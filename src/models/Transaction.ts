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
    paymentId?: string | null
    quote?: string | null
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
    RECEIVE_BY_PAYMENT_REQUEST = 'RECEIVE_BY_PAYMENT_REQUEST',
    TOPUP = 'TOPUP',
    TRANSFER = 'TRANSFER',
}

export enum TransactionStatus {
    DRAFT = 'DRAFT',
    PREPARED = 'PREPARED',
    PREPARED_OFFLINE = 'PREPARED_OFFLINE', // offline receive, safer to have if sepearate from prepared 
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
        sentFrom: types.maybe(types.maybeNull(types.string)),
        sentTo: types.maybe(types.maybeNull(types.string)),
        profile: types.maybe(types.maybeNull(types.string)),
        paymentId: types.maybe(types.maybeNull(types.string)),
        quote: types.maybe(types.maybeNull(types.string)),
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
            log.trace('[setStatus]', 'Transaction status and data updated', {id: self.id, status})            
        },
        setBalanceAfter(balanceAfter: number) {            
            Database.updateBalanceAfter(self.id!, balanceAfter)            
            self.balanceAfter = balanceAfter
            log.trace('[setBalanceAfter]', 'Transaction balanceAfter updated', {id: self.id, balanceAfter})
        },
        setFee(fee: number) {            
            Database.updateFee(self.id!, fee)            
            self.fee = fee
            log.trace('[setFee]', 'Transaction fee updated', {id: self.id, fee})
        },
        setPaymentId(paymentId: string) {            
            Database.updatePaymentId(self.id!, paymentId)            
            self.paymentId = paymentId
            log.trace('[setPaymentId]', 'Transaction paymentId updated', {id: self.id, paymentId})
        },
        setQuote(quote: string) {            
            Database.updateQuote(self.id!, quote)            
            self.quote = quote
            log.trace('[setQuote]', 'Transaction quote updated', {id: self.id, quote})
        },
        setReceivedAmount(amount: number) {            
            Database.updateReceivedAmount(self.id!, amount)
            self.amount = amount
            log.trace('[setReceivedAmount]', 'Transaction amount updated', {id: self.id, amount})
        },
        setNote(note: string) {            
            Database.updateNote(self.id!, note)            
            self.noteToSelf = note
            log.trace('[saveNote]', 'Transaction note updated', {id: self.id, note})
        },
        setZapRequest(zapRequest: string) {
            Database.updateZapRequest(self.id!, zapRequest)            
            self.zapRequest = zapRequest
            log.trace('[setZapRequest]', 'Transaction zapRequest updated', {id: self.id, zapRequest})
        }, 
        setSentFrom(sentFrom: string) {
            Database.updateSentFrom(self.id!, sentFrom)            
            self.sentFrom = sentFrom
            log.trace('[setSentFrom]', 'Transaction sentFrom updated', {id: self.id, sentFrom})
        },
        setSentTo(sentTo: string) {
            Database.updateSentTo(self.id!, sentTo)            
            self.sentTo = sentTo
            log.trace('[setSentTo]', 'Transaction sentTo updated', {id: self.id, sentTo})
        }, 
        setProfile(profile: string) {
            Database.updateProfile(self.id!, profile)            
            self.profile = profile
            log.trace('[setProfile]', 'Transaction profile updated', {id: self.id, profile})
        }, 
        setInputToken(inputToken: string) {
            Database.updateInputToken(self.id!, inputToken)            
            self.inputToken = inputToken.slice(0, 40)
            log.trace('[setInputToken]', 'Transaction inputToken updated', {id: self.id, inputToken})
        },
        setOutputToken(outputToken: string) {
            Database.updateOutputToken(self.id!, outputToken)            
            self.outputToken = outputToken.slice(0, 40)
            log.trace('[setOutputToken]', 'Transaction outputToken updated', {id: self.id})
        },
        setProof(proof: string) {
            Database.updateProof(self.id!, proof)            
            self.proof = proof
            log.trace('[setProof]', 'Transaction proof updated', {id: self.id, proof})
        },
        pruneInputToken(inputToken: string) {            
            self.inputToken = inputToken.slice(0, 40)
            log.trace('[pruneInputToken]', 'Transaction inputToken pruned in store', {id: self.id})
        }, 
        pruneOutputToken(outputToken: string) {            
            self.outputToken = outputToken.slice(0, 40)
            log.trace('[pruneOutputToken]', 'Transaction outputToken pruned in store', {id: self.id})
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