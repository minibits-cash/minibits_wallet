import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import { log } from '../services/logService'
import { MintUnit } from '../services'

export interface TransactionRecord {
    id?: number
    type: TransactionType
    amount: number
    fee?: number | null
    unit: MintUnit
    data: string
    sentFrom?: string | null
    memo?: string | null  
    mint: string
    balanceAfter?: number | null
    noteToSelf?: string | null
    tags?: Array<string> | null
    status: TransactionStatus 
    createdAt: Date   
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
        unit: types.frozen<MintUnit>(),
        data: types.string,
        sentFrom: types.maybe(types.maybeNull(types.string)),
        sentTo: types.maybe(types.maybeNull(types.string)),
        memo: types.maybe(types.maybeNull(types.string)),
        mint: types.string,
        balanceAfter: types.maybe(types.maybeNull(types.integer)),
        noteToSelf: types.maybe(types.maybeNull(types.string)),
        tags: types.maybe(types.maybeNull(types.array(types.string))),
        status: types.frozen<TransactionStatus>(),
        createdAt: types.optional(types.Date, new Date()),
    })   
    

export type Transaction = {
    amount: number
    fee: number
    unit: MintUnit    
    type: TransactionType    
    data: string
    mint: string
    status: TransactionStatus
} & Partial<Instance<typeof TransactionModel>>
export interface TransactionSnapshotOut
  extends SnapshotOut<typeof TransactionModel> {}
export interface TransactionSnapshotIn
  extends SnapshotIn<typeof TransactionModel> {}
