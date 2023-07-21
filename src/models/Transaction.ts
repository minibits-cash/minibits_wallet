import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'

export interface TransactionRecord {
    id: number
    type: TransactionType
    amount: number
    fee?: number
    data: string
    sentFrom?: string
    memo?: string
    balanceAfter?: number
    noteToSelf?: string
    tags?: Array<string>
    status: TransactionStatus
    createdAt: string
}

export type TransactionData = {
    status: TransactionStatus
    [index: string]: any
}

export enum TransactionType {
    SEND = 'SEND',
    RECEIVE = 'RECEIVE',
    RECEIVE_OFFLINE = 'RECEIVE_OFFLINE',
    RECEIVE_NOSTR = 'RECEIVE_NOSTR', // not used
    TOPUP = 'TOPUP',
    TRANSFER = 'TRANSFER',
}

export enum TransactionStatus {
    DRAFT = 'DRAFT',
    PREPARED = 'PREPARED',
    PREPARED_OFFLINE = 'PREPARED_OFFLINE', // offline receive, safer to have if sepearate from prepared 
    PENDING = 'PENDING',
    REVERTED = 'REVERTED',
    COMPLETED = 'COMPLETED',
    ERROR = 'ERROR',
    BLOCKED = 'BLOCKED',
    EXPIRED = 'EXPIRED',
}

export const TransactionModel = types
    .model('Transaction', {
        id: types.maybe(types.number),
        type: types.frozen<TransactionType>(),
        amount: types.integer,
        fee: types.maybe(types.maybeNull(types.integer)),
        data: types.string,
        sentFrom: types.maybe(types.maybeNull(types.string)),
        memo: types.maybe(types.maybeNull(types.string)),
        balanceAfter: types.maybe(types.maybeNull(types.integer)),
        noteToSelf: types.maybe(types.maybeNull(types.string)),
        tags: types.maybe(types.maybeNull(types.array(types.string))),
        status: types.frozen<TransactionStatus>(),
        createdAt: types.optional(types.Date, new Date()),
    })

export type Transaction = {
    amount: number    
    type: TransactionType
    data: string
    status: TransactionStatus
} & Partial<Instance<typeof TransactionModel>>
export interface TransactionSnapshotOut
  extends SnapshotOut<typeof TransactionModel> {}
export interface TransactionSnapshotIn
  extends SnapshotIn<typeof TransactionModel> {}
