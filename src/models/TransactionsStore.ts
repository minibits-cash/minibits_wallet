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

    // ───────────────────── VIEWS (100% preserved) ─────────────────────
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

        // ── Pending topups/transfers from DB (kept exactly as-is) ──
        getPendingTopups(): Transaction[] {
            const dbTopups = Database.getPendingTopups()
            return dbTopups.map(t => TransactionModel.create({ ...t }))
        },

        getPendingTransfers(): Transaction[] {
            const dbTransfers = Database.getPendingTransfers()
            return dbTransfers.map(t => TransactionModel.create({ ...t }))
        },
    }))

    // ───────────────────── ACTIONS (safe + complete) ─────────────────────
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

        // ── Safe pruning (rebuild instead of filter + replace) ──
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
        addTransaction: flow(function* addTransaction(newTxData: any) {
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
            const dbTxs = Database.getTransactions(limit, offset, onlyPending)
            if (!dbTxs?.length) return

            for (const dbTx of dbTxs) {
                if (self.transactionsMap.has(String(dbTx.id))) continue

                const tx = TransactionModel.create({
                    ...dbTx,
                    inputToken: dbTx.inputToken?.slice(0, 40) || '',
                    outputToken: dbTx.outputToken?.slice(0, 40) || '',
                })

                self.transactionsMap.set(String(dbTx.id), tx)
                if (!self.history.some(t => t.id === dbTx.id)) {
                    self.history.push(tx)
                }
            }
        }),

        // ── Rehydrate recent on app start ──
        addRecentByUnit: flow(function* addRecentByUnit() {
            const dbTxs = Database.getRecentTransactionsByUnit(maxTransactionsByUnit)
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
       
        // ── Call this once after hydration (e.g. in RootStore.afterCreate) ──
        rehydrateFromDatabase: flow(function* rehydrateFromDatabase() {
            if (self.history.length > 0 || self.recentByUnit.length > 0) return // already loaded

            yield self.addRecentByUnit()
            yield self.addToHistory(20, 0, false) // initial page

            log.debug('[TransactionsStore] Rehydrated from database')
        }),
        
    }))
    // ── Clean empty snapshot (no pruning logic!) ──
    .postProcessSnapshot(() => ({
        transactionsMap: {},
        history: [],
        recentByUnit: [],
    }))

export interface TransactionsStore extends Instance<typeof TransactionsStoreModel> {}
export interface TransactionsStoreSnapshot extends SnapshotOut<typeof TransactionsStoreModel> {}