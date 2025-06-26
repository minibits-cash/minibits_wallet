import {
    Instance,
    SnapshotOut,
    types,
    flow,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {
    TransactionModel,
    Transaction,
    TransactionStatus,
} from './Transaction'
import {Database} from '../services'
import {log} from '../services/logService'
import { getRootStore } from './helpers/getRootStore'
import { formatDistance } from 'date-fns'
import { MintUnit } from '../services/wallet/currency'
import { Mint } from './Mint'

export const maxTransactionsInHistory = 10
export const maxTransactionsByUnit = 3

export type GroupedByTimeAgo = {
    [timeAgo: string]: Transaction[];
}

export const TransactionsStoreModel = types
    .model('TransactionsStore', {
        transactionsMap: types.map(TransactionModel),
        history: types.array(types.safeReference(TransactionModel, { acceptsUndefined: false })),
        recentByUnit: types.array(types.safeReference(TransactionModel, { acceptsUndefined: false })),
    })
    .actions(withSetPropAction)
    .views(self => ({
        get pendingHistory() {
            return self.history
                .slice()
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .filter(t => t.status === TransactionStatus.PENDING)
        },
        get historyByTimeAgo() {
            return self.history
                .slice()
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .reduce((groups: GroupedByTimeAgo, transaction: Transaction) => {
                    const timeAgo = formatDistance(transaction.createdAt as Date, new Date(), { addSuffix: true })
                    if (!groups[timeAgo]) {
                        groups[timeAgo] = []
                    }
                    groups[timeAgo].push(transaction)
                    return groups
                }, {})
        },
        get historyPendingByTimeAgo() {
            return this.pendingHistory.reduce((groups: GroupedByTimeAgo, transaction: Transaction) => {
                const timeAgo = formatDistance(transaction.createdAt as Date, new Date(), { addSuffix: true })
                if (!groups[timeAgo]) {
                    groups[timeAgo] = []
                }
                groups[timeAgo].push(transaction)
                return groups
            }, {})
        },
        get historyCount() {
            return self.history.length
        },
        get pendingHistoryCount() {
            return this.pendingHistory.length
        },
        getRecentByUnit(unit: MintUnit) {
            return self.recentByUnit
                .slice()
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .filter(t => t.unit === unit)
        },
        getPendingTopups() {
            const dbTopups: Transaction[] = Database.getPendingTopups()

            if (dbTopups.length > 0) {
                const pendingTopups: Transaction[] = []
                for (const topup of dbTopups) {
                    const inStoreTransaction = { ...topup }
                    const topupInstance = TransactionModel.create(inStoreTransaction)
                    pendingTopups.push(topupInstance)
                }
                return pendingTopups
            }
            return []
        },
        getPendingTransfers() {
            const dbTransfers: Transaction[] = Database.getPendingTransfers()

            if (dbTransfers.length > 0) {
                const pendingTransfers: Transaction[] = []
                for (const transfer of dbTransfers) {
                    const inStoreTransaction = { ...transfer }
                    const transferInstance = TransactionModel.create(inStoreTransaction)
                    pendingTransfers.push(transferInstance)
                }
                return pendingTransfers
            }
            return []
        },
        countRecentByUnit(unit: MintUnit) {
            return this.getRecentByUnit(unit).length
        }
    }))
    .actions(self => ({
        findById(id: number, loadTokens?: boolean) {
            let transaction = self.transactionsMap.get(id)

            // Search the db and add if tx is not in the state
            // Search always to retrieve full tokens in tx detail screen
            if (!transaction || loadTokens === true) {
                const dbTransaction = Database.getTransactionById(id)

                if (dbTransaction) {
                    const inStoreTransaction = { ...dbTransaction }
                    const { id } = dbTransaction

                    if (!loadTokens) {
                        // Shorten for performance reasons
                        if (inStoreTransaction.inputToken && inStoreTransaction.inputToken.length > 0) {
                            inStoreTransaction.inputToken = inStoreTransaction.inputToken?.slice(0, 40)
                        }
                        if (inStoreTransaction.outputToken && inStoreTransaction.outputToken.length > 0) {
                            inStoreTransaction.outputToken = inStoreTransaction.outputToken?.slice(0, 40)
                        }
                    }

                    self.transactionsMap.set(id, inStoreTransaction)
                    transaction = self.transactionsMap.get(id)
                }
            }

            return transaction
        },
        findBy(criteria: { paymentId?: string; quote?: string; paymentRequest?: string }) {
            let dbTransaction: Transaction
            let key: string, value: string

            try {
                dbTransaction = Database.getTransactionBy(criteria)
            } catch (e: any) {
                const entry = Object.entries(criteria).find(([_, v]) => v != null)
                if (entry) {
                    [key, value] = entry
                    log.warn('[findBy]', `Transaction with ${key} ${value} not found in database`)
                } else {
                    log.warn('[findBy]', 'Invalid search criteria', { criteria })
                }
                return undefined
            }

            const inStoreTransaction = { ...dbTransaction }
            const { id } = dbTransaction

            // Shorten for performance reasons
            if (inStoreTransaction.inputToken && inStoreTransaction.inputToken.length > 0) {
                inStoreTransaction.inputToken = inStoreTransaction.inputToken.slice(0, 40)
            }
            if (inStoreTransaction.outputToken && inStoreTransaction.outputToken.length > 0) {
                inStoreTransaction.outputToken = inStoreTransaction.outputToken.slice(0, 40)
            }

            self.transactionsMap.set(id, inStoreTransaction)
            return self.transactionsMap.get(id)
        },
        pruneRecentByUnit(unit: MintUnit) {
            const unitCount = self.countRecentByUnit(unit)
            log.trace('[pruneRecentByUnit]', { unit, unitCount })

            if (unitCount > maxTransactionsByUnit) {
                const transactionsToRemove = self.getRecentByUnit(unit)
                    .slice()
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                    .splice(maxTransactionsByUnit)

                self.recentByUnit.replace(
                    self.recentByUnit.filter(
                        t => !transactionsToRemove.some(removed => removed.id === t.id)
                    )
                )
                log.trace('[pruneRecentByUnit]', `${transactionsToRemove.length} pruned from recentByUnit`)
            }
        },
        pruneRecentWithoutCurrentMint() {
            const rootStore = getRootStore(self)
            const { mintsStore } = rootStore

            const transactionsToRemove = self.recentByUnit.filter(transaction => {
                // Check if the mint property of the transaction does not exist in the mints array
                return !mintsStore.allMints.some((mint: Mint) => mint.mintUrl === transaction.mint)
            })

            self.recentByUnit.replace(
                self.recentByUnit.filter(
                    t => !transactionsToRemove.some(removed => removed.id === t.id)
                )
            )
            log.trace(
                '[pruneRecentWithoutCurrentMint]',
                `${transactionsToRemove.length} pruned from recentByUnit`
            )
        },
        pruneHistory() {
            // Step 1: Trim history to keep only the MAX_HISTORY_TRANSACTIONS most recent
            if (self.history.length > maxTransactionsInHistory) {
                const transactionsToRemove = self.history
                    .slice()
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                    .splice(maxTransactionsInHistory)

                self.history.replace(
                    self.history.filter(
                        t => !transactionsToRemove.some(removed => removed.id === t.id)
                    )
                )
                log.trace('[pruneHistory]', `${transactionsToRemove.length} pruned from history`)
            }
        },
        removeAllHistory() {
            self.history.clear()
            log.debug('[removeAllHistory]', 'Removed all transactions from history')
        },
        removeAllRecentByUnit() {
            self.recentByUnit.clear()
            log.debug('[removeAllRecentByUnit]', 'Removed all transactions from recentByUnit')
        },
        removeAllTransactions() {
            self.recentByUnit.clear()
            self.history.clear()
            self.transactionsMap.clear()
            log.debug('[removeAllTransactions]', 'Removed all transactions from TransactionsStore')
        },
    }))
    .actions(self => ({
        addTransaction: flow(function* addTransaction(newTransaction) {
            // First let's store the transaction into the database
            const dbTransaction: Transaction = yield Database.addTransactionAsync(newTransaction)

            // Add the new transaction to the transactions store
            const inStoreTransaction = { ...dbTransaction }
            const { id } = dbTransaction

            if (!self.transactionsMap.has(id)) {
                self.transactionsMap.set(id, inStoreTransaction)
            }

            const reference = self.transactionsMap.get(id)
            self.history.unshift(reference!)
            self.recentByUnit.unshift(reference!)

            // Purge the oldest references from cache, but keep some for each mint
            self.pruneRecentByUnit(newTransaction.unit)
            self.pruneHistory()

            return reference as Transaction
        }),
        addToHistory(limit: number, offset: number, onlyPending: boolean) {
            // Appends transaction to the map and adds reference to history from database.
            const transactions = Database.getTransactions(limit, offset, onlyPending)
            log.trace('[addToHistory] transactions ids', {
                ids: transactions ? transactions.map(t => t.id) : []
            })

            if (transactions && transactions.length > 0) {
                for (const dbTransaction of transactions) {
                    const inStoreTransaction = { ...dbTransaction }

                    // Shorten for performance reasons
                    if (inStoreTransaction.inputToken && inStoreTransaction.inputToken.length > 0) {
                        inStoreTransaction.inputToken = inStoreTransaction.inputToken?.slice(0, 40)
                    }
                    if (inStoreTransaction.outputToken && inStoreTransaction.outputToken.length > 0) {
                        inStoreTransaction.outputToken = inStoreTransaction.outputToken?.slice(0, 40)
                    }

                    const { id } = dbTransaction

                    if (!self.transactionsMap.has(id)) {
                        self.transactionsMap.set(id, inStoreTransaction)
                        log.trace('[addToHistory]', `${id} added to transactionsMap`)
                    }

                    const reference = self.transactionsMap.get(id)

                    if (!self.history.find(t => t.id === id)) {
                        self.history.push(reference!)
                        log.trace(
                            '[addToHistory]',
                            `${onlyPending ? 'Pending reference' : 'Reference'} ${id} added to history`
                        )
                    }
                }
            }
        },
        addRecentByUnit() {
            // Rehydrates recent from database.
            const transactions = Database.getRecentTransactionsByUnit(maxTransactionsByUnit)

            if (transactions && transactions.length > 0) {
                for (const dbTransaction of transactions) {
                    const inStoreTransaction = { ...dbTransaction }

                    // Shorten for performance reasons
                    if (inStoreTransaction.inputToken && inStoreTransaction.inputToken.length > 0) {
                        inStoreTransaction.inputToken = inStoreTransaction.inputToken?.slice(0, 40)
                    }
                    if (inStoreTransaction.outputToken && inStoreTransaction.outputToken.length > 0) {
                        inStoreTransaction.outputToken = inStoreTransaction.outputToken?.slice(0, 40)
                    }

                    const { id } = dbTransaction

                    if (!self.transactionsMap.has(id)) {
                        self.transactionsMap.set(id, inStoreTransaction)
                    }

                    const reference = self.transactionsMap.get(id)

                    if (!self.recentByUnit.find(t => t.id === id)) {
                        self.recentByUnit.push(reference!)
                        log.trace(
                            '[addRecentByUnit]',
                            `Transaction ${inStoreTransaction.id} added to recentByUnit`
                        )
                    }
                }
            }
        },
        updateStatuses: flow(function* updateStatuses(
            ids: number[],
            status: TransactionStatus,
            data: string,
        ) {
            // Update status and amend to existing data in database
            yield Database.updateStatusesAsync(ids, status, data)

            // Update the model status and amend related tx data
            for (const id of ids) {
                const transactionInstance = self.transactionsMap.get(id)

                if (transactionInstance) {
                    transactionInstance.status = status

                    // Awkward but I want to keep function signature aligned with single status update
                    const updatedData = JSON.parse(transactionInstance.data)
                    updatedData.push(JSON.parse(data))
                    transactionInstance.data = JSON.stringify(updatedData)
                }

                log.trace(
                    '[updateStatuses]',
                    'Transaction statuses and data updated in TransactionsStore',
                    { ids, status }
                )
            }
        }),
        deleteByStatus(status: TransactionStatus) {
            self.transactionsMap.forEach((transaction, transactionId) => {
                if (transaction.status === status) {
                    self.transactionsMap.delete(transactionId as string)
                }
            })
            return Database.deleteTransactionsByStatus(status)
        }
    })).postProcessSnapshot((snapshot) => {
        // Trim history if it exceeds the limit
        let prunedHistory = snapshot.history

        if (snapshot.history.length > maxTransactionsInHistory) {
            // Keep only the most recent transactions within the limit
            const orderedHistory = [...snapshot.history].sort((a, b) => (b as number) - (a as number))
            prunedHistory = orderedHistory.slice(0, maxTransactionsInHistory)
        }

        // Clean up transactionMap: remove transactions not in history or recentByUnit
        const prunedTransactionsMap = Object.fromEntries(
            Object.entries(snapshot.transactionsMap).filter(([transactionId]) =>
                prunedHistory.includes(parseInt(transactionId)) ||
                snapshot.recentByUnit.includes(parseInt(transactionId))
            )
        )

        // Return the new snapshot with the trimmed history and filtered transactionMap
        const prunedSnapshot = {
            ...snapshot,
            history: prunedHistory,
            transactionsMap: prunedTransactionsMap
        }

        return prunedSnapshot
    })

// refresh
export interface TransactionsStore
    extends Instance<typeof TransactionsStoreModel> {}
export interface TransactionsStoreSnapshot
    extends SnapshotOut<typeof TransactionsStoreModel> {}