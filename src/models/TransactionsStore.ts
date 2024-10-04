import {
  Instance,
  SnapshotOut,
  types,
  flow,
  detach,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {
  TransactionModel,
  Transaction,
  TransactionStatus,
  TransactionRecord,
} from './Transaction'
import {Database} from '../services'
import {log} from '../services/logService'
import { getRootStore } from './helpers/getRootStore'
import { formatDistance } from 'date-fns'
import { MintUnit } from '../services/wallet/currency'
import { Mint } from './Mint'

export const maxTransactionsInModel = 10
export const maxTransactionsByMint = 10
export const maxTransactionsByHostname = 3
export const maxTransactionsByUnit = 3

export type GroupedByTimeAgo = {
    [timeAgo: string]: Transaction[];
}

export const TransactionsStoreModel = types
    .model('TransactionsStore', {
        transactions: types.array(TransactionModel),
    })
    .actions(withSetPropAction)
    .views(self => ({
        get all() {
            return self.transactions
                .slice()
                .sort((a, b) => {
                    // Sort by createdAt timestamp
                    if (a.createdAt && b.createdAt) {
                        return b.createdAt.getTime() - a.createdAt.getTime()
                    }
            }) as Transaction[]
        },
        get count() {
            return self.transactions.length
        },
        get recent() {
            return this.all.slice(0, 3) // Return the first 3 transactions
        },
        get pending() {
            return this.all.filter(t => t.status === TransactionStatus.PENDING)
        },
        get groupedByTimeAgo() {
            return this.all.reduce((groups: GroupedByTimeAgo, transaction: Transaction) => {
                const timeAgo = formatDistance(transaction.createdAt as Date, new Date(), {addSuffix: true})  
                if (!groups[timeAgo]) {
                    groups[timeAgo] = []
                }
                groups[timeAgo].push(transaction)
                return groups
            }, {})
        },
        get groupedPendingByTimeAgo() {
            return this.pending.reduce((groups: GroupedByTimeAgo, transaction: Transaction) => {
                const timeAgo = formatDistance(transaction.createdAt as Date, new Date(), {addSuffix: true})  
                if (!groups[timeAgo]) {
                    groups[timeAgo] = []
                }
                groups[timeAgo].push(transaction)
                return groups
            }, {})
        },   

        recentByHostname(mintHostname: string) {            
            return this.all.filter(t => getHostname(t.mint as string) === mintHostname).slice(0, maxTransactionsByHostname)
        },
        recentByUnit(unit: MintUnit, count?: number) {
            if (!count || count > maxTransactionsByUnit) {
                count = maxTransactionsByUnit
            }
                      
            return this.all.filter(t => t.unit === unit).slice(0, count)
        },
        recentByHostnameGroupedByTimeAgo(mintHostname: string) {
            const recentByHostname = this.recentByHostname(mintHostname)

            return recentByHostname.reduce((groups: GroupedByTimeAgo, transaction: Transaction) => {
                const timeAgo = formatDistance(transaction.createdAt as Date, new Date(), {addSuffix: true})  
                if (!groups[timeAgo]) {
                    groups[timeAgo] = []
                }
                groups[timeAgo].push(transaction)
                return groups
            }, {})
        },
        getByMint(mintUrl: string) {
            return this.all.filter(t => t.mint === mintUrl)
        },
        countByMint(mintUrl: string) {
            return this.getByMint(mintUrl).length
        }  
    }))
    .actions(self => ({
        findById(id: number) {
            
            let tx = self.transactions.find(tx => tx.id === id)

            // Search the db and add if tx is not in the state
            if(!tx) {
                const dbTransaction = Database.getTransactionById(id)

                if(dbTransaction) {
                    const createdAt = new Date(dbTransaction.createdAt)
                    const inStoreTransaction = {...dbTransaction, createdAt}
    
                    tx = TransactionModel.create(inStoreTransaction)
                    self.transactions.push(tx)
                }
            }

            return tx
        },
        removeOldTransactions: () => { // not used
            const numTransactions = self.count

            // If there are more than 10 transactions, delete the older ones
            if (numTransactions > maxTransactionsInModel) {
                self.transactions
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .splice(maxTransactionsInModel) // Remove transactions beyond the desired number to keep

                log.debug('[removeOldTransactions]', `${
                    numTransactions - maxTransactionsInModel
                    } transaction(s) removed from TransactionsStore`,
                )
            }
        },
        removeOldByMint: (mintUrl: string) => {
            const numByMint = self.countByMint(mintUrl)            
            
            if (numByMint > maxTransactionsByMint) {
                const transactionsToRemove = self.getByMint(mintUrl)
                .slice()
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(maxTransactionsByMint)
                
                transactionsToRemove.map((t) => {                    
                    detach(t)                                       
                }) 

                self.transactions.replace(self.transactions.filter(t => !transactionsToRemove.some(removed => removed.id === t.id)))

                const txByMintAfterDelete = self.countByMint(mintUrl)
                const txTotalAfterDelete = self.count

                log.trace('[removeOldByMint]', {txByMintAfterDelete, txTotalAfterDelete})
            }
        },
        removeAllWithoutCurrentMint: () => {
            const rootStore = getRootStore(self)                
            const {mintsStore} = rootStore

            const transactionsToRemove = self.transactions.filter(transaction => {
                // Check if the mint property of the transaction does not exist in the mints array
                return !mintsStore.allMints.some((mint: Mint) => mint.mintUrl === transaction.mint);
            });

            self.transactions.replace(self.transactions.filter(t => !transactionsToRemove.some(removed => removed.id === t.id)))
            
            const txTotalAfterDelete = self.count

            log.trace('[removeAllWithoutCurrentMint]', {deleted: transactionsToRemove.length, txTotalAfterDelete})
            
        }         
    }))
    .actions(self => ({
        addTransaction: flow(function* addTransaction(newTransaction){
            // First let's store the transaction into the database
            const dbTransaction: TransactionRecord = yield Database.addTransactionAsync(newTransaction)

            // Add the new transaction to the transactions store
            const createdAt = new Date(dbTransaction.createdAt)
            const inStoreTransaction = {...dbTransaction, createdAt}

            const transactionInstance = TransactionModel.create(inStoreTransaction)
            self.transactions.push(transactionInstance)

            log.debug('[addTransaction]', 'New transaction added to the TransactionsStore')

            // Purge the oldest transaction from cache, but keep some for each mint
            self.removeOldByMint(newTransaction.mint)

            return transactionInstance as Transaction
        }),
        addTransactionsToModel: (dbTransactions: TransactionRecord[]) => {
            // This adds to model only. Used to have observable UI in tx history loaded from database.
            const inStoreTransactions: Transaction[] = []

            for (const dbTransaction of dbTransactions) {
                const createdAt = new Date(dbTransaction.createdAt)
                const inStoreTransaction = {...dbTransaction, createdAt}

                if(self.findById(inStoreTransaction.id as number)) {
                    log.trace('[addTransactionsToModel] Transaction already exists in the model, skipping...')
                    continue
                }   
                
                const transactionInstance = TransactionModel.create(inStoreTransaction)
                inStoreTransactions.push(transactionInstance as Transaction)
            }

            self.transactions.push(...inStoreTransactions)

            log.debug('[addTransactionsToModel]', `${inStoreTransactions.length} new transactions added to TransactionsStore`)
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
                const transactionInstance = self.findById(id)

                if (transactionInstance) {
                    transactionInstance.status = status

                    // Awkward but I want to keep function signature aligned with single status update
                    const updatedData = JSON.parse(transactionInstance.data)
                    updatedData.push(JSON.parse(data))
                    transactionInstance.data = JSON.stringify(updatedData)

                    log.debug('[updateStatuses]', 'Transaction statuses and data updated in TransactionsStore', {ids, status})
                }
            }
        }),
        expireAllAfterRecovery: flow(function* expireAllAfterRecovery() {
            // Update status in database
            yield Database.expireAllAfterRecovery()

            // Update the model statuses
            for (const t of self.all) {
                t.setIsExpired()
            }
        }),        
        deleteByStatus: (status: TransactionStatus) => {            
            for (const transaction of self.transactions) {
                if(transaction.status === status) {
                    detach(transaction)                    
                }
            }
            
            self.transactions.replace(self.transactions.filter(t => t.status !== status))

            return Database.deleteTransactionsByStatus(status)
        },
        removeAllTransactions() {
            self.transactions.clear()
            log.debug('[removeAllTransactions]', 'Removed all transactions from TransactionsStore')
        },
    }))

    const getHostname = function (mintUrl: string) {
        try {
            return new URL(mintUrl).hostname
        } catch (e) {
            return false
        }
    }

// refresh
export interface TransactionsStore
  extends Instance<typeof TransactionsStoreModel> {}
export interface TransactionsStoreSnapshot
  extends SnapshotOut<typeof TransactionsStoreModel> {}
