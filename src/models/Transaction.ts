import {Instance, SnapshotIn, SnapshotOut, flow, types} from 'mobx-state-tree'
import { log } from '../services/logService'
import { MintUnit } from '../services/wallet/currency'
import { Database } from '../services'


export interface TransactionRecord {
    id: number
    type: TransactionType
    amount: number
    fee: number
    unit: MintUnit
    data: string
    sentFrom?: string | null
    sentTo?: string | null
    profile?: string | null
    memo?: string | null
    zapRequest?: string | null
    inputToken?: string | null
    outputToken?: string | null
    proof?: string | null
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
        id: types.number,
        type: types.frozen<TransactionType>(),
        amount: types.integer,
        fee: types.optional(types.integer, 0),
        unit: types.frozen<MintUnit>(),
        data: types.string,
        sentFrom: types.maybe(types.maybeNull(types.string)),
        sentTo: types.maybe(types.maybeNull(types.string)),
        profile: types.maybe(types.maybeNull(types.string)),
        memo: types.maybe(types.maybeNull(types.string)),
        mint: types.string,
        zapRequest: types.maybe(types.maybeNull(types.string)),
        inputToken: types.maybe(types.maybeNull(types.string)),
        outputToken: types.maybe(types.maybeNull(types.string)),
        proof: types.maybe(types.maybeNull(types.string)),
        balanceAfter: types.maybe(types.maybeNull(types.integer)),
        noteToSelf: types.maybe(types.maybeNull(types.string)),
        tags: types.maybe(types.maybeNull(types.array(types.string))),
        status: types.frozen<TransactionStatus>(),
        createdAt: types.optional(types.Date, new Date()),
    })
    .views(self => ({        
    }))
    .actions(self => ({
        setUnit(unit: MintUnit) { // migration
            self.unit = unit
        },
        setIsExpired() {
            self.status = TransactionStatus.EXPIRED
        },        
        setStatus (
            status: TransactionStatus,
            data: string,
        ) {
            // Update status and set related tx data in database
            Database.updateStatus(self.id!, status, data)
            // Update in the model
            self.status = status
            self.data = data 
            log.debug('[setStatus]', 'Transaction status and data updated', {id: self.id, status})            
        },
        setBalanceAfter(balanceAfter: number) {            
            Database.updateBalanceAfter(self.id!, balanceAfter)            
            self.balanceAfter = balanceAfter
            log.debug('[setBalanceAfter]', 'Transaction balanceAfter updated', {id: self.id, balanceAfter})
        },
        setFee(fee: number) {            
            Database.updateFee(self.id!, fee)            
            self.fee = fee
            log.debug('[setFee]', 'Transaction fee updated', {id: self.id, fee})
        },
        setReceivedAmount(amount: number) {            
            Database.updateReceivedAmount(self.id!, amount)
            self.amount = amount
            log.debug('[setReceivedAmount]', 'Transaction amount updated', {id: self.id, amount})
        },
        setNote(note: string) {            
            Database.updateNote(self.id!, note)            
            self.noteToSelf = note
            log.debug('[saveNote]', 'Transaction note updated', {id: self.id, note})
        },
        setZapRequest(zapRequest: string) {
            Database.updateZapRequest(self.id!, zapRequest)            
            self.zapRequest = zapRequest
            log.debug('[setZapRequest]', 'Transaction zapRequest updated', {id: self.id, zapRequest})
        }, 
        setSentFrom(sentFrom: string) {
            Database.updateSentFrom(self.id!, sentFrom)            
            self.sentFrom = sentFrom
            log.debug('[setSentFrom]', 'Transaction sentFrom updated', {id: self.id, sentFrom})
        },
        setSentTo(sentTo: string) {
            Database.updateSentTo(self.id!, sentTo)            
            self.sentTo = sentTo
            log.debug('[setSentTo]', 'Transaction sentTo updated', {id: self.id, sentTo})
        }, 
        setProfile(profile: string) {
            Database.updateProfile(self.id!, profile)            
            self.profile = profile
            log.debug('[setProfile]', 'Transaction profile updated', {id: self.id, profile})
        }, 
        setInputToken(inputToken: string) {
            Database.updateInputToken(self.id!, inputToken)            
            self.inputToken = inputToken
            log.debug('[setInputToken]', 'Transaction inputToken updated', {id: self.id, inputToken})
        },
        setOutputToken(outputToken: string) {
            Database.updateOutputToken(self.id!, outputToken)            
            self.outputToken = outputToken
            log.debug('[setOutputToken]', 'Transaction outputToken updated', {id: self.id, outputToken})
        },
        setProof(proof: string) {
            Database.updateProof(self.id!, proof)            
            self.proof = proof
            log.debug('[setProof]', 'Transaction proof updated', {id: self.id, proof})
        },             
  }))   
    

export interface Transaction extends Instance<typeof TransactionModel> {}
/*export type Transaction = Partial<Instance<typeof TransactionModel>> & {
    amount: number
    fee: number
    unit: MintUnit    
    type: TransactionType    
    data: string
    mint: string
    status: TransactionStatus
}*/
export interface TransactionSnapshotOut
  extends SnapshotOut<typeof TransactionModel> {}
export interface TransactionSnapshotIn
  extends SnapshotIn<typeof TransactionModel> {}
