import {
    Instance,
    SnapshotOut,
    types,
    flow,
    destroy,
    isStateTreeNode,
    detach,  
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {log} from '../services/logService'
import EventEmitter from '../utils/eventEmitter'
import { getRootStore } from './helpers/getRootStore'
import { 
    KeyChain, 
    KeyPair, 
    NostrClient, 
    NostrEvent, 
    NostrUnsignedEvent, 
    TransactionTaskResult, 
    WalletTask 
} from '../services'
import AppError, { Err } from '../utils/AppError'
import { LightningUtils } from '../services/lightning/lightningUtils'
import { addSeconds } from 'date-fns/addSeconds'
import { TransactionStatus, TransactionType } from './Transaction'
import { MeltQuoteResponse } from '@cashu/cashu-ts'
import { WalletStore } from './WalletStore'
import { Proofs } from './ProofsStore'
import { isSameDay } from 'date-fns/isSameDay'
import { NotificationService } from '../services/notificationService'
import { roundUp } from '../utils/number'
import { PaymentRequest } from './PaymentRequest'
import { PaymentRequests } from './PaymentRequestsStore'

type NwcError = {
    result_type: string,
    error: {
      code: string,
      message: string
    }
}
  
const NwcKind = {
    info: 13194,
    request: 23194,
    response: 23195
}

type NwcRequest = {
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

const nwcPngUrl = 'https://1044827509-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F0JQfRPMJ4uO7z9wmnAOK%2Fuploads%2FVO76qdgzHHzWSDsHQXdu%2FGroup%201000001143%20(1).png?alt=media&token=0fdb70b7-bb19-4bed-a752-a0560585c2f4&width=512&dpr=1&quality=100&sign=57c41699&sv=1'

const getConnectionRelays = function () {
    const minibitsRelays = NostrClient.getMinibitsRelays()
    const publicRelays = NostrClient.getDefaultRelays() 
    return [...minibitsRelays, ...publicRelays]
}

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
.views(self => ({
    get walletPubkey(): string {
        const rootStore = getRootStore(self)
        const {walletProfileStore} = rootStore
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
        return `nostr+walletconnect://${self.walletPubkey}?relay=${self.connectionRelays.join('&relay=')}&secret=${self.connectionSecret}`
    },
}))
.actions(self => ({
    getWalletKeyPair: flow(function* getWalletKeyPair() {  
        const keyPair: KeyPair = yield NostrClient.getOrCreateKeyPair()
        return keyPair
    }),
    getWalletStore (): WalletStore {  
        const rootStore = getRootStore(self)
        const {walletStore} = rootStore
        return walletStore
    },
    getProofsStore (): Proofs {  
        const rootStore = getRootStore(self)
        const {proofsStore} = rootStore
        return proofsStore
    },
    getPaymentRequestsStore (): PaymentRequests {  
        const rootStore = getRootStore(self)
        const {paymentRequestsStore} = rootStore
        return paymentRequestsStore
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
            kind: NwcKind.response,
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

            const enabled = yield NotificationService.areNotificationsEnabled()
            if(enabled) {
                yield NotificationService.createLocalNotification(
                    `<b>${self.name}</b> - Nostr Wallet Connect`,
                    body + (nwcResponse as NwcError).error.message,
                    nwcPngUrl
                )
            }
        }        

        NostrClient.publish(
            responseEvent,
            self.connectionRelays                    
        )       
        
    }),
}))
.actions(self => ({    
    handleTransferTaskResult: flow(function* handleTransferTaskResult(result: TransactionTaskResult) {
        log.debug('[handleTransferTaskResult] Got transfer task result', {
            connection: self.name, 
            meltQuote: result.meltQuote?.quote,            
        })

        if(result.meltQuote?.quote === self.lastMeltQuoteId) {
            log.error('Meltquote has been already handled, skipping...', {
                meltQuoteId: self.lastMeltQuoteId, 
                caller: 'handleTransferTaskResult'
            })
            return
        }

        self.setLastMeltQuoteId(result.meltQuote?.quote)

        let nwcResponse: NwcResponse | NwcError

        if(result.transaction?.status === TransactionStatus.COMPLETED) {
            const updatedLimit = self.remainingDailyLimit - 
            (result.transaction.amount + result.transaction.fee)

            nwcResponse = {
                result_type: 'pay_invoice',
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

            // notify completed payment
            const enabled = yield NotificationService.areNotificationsEnabled()
            if(enabled) {
                yield NotificationService.createLocalNotification(
                    `<b>${self.name}</b> - Nostr Wallet Connect`,
                    `Invoice for ${result.transaction.amount} SATS paid${result.transaction.fee > 0 ? ', fee ' + result.transaction.fee + ' SATS' : ''}. Remaining today's limit is ${self.remainingDailyLimit} SATS`,
                    nwcPngUrl
                )
            }
        } else {
            nwcResponse = {
                result_type: 'pay_invoice',
                error: { code: 'INTERNAL', message: result.message}
            } as NwcError
        }

        if(!result.nwcEvent) {
            log.error('Missing nwcEvent.', {caller: 'handleTransferTaskResult'})
            return
        }

        yield self.sendResponse(nwcResponse, result.nwcEvent)
    }),
    handleTopupTaskResult: flow(function* handleTopupTaskResult(result: TransactionTaskResult) {
        log.debug('Got topup task result', {
            connection: self.name,
            encodedInvoice: result.encodedInvoice,             
            caller: 'handleTopupTaskResult'
        })
        
        if(!result.nwcEvent) {
            log.error('Missing nwcEvent.', {caller: 'handleTopupTaskResult'})
            return
        }

        let nwcResponse: NwcResponse | NwcError

        if(result.paymentRequest) {
            const pr: PaymentRequest = result.paymentRequest

            nwcResponse = {
                result_type: 'make_invoice',
                result: {
                    type: 'incoming',
                    invoice: pr.encodedInvoice,
                    description: pr.description,                                    
                    payment_hash: pr.paymentHash,
                    amount: pr.invoicedAmount * 1000,
                    fees_paid: 0,
                    created_at: Math.floor(pr.createdAt!.getTime() / 1000),
                    expires_at: Math.floor(pr.expiresAt!.getTime() / 1000),                    
                    preimage: null,
                    settled_at: null
                } as NwcTransaction
            } as NwcResponse            

            // notify created topup
            const enabled = yield NotificationService.areNotificationsEnabled()
            if(enabled) {
                yield NotificationService.createLocalNotification(
                    `<b>${self.name}</b> - Nostr Wallet Connect`,
                    `Invoice for ${result.paymentRequest.amount} SATS has been created.`,
                    nwcPngUrl
                )
            }            
        } else {
            nwcResponse = {
                result_type: 'make_invoice',
                error: { code: 'INTERNAL', message: result.message}
            } as NwcError
        }

        yield self.sendResponse(nwcResponse, result.nwcEvent)
    })
}))
.actions(self => ({
    handleGetInfo (nwcRequest: NwcRequest): NwcResponse {        
        const nwcResponse = {
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
        const lightningTransactions = transactionsStore.all.filter(
            t => (t.type === TransactionType.TOPUP || 
            t.type === TransactionType.TRANSFER) && 
            t.status === TransactionStatus.COMPLETED
        )

        // TODO barebones implementation, no paging commands support
        const transactions = lightningTransactions.map(t => {
            return {                
                type: t.type === TransactionType.TOPUP ? 'incoming' : 'outgoing',
                invoice: '',
                description: t.memo,
                preimage: null,
                payment_hash: null,
                amount: t.amount,
                fees_paid: t.fee,
                created_at: Math.floor(t.createdAt!.getTime() / 1000),
                settled_at: Math.floor(t.createdAt!.getTime() / 1000),
                expires_at: null                  
            } as NwcTransaction
        })
        
        const nwcResponse = {
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

        const nwcResponse = {
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

        yield WalletTask.topup(
            mintBalance,
            roundUp(amontMsat / 1000, 0),
            'sat',
            description,
            undefined,
            requestEvent                    
        )        
    }),
    handleLookupInvoice(nwcRequest: NwcRequest) {
        const paymentRequestsStore = self.getPaymentRequestsStore()
        let pr: PaymentRequest | undefined = undefined

        if(nwcRequest.params.payment_hash) {
            pr = paymentRequestsStore.findByPaymentHash(nwcRequest.params.payment_hash)
        }

        if(nwcRequest.params.invoice) {
            pr = paymentRequestsStore.findByEncodedInvoice(nwcRequest.params.invoice)
        }

        if(!pr) {
            return {
                result_type: nwcRequest.method,
                error: { code: 'INTERNAL', message: 'Could not find requested invoice'}
            } as NwcError
        }

        return {
            result_type: nwcRequest.method,
            result: {
                type: 'incoming',
                invoice: pr.encodedInvoice,
                description: pr.description,                                    
                payment_hash: pr.paymentHash,
                amount: pr.invoicedAmount * 1000,
                fees_paid: 0,
                created_at: Math.floor(pr.createdAt!.getTime() / 1000),
                expires_at: Math.floor(pr.expiresAt!.getTime() / 1000),                    
                preimage: null,
                settled_at: null
            } as NwcTransaction
        } as NwcResponse
    },
    handlePayInvoice: flow(function* handlePayInvoice(nwcRequest: NwcRequest, requestEvent: NostrEvent) {
        log.trace('[Nwc.handlePayInvoice] start')       

        try {
            const encoded = nwcRequest.params.invoice
            const walletStore = self.getWalletStore()
            const proofsStore = self.getProofsStore()        
        
            const invoice = LightningUtils.decodeInvoice(encoded)

            const {
                amount: amountToPay, 
                expiry, 
                description, 
                timestamp
            } = LightningUtils.getInvoiceData(invoice)

            const invoiceExpiry = addSeconds(new Date(timestamp as number * 1000), expiry as number)

            const mintBalance = proofsStore.getMintBalanceWithMaxBalance('sat')
            const availableBalanceSat = mintBalance?.balances.sat || 0

            if(!mintBalance || availableBalanceSat < amountToPay) { // decoded amount is in sat
                const message = `Insufficient balance to pay this invoice`
                return {
                    result_type: nwcRequest.method,
                    error: { code: 'INSUFFICIENT_BALANCE', message}
                } as NwcError
            }

            // melt quote
            const meltQuote: MeltQuoteResponse = yield walletStore.createLightningMeltQuote(
                mintBalance.mintUrl,
                'sat',
                encoded,
            )
            
            const totalAmountToPay = meltQuote.amount + meltQuote.fee_reserve

            // reset daily limit if day changed while keeping live connection
            if(!isSameDay(self.currentDay, new Date())) {                
                self.setRemainingDailyLimit(self.dailyLimit)
                self.setCurrentDay()
            }

            if(availableBalanceSat  < totalAmountToPay) {
                const message = `Insufficient balance to pay this invoice.`
                return {
                    result_type: nwcRequest.method,
                    error: { code: 'INSUFFICIENT_BALANCE', message}
                } as NwcError
            }

            if(totalAmountToPay > self.remainingDailyLimit) {
                const message = `Your remaining daily limit of ${self.remainingDailyLimit} SATS would be exceeded with this payment.`
                return {
                    result_type: nwcRequest.method,
                    error: { code: 'QUOTA_EXCEEDED', message}
                } as NwcError
            }
            
            // Jachyme, hod ho do stroje!
            WalletTask.transfer(
                mintBalance,
                amountToPay,
                'sat',
                meltQuote,        
                description || '',
                invoiceExpiry as Date,
                encoded,
                requestEvent
            )

        } catch (e: any) {            
            log.error(`[NwcConnection.handlePayInvoice] ${e.message}`)

            return {
                result_type: nwcRequest.method,
                error: { code: 'INTERNAL', message: e.message}
            } as NwcError
        }
    })
}))
.actions(self => ({
    handleRequest: flow(function* handleRequest(requestEvent: NostrEvent) {
        // decrypt with main wallet privKey. Event.pubkey = connectionPubkey
        const decryptedContent = yield NostrClient.decryptNip04(requestEvent.pubkey, requestEvent.content)        

        const nwcRequest: NwcRequest = JSON.parse(decryptedContent)
        let nwcResponse: NwcResponse | NwcError

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
                nwcResponse = yield self.handleMakeInvoice(nwcRequest, requestEvent) as Promise<NwcError | undefined> 
                
                // no early error, topup initiated, exit and create response in topup result event handler
                if(!nwcResponse) {                    
                    return
                }
                break
            case 'lookup_invoice':                
                nwcResponse = self.handleLookupInvoice(nwcRequest)    
                break        
            case 'pay_invoice': 
                // only early errors are immediately returned
                nwcResponse = yield self.handlePayInvoice(nwcRequest, requestEvent) as Promise<NwcError | undefined>
                
                // no early error, transfer initiated, exit and create response in transfer result event handler
                if(!nwcResponse) {                    
                    return
                }
                break
            default:
                const message = `NWC method ${nwcRequest.method} is unknown or not yet supported.`
                nwcResponse = {
                    result_type: nwcRequest.method,
                    error: { code: 'NOT_IMPLEMENTED', message}
                } as NwcError

                log.error(message, {nwcRequest})
        }

        // needs to be set before sendResponse but after switch / pay_invoice        
        yield self.sendResponse(nwcResponse, requestEvent)

    }),
}))



export const NwcStoreModel = types
    .model('NwcStore', {
        nwcConnections: types.array(NwcConnectionModel),        
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
        handleTransferResult: flow(function* handleTransferResult(result: TransactionTaskResult) {        
            // find connection the nwc request is sent to
            const targetConnection = self.nwcConnections.find(c => 
                c.connectionPubkey === result.nwcEvent?.pubkey
            )

            if(!targetConnection) {
                log.error('Missing connection matching event pubkey', {pubkey: result.nwcEvent?.pubkey})
                return
            }

            yield targetConnection.handleTransferTaskResult(result)                
              
        }),
        handleTopupResult: flow(function* handleTopupResult(result: TransactionTaskResult) {        
            // find connection the nwc request is sent to
            const targetConnection = self.nwcConnections.find(c => 
                c.connectionPubkey === result.nwcEvent?.pubkey
            )

            if(!targetConnection) {
                log.error('Missing connection matching event pubkey', {pubkey: result.nwcEvent?.pubkey})
                return
            }

            yield targetConnection.handleTopupTaskResult(result)                
              
        }),
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

            const filters = [{            
                kinds: [NwcKind.info],
                authors: [newConnection.walletPubkey],                
            }]

            // Not sure we should publish that as we are not always on, TBD
            const existingInfoEvent = yield NostrClient.getEvent(newConnection.connectionRelays, filters)

            if(!existingInfoEvent) {
                // publish info replacable event // seems to be a relict replaced by get_info request?
                const infoEvent: NostrUnsignedEvent = {
                    kind: NwcKind.info,
                    pubkey: newConnection.walletPubkey,
                    tags: [],                        
                    content: self.supportedMethods.join(' '),
                    created_at: Math.floor(Date.now() / 1000)                              
                }

                NostrClient.publish(
                    infoEvent,
                    newConnection.connectionRelays                    
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
        receiveNwcEvents () {
            log.trace('[receiveNwcEvents] start listening for NWC events', {                
                walletPubkey: self.walletPubkey
            })

            if(self.nwcConnections.length === 0) {
                log.trace('[receiveNwcEvents] No NWC connections, skipping subscription...')
                return
            }

            // reset daily limits if day changed            
            for (const c of self.nwcConnections) {
                if(!isSameDay(c.currentDay, new Date())) {
                    c.setRemainingDailyLimit(c.dailyLimit)
                    c.setCurrentDay()
                }
            }            
            
            try {
                const since = Math.floor(Date.now() / 1000)
                const connectionsPubkeys = self.nwcConnections.map(c => c.connectionPubkey)                
        
                const filters = [{            
                    kinds: [NwcKind.request],
                    authors: connectionsPubkeys,
                    "#p": [self.walletPubkey],
                    since
                }]    
                
                const pool = NostrClient.getRelayPool()        
                const sub = pool.sub(self.connectionRelays , filters)
    
                let eventsBatch: NostrEvent[] = []
                
                sub.on('event', async (event: NostrEvent) => { 
                    if (event.kind != NwcKind.request) {
                        return
                    }                    
        
                    eventsBatch.push(event)
                    
                    // find connection the nwc request is sent to
                    const targetConnection = self.nwcConnections.find(c => 
                        c.connectionPubkey === event.pubkey
                    )

                    if(!targetConnection) {
                        throw new AppError(Err.VALIDATION_ERROR, 'Missing connection matching event pubkey', {pubkey: event.pubkey})
                    }
                    // dispatch to correct connection
                    await targetConnection.handleRequest(event)
                })        
        
                sub.on('eose', async () => {
                    log.trace('[receiveNwcEvents]', `Eose: Got ${eventsBatch.length} NWC events`)
                    eventsBatch = []
                })
                
                EventEmitter.on('ev_transferTask_result', self.handleTransferResult)
                EventEmitter.on('ev_topupTask_result', self.handleTopupResult)
                
            } catch (e: any) {
                log.error(e.name, e.message)
                return
            }
        },        
        handleNwcRequestFromNotification: flow(function* handleNwcRequestFromNotification(event: NostrEvent) {        
            // find connection the nwc request is sent to
            const targetConnection = self.nwcConnections.find(c => 
                c.connectionPubkey === event.pubkey
            )

            if(!targetConnection) {
                log.error('[handleNwcRequestFromNotification] Missing connection matching event pubkey.', {pubkey: event.pubkey})
                return
            }

            yield targetConnection.handleRequest(event)                

            EventEmitter.on('ev_transferTask_result', self.handleTransferResult)
            EventEmitter.on('ev_topupTask_result', self.handleTopupResult)
              
        })
    }))
    .views(self => ({
        get all() {
            return self.nwcConnections.slice()
        }                
    }))


export interface NwcConnection extends Instance<typeof NwcConnectionModel> {}

export interface NwcStore
  extends Instance<typeof NwcStoreModel> {}
export interface NwcStoreSnapshot
  extends SnapshotOut<typeof NwcStoreModel> {}
