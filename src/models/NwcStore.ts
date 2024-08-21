import {
  Instance,
  SnapshotOut,
  types,
  flow,
  destroy,
  isStateTreeNode,
  detach,  
} from 'mobx-state-tree'
import QuickCrypto from 'react-native-quick-crypto'
import {secp256k1} from '@noble/curves/secp256k1'
import {withSetPropAction} from './helpers/withSetPropAction'
import {log} from '../services/logService'
import EventEmitter from '../utils/eventEmitter'
import { getRootStore } from './helpers/getRootStore'
import { KeyChain, KeyPair, NostrClient, NostrEvent, NostrUnsignedEvent, TransactionTaskResult, WalletTask } from '../services'
import AppError, { Err } from '../utils/AppError'
import { LightningUtils } from '../services/lightning/lightningUtils'
import { addSeconds } from 'date-fns/addSeconds'
import { Transaction, TransactionStatus, TransactionType } from './Transaction'
import { MeltQuoteResponse } from '@cashu/cashu-ts'
import { WalletStore } from './WalletStore'
import { Proofs } from './ProofsStore'
import { isSameDay } from 'date-fns/isSameDay'
import { NotificationService } from '../services/notificationService'

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

type nwcTransaction = {
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

export const NwcConnectionModel = types.model('NwcConnection', {
    name: types.string,
    connectionPubkey: types.string,
    connectionSecret: types.identifier,
    meltQuoteInFlight: types.maybe(types.frozen<MeltQuoteResponse>()),
    eventInFlight: types.maybe(types.frozen<NostrEvent>()),
    dailyLimit: types.optional(types.number, 0),    
    remainingDailyLimit: types.optional(types.number, 0),
    currentDay: types.optional(types.Date, new Date()),    
})
.actions(withSetPropAction)
.views(self => ({
    get walletPubkey(): string {
        const rootStore = getRootStore(self)
        const {walletProfileStore} = rootStore
        return walletProfileStore.pubkey
    },
    get connectionRelays(): string[] {        
        return NostrClient.getMinibitsRelays()
    },
    get responseRelays(): string[] {
        const minibitsRelays = NostrClient.getMinibitsRelays()
        const publicRelays = ["wss://relay.primal.net", "wss://relay.damus.io", "wss://relay.8333.space/", "wss://relay.snort.social", "wss://nostr.mutinywallet.com"]
        return [...publicRelays, ...minibitsRelays]        
    },
    get supportedMethods() {
        return ['pay_invoice', 'get_balance', 'get_info', 'list_transactions']
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
    setRemainingDailyLimit(limit: number) {
        self.remainingDailyLimit = limit
    },
    setCurrentDay() {
        self.currentDay = new Date()
    },
    setEventInFlight(event: NostrEvent) {
        self.eventInFlight = event
    },
    resetEventInFlight() {
        self.eventInFlight = undefined
    },
    setMeltQuoteInFlight(meltQuoteInFlight: MeltQuoteResponse) {
        self.meltQuoteInFlight = meltQuoteInFlight
    },
    resetMeltQuoteInFlight() {
        self.meltQuoteInFlight = undefined
    },
}))
.actions(self => ({    
    sendResponse: flow(function* sendResponse(nwcResponse: NwcResponse | NwcError, requestEvent: NostrEvent) {
        log.trace('[Nwc.sendResponse] start', {nwcResponse})

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

            yield NotificationService.createLocalNotification(
                `<b>${self.name}</b> - Nostr Wallet Connect`,
                body + (nwcResponse as NwcError).error.message,
                nwcPngUrl
            )
        }        

        const publishedEvent: Event | undefined = yield NostrClient.publish(
            responseEvent,
            self.responseRelays                    
        )
        
        return publishedEvent
    }),
}))
.actions(self => ({    
    handleTransferTaskResult: flow(function* handleTransferTaskResult(result: TransactionTaskResult) {
        log.debug('[NWC.handleTransferTaskResult] Got transfer task result', {connection: self.name, meltQuote: result.meltQuote.quote})        

        let nwcResponse: NwcResponse | NwcError

        if(result.transaction?.status === TransactionStatus.COMPLETED) {
            const updatedLimit = self.remainingDailyLimit - 
            result.transaction.amount +
            result.transaction.fee            

            nwcResponse = {
                result_type: 'pay_invoice',
                result: {
                  preimage: result.preimage,
                }
            } as NwcResponse

            self.setRemainingDailyLimit(updatedLimit)

            // notify completed payment
            yield NotificationService.createLocalNotification(
                `<b>${self.name}</b> - Nostr Wallet Connect`,
                `Invoice for ${result.transaction.amount} SATS paid${result.transaction.fee > 0 && ', fee ' + result.transaction.fee + ' SATS'}. Remaining today's limit is ${self.remainingDailyLimit} SATS`,
                nwcPngUrl
            )
            
        } else {
            nwcResponse = {
                result_type: 'pay_invoice',
                error: { code: 'INTERNAL', message: result.message}
            } as NwcError
        }

        if(!self.eventInFlight) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing eventInFLight')
        }

        yield self.sendResponse(nwcResponse, self.eventInFlight)

        self.resetEventInFlight()
        self.resetMeltQuoteInFlight()
    })
}))
.actions(self => ({
    handleListTransactions (nwcRequest: NwcRequest): NwcResponse {
        const rootStore = getRootStore(self)
        const {transactionsStore} = rootStore
        const lightningTransactions = transactionsStore.all.filter(
            t => t.type === TransactionType.TOPUP || 
            t.type === TransactionType.TRANSFER
        )

        const transactions = lightningTransactions.map(t => {
            return {                
                type: t.type === TransactionType.TOPUP ? 'incoming' : 'outgoing',
                invoice: null,
                description: t.memo,
                preimage: null,
                payment_hash: null,
                amount: t.amount,
                fees_paid: t.fee,
                created_at: Math.floor(t.createdAt!.getTime() / 1000),
                settled_at: null,
                expires_at: null                  
            }
        })
        
        const nwcResponse = {
            result_type: nwcRequest.method,
            result: {
                transactions
            }
        }
        
        return nwcResponse   
    },
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
    handleGetBalance(nwcRequest: NwcRequest) {
        const balance = self.remainingDailyLimit
        let balanceMsat = 0

        if(balance && balance > 0) {
            balanceMsat = balance * 1000
        } else {
            balanceMsat = 0
        }

        // notify balance request
        /* yield NotificationService.createLocalNotification(
            `<b>${self.name}</b> - Nostr Wallet Connect`,
            `Daily balance is ${balance} SATS`,
            nwcPngUrl
        )*/

        const nwcResponse = {
            result_type: nwcRequest.method,
            result: {
                balance: balanceMsat
            }
        }

        return nwcResponse 
    },
    handlePayInvoice: flow(function* handlePayInvoice(nwcRequest: NwcRequest) {
        log.trace('[Nwc.handlePayInvoice] start')

        const encoded = nwcRequest.params.invoice
        const walletStore = self.getWalletStore()
        const proofsStore = self.getProofsStore()
        
        try {
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

            self.setMeltQuoteInFlight(meltQuote)
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
            )            

        } catch (e: any) {
            const message = `Could not pay provided invoice: ${e.message}`
            log.error(`[NwcConnection.handlePayInvoice] ${message}`)

            self.resetEventInFlight()
            self.resetMeltQuoteInFlight()

            return {
                result_type: nwcRequest.method,
                error: { code: 'INTERNAL', message}
            } as NwcError
        }
    })
}))
.actions(self => ({
    handleRequest: flow(function* handleRequest(requestEvent: NostrEvent) {
        // decrypt with main wallet nostr privKey. Event.pubkey should then = connectionPubkey
        const decryptedContent = yield NostrClient.decryptNip04(requestEvent.pubkey, requestEvent.content)        

        const nwcRequest: NwcRequest = JSON.parse(decryptedContent)
        let nwcResponse: NwcResponse | NwcError

        log.trace('[Nwc.handleRequest] request event', {requestEvent})
        log.trace('[Nwc.handleRequest] request method', {method: nwcRequest.method})

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
                           
            case 'pay_invoice':                
                // payInvoice is long running and async, make sure we do not overwrite event
                // by a new one
                if (self.eventInFlight) {
                    nwcResponse = {
                      result_type: nwcRequest.method,
                      error: { code: 'INTERNAL', message: 'Another payment is in flight.' }
                    } as NwcError

                    break
                }
                                
                // only early errors are immediately returned, transfer result is handled via event handler
                nwcResponse = yield self.handlePayInvoice(nwcRequest) as Promise<NwcError>
                
                // no early error, transfer initiated, exit and create response in transfer result event handler
                if(!nwcResponse) { 
                    self.setEventInFlight(requestEvent)
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
        self.setEventInFlight(requestEvent)
        yield self.sendResponse(nwcResponse, requestEvent)

    }),
}))
.actions(self => ({
    receiveNwcEvents () {  
        log.trace('[receiveNwcEvents] start listening for NWC events', {
            name: self.name, 
            connectionPubkey: self.connectionPubkey, 
            walletPubkey: self.walletPubkey
        })

        self.resetEventInFlight()
        self.resetMeltQuoteInFlight()
        
        try {   
            // reset daily limit if day changed
            if(!isSameDay(self.currentDay, new Date())) {                
                self.setRemainingDailyLimit(self.dailyLimit)
                self.setCurrentDay()
            }

            const since = Math.floor(Date.now() / 1000)
    
            const filters = [{            
                kinds: [NwcKind.request],
                authors: [self.connectionPubkey],
                "#p": [self.walletPubkey],
                since
            }]    
            
            const pool = NostrClient.getRelayPool()
    
            const sub = pool.sub(self.connectionRelays , filters)
            const relaysConnections = pool._conn    
            const rootStore = getRootStore(self)
            const {relaysStore} = rootStore
    
            // update single relay instances status
            for (const url in relaysConnections) {
                if (relaysConnections.hasOwnProperty(url)) {
                    const relay = relaysConnections[url]
    
                    relay.on('error', (error: string) => {
                        const relayInstance = relaysStore.findByUrl(relay.url)
                        relayInstance?.setStatus(relay.status)
                        relayInstance?.setError(relay.error)
                    })
    
                    relay.on('connect', () => {  
                        const relayInstance = relaysStore.findByUrl(relay.url)
                        relayInstance?.setStatus(relay.status)                    
                    })
    
                    relay.on('disconnect', () => {                    
                        const relayInstance = relaysStore.findByUrl(relay.url)
                        relayInstance?.setStatus(relay.status)  
                    })
                }            
            }

            let eventsBatch: NostrEvent[] = []
            
            sub.on('event', async (event: NostrEvent) => { 
                if (event.kind != NwcKind.request) {
                    return
                }
                
                // log.trace('[receiveNwcEvents] incoming event', {event})
    
                if(self.eventInFlight && self.eventInFlight.id === event.id) {
                    log.warn(
                        Err.ALREADY_EXISTS_ERROR, 
                        'Same NWC Event is being already processed, skipping...', 
                        {id: event.id, created_at: event.created_at, caller: 'receiveNwcEvents'}
                    )
                    return
                }
    
                eventsBatch.push(event)                
                await self.handleRequest(event)
            })        
    
            sub.on('eose', async () => {
                log.trace('[receiveNwcEvents]', `Eose: Got ${eventsBatch.length} NWC events`)
                eventsBatch = []
            })            
            
        } catch (e: any) {
            log.error(e.name, e.message)
            return
        }
    }  
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
        get all() {
            return self.nwcConnections
        },
        get supportedMethods() {
            return ['pay_invoice', 'get_balance', 'get_info', 'list_transactions']
        }
    }))
    .actions(self => ({
        handleTransferTaskResult: flow(function* handleTransferTaskResult(result: TransactionTaskResult) {
            const connectionWithTransfer = 
                self.nwcConnections.find(c => c.meltQuoteInFlight?.quote === result.meltQuote.quote)

            if(connectionWithTransfer) {
                yield connectionWithTransfer.handleTransferTaskResult(result)
            } else {
                log.trace('Not an NWC transfer, skipping...')
            }
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

            const existingInfoEvent = yield NostrClient.getEvent(newConnection.responseRelays, filters)

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
                    newConnection.responseRelays                    
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
        receiveNwcEvents() {    
            for (const conn of self.nwcConnections) {
                conn.receiveNwcEvents()
            }
            
            if (self.all.length > 0) {
                EventEmitter.on('ev_transferTask_result', self.handleTransferTaskResult)            
            }            
        },
        handleNwcRequestFromNotification: flow(function* handleNwcRequestFromNotification(requestEvent: NostrEvent) {        
            // We need to select the connection the request belongs to
            const connection = self.nwcConnections.find(c => c.connectionPubkey === requestEvent.pubkey)

            if(connection) {                
                const decryptedContent = yield NostrClient.decryptNip04(requestEvent.pubkey, requestEvent.content)
                const nwcRequest: NwcRequest = JSON.parse(decryptedContent)

                if(nwcRequest.method === 'pay_invoice') {
                    EventEmitter.on('ev_transferTask_result', self.handleTransferTaskResult)            
                }
                
                yield connection.handleRequest(requestEvent)                
                return nwcRequest
            } else {
                log.warn('[handleNwcRequestFromNotification] No connectionPubkey matches the event pubkey', {requestEvent})
            }
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
