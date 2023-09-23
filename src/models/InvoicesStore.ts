import {
  Instance,
  SnapshotOut,
  types,
  destroy,
  isStateTreeNode,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {InvoiceModel, Invoice} from './Invoice'
import {log} from '../utils/logger'

export const InvoicesStoreModel = types
    .model('Invoices', {
        invoices: types.array(InvoiceModel),
    })
    .views(self => ({
        findByPaymentHash(paymentHash: string) {
            const invoice = self.invoices.find(i => i.paymentHash === paymentHash)
            return invoice ? invoice : undefined
        },
        findByTransactionId(transactionId: number) {
            const invoice = self.invoices.find(i => i.transactionId === transactionId)
            return invoice ? invoice : undefined
        },
    }))
    .actions(withSetPropAction)
    .actions(self => ({
        addInvoice(newInvoice: Invoice) {
            const invoiceInstance = InvoiceModel.create(newInvoice)
            // expiry in Date format
            invoiceInstance.setExpiresAt()
            self.invoices.push(invoiceInstance)

            log.info('New invoice added to InvoicesStore', newInvoice)

            return invoiceInstance
        },
        removeInvoice(invoiceToRemove: Invoice) {
            // self.invoices.remove(invoice)

            let invoiceInstance: Invoice | undefined

            if (isStateTreeNode(invoiceToRemove)) {
                invoiceInstance = invoiceToRemove
            } else {
                invoiceInstance = self.findByPaymentHash(
                (invoiceToRemove as Invoice).paymentHash,
                )
            }

            if (invoiceInstance) {
                log.info('Invoice to be removed from InvoicesStore', invoiceToRemove)
                destroy(invoiceInstance)
                log.info('Invoice removed')
                
            }
        },
    }))
    .views(self => ({
        get invoicesCount() {
            return self.invoices.length
        },
        get allInvoices() {
            return self.invoices
        },
        filterByMint(mintUrl: string) {
            let filtered: Invoice[] = []

            filtered = self.invoices.filter(invoice => {
                if (invoice.mint === mintUrl) {
                return true
                }
                return false
            })

            return filtered
        },
    }))

export interface Invoices extends Instance<typeof InvoicesStoreModel> {}
export interface InvoicesStoreSnapshot
  extends SnapshotOut<typeof InvoicesStoreModel> {}
