import {
  Instance,
  SnapshotOut,
  types,
  flow,
  destroy,
  isStateTreeNode,
  detach,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {
  TransactionModel,
  Transaction,
  TransactionStatus,
  TransactionRecord,
} from './Transaction'
import {Database, MintClient} from '../services'
import {log} from '../services/logService'

export const maxTransactionsInModel = 10
export const maxTransactionsByMint = 10
export const maxTransactionsByHostname = 4

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
            })
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
        findById(id: number) {
            const tx = self.transactions.find(tx => tx.id === id)
            return tx || undefined
        },
        recentByHostname(mintHostname: string) {
            return this.all.filter(t => t.mint?.includes(mintHostname)).slice(0, maxTransactionsByHostname)
        },
        getByMint(mintUrl: string) {
            return this.all.filter(t => t.mint === mintUrl)
        },
        countByMint(mintUrl: string) {
            return this.getByMint(mintUrl).length
        }   
    }))
    .actions(self => ({
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
                self.getByMint(mintUrl)
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .splice(maxTransactionsByMint)

                log.debug('[removeOldByMint]', `${
                    numByMint - maxTransactionsByMint
                    } transaction(s) removed from TransactionsStore`,
                )
            }
        }        
    }))
    .actions(self => ({
        addTransaction: flow(function* addTransaction(newTransaction: Transaction) {
            // First let's store the transaction into the database
            const dbTransaction = yield Database.addTransactionAsync(newTransaction)

            // Add the new transaction to the transactions store
            const createdAt = new Date(dbTransaction.createdAt)
            const inStoreTransaction = {...dbTransaction, createdAt}

            const transactionInstance = TransactionModel.create(inStoreTransaction)
            self.transactions.push(transactionInstance)

            log.debug('[addTransaction]', 'New transaction added to the TransactionsStore')

            // Purge the oldest transaction from cache, but keep some for each mint
            self.removeOldByMint(newTransaction.mint)

            return transactionInstance
        }),
        addTransactionsToModel: (dbTransactions: TransactionRecord[]) => {
            // This adds to model only. Used to have observable UI in tx history loaded from database.
            const inStoreTransactions: Transaction[] = []

            for (const dbTransaction of dbTransactions) {
                const createdAt = new Date(dbTransaction.createdAt)
                const inStoreTransaction = {...dbTransaction, createdAt}

                const transactionInstance = TransactionModel.create(inStoreTransaction)
                inStoreTransactions.push(transactionInstance as Transaction)
            }

            self.transactions.push(...inStoreTransactions)

            log.debug('[addTransactionsToModel]', `${inStoreTransactions.length} new transactions added to TransactionsStore`)
        },
        updateStatus: flow(function* updateStatus( // TODO append, not replace status to align behavior with updateStatuses
            id: number,
            status: TransactionStatus,
            data: string,
        ) {
            // Update status and set related tx data in database
            yield Database.updateStatusAsync(id, status, data)
            const transactionInstance = self.findById(id)

            // Update in the model
            if (transactionInstance) {
                transactionInstance.status = status
                transactionInstance.data = data 
                log.debug('[updateStatus]', 'Transaction status and data updated in TransactionsStore', {id, status})
            }

            return transactionInstance
        }),
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
        updateBalanceAfter: flow(function* updateBalanceAfter(
            id: number,
            balanceAfter: number,
        ) {
            // Update status and related metadata in database
            yield Database.updateBalanceAfterAsync(id, balanceAfter)

            const transactionInstance = self.findById(id)

            // Update in the model
            if (transactionInstance) {
                transactionInstance.balanceAfter = balanceAfter
                log.debug('[updateBalanceAfter]', 'Transaction balanceAfter updated in TransactionsStore', {balanceAfter})
            }

            return transactionInstance
        }),
        updateFee: flow(function* updateFee(id: number, fee: number) {
            // Update status and related metadata in database
            yield Database.updateFeeAsync(id, fee)

            const transactionInstance = self.findById(id)

            // Update in the model
            if (transactionInstance) {
                transactionInstance.fee = fee
                log.debug('[updateFee]', 'Transaction fee updated in TransactionsStore', {fee})
            }

            return transactionInstance
        }),
        updateReceivedAmount: flow(function* updateReceivedAmount(
            id: number,
            amount: number,
        ) {
            // Update status and related metadata in database
            yield Database.updateReceivedAmountAsync(id, amount)

            const transactionInstance = self.findById(id)

            // Update in the model
            if (transactionInstance) {
                transactionInstance.amount = amount
                log.debug('[updateReceivedAmount]', 'Transaction amount updated in TransactionsStore', {id, amount})
            }

            return transactionInstance
        }),
        saveNote: flow(function* saveNote(id: number, note: string) {
            // update note stored in database
            yield Database.updateNoteAsync(id, note)

            // check if the tx is in recent transactions stored in this store
            const transactionInstance = self.findById(id)
            // if we found it, we update the model so that the UI updates
            // TODO how to handle missing UI updates for older notes that are stored in db only
            if (transactionInstance) {
                transactionInstance.noteToSelf = note
                log.debug('[saveNote]', 'Transaction note updated in TransactionsStore', {note})
            }
        }),
        updateSentFrom: flow(function* updateSentFrom(id: number, sentFrom: string) {

            yield Database.updateSentFromAsync(id, sentFrom)
            const transactionInstance = self.findById(id)
            if (transactionInstance) {
                transactionInstance.sentFrom = sentFrom
                log.debug('[updateSentFrom]', 'Transaction sentFrom updated in TransactionsStore', {id, sentFrom})
            }
        }),
        updateSentTo: flow(function* updateSentTo(id: number, sentTo: string) { //

            yield Database.updateSentToAsync(id, sentTo)
            const transactionInstance = self.findById(id)
            if (transactionInstance) {
                transactionInstance.sentTo = sentTo
                log.debug('[updateSentTo]', 'Transaction sentTo updated in TransactionsStore', {id, sentTo})
            }
        }),
        removeAllTransactions() {
            self.transactions.clear()
            log.debug('[removeAllTransactions]', 'Removed all transactions from TransactionsStore')
        },
    }))

// refresh
export interface TransactionsStore
  extends Instance<typeof TransactionsStoreModel> {}
export interface TransactionsStoreSnapshot
  extends SnapshotOut<typeof TransactionsStoreModel> {}
