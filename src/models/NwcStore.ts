import {
    Instance,
    SnapshotOut,
    types,
    flow,
    destroy,
    isStateTreeNode,
    detach,  
} from 'mobx-state-tree'
import { NWCWalletResponse, NWCWalletInfo, NWCWalletRequest } from 'nostr-tools/kinds'
import {withSetPropAction} from './helpers/withSetPropAction'
import {log} from '../services/logService'
import { getRootStore } from './helpers/getRootStore'
import { 
    HANDLE_NWC_REQUEST_TASK,
    KeyChain,      
    NostrClient, 
    NostrEvent, 
    NostrKeyPair, 
    NostrUnsignedEvent, 
    SyncQueue, 
    TransactionTaskResult, 
    WalletTaskResult
} from '../services'
import AppError, { Err } from '../utils/AppError'
import { LightningUtils } from '../services/lightning/lightningUtils'
import { addSeconds } from 'date-fns/addSeconds'
import { Transaction, TransactionStatus, TransactionType } from './Transaction'
import { MeltQuoteResponse } from '@cashu/cashu-ts'
import { WalletStore } from './WalletStore'
import { ProofsStore } from './ProofsStore'
import { isSameDay } from 'date-fns/isSameDay'
import { NotificationService } from '../services/notificationService'
import { roundUp } from '../utils/number'
import { MINIBITS_MINT_URL } from '@env'
import { MintBalance } from './Mint'
import { transferTask } from '../services/wallet/transferTask'
import { topupTask } from '../services/wallet/topupTask'
import { WalletProfileStore } from './WalletProfileStore'
import { Platform } from 'react-native'
import { TransactionsStore } from './TransactionsStore'
import { SubCloser } from 'nostr-tools/abstract-pool'

type NwcError = {
    result_type: string,
    error: {
      code: string,
      message: string
    }
}

export type NwcRequest = {
    method: string,
    params: any
}

type NwcResponse = {
    result_type: string,
    result: any
}

type NwcTransaction = {
    type: string,
    invoice: string,
    description: string | null,
    preimage: string | null,
    payment_hash: string | null,
    amount: number,
    fees_paid: number | null,
    created_at: number,
    settled_at: number | null
    expires_at: number | null
}

export const nwcPngUrl = 'https://1044827509-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F0JQfRPMJ4uO7z9wmnAOK%2Fuploads%2FVO76qdgzHHzWSDsHQXdu%2FGroup%201000001143%20(1).png?alt=media&token=0fdb70b7-bb19-4bed-a752-a0560585c2f4&width=512&dpr=1&quality=100&sign=57c41699&sv=1'

const getConnectionRelays = function () {
    const minibitsRelays = NostrClient.getMinibitsRelays()
    // const publicRelays = NostrClient.getDefaultRelays() 
    // return [...minibitsRelays, ...publicRelays]
    return minibitsRelays
}

export const LISTEN_FOR_NWC_EVENTS = 'listenForNwcEvents'

const MIN_LIGHTNING_FEE = 2 // sats
const LIGHTNING_FEE_PERCENT = 1
const MAX_MULTI_PAY_INVOICES = 5

const getSupportedMethods = function () {
    return [
        'pay_invoice', 
        'get_balance', 
        'get_info', 
        'list_transactions',
        'make_invoice',
        'lookup_invoice'
    ]
}

export const NwcConnectionModel = types.model('NwcConnection', {
    name: types.string,
    connectionPubkey: types.string,
    connectionSecret: types.identifier,
    dailyLimit: types.optional(types.number, 0),    
    remainingDailyLimit: types.optional(types.number, 0),
    currentDay: types.optional(types.Date, new Date()),
    lastMeltQuoteId: types.maybe(types.string),    
})
.actions(withSetPropAction)
.actions(self => ({
    getWalletStore (): WalletStore {  
        const rootStore = getRootStore(self)
        const {walletStore} = rootStore
        return walletStore
    },
    getWalletProfileStore (): WalletProfileStore {  
        const rootStore = getRootStore(self)
        const {walletProfileStore} = rootStore
        return walletProfileStore
    },
    getProofsStore (): ProofsStore {  
        const rootStore = getRootStore(self)
        const {proofsStore} = rootStore
        return proofsStore
    },
    getTransactionsStore (): TransactionsStore {  
        const rootStore = getRootStore(self)
        const {transactionsStore} = rootStore
        return transactionsStore
    },
    setRemainingDailyLimit(limit: number) {
        self.remainingDailyLimit = limit
    },
    setCurrentDay() {
        self.currentDay = new Date()
    },
    setLastMeltQuoteId(quoteId: string | undefined) {
        self.lastMeltQuoteId = quoteId
    },
}))
.views(self => ({
    get walletPubkey(): string {
        const walletProfileStore = self.getWalletProfileStore()
        return walletProfileStore.pubkey
    },
    get connectionRelays(): string[] {
        return getConnectionRelays()
    },
    get supportedMethods() {
        return getSupportedMethods()
    }
}))
.views(self => ({
    get connectionString(): string {
        const walletProfileStore = self.getWalletProfileStore()
        return `nostr+walletconnect://${self.walletPubkey}?relay=${self.connectionRelays.join('&relay=')}&secret=${self.connectionSecret}&lud16=${walletProfileStore.lud16}`
    },
}))

.actions(self => ({  
    sendResponse: flow(function* sendResponse(nwcResponse: NwcResponse | NwcError, requestEvent: NostrEvent) {
        log.trace('[Nwc.sendResponse] start', {nwcResponse, connection: self.name})

        // eventInFlight.pubkey should = connectionPubkey
        log.trace('Encrypt response', {connectionPubkey: self.connectionPubkey, requestEventPubkey: requestEvent.pubkey})

        const encryptedContent = yield NostrClient.encryptNip04(
            requestEvent.pubkey,          
            JSON.stringify(nwcResponse)
        )

        const responseEvent: NostrUnsignedEvent = {
            pubkey: self.walletPubkey,            
            kind: NWCWalletResponse,
            tags: [["p", requestEvent.pubkey], ["e", requestEvent.id]],
            content: encryptedContent,
            created_at: Math.floor(Date.now() / 1000)
        }
        
        // notify errors
        
        if((nwcResponse as NwcError).error) {
            let body = ''
            if(nwcResponse.result_type === 'pay_invoice') {
                body = 'Pay invoice error: '
            }

            if(nwcResponse.result_type === 'multi_pay_invoice') {
                body = 'Multi pay invoice error: '
            }

            if(nwcResponse.result_type === 'get_balance') {
                body = 'Get balance error: '
            }

            if(nwcResponse.result_type === 'list_transactions') {
                body = 'List transactions error: '
            }

            if(nwcResponse.result_type === 'make_invoice') {
                body = 'Create invoice error: '
            }

            if(nwcResponse.result_type === 'lookup_invoice') {
                body = 'Lookup invoice error: '
            }            
            
            yield NotificationService.createLocalNotification(
                Platform.OS === 'android' ? `<b>${self.name}</b> - Nostr Wallet Connect` : `${self.name} - Nostr Wallet Connect`,
                body + (nwcResponse as NwcError).error.message,
                nwcPngUrl
            )            
        }    

        yield NostrClient.publish(
            responseEvent,
            self.connectionRelays,
            false                    
        )    
    }),
    payInvoice: flow(function* payInvoice(nwcRequest: NwcRequest, encodedInvoice: string, requestEvent: NostrEvent) {
        log.debug('[Nwc.payInvoice] start')       

        try {            
            const walletStore = self.getWalletStore()
            const proofsStore = self.getProofsStore()
        
            const invoice = LightningUtils.decodeInvoice(encodedInvoice)

            const {
                amount: amountToPay, 
                expiry, 
                description, 
                timestamp
            } = LightningUtils.getInvoiceData(invoice)

            const invoiceExpiry = addSeconds(new Date(timestamp as number * 1000), expiry as number)
            
            // Calculated on device to avoid mintQuote call for minibits mint
            const feeReserve = Math.max(MIN_LIGHTNING_FEE, amountToPay * LIGHTNING_FEE_PERCENT / 100) 
            const totalAmountToPay = amountToPay + feeReserve 

            let mintBalance: MintBalance | undefined = undefined            
            const minibitsBalance = proofsStore.getMintBalance(MINIBITS_MINT_URL)

            if(minibitsBalance && minibitsBalance.balances.sat! >= totalAmountToPay) {
                mintBalance = minibitsBalance                
            } else {
                mintBalance = proofsStore.getMintBalanceWithMaxBalance('sat')
            }
            
            const availableBalanceSat = mintBalance?.balances.sat || 0

            if(!mintBalance || availableBalanceSat < totalAmountToPay) {
                const message = `Insufficient balance to pay this invoice.`
                return {
                    result_type: nwcRequest.method,
                    error: { code: 'INSUFFICIENT_BALANCE', message}
                } as NwcError
            }

            if(totalAmountToPay > self.remainingDailyLimit) {
                const message = `Your remaining daily limit of ${self.remainingDailyLimit} SAT would be exceeded with this payment.`
                return {
                    result_type: nwcRequest.method,
                    error: { code: 'QUOTA_EXCEEDED', message}
                } as NwcError
            }
            
            const meltQuote: MeltQuoteResponse = yield walletStore.createLightningMeltQuote(
                mintBalance.mintUrl,
                'sat',
                encodedInvoice,
            )

            const result = yield transferTask(
                mintBalance,
                amountToPay,                    
                'sat',
                meltQuote,                  
                description || '',
                invoiceExpiry as Date,
                encodedInvoice,
                requestEvent,
                undefined
            )

            if(result.meltQuote?.quote === self.lastMeltQuoteId) {
                throw new AppError(Err.ALREADY_EXISTS_ERROR, 'Already processed', {quote: result.meltQuote?.quote})
            }

            self.setLastMeltQuoteId(result.meltQuote?.quote)

            let nwcResponse: NwcResponse | NwcError
    
            if(result.transaction?.status === TransactionStatus.COMPLETED) {
                const updatedLimit = self.remainingDailyLimit - 
                (result.transaction.amount + result.transaction.fee)
    
                nwcResponse = {
                    result_type: nwcRequest.method,
                    result: {
                      preimage: result.preimage,
                    }
                } as NwcResponse
    
                log.trace('[handleTransferTaskResult] Updating remainingLimit', {
                    connection: self.name,
                    beforeUpdate: self.remainingDailyLimit,
                    afterUpdate: updatedLimit
                })
    
                self.setRemainingDailyLimit(updatedLimit)            
    
                yield NotificationService.createLocalNotification(
                    Platform.OS === 'android' ? `<b>${self.name}</b> - Nostr Wallet Connect` : `${self.name} - Nostr Wallet Connect`,
                    `Paid ${result.transaction.amount} SAT${result.transaction.fee > 0 ? ', fee ' + result.transaction.fee + ' SAT' : ''}. Remaining today's limit is ${self.remainingDailyLimit} SAT`,
                    nwcPngUrl
                )
                
            } else {
                nwcResponse = {
                    result_type: nwcRequest.method,
                    error: { code: 'INTERNAL', message: result.message}
                } as NwcError
            }
    
            return nwcResponse

        } catch (e: any) {            
            log.error(`[NwcConnection.handlePayInvoice] ${e.message}`)
            
            return {
                result_type: nwcRequest.method,
                error: { code: 'INTERNAL', message: e.message}
            } as NwcError
        }
    }),
}))
.actions(self => ({
    handleGetInfo (nwcRequest: NwcRequest): NwcResponse {        
        const nwcResponse: NwcResponse = {
            result_type: nwcRequest.method,
            result: {
                alias: 'Minibits',
                color: '#2372F5',
                pubkey: self.walletPubkey,
                network: 'mainnet',
                block_height: 1,
                block_hash: 'hash',
                methods: self.supportedMethods
            }
        }
        
        return nwcResponse   
    },
    handleListTransactions (nwcRequest: NwcRequest): NwcResponse {
        const rootStore = getRootStore(self)
        const {transactionsStore} = rootStore
        const lightningTransactions = transactionsStore.history.filter(
            (t: Transaction) => (t.type === TransactionType.TOPUP || 
            t.type === TransactionType.TRANSFER) && 
            t.status === TransactionStatus.COMPLETED
        )

        // TODO barebones implementation, no paging commands support
        const transactions = lightningTransactions.map(t => {
            return {                
                type: t.type === TransactionType.TOPUP ? 'incoming' : 'outgoing',
                invoice: t.paymentRequest,
                description: t.memo,
                preimage: t.proof,
                payment_hash: t.paymentId,
                amount: t.amount * 1000,
                fees_paid: t.fee,
                created_at: Math.floor(t.createdAt.getTime() / 1000),
                settled_at: Math.floor(t.createdAt.getTime() / 1000),
                expires_at: t.expiresAt ? Math.floor(t.expiresAt.getTime() / 1000) : 0,                  
            } as NwcTransaction
        })
        
        const nwcResponse: NwcResponse = {
            result_type: nwcRequest.method,
            result: {
                transactions
            }
        }
        
        return nwcResponse   
    },
    handleGetBalance(nwcRequest: NwcRequest) {
        const balance = self.getProofsStore().getMintBalanceWithMaxBalance('sat')?.balances.sat
        const limit = self.remainingDailyLimit
        let resultBalanceMsat = 0

        if(balance && balance > 0 && limit > 0) {
            resultBalanceMsat = (Math.min(balance, limit)) * 1000
        } else {
            resultBalanceMsat = 0
        }

        const nwcResponse: NwcResponse = {
            result_type: nwcRequest.method,
            result: {
                balance: resultBalanceMsat
            }
        }

        return nwcResponse 
    },
    handleMakeInvoice: flow(function* handleMakeInvoice(nwcRequest: NwcRequest, requestEvent: NostrEvent) {
        log.debug('[handleMakeInvoice]', {
            connection: self.name,
            amountMsat: nwcRequest.params.amount,                         
        })
                     
        const proofsStore = self.getProofsStore()
        const mintBalance = proofsStore.getMintBalanceWithMaxBalance('sat')
        const {amount: amontMsat, description} = nwcRequest.params

        if(!mintBalance) {
            const message = `Wallet has no mints`
            return {
                result_type: nwcRequest.method,
                error: { code: 'INTERNAL', message}
            } as NwcError
        }

        const result: TransactionTaskResult = yield topupTask(
            mintBalance,
            roundUp(amontMsat / 1000, 0),
            'sat',
            description,
            undefined,
            requestEvent                    
        )
        
        log.debug('Got topup task result', {
            connection: self.name,
            encodedInvoice: result.encodedInvoice,             
            caller: 'handleTopupTaskResult'
        })

        let nwcResponse: NwcResponse | NwcError

        if(result.transaction) {
            const {transaction} = result
            nwcResponse = {
                result_type: 'make_invoice',
                result: {
                    type: 'incoming',
                    invoice: transaction.paymentRequest,
                    description: transaction.memo,                                    
                    payment_hash: transaction.paymentId,
                    amount: transaction.amount * 1000,
                    fees_paid: transaction.fee,
                    created_at: Math.floor(transaction.createdAt!.getTime() / 1000),
                    expires_at: Math.floor(transaction.expiresAt!.getTime() / 1000),                    
                    preimage: null,
                    settled_at: null
                } as NwcTransaction
            } as NwcResponse

            yield NotificationService.createLocalNotification(
                Platform.OS === 'android' ? `<b>${self.name}</b> - Nostr Wallet Connect` : `${self.name} - Nostr Wallet Connect`,
                `Invoice for ${transaction.amount} SATS has been created.`,
                nwcPngUrl
            )

        } else {
            nwcResponse = {
                result_type: 'make_invoice',
                error: { code: 'INTERNAL', message: result.message}
            } as NwcError
        }

        return nwcResponse
    }),
    handleLookupInvoice(nwcRequest: NwcRequest) {
        let transaction: Transaction | undefined = undefined
        let transactionsStore = self.getTransactionsStore()

        if(nwcRequest.params.payment_hash) {
            transaction = transactionsStore.findBy({paymentId: nwcRequest.params.payment_hash})
        }

        if(nwcRequest.params.invoice) {
            transaction = transactionsStore.findBy({paymentRequest: nwcRequest.params.invoice})
        }

        if(!transaction) {
            return {
                result_type: nwcRequest.method,
                error: { code: 'INTERNAL', message: 'Could not find requested invoice'}
            } as NwcError
        }

        return {
            result_type: nwcRequest.method,
            result: {
                type: 'incoming',
                invoice: transaction.paymentRequest,
                description: transaction.memo,                                    
                payment_hash: transaction.paymentId,
                amount: transaction.amount * 1000,
                fees_paid: transaction.fee,
                created_at: Math.floor(transaction.createdAt!.getTime() / 1000),
                expires_at: Math.floor(transaction.expiresAt!.getTime() / 1000),                    
                preimage: transaction.proof,
                settled_at: Math.floor(transaction.createdAt!.getTime() / 1000)
            } as NwcTransaction
        } as NwcResponse
    },
    handlePayInvoice: flow(function* handlePayInvoice(nwcRequest: NwcRequest, requestEvent: NostrEvent) {
        log.debug('[Nwc.handlePayInvoice] start') 
        
        // reset daily limit if day changed while keeping live connection
        if(!isSameDay(self.currentDay, new Date())) {                
            self.setRemainingDailyLimit(self.dailyLimit)
            self.setCurrentDay()
        }

        const nwcResponse = yield self.payInvoice(nwcRequest, nwcRequest.params.invoice, requestEvent)
        return nwcResponse as NwcResponse | NwcError
    }),
    handleMultiPayInvoice: flow(function* handleMultiPayInvoice(nwcRequest: NwcRequest, requestEvent: NostrEvent) {
        log.debug('[Nwc.handleMultiPayInvoice] start')       
        
        const encodedInvoices: string[] = nwcRequest.params.invoices

        if(encodedInvoices.length > MAX_MULTI_PAY_INVOICES) {
            const nwcResponse = {
                result_type: 'multi_pay_invoice',
                error: { code: 'INTERNAL', message: 'Can not process more than 5 payments at once.'}
            } as NwcError

            return [nwcResponse] as NwcError[]
        }

        // reset daily limit if day changed while keeping live connection
        if(!isSameDay(self.currentDay, new Date())) {                
            self.setRemainingDailyLimit(self.dailyLimit)
            self.setCurrentDay()
        }

        const nwcResponses: (NwcResponse | NwcError)[] = []

        for (const invoice of encodedInvoices) {
            const nwcResponse = yield self.payInvoice(nwcRequest, invoice, requestEvent)
            nwcResponses.push(nwcResponse)
        }

        return nwcResponses
    })
}))
.actions(self => ({
    handleNwcRequestTask: flow(function* handleNwcRequestTask(requestEvent: NostrEvent, decryptedNwcRequest?: NwcRequest) {        
        let nwcRequest: NwcRequest
        if(!decryptedNwcRequest) {
            
            const decryptedContent = yield NostrClient.decryptNip04(
                requestEvent.pubkey, 
                requestEvent.content
            )

            nwcRequest = JSON.parse(decryptedContent)
        } else {
            nwcRequest = decryptedNwcRequest
        }
        
        let nwcResponse: NwcResponse | NwcError | undefined = undefined
        let nwcResponses: (NwcResponse | NwcError)[] = []       

        log.trace('[Nwc.handleRequest] request event', {requestEvent})
        log.trace('[Nwc.handleRequest] decrypted nwc command', {nwcRequest})

        switch (nwcRequest.method) {
            case 'get_info':                
                nwcResponse = self.handleGetInfo(nwcRequest)                
                break
            case 'list_transactions':                
                nwcResponse = self.handleListTransactions(nwcRequest)                
                break                 
            case 'get_balance':                
                nwcResponse = self.handleGetBalance(nwcRequest)                
                break 
            case 'make_invoice':                
                nwcResponse = yield self.handleMakeInvoice(nwcRequest, requestEvent)                
                break
            case 'lookup_invoice':                
                nwcResponse = self.handleLookupInvoice(nwcRequest)                
                break        
            case 'pay_invoice':                 
                nwcResponse = yield self.handlePayInvoice(nwcRequest, requestEvent)                
                break
            case 'multi_pay_invoice':                 
                const responses = yield self.handleMultiPayInvoice(nwcRequest, requestEvent)
                nwcResponses = [...responses]
                break
            default:
                const message = `NWC method ${nwcRequest.method} is unknown or not yet supported.`
                nwcResponse = {
                    result_type: nwcRequest.method,
                    error: { code: 'NOT_IMPLEMENTED', message}
                } as NwcError

                log.error(message, {nwcRequest})
        }

        // support for multiple responses from one nwc request (multi_pay_invoice)
        if(nwcResponse) {
            nwcResponses.push(nwcResponse)
        }

        for (const response of nwcResponses) {
            yield self.sendResponse(response, requestEvent)
        }        

        return nwcResponses[0]
    }),
}))



export const NwcStoreModel = types
    .model('NwcStore', {
        nwcConnections: types.array(NwcConnectionModel),
        isNwcListenerActive: types.optional(types.boolean, false),
        nwcSubscription: types.maybe(types.frozen<SubCloser>()),     
    })    
    .views(self => ({          
        findByName: (name: string) => {
            const c = self.nwcConnections.find(c => c.name === name)
            return c ? c : undefined
        },
        findBySecret: (secret: string) => {
            const c = self.nwcConnections.find(c => c.connectionSecret === secret)
            return c ? c : undefined
        },
        alreadyExists: (name: string) => {
            return self.nwcConnections.some(c => c.name === name)            
        },
        get walletPubkey(): string {
            const rootStore = getRootStore(self)
            const {walletProfileStore} = rootStore
            return walletProfileStore.pubkey
        },
        get all() {
            return self.nwcConnections
        },
        get supportedMethods() {
            return getSupportedMethods()
        },
        get connectionRelays() {
            return getConnectionRelays()
        }
    })) 
    .actions(self => ({
        resetDailyLimits () {
            for (const c of self.nwcConnections) {
                if(!isSameDay(c.currentDay, new Date())) {
                    c.setRemainingDailyLimit(c.dailyLimit)
                    c.setCurrentDay()
                }
            }
        },
        resetSubscription () {
            if(self.nwcSubscription) {
                log.trace('[resetSubscription] Closing and removing existing nwcSubscription')
                self.nwcSubscription.close()
                self.nwcSubscription = undefined
            }           
        }
    }))
    .actions(self => ({
        addConnection: flow(function* addConnection(name: string, dailyLimit: number) {
            if(self.findByName(name) !== undefined) {
                throw new AppError(Err.VALIDATION_ERROR, 'Connection with this name already exists')
            }

            const keyPair = KeyChain.generateNostrKeyPair()

            const newConnection = NwcConnectionModel.create({
                name,
                connectionSecret: keyPair.privateKey,
                connectionPubkey: keyPair.publicKey,
                dailyLimit,
                remainingDailyLimit: dailyLimit,
            })

            self.nwcConnections.push(newConnection)

            const filter = {            
                kinds: [NWCWalletInfo],
                authors: [newConnection.walletPubkey],                
            }

            // Not sure we should publish that as we are not always on, TBD
            const existingInfoEvent = yield NostrClient.getEvent(newConnection.connectionRelays, filter)

            if(!existingInfoEvent) {
                // publish info replacable event // seems to be a relict replaced by get_info request?
                const infoEvent: NostrUnsignedEvent = {
                    kind: NWCWalletInfo,
                    pubkey: newConnection.walletPubkey,
                    tags: [],                        
                    content: self.supportedMethods.join(' '),
                    created_at: Math.floor(Date.now() / 1000)                              
                }

                NostrClient.publish(
                    infoEvent,
                    newConnection.connectionRelays,
                    false                    
                )
            }
        }),        
        removeConnection(connectionToRemove: NwcConnection) {
            let connInstance: NwcConnection | undefined            

            if (isStateTreeNode(connectionToRemove)) {
                connInstance = connectionToRemove
            } else {
                connInstance = self.findByName((connectionToRemove as NwcConnection).name)
            }

            if (connInstance) {
                detach(connInstance) // needed
                destroy(connInstance)
                log.debug('[remove]', 'Connection removed from NwcStore')
            }
        },
        listenForNwcEvents () {
            log.trace('[listenForNwcEvents] got request to start nwcListener', {                
                walletPubkey: self.walletPubkey,
                isNwcListenerActive: self.isNwcListenerActive,
                relays: self.connectionRelays
            })

            if(self.nwcConnections.length === 0) {
                log.trace('[listenForNwcEvents] No NWC connections, skipping subscription...')
                return
            }

            if(self.isNwcListenerActive) {
                log.trace('[listenForNwcEvents] nwcListener is already OPEN, skipping subscription...')
                return 
            }

            // reset daily limits if day changed            
            self.resetDailyLimits()            
            
            try {
                // 10s window to get the first event that came with push message
                const since = Math.floor(Date.now() / 1000) - 5000 
                const connectionsPubkeys = self.nwcConnections.map(c => c.connectionPubkey)
                let eventsBatch: NostrEvent[] = []               
        
                const filter = [{            
                    kinds: [NWCWalletRequest],
                    authors: connectionsPubkeys,
                    "#p": [self.walletPubkey],
                    since
                }]    
                
                const pool = NostrClient.getRelayPool()
                const relaysStore = getRootStore(self).relaysStore 
                
                const sub = pool.subscribeMany(self.connectionRelays , filter, {
                    onevent(event) {
                        log.trace('[listenForNwcEvents]', `onEvent`)
                        if (event.kind != NWCWalletRequest) {
                            return
                        }                    
            
                        eventsBatch.push(event)

                        if(relaysStore.eventAlreadyReceived(event.id)) {
                            log.warn(
                                Err.ALREADY_EXISTS_ERROR, 
                                '[listenForNwcEvents] Event has been processed in the past, skipping...', 
                                {id: event.id, created_at: event.created_at}
                            )
                            return
                        }
                        
                        eventsBatch.push(event)
                        relaysStore.addReceivedEventId(event.id)
                        
                        // find connection the nwc request is sent to
                        const targetConnection = self.nwcConnections.find(c => 
                            c.connectionPubkey === event.pubkey
                        )
    
                        if(!targetConnection) {
                            throw new AppError(Err.VALIDATION_ERROR, `Your wallet has received a NWC command, but could not find related NWC connection to handle it.`)
                        }
                        
                        // dispatch to correct connection, process over sync queue
                        const now = new Date().getTime()
                        SyncQueue.addTask(       
                            `handleNwcRequestTask-${now}`,          
                            async () => await targetConnection.handleNwcRequestTask(event)               
                        )                        
                    },
                    oneose() {
                        log.trace('[listenForNwcEvents]', `onEose: Got ${eventsBatch.length} NWC events`)
                        eventsBatch = []

                        const connections = pool.listConnectionStatus()
                        log.trace('[listenForNwcEvents] onEose', {connections: Array.from(connections)})

                        const nwcConnStatuses = Array.from(connections).filter((conn: any) => self.connectionRelays.some(r => r === conn[0]))
  
                    },
                    onclose() {
                        log.trace('[listenForNwcEvents]', `onClose`)
                        self.nwcSubscription = undefined
                    }
                })

                self.nwcSubscription = sub
                
            } catch (e: any) {
                log.error(e.name, e.message)
                return
            }
        },        
        handleNwcRequestTask: flow(function* handleNwcRequestTask(event: NostrEvent, decryptedNwcRequest?: NwcRequest) {        
            // find connection the nwc request is sent to
            const targetConnection = self.nwcConnections.find(c => 
                c.connectionPubkey === event.pubkey
            )

            if(!targetConnection) {
                const message = `Your wallet has received a NWC command, but could not find related NWC connection to handle it.`
                log.error('[handleNwcRequestFromNotification]', message, {pubkey: event.pubkey})
                
                yield NotificationService.createLocalNotification(
                    Platform.OS === 'android' ? `<b>Nostr Wallet Connect<b> error` : `Nostr Wallet Connect error`,
                    message,
                    nwcPngUrl
                )
                 
                return {                
                    taskFunction: HANDLE_NWC_REQUEST_TASK,            
                    message,
                    error: new AppError(Err.WALLET_ERROR, message)
                } as WalletTaskResult
            }

            if(!event) {                
                const message = `Your wallet has received a NWC command, but could not retrieve the required data.`
                log.error('[handleNwcRequestFromNotification]', message)
                
                yield NotificationService.createLocalNotification(
                    Platform.OS === 'android' ? `<b>Nostr Wallet Connect<b> error` : `Nostr Wallet Connect error`,
                    message,
                    nwcPngUrl
                )
                 
                return {                
                    taskFunction: HANDLE_NWC_REQUEST_TASK,            
                    message,
                    error: new AppError(Err.WALLET_ERROR, message)
                } as WalletTaskResult
            }

            const nwcResponse: NwcResponse | NwcError = 
                yield targetConnection.handleNwcRequestTask(event, decryptedNwcRequest)

            return {                
                taskFunction: HANDLE_NWC_REQUEST_TASK,            
                message: (nwcResponse as NwcResponse).result || undefined ,
                error: (nwcResponse as NwcError).error ? new AppError(Err.WALLET_ERROR, (nwcResponse as NwcError).error.message) : undefined
            } as WalletTaskResult
        })
    }))
    .views(self => ({
        get all() {
            return self.nwcConnections
        }                
    }))
    .postProcessSnapshot((snapshot) => {
        return {
            nwcConnections: snapshot.nwcConnections,            
            nwcSubscription: undefined,            
        }          
      })



export interface NwcConnection extends Instance<typeof NwcConnectionModel> {}

export interface NwcStore
  extends Instance<typeof NwcStoreModel> {}
export interface NwcStoreSnapshot
  extends SnapshotOut<typeof NwcStoreModel> {}
