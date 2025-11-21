import {
    Instance,
    SnapshotOut,
    types,
    flow,
    getSnapshot,
} from 'mobx-state-tree'
import { withSetPropAction } from './helpers/withSetPropAction'
import {
    TransactionModel,
    Transaction,
    TransactionStatus,
} from './Transaction'
import { Database } from '../services'
import { log } from '../services/logService'
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

        get historyByTimeAgo(): GroupedByTimeAgo {
            return self.history
                .slice()
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .reduce((groups, tx) => {
                    const key = formatDistance(tx.createdAt, new Date(), { addSuffix: true })
                    ;(groups[key] ??= []).push(tx)
                    return groups
                }, {} as GroupedByTimeAgo)
        },

        get historyPendingByTimeAgo(): GroupedByTimeAgo {
            return this.pendingHistory.reduce((groups, tx) => {
                const key = formatDistance(tx.createdAt, new Date(), { addSuffix: true })
                ;(groups[key] ??= []).push(tx)
                return groups
            }, {} as GroupedByTimeAgo)
        },

        get historyCount() { return self.history.length },
        get pendingHistoryCount() { return this.pendingHistory.length },

        getRecentByUnit(unit: MintUnit): Transaction[] {
            return self.recentByUnit
                .slice()
                .filter(t => t.unit === unit)
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        },

        countRecentByUnit(unit: MintUnit): number {
            return this.getRecentByUnit(unit).length
        },
        
        getPendingTopups(): Transaction[] {
            const dbTopups = Database.getPendingTopups()
            return dbTopups.map(t => TransactionModel.create({ ...t }))
        },

        getPendingTransfers(): Transaction[] {
            const dbTransfers = Database.getPendingTransfers()
            return dbTransfers.map(t => TransactionModel.create({ ...t }))
        },
    }))

    
    .actions(self => ({
        findById(id: number, loadTokens = false): Transaction | undefined {
            let tx = self.transactionsMap.get(String(id))

            if (!tx || loadTokens) {
                const dbTx = Database.getTransactionById(id)
                if (!dbTx) return undefined

                const inStoreTx = { ...dbTx }
                if (!loadTokens) {
                    inStoreTx.inputToken = inStoreTx.inputToken?.slice(0, 40) || ''
                    inStoreTx.outputToken = inStoreTx.outputToken?.slice(0, 40) || ''
                }

                self.transactionsMap.set(String(id), inStoreTx)
                tx = self.transactionsMap.get(String(id))
            }
            return tx
        },

        findBy(criteria: { paymentId?: string; quote?: string; paymentRequest?: string }): Transaction | undefined {
            let dbTx: Transaction
            try {
                dbTx = Database.getTransactionBy(criteria)
            } catch {
                return undefined
            }

            const inStoreTx = {
                ...dbTx,
                inputToken: dbTx.inputToken?.slice(0, 40) || '',
                outputToken: dbTx.outputToken?.slice(0, 40) || '',
            }

            self.transactionsMap.set(String(dbTx.id), inStoreTx)
            return self.transactionsMap.get(String(dbTx.id))
        },
        
        pruneHistory() {
            if (self.history.length <= maxTransactionsInHistory) return

            const keep = self.history
                .slice()
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(0, maxTransactionsInHistory)

            self.history.replace(keep)
            log.trace('[pruneHistory]', `${self.history.length} kept in history`)
        },

        pruneRecentByUnit(unit: MintUnit) {
            const recent = self.getRecentByUnit(unit)
            if (recent.length <= maxTransactionsByUnit) return

            const keepIds = new Set(recent.slice(0, maxTransactionsByUnit).map(t => t.id))
            const newList = self.recentByUnit.filter(t => t.unit !== unit || keepIds.has(t.id))

            self.recentByUnit.replace(newList)
            log.trace('[pruneRecentByUnit]', `${recent.length - keepIds.size} pruned for unit ${unit}`)
        },

        pruneRecentWithoutCurrentMint() {
            const { mintsStore } = getRootStore(self)
            const validUrls = new Set(mintsStore.allMints.map(m => m.mintUrl))

            const newList = self.recentByUnit.filter(tx => validUrls.has(tx.mint))
            if (newList.length !== self.recentByUnit.length) {
                self.recentByUnit.replace(newList)
                log.trace('[pruneRecentWithoutCurrentMint]', `${self.recentByUnit.length - newList.length} removed`)
            }
        },

        removeAllHistory() { self.history.clear() },
        removeAllRecentByUnit() { self.recentByUnit.clear() },
        removeAllTransactions() {
            self.history.clear()
            self.recentByUnit.clear()
            self.transactionsMap.clear()
        },
    }))

    .actions(self => ({
        // ── Main add (push + safe prune) ──
        addTransaction: flow(function* addTransaction(newTxData: Partial<Transaction>) {
            const dbTx: Transaction = yield Database.addTransactionAsync(newTxData)
            const tx = TransactionModel.create(dbTx)

            self.transactionsMap.set(String(dbTx.id), tx)
            self.history.push(tx)
            self.recentByUnit.push(tx)

            self.pruneHistory()
            self.pruneRecentByUnit(dbTx.unit)

            return tx
        }),

        // ── Lazy load more history ──
        addToHistory: flow(function* addToHistory(limit: number, offset: number, onlyPending: boolean) {
            // Appends transaction to the map and adds reference to history from database.
            const transactions = yield Database.getTransactionsAsync(limit, offset, onlyPending)

            for (const dbTx of transactions) {
                const { id } = dbTx

                if (!self.transactionsMap.has(id)) {
                    self.transactionsMap.set(id, {
                        ...dbTx,
                        inputToken: dbTx.inputToken?.slice(0, 40) || '',
                        outputToken: dbTx.outputToken?.slice(0, 40) || '',
                    })
                    log.trace('[addToHistory]', `${id} added to transactionsMap`)
                }

                const ref = self.transactionsMap.get(id)

                if (!self.history.find(t => t.id === id)) {
                    if(ref) self.history.push(ref)
                }
            }
            
        }),

        // ── Rehydrate recent on app start ──
        addRecentByUnit: flow(function* addRecentByUnit() {
            const dbTxs = yield Database.getRecentTransactionsByUnitAsync(maxTransactionsByUnit)
            if (!dbTxs?.length) return

            for (const dbTx of dbTxs) {
                if (self.transactionsMap.has(String(dbTx.id))) continue

                const tx = TransactionModel.create({
                    ...dbTx,
                    inputToken: dbTx.inputToken?.slice(0, 40) || '',
                    outputToken: dbTx.outputToken?.slice(0, 40) || '',
                })

                self.transactionsMap.set(String(dbTx.id), tx)
                if (!self.recentByUnit.some(t => t.id === dbTx.id)) {
                    self.recentByUnit.push(tx)
                }
            }
        }),

       updateStatuses: flow(function* updateStatuses(ids: number[], status: TransactionStatus, data: string) {
            yield Database.updateStatusesAsync(ids, status, data)

            for (const id of ids) {
                const tx = self.transactionsMap.get(String(id))
                if (tx) {
                    tx.status = status
                    const parsed = JSON.parse(tx.data || '[]')
                    parsed.push(JSON.parse(data))
                    tx.data = JSON.stringify(parsed)
                }
            }
        }),

        deleteByStatus(status: TransactionStatus) {
            const toDelete: number[] = []

            self.transactionsMap.forEach((tx, key) => {
                if (tx.status === status) {
                    toDelete.push(tx.id)
                    self.transactionsMap.delete(key as string)
                }
            })

            if (toDelete.length > 0) {
                self.history.replace(self.history.filter(t => !toDelete.includes(t.id)))
                self.recentByUnit.replace(self.recentByUnit.filter(t => !toDelete.includes(t.id)))
            }

            return Database.deleteTransactionsByStatus(status)
        },

    }))

    .actions(self => ({       
        
        loadRecentFromDatabase: flow(function* loadRecentFromDatabase() {
            if (self.history.length > 0 || self.recentByUnit.length > 0) return // already loaded

            yield self.addRecentByUnit() // wallet screen
            yield self.addToHistory(maxTransactionsInHistory, 0, false) // tx screen

            log.trace('[TransactionsStore] Rehydrated from database')
        }),
        
    }))
    
    .postProcessSnapshot(() => ({
        transactionsMap: {},
        history: [],
        recentByUnit: [],
    }))

export interface TransactionsStore extends Instance<typeof TransactionsStoreModel> {}
export interface TransactionsStoreSnapshot extends SnapshotOut<typeof TransactionsStoreModel> {}