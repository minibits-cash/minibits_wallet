import { flow, Instance, isAlive, SnapshotIn, SnapshotOut, types } from 'mobx-state-tree'
import { log } from '../services/logService'
import { MintUnit } from '../services/wallet/currency'
import { Database } from '../services'


export type TransactionData = {
    status: TransactionStatus
    [index: string]: any
}

export enum TransactionType {
    SEND = 'SEND',
    RECEIVE = 'RECEIVE',
    RECEIVE_OFFLINE = 'RECEIVE_OFFLINE',
    RECEIVE_NOSTR = 'RECEIVE_NOSTR', // not used
    RECEIVE_BY_PAYMENT_REQUEST = 'RECEIVE_BY_PAYMENT_REQUEST',
    TOPUP = 'TOPUP',
    TRANSFER = 'TRANSFER',
}

export enum TransactionStatus {
    DRAFT = 'DRAFT',
    PREPARED = 'PREPARED',
    PREPARED_OFFLINE = 'PREPARED_OFFLINE', // offline receive, safer to have if separate from prepared 
    PENDING = 'PENDING',
    REVERTED = 'REVERTED',
    RECOVERED = 'RECOVERED',
    COMPLETED = 'COMPLETED',
    ERROR = 'ERROR',
    BLOCKED = 'BLOCKED',
    EXPIRED = 'EXPIRED',
}

export const TransactionModel = types
    .model('Transaction', {
        id: types.identifierNumber,
        type: types.frozen<TransactionType>(),
        amount: types.integer,
        fee: types.optional(types.integer, 0),
        unit: types.frozen<MintUnit>(),        
        data: types.string,
        keysetId:types.maybe(types.maybeNull(types.string)),
        sentFrom: types.maybe(types.maybeNull(types.string)),
        sentTo: types.maybe(types.maybeNull(types.string)),
        profile: types.maybe(types.maybeNull(types.string)),
        paymentId: types.maybe(types.maybeNull(types.string)),
        quote: types.maybe(types.maybeNull(types.string)),
        memo: types.maybe(types.maybeNull(types.string)),
        mint: types.string,
        paymentRequest: types.maybe(types.maybeNull(types.string)),
        zapRequest: types.maybe(types.maybeNull(types.string)),
        inputToken: types.maybe(types.maybeNull(types.string)),
        outputToken: types.maybe(types.maybeNull(types.string)),
        proof: types.maybe(types.maybeNull(types.string)),
        balanceAfter: types.maybe(types.maybeNull(types.integer)),
        noteToSelf: types.maybe(types.maybeNull(types.string)),
        tags: types.maybe(types.maybeNull(types.array(types.string))),
        status: types.frozen<TransactionStatus>(),
        expiresAt: types.maybe(types.maybeNull(types.Date)),
        createdAt: types.optional(types.Date, new Date()),
    })
    .views(self => ({}))
    .actions(self => ({
        pruneInputToken(inputToken: string) {
            self.inputToken = inputToken.slice(0, 40)
            log.trace('[pruneInputToken]', 'Transaction inputToken pruned in store', { id: self.id })
        },
        pruneOutputToken(outputToken: string) {
            self.outputToken = outputToken.slice(0, 40)
            log.trace('[pruneOutputToken]', 'Transaction outputToken pruned in store', { id: self.id })
        },
        update(fields: Partial<Transaction>) {
            // log.trace('[update]', {fields})
            // Update multiple fields in database with a single query
            const updatedTransaction = Database.updateTransaction(self.id, fields)            

            if (!isAlive(self)) {
                log.error('[update]', 'Transaction instance is not alive, aborting state update', { id: self.id })
                return
            }

            // Update the model to keep store in sync
            Object.keys(updatedTransaction).forEach(key => {
                ;(self as any)[key] = (updatedTransaction as any)[key]
            })

            log.trace('[update]', 'Transaction updated in state', { id: self.id, status: self.status})
        }
    }))

export interface Transaction extends Instance<typeof TransactionModel> {}
export interface TransactionSnapshotOut extends SnapshotOut<typeof TransactionModel> {}
export interface TransactionSnapshotIn extends SnapshotIn<typeof TransactionModel> {}