import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {LightningUtils} from '../services/lightning/lightningUtils'
import {withSetPropAction} from './helpers/withSetPropAction'
import {log} from '../utils/logger'
import addSeconds from 'date-fns/addSeconds'

/**
 * This represents incoming lightning invoice to pay (by transfer tx)
 */

export enum PaymentRequestStatus {
    RECEIVED = 'RECEIVED',
    PAID = 'PAID',
    EXPIRED = 'EXPIRED',
}

export const PaymentRequestModel = types
    .model('PaymentRequest', {        
        encodedInvoice: types.string,
        amount: types.number,
        description: types.optional(types.string, ''),
        paymentHash: types.string,
        sentFrom: types.maybe(types.string),
        sentFromPubkey: types.maybe(types.string),
        expiry: types.optional(types.number, 600),        
        transactionId: types.maybe(types.number),
        status: types.frozen<PaymentRequestStatus>(),
        expiresAt: types.maybe(types.Date),
        createdAt: types.optional(types.Date, new Date()),
    })
    .actions(withSetPropAction)
    .actions(self => ({
        setExpiresAt() {
            const decoded = LightningUtils.decodeInvoice(self.encodedInvoice)
            const {expiry, timestamp} = LightningUtils.getInvoiceData(decoded)
            
            if(!expiry || !timestamp) {
                return
            }

            const expiresAt = addSeconds(new Date(timestamp * 1000), expiry as number)

            log.trace(
                `PaymentRequest expiry is ${expiry}, setting expiresAt to ${expiresAt}`,
            )
            self.expiresAt = new Date(expiresAt)
        },
        setStatus(status: PaymentRequestStatus) {            
            self.status = status
        },
    }))


export type PaymentRequest = {    
    encodedInvoice: string
    amount: number
    description?: string
    paymentHash: string
    sentFrom?: string
    sentFromPubkey?: string
    expiry?: number
    status: PaymentRequestStatus,   
    transactionId?: number
} & Partial<Instance<typeof PaymentRequestModel>>
export interface PaymentRequestSnapshotOut extends SnapshotOut<typeof PaymentRequestModel> {}
export interface PaymentRequestSnapshotIn extends SnapshotIn<typeof PaymentRequestModel> {}
