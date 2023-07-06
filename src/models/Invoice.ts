import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {decodeInvoice} from '../services/cashuHelpers'
import {withSetPropAction} from './helpers/withSetPropAction'
import {log} from '../utils/logger'
import addSeconds from 'date-fns/addSeconds'

/**
 * This represents lightning invoice got for request to mint new tokens
 */

export const InvoiceModel = types
    .model('Invoice', {
        mint: types.string,
        encodedInvoice: types.string,
        amount: types.number,
        description: types.optional(types.string, ''),
        paymentHash: types.string,
        expiry: types.optional(types.number, 600),
        memo: types.optional(types.string, 'Topup of minibits wallet'),
        transactionId: types.number,
        expiresAt: types.maybe(types.Date),
        createdAt: types.optional(types.Date, new Date()),
    })
    .actions(withSetPropAction)
    .actions(self => ({
        setExpiresAt() {
            const decoded = decodeInvoice(self.encodedInvoice)
            let {expiry} = decoded // in seconds
            if (!expiry) {
                expiry = 600
            }
            const expiresAt = addSeconds(new Date(), expiry)

            log.trace(
                `Invoice expiry is ${expiry}, setting expiresAt to ${expiresAt}`,
            )
            self.expiresAt = new Date(expiresAt)
        },
    }))


export type Invoice = {
    mint: string
    encodedInvoice: string
    amount: number
    description?: string
    paymentHash: string
    expiry?: number
    memo: string
    transactionId: number
} & Partial<Instance<typeof InvoiceModel>>
export interface InvoiceSnapshotOut extends SnapshotOut<typeof InvoiceModel> {}
export interface InvoiceSnapshotIn extends SnapshotIn<typeof InvoiceModel> {}
