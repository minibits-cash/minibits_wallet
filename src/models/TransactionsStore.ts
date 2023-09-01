import {
  Instance,
  SnapshotOut,
  types,
  flow,
  destroy,
  isStateTreeNode,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {
  TransactionModel,
  Transaction,
  TransactionStatus,
  TransactionRecord,
} from './Transaction'
import {Database} from '../services'
import {log} from '../utils/logger'

export const maxTransactionsInModel = 10

export const TransactionsStoreModel = types
    .model('TransactionsStore', {
        transactions: types.array(TransactionModel),
    })
    .actions(withSetPropAction)
    .actions(self => ({
        findById: (id: number) => {
            const tx = self.transactions.find(tx => tx.id === id)
            return tx ? tx : undefined
        },
        removeTransaction: (removedTransaction: Transaction) => {
            let transactionInstance: Transaction | undefined

            if (isStateTreeNode(removedTransaction)) {
                transactionInstance = removedTransaction
            } else {
                transactionInstance = self.transactions.find(
                (t: Transaction) => t.id === (removedTransaction as Transaction).id,
                )
            }

            if (transactionInstance) {
                destroy(transactionInstance)
                log.trace('Transaction removed from TransactionsStore')
            }
        },
        removeOldTransactions: () => {
            const numTransactions = self.transactions.length

            // If there are more than 10 transactions, delete the older ones
            if (numTransactions > maxTransactionsInModel) {
                self.transactions
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) // Sort transactions by createdAt in descending order
                .splice(maxTransactionsInModel) // Remove transactions beyond the desired number to keep

                log.trace(
                `${
                    numTransactions - maxTransactionsInModel
                } transaction(s) removed from TransactionsStore`,
                )
            }
        },
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

            log.trace(
                'New transaction added to the TransactionsStore',
                [],
                'addTransaction',
            )

            // Purge the oldest transaction from the model if the maximum number of transactions is reached
            if (self.transactions.length > maxTransactionsInModel) {
                self.removeOldTransactions()
            }

            return transactionInstance
        }),
        addTransactionsToModel: (dbTransactions: TransactionRecord[]) => {
            // This adds to model only. Used to have observable UI in tx history loaded from database.
            const inStoreTransactions: Transaction[] = []

            for (const dbTransaction of dbTransactions) {
                const createdAt = new Date(dbTransaction.createdAt)
                const inStoreTransaction = {...dbTransaction, createdAt}

                const transactionInstance = TransactionModel.create(inStoreTransaction)
                inStoreTransactions.push(transactionInstance)
            }

            self.transactions.push(...inStoreTransactions)

            log.trace(
                `${inStoreTransactions.length} new transactions added to TransactionsStore`,
            )
        },
        updateStatus: flow(function* updateStatus(
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
                log.trace(
                    'Transaction status and data updated in TransactionsStore',
                    'updateStatus',
                )
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


                    log.trace('Transaction status and data updated in TransactionsStore',[],'updateStatuses',)
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
                log.trace('Transaction balanceAfter updated in TransactionsStore',[],'updateBalanceAfter',)
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
                log.trace('Transaction fee updated in TransactionsStore',[],'updateFee')
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
                log.trace('Transaction amount updated in TransactionsStore')
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
                log.trace('Transaction note updated in TransactionsStore')
            }
        }),
        updateSentFrom: flow(function* updateSentFrom(id: number, sentFrom: string) {

            yield Database.updateSentFromAsync(id, sentFrom)
            const transactionInstance = self.findById(id)
            if (transactionInstance) {
                transactionInstance.sentFrom = sentFrom
                log.trace('Transaction sentFrom updated in TransactionsStore')
            }
        }),
        updateSentTo: flow(function* updateSentTo(id: number, sentTo: string) { //

            yield Database.updateSentToAsync(id, sentTo)
            const transactionInstance = self.findById(id)
            if (transactionInstance) {
                transactionInstance.sentTo = sentTo
                log.trace('Transaction sentTo updated in TransactionsStore')
            }
        }),
        removeAllTransactions() {
            self.transactions.clear()
            log.info('Removed all transactions from TransactionsStore')
        },
    }))
    .views(self => ({
        get count() {
            return self.transactions.length
        },
        get recent(): Transaction[] {
            return this.all.slice(0, 3) // Return the first 3 transactions
        },
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
        get pending() {
            return this.all.filter(t => t.status === TransactionStatus.PENDING)
        },       
    }))


export interface TransactionsStore
  extends Instance<typeof TransactionsStoreModel> {}
export interface TransactionsStoreSnapshot
  extends SnapshotOut<typeof TransactionsStoreModel> {}
