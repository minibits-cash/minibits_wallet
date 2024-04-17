import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {LightningUtils} from '../services/lightning/lightningUtils'
import {withSetPropAction} from './helpers/withSetPropAction'
import {Contact, ContactModel} from './Contact'
import {log} from '../services/logService'
import addSeconds from 'date-fns/addSeconds'
import { MintUnit } from '../services'

/**
 * This represents incoming lightning invoice to pay (by transfer tx)
 */

export enum PaymentRequestStatus {
    ACTIVE = 'ACTIVE',
    PAID = 'PAID',
    EXPIRED = 'EXPIRED',
}


export enum PaymentRequestType {
    INCOMING = 'INCOMING',
    OUTGOING = 'OUTGOING',    
}

export const PaymentRequestModel = types
    .model('PaymentRequest', {
        type: types.frozen<PaymentRequestType>(),
        status: types.frozen<PaymentRequestStatus>(),
        mint: types.maybe(types.string),
        mintQuote: types.maybe(types.string),   
        encodedInvoice: types.string,
        amount: types.number,
        unit: types.frozen<MintUnit>(), // TODO migration to set default unit for existing PRs
        description: types.optional(types.string, ''),        
        paymentHash: types.string,
        contactFrom: types.frozen<Contact>(),
        contactTo: types.maybe(types.frozen<Contact>()),
        expiry: types.number,        
        transactionId: types.maybe(types.number),        
        expiresAt: types.maybe(types.Date),
        createdAt: types.Date,
    })
    .actions(withSetPropAction)
    .actions(self => ({
        setStatus(status: PaymentRequestStatus) {
            self.status = status
        }        
    }))


export type PaymentRequest = {
    type: PaymentRequestType
    status: PaymentRequestStatus
    mint?: string
    mintQuote?: string
    encodedInvoice: string
    amount: number
    unit: MintUnit
    description?: string    
    paymentHash: string
    contactFrom: Contact
    contactTo?: Contact
    expiry: number
    transactionId?: number
    createdAt: Date
} & Partial<Instance<typeof PaymentRequestModel>>
export interface PaymentRequestSnapshotOut extends SnapshotOut<typeof PaymentRequestModel> {}
export interface PaymentRequestSnapshotIn extends SnapshotIn<typeof PaymentRequestModel> {}
