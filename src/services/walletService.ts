import {CashuMint, deriveKeysetId, getEncodedToken} from '@cashu/cashu-ts'
import {isBefore} from 'date-fns'
import {getSnapshot, isStateTreeNode} from 'mobx-state-tree'
import {log} from './logService'
import {MintClient, MintKeys} from './cashuMintClient'
import {Proof} from '../models/Proof'
import {
  Transaction,
  TransactionData,
  TransactionRecord,
  TransactionStatus,
  TransactionType,
} from '../models/Transaction'
import {rootStoreInstance} from '../models'
import {CashuUtils} from './cashu/cashuUtils'
import {LightningUtils} from './lightning/lightningUtils'
import AppError, {Err} from '../utils/AppError'
import {MintBalance, MintStatus} from '../models/Mint'
import {Token} from '../models/Token'
import {
    type Token as CashuToken,
    type TokenEntry as CashuTokenEntry,
    type Proof as CashuProof,
} from '@cashu/cashu-ts'
import {Mint} from '../models/Mint'
import {poller, pollerExists, stopPolling} from '../utils/poller'
import EventEmitter from '../utils/eventEmitter'
import { NostrClient, NostrEvent, NostrFilter } from './nostrService'
import { MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST } from '@env'
import { PaymentRequest, PaymentRequestStatus, PaymentRequestType } from '../models/PaymentRequest'
import { IncomingDataType, IncomingParser } from './incomingParser'
import { Contact } from '../models/Contact'
import { getDefaultAmountPreference, isObj } from '@cashu/cashu-ts/src/utils'
import { delay } from '../utils/utils'


type WalletService = {
    checkPendingSpent: () => Promise<void>
    checkPendingReceived: () => Promise<void>
    checkSpent: () => Promise<{
        spentCount: number; 
        spentAmount: number
    } | undefined>
    checkPendingTopups: () => Promise<void>
    checkInFlight: () => Promise<{
        recoveredCount: number,
        recoveredAmount: number
    } | undefined>
    transfer: (
        mintBalanceToTransferFrom: MintBalance,
        amountToTransfer: number,
        estimatedFee: number,
        invoiceExpiry: Date,
        memo: string,
        encodedInvoice: string,
    ) => Promise<TransactionResult>
    receive: (
        token: Token,
        amountToReceive: number,
        memo: string,
        encodedToken: string,
    ) => Promise<TransactionResult>
    receiveOfflinePrepare: (
        token: Token,
        amountToReceive: number,
        memo: string,
        encodedToken: string,
    ) => Promise<TransactionResult>
    receiveOfflineComplete: (        
        transaction: Transaction
    ) => Promise<TransactionResult>
    send: (
        mintBalanceToSendFrom: MintBalance,
        amountToSend: number,
        memo: string,
        selectedProofs: Proof[]
    ) => Promise<TransactionResult>
    topup: (
        mintBalanceToTopup: MintBalance,
        amountToTopup: number,
        memo: string,
        contactToSendTo?: Contact
    ) => Promise<TransactionResult>
}

export type TransactionResult = {
    transaction: Transaction | undefined
    message: string
    error?: AppError
    [key: string]: any
}

export type ReceivedEventResult = {
    status: TransactionStatus | PaymentRequestStatus, 
    title: string,     
    message: string, 
    memo?: string, 
    picture?: string
    paymentRequest?: PaymentRequest
    token?: Token
}

const {
    walletProfileStore,
    mintsStore,
    proofsStore,
    transactionsStore,    
    paymentRequestsStore,
    contactsStore,
    relaysStore,
} = rootStoreInstance

/*
 * Checks with all mints whether their pending proofs have been spent.
 */
const checkPendingSpent = async function () {
    log.trace('[checkPendingSpent] start')
    if (mintsStore.mintCount === 0) {
        return
    }

    // group proofs by mint so that we do max one call per mint
    for (const mint of mintsStore.allMints) {

        if(pollerExists(`checkSpentByMintPoller-${mint.mintUrl}`)) {
            log.trace('[checkPendingSpent] Skipping _checkSpentByMint, poller exists', {mintUrl: mint.mintUrl})
            continue
        }
        
        const result = await _checkSpentByMint({mintUrl: mint.mintUrl, isPending: true}) // pending true        
        
        if(!result) {
            // go to next mint if there were no proofs to call mint with, do not assume any mint status
            continue
        }        

        if(result && result.error) {
            // if error looks like mint is offline
            if(result.error.name === Err.MINT_ERROR) {                
                mint.setStatus(MintStatus.OFFLINE)                
                return
            }
        }
        
        mint.setStatus(MintStatus.ONLINE)
    }
}


/*
 * Checks with NOSTR relays whether there is ecash to be received or an invoice to be paid.
 */
const checkPendingReceived = async function () {
    log.trace('[checkPendingReceived] start')
    if(!walletProfileStore.pubkey) { // New profile not yet created in ContactsScreen
        return       
    }
    
    // clean expired paymentRequests

    try {            
        const { lastPendingReceivedCheck } = contactsStore

        const filter: NostrFilter = [{            
            kinds: [4],
            "#p": [walletProfileStore.pubkey],
            since: lastPendingReceivedCheck || 0
        }]

        contactsStore.setLastPendingReceivedCheck()         
        const pool = NostrClient.getRelayPool()

        // make sure we have at least default relays
        if(relaysStore.allRelays.length < 3) {
            relaysStore.addDefaultRelays()
        }
        
        let relaysToConnect = relaysStore.allUrls

        const sub = pool.sub(relaysToConnect , filter)
        const relaysConnections = pool._conn        

        // update relays statuses
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

        // eventsQueue makes sure that events are processed in sequence
        let eventsQueue: NostrEvent[] = []
        let eventsBatch: NostrEvent[] = []
        let eventIsProcessing: boolean = false
        let result: ReceivedEventResult | undefined = undefined
        

        sub.on('event', async (event: NostrEvent) => {
            
            // ignore all kinds of duplicate events
            if(eventsBatch.some(ev => ev.id === event.id)) {
                log.warn(Err.ALREADY_EXISTS_ERROR, 'Duplicate event received by this subscription, skipping...', {id: event.id, created_at: event.created_at})
                return
            }                

            if(contactsStore.eventAlreadyReceived(event.id)) {
                log.warn(Err.ALREADY_EXISTS_ERROR, 'Event has been processed in the past, skipping...', {id: event.id, created_at: event.created_at})
                return
            }

            eventsQueue.push(event)
            eventsBatch.push(event)

            contactsStore.addReceivedEventId(event.id)
            // move window to receive events to the last event created_at to avoid recive it again
            contactsStore.setLastPendingReceivedCheck(event.created_at)

            // do strictly sequential queue processing
            if(!eventIsProcessing) {
                eventIsProcessing = true

                while (eventsQueue.length > 0) {
                    const ev: NostrEvent = eventsQueue.shift()

                    try {
                        log.trace('[eventsQueue] processing start ev...', ev.id)
                        await processReceiveEvent(ev)
                        log.trace('[eventsQueue] processing completed ev...', ev.id)
                    } catch (e: any) {
                        const result = {
                            status: TransactionStatus.ERROR,
                            message: e.message
                        }
                
                        EventEmitter.emit('receiveTokenOrInvoiceError', result) // so far not used
                        log.error(e.name, e.message)
                    }
                }

                eventIsProcessing = false

            } // if eventIsProcessing
        })


        const processReceiveEvent = async function (event: NostrEvent) {
                // decrypt message content
                const decrypted = await NostrClient.decryptNip04(event.pubkey, event.content)

                log.trace('[checkPendingReceived]', 'Received event', {id: event.id, created_at: event.created_at})
                
                // get sender profile and save it as a contact
                // this is not valid for events sent from LNURL bridge, that are sent and signed by a single server key
                // and *** do not contain sentFrom ***
                let sentFromPubkey = event.pubkey
                let sentFrom = getFirstTagValue(event.tags, 'from')
                let sentFromNpub = NostrClient.getNpubkey(sentFromPubkey)
                let contactFrom: Contact | undefined = undefined 
                let sentFromPicture: string | undefined = undefined          

                if(sentFrom) {
                    const sentFromName = NostrClient.getNameFromNip05(sentFrom as string)                                  
                    
                    if(sentFrom.includes(MINIBITS_NIP05_DOMAIN)) {
                        sentFromPicture = MINIBITS_SERVER_API_HOST + '/profile/avatar/' + sentFromPubkey
                    }

                    // we skip retrieval of external nostr profiles to minimize failures
                    // external contacts will thus miss image and lud16 address...
                                        
                    contactFrom = {                        
                        pubkey: sentFromPubkey,
                        npub: sentFromNpub,
                        nip05: sentFrom,
                        lud16: sentFrom.includes(MINIBITS_NIP05_DOMAIN) ? sentFrom : undefined,
                        name: sentFromName || undefined,
                        picture: sentFromPicture || undefined,
                        isExternalDomain: sentFrom.includes(MINIBITS_NIP05_DOMAIN) ? false : true                        
                    } as Contact
                    
                    contactsStore.addContact(contactFrom)
                }

                // parse incoming message
                const incoming = IncomingParser.findAndExtract(decrypted)

                log.trace('[checkPendingReceived]', 'Incoming data', {incoming})
    
                //
                // Receive token start
                //
                if(incoming.type === IncomingDataType.CASHU) {

                    const decoded: Token = CashuUtils.decodeToken(incoming.encoded)
                    const amountToReceive = CashuUtils.getTokenAmounts(decoded).totalAmount
                    const memo = decoded.memo || 'Received over Nostr'

                    const {transaction, receivedAmount} = await receive(
                        decoded as Token,
                        amountToReceive,
                        memo,
                        incoming.encoded as string,
                    )

                    // If the decrypted DM contains zap request, payment is a zap coming from LNURL server. 
                    // We retrieve the sender, we do not save zap sender to contacts, just into tx details

                    // We do it defensively only after cash is received
                    // and asynchronously so we speed up queue, as for zaps relay comm takes long
                    processReceiveNotification(event, decrypted, transaction as Transaction, receivedAmount)
                    return                   
                }

                //
                // Receive invoice start
                //
                if (incoming.type === IncomingDataType.INVOICE) {
                    // receiver is current wallet profile
                    const {
                        pubkey,
                        npub,
                        name,
                        picture,
                    } = walletProfileStore
    
                    const contactTo: Contact = {
                        pubkey,
                        npub,
                        name,
                        picture
                    }                    
                    
                    const decoded = LightningUtils.decodeInvoice(incoming.encoded)
                    const {
                        amount, 
                        description, 
                        expiry, 
                        payment_hash: paymentHash, 
                        timestamp
                    } = LightningUtils.getInvoiceData(decoded)
                    
                    const maybeMemo = findMemo(decrypted)
                    
                    const paymentRequest = paymentRequestsStore.addPaymentRequest({
                        type: PaymentRequestType.INCOMING,
                        status: PaymentRequestStatus.ACTIVE,                            
                        encodedInvoice: incoming.encoded,
                        amount: amount || 0,
                        description: maybeMemo ? maybeMemo : description,                            
                        paymentHash,
                        contactFrom: contactFrom || {pubkey: sentFromPubkey, npub: sentFromNpub},
                        contactTo,                        
                        expiry,
                        createdAt: timestamp ? new Date(timestamp * 1000) : new Date()
                    })
                    
                    result = {
                        status: PaymentRequestStatus.ACTIVE,
                        title: `⚡ Please pay ${paymentRequest.amount} SATS!`,                    
                        message: `${sentFrom} has sent you a request to pay an invoice.`,
                        memo: (maybeMemo) ? maybeMemo : paymentRequest.description,
                        picture: sentFromPicture,
                        paymentRequest,
                    }

                    EventEmitter.emit('receivePaymentRequest', result)
                    return
                }
                    
                if (incoming.type === IncomingDataType.LNURL) {
                    throw new AppError(Err.NOTFOUND_ERROR, 'LNURL support is not yet implemented.', {caller: 'checkPendingReceived'})
                }                      
                   
                throw new AppError(Err.NOTFOUND_ERROR, 'Received unknown message', incoming)
        }



        const processReceiveNotification = async function (
            event: NostrEvent, 
            decrypted: NostrEvent, 
            transaction: Transaction,
            receivedAmount: number
        ) {
            let sentFromPubkey = event.pubkey
            let sentFrom = getFirstTagValue(event.tags, 'from')
            let sentFromPicture: string | undefined = undefined  

            const maybeZapRequestString = findZapRequest(decrypted)
            let zapRequest: NostrEvent | undefined = undefined

            if(maybeZapRequestString) {
                try {
                    zapRequest = JSON.parse(maybeZapRequestString)
                    sentFromPubkey = zapRequest.pubkey // zap sender pubkey

                    const relays = getTagsByName(zapRequest.tags, 'relays')
        
                    if(relays && relays.length > 0) {
                        const senderProfile = await NostrClient.getProfileFromRelays(sentFromPubkey, relays) // returns undefined if not found
        
                        if(senderProfile) {
                            sentFrom = senderProfile.nip05 || senderProfile.name
                            sentFromPicture = senderProfile.picture
                            
                            // if we have such contact, set or update its lightning address by the one from profile
                            const contactInstance = contactsStore.findByPubkey(sentFromPubkey)
                            if(contactInstance && senderProfile.lud16) {                                        
                                contactInstance.setLud16(senderProfile.lud16)
                            }
                        }
                    }
                } catch (e: any) {
                    log.warn('[checkPendingReceived]', 'Could not get sender from zapRequest', {message: e.message, maybeZapRequestString})
                }
            }
    
            if(transaction) {
                await transactionsStore.updateSentFrom(
                    transaction.id as number,
                    sentFrom as string
                ) 
            }

            //
            // Send notification event
            //
            if(receivedAmount && receivedAmount > 0) {
                result = {
                    status: TransactionStatus.COMPLETED,                        
                    title: `⚡${receivedAmount} SATS received!`,
                    message: `${zapRequest ? 'Zap' : 'Ecash'} from <b>${sentFrom || 'unknown payer'}</b> is now in your wallet.`,                    
                    picture: sentFromPicture                    
                }
    
                EventEmitter.emit('receiveTokenCompleted', result)
            }

            return
        }

        sub.on('eose', async () => {
            log.trace('[checkPendingReceived]', `Eose: Got ${eventsBatch.length} receive events`)
        })

        
    } catch (e: any) {
        const result = {
            status: TransactionStatus.ERROR,
            message: e.message
        }

        EventEmitter.emit('receiveTokenOrInvoiceError', result) // so far not used
        log.error(e.name, e.message)
    }
}   

// returns array of values after the first element (tag name)
function getTagsByName(tagsArray: [string, string][], tagName: string) {
    let tagValues = tagsArray.find(t => t && t.length && t.length >= 2 && t[0] === tagName)
    if(tagValues && tagValues.length > 1) {
        tagValues.shift() // remove tag name
        return tagValues
    }

    return undefined
}

// returns first element after tag name
const getFirstTagValue = function (tagsArray: [string, string][], tagName: string): string | undefined {
    const tag = tagsArray.find(([name]) => name === tagName)
    return tag ? tag[1] : undefined
}


const findMemo = function (message: string): string | undefined {
    // Find the last occurrence of "memo: "
    const lastIndex = message.lastIndexOf("Memo: ")
    
    if (lastIndex !== -1) {        
        const memoAfterLast = message.substring(lastIndex + 6) // skip "memo: " itself
        return memoAfterLast
    } 
        
    return undefined    
}


const findZapRequest = function (message: string): string | undefined {
    // Find the last occurrence of "memo: "
    const lastIndex = message.lastIndexOf("zapRequest:")
    
    if (lastIndex !== -1) {        
        const zapRequestString = message.substring(lastIndex + 11) // skip "zapRequest:" itself
        return zapRequestString
    } 
        
    return undefined    
}



/*
 * Recover stuck wallet if tx error caused spent proof to remain in wallet.
 */
const checkSpent = async function () {
    if (mintsStore.mintCount === 0) {
        return
    }

    let spentCount = 0
    let spentAmount = 0
    // group proofs by mint so that we do max one call per mint
    for (const mint of mintsStore.allMints) {
        const result = await _checkSpentByMint({mintUrl: mint.mintUrl, isPending: false}) // pending false
        spentCount += result?.spentCount || 0
        spentAmount += result?.spentAmount || 0
    }

    return {spentCount, spentAmount}
}

/*
*  Checks with the mint whether proofs have been spent.
 *  Under normal wallet operations, it is used to check pending proofs that were sent to the payee.
 *
 *  However it is used as well as a recovery process to remove spent proofs from the live wallet itself.
 *  This situation occurs as a result of error during SEND or TRANSFER and causes failure of
 *  subsequent transactions because mint returns "Tokens already spent" if any spent proof is used as an input.
 */
const _checkSpentByMint = async function (params: {mintUrl: string, isPending: boolean}) {
    try {
        const {mintUrl, isPending} = params
        const proofsFromMint = proofsStore.getByMint(mintUrl, isPending) as Proof[]

        if (proofsFromMint.length < 1) {
            log.trace('[_checkSpentByMint]', `No ${isPending ? 'pending' : ''} proofs found for mint`, mintUrl)
            return
        }

        const {spent: spentProofs, pending: pendingProofs} = await MintClient.getSpentOrPendingProofsFromMint(
            mintUrl,
            proofsFromMint,
        )
        
        for (const proof of pendingProofs) {
            proofsStore.addToPendingByMint(proof as Proof)
        }        

        const spentCount = spentProofs.length
        const spentAmount = CashuUtils.getProofsAmount(spentProofs as Proof[])
        const pendingAmount = CashuUtils.getProofsAmount(pendingProofs as Proof[])

        log.trace('[_checkSpentByMint]', `spentProofs and pendingProofs amounts`, {spentAmount, pendingAmount, isPending})

        if (spentProofs.length > 0) {
            // we need to identify txIds to update their statuses, there might be more then one tx to complete
            let relatedTransactionIds: number[] = []

            for (const spentProof of spentProofs) {
                const tId = proofsFromMint.find(
                    (proof: Proof) => proof.secret === spentProof.secret,
                )?.tId

                if (tId && !relatedTransactionIds.includes(tId)) {
                    relatedTransactionIds.push(tId)
                }
            }

            // Clean pendingByMint secrets if in-flight lightning payment completed and they came back as spent            
            if(proofsStore.pendingByMintSecrets.length > 0) {

                log.trace('[_checkSpentByMint]', 'Starting sweep of spent pendingByMint proofs')

                for (const proof of spentProofs) {
                    const secret = proofsStore.pendingByMintSecrets.find((s => s === proof.secret))
                    if(secret) {
                        proofsStore.removeFromPendingByMint(proof as Proof)
                    }
                }
            }

            // remove spent proofs model instances from pending
            proofsStore.removeProofs(spentProofs as Proof[], isPending)

            // Update related transactions statuses
            log.debug('[_checkSpentByMint]', 'Transaction id(s) to complete', relatedTransactionIds.toString())

            // Complete related transactions in normal wallet operations
            if (isPending) {
                const transactionDataUpdate = {
                    status: TransactionStatus.COMPLETED,
                    createdAt: new Date(),
                }

                await transactionsStore.updateStatuses(
                    relatedTransactionIds,
                    TransactionStatus.COMPLETED,
                    JSON.stringify(transactionDataUpdate),
                )

                EventEmitter.emit('sendCompleted', relatedTransactionIds)
                stopPolling(`checkSpentByMintPoller-${mintUrl}`)
            }
        } else {
            log.trace('[_checkSpentByMint]', `No spent ${isPending ? 'pending' : ''} proofs returned from the mint`, mintUrl)                    
        }        
       
        // Check if remaining pendingByMint secrets are still pending with the mint. 
        // If not, move related wallet's pending proofs back to spendable as the payment failed and they were not spent (those are handled above). 
        const remainingSecrets = getSnapshot(proofsStore.pendingByMintSecrets) 
        
        log.trace('[_checkSpentByMint]', 'pendingByMintSecrets', remainingSecrets)

        if(remainingSecrets.length > 0 && isPending) {

            log.trace('[_checkSpentByMint]', 'Starting sweep of pendingByMintSecrets back to spendable wallet')
           
            const movedProofs: Proof[] = []

            for (const secret of remainingSecrets) {
                const proofToMove = proofsStore.getBySecret(secret, true) // find the proof in wallet's pending
                
                // only move if it is from current mint
                if(proofToMove && proofToMove.mintUrl === mintUrl) {                     
                    const stillPendingByMint = pendingProofs.find((p => p.secret === secret))

                    if(!stillPendingByMint) {
                        // move it if it is not pending by mint anymore
                        proofsStore.removeFromPendingByMint(proofToMove as Proof)                            
                        movedProofs.push(proofToMove)
                    }
                }                                
            }

            if(movedProofs.length > 0) {
                
                log.trace('[_checkSpentByMint]', 'Moving proofs from pending to spendable', movedProofs.length)

                // Update related transactions as reverted
                let relatedTransactionIds: number[] = []

                for (const movedProof of movedProofs) {
                    const tId = movedProof.tId

                    if (tId && !relatedTransactionIds.includes(tId)) {
                        relatedTransactionIds.push(tId)
                    }
                }

                // remove it from pending proofs in the wallet
                proofsStore.removeProofs(movedProofs, true, true)
                // add proofs back to the spendable wallet
                proofsStore.addProofs(movedProofs)

                if(relatedTransactionIds.length > 0) {
                    const transactionDataUpdate = {
                        status: TransactionStatus.REVERTED,
                        createdAt: new Date(),
                    }

                    await transactionsStore.updateStatuses(
                        relatedTransactionIds,
                        TransactionStatus.REVERTED,
                        JSON.stringify(transactionDataUpdate),
                    )
                }
            } else {
                log.trace('[_checkSpentByMint]', `No proofs to be moved from pending back to spendable`, mintUrl)                    
            } 
            
        }        
        
        return {
            mintUrl, 
            spentCount, 
            spentAmount
        }

    } catch (e: any) {        
        // silent
        log.error('[_checkSpentByMint]', e.name, {message: e.message, mintUrl: params.mintUrl})
        return {
            mintUrl: params.mintUrl,           
            error: e,
        }        
    }
}


/*
 * Recover proofs that were issued by mint, but wallet failed to receive them if split did not complete.
 */
const checkInFlight = async function () {
    log.trace('[checkInFlight] start')
    if (mintsStore.mintCount === 0) {
        return
    }

    let recoveredCount: number = 0
    let recoveredAmount: number = 0
    const seed = await MintClient.getSeed()

    if(!seed) {
        return
    }

    for (const mint of mintsStore.allMints) {
        try {
            const result = await _checkInFlightByMint(mint, seed)

            if(result) {
                log.info('[checkInFlight] result', {result})
            }
        } catch (e) {
            continue
        }        
    }

    log.trace('[checkInFlight] completed')
    return {recoveredCount, recoveredAmount}
}


const _checkInFlightByMint = async function (mint: Mint, seed: Uint8Array) {

    const mintUrl = mint.mintUrl
    const proofsCounter = mint.getOrCreateProofsCounter?.()  

    if(!proofsCounter?.inFlightFrom || !proofsCounter?.inFlightTo) {
        log.trace('[_checkInFlightByMint]', 'No inFlight proofs to restore', {mintUrl})
        return
    }

    try {
        log.info('[_checkInFlightByMint]', `Restoring from ${mint.hostname}...`)
        log.debug('[_checkInFlightByMint]', proofsCounter)        
                
        const { proofs, newKeys } = await MintClient.restore(
            mint.mintUrl, 
            proofsCounter.inFlightFrom, 
            proofsCounter.inFlightTo,
            seed as Uint8Array
        )

        if(newKeys) {_updateMintKeys(mint.mintUrl as string, newKeys)}

        if (proofs.length === 0) {
            mint.resetInFlight?.(proofsCounter.inFlightTid as number)
            return
        }        

        const {spent, pending} = await MintClient.getSpentOrPendingProofsFromMint(
            mint.mintUrl,
            proofs as Proof[]
        )

        const spentCount = spent.length        
        const pendingCount = pending.length
        
        const spentAmount = CashuUtils.getProofsAmount(spent as Proof[])
        const pendingAmount = CashuUtils.getProofsAmount(pending as Proof[])

        const unspent = proofs.filter(proof => !spent.includes(proof))
        const unspentCount = unspent.length
        const unspentAmount = CashuUtils.getProofsAmount(unspent as Proof[])

        log.debug('[_checkInFlightByMint]', `Restored proofs`, {
            spentCount, 
            spentAmount, 
            pendingCount, 
            pendingAmount,
            unspentCount,
            unspentAmount
        })

        if(unspent.length === 0) {
            log.debug('[_checkInFlightByMint]', `No unspent proofs recovered.`)
            mint.resetInFlight?.(proofsCounter.inFlightTid as number)
            return
        }
         
        const { addedAmount, addedProofs } = _addCashuProofs(
            unspent,
            mint.mintUrl,
            proofsCounter.inFlightTid as number                
        )

        // release the lock
        mint.resetInFlight?.(proofsCounter.inFlightTid as number)

        const txRecoveryResult  = {
            mintUrl,
            inFlightFrom: proofsCounter.inFlightFrom,
            inFlightTo: proofsCounter.inFlightTo,
            recoveredCount: addedProofs.length,
            recoveredAmount: addedAmount,
            spentCount,
            spentAmount
        }
        
        const transactionDataUpdate = {
            status: TransactionStatus.ERROR,
            txRecoveryResult,
            message: 'This transaction failed to receive expected funds from the mint, but the wallet suceeded to recover them.',
            createdAt: new Date(),
        }

        transactionsStore.updateStatuses(
            [proofsCounter.inFlightTid as number],
            TransactionStatus.ERROR, // has been most likely DRAFT
            JSON.stringify(transactionDataUpdate),
        )

        log.debug('[_checkInFlightByMint]', `Completed`, {txRecoveryResult})

        return txRecoveryResult

    } catch (e: any) {
        // silent
        log.error('[_checkInFlightByMint]', e.name, {message: e.message, mintUrl})
        // make sure we release the lock
        mint.resetInFlight?.(proofsCounter.inFlightTid as number)
        return {
            mintUrl,                
            error: {name: e.name, message: e.message}
        }
    }
}


const lockAndSetInFlight = async function (
    mint: Mint, 
    countOfInFlightProofs: number, 
    transactionId: number,
    retryCount: number = 0
): Promise<void> {
    const currentCounter = mint.getOrCreateProofsCounter?.()
    log.trace('[lockAndSetInFlight] proofsCounter', {currentCounter})   
    
    if(currentCounter && currentCounter.inFlightTid && currentCounter.inFlightTid !== transactionId) {
        
        log.warn('[lockAndSetInFlight] Waiting for a lock to release', {
            lockedBy: currentCounter.inFlightTid, 
            waiting: transactionId
        })

        await delay(1000)

        if (retryCount < 50) {
            // retry to acquire lock, increment the count of retries up to 50 seconds
            return lockAndSetInFlight(
                mint,
                countOfInFlightProofs,
                transactionId,
                retryCount + 1
            )
        } else {            
            log.error('[lockAndSetInFlight] Hard reset the lock after max retries to release were reached', {
                lockedBy: currentCounter.inFlightTid, 
                waiting: transactionId
            })         
            mint.resetInFlight?.(currentCounter.inFlightTid as number)
        }
    }

    // This sets inFlightFrom -> inFlightTo recovery interval in case the mint response won't come
    // It sets as well the counter to inFlightTo until response comes
    mint.setInFlight?.(
        currentCounter?.counter as number, 
        currentCounter?.counter as number + countOfInFlightProofs,
        transactionId
    )
}


const receive = async function (
    token: Token,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
) {
  const transactionData: TransactionData[] = []
  let transactionId: number = 0
  let mintToReceive: string | undefined = undefined

  try {
        const tokenMints: string[] = CashuUtils.getMintsFromToken(token as Token)
        log.trace('[receive]', 'receiveToken tokenMints', tokenMints)

        if (tokenMints.length === 0) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not get any mint information from the ecash token.',
            )
        }

        if (tokenMints.length > 1) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Wallet does not support receiving of tokens with entries from multiple mints.',
            )
        }

        mintToReceive = tokenMints[0]        

        // Let's create new draft receive transaction in database
        transactionData.push({
            status: TransactionStatus.DRAFT,
            amountToReceive,            
            createdAt: new Date(),
        })

        const newTransaction: Transaction = {
            type: TransactionType.RECEIVE,
            amount: amountToReceive,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintToReceive,
            status: TransactionStatus.DRAFT,
        }

        const draftTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
        transactionId = draftTransaction.id as number

        // Handle blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            const blockedTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.BLOCKED,
                JSON.stringify(transactionData),
            )

            return {
                transaction: blockedTransaction,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionResult
        }

        // Handle missing mint, we add it automatically
        const alreadyExists = mintsStore.alreadyExists(mintToReceive)

        if (!alreadyExists) {
            await mintsStore.addMint(mintToReceive)
        }

        const mintInstance = mintsStore.findByUrl(mintToReceive)

        if(!mintInstance) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing mint', {mintToReceive})
        }

        // Increase the proofs counter before the mint call so that in case the response
        // is not received our recovery index counts for sigs the mint has already issued (prevents duplicate b_b bug)
        const amountPreferences = getDefaultAmountPreference(amountToReceive)        
        const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences)
        
        log.trace('[receive]', 'proofsCounter initial state', {proofsCounter: mintInstance.getOrCreateProofsCounter?.()})
        log.trace('[receive]', 'amountPreferences', {amountPreferences, transactionId})
        log.trace('[receive]', 'countOfInFlightProofs', {countOfInFlightProofs, transactionId})  
        
        // temp increase the counter + acquire lock and set inFlight values        
        await lockAndSetInFlight(mintInstance, countOfInFlightProofs, transactionId)
        
        // get locked counter values
        const lockedProofsCounter = mintInstance.getOrCreateProofsCounter?.()
        
        // Now we ask all mints to get fresh outputs for their tokenEntries, and create from them new proofs
        // As this method supports multiple token entries potentially from multiple mints processed in cycle it does not throw but returns collected errors
        let receiveResult: {
            updatedToken: CashuToken | undefined, 
            errorToken: CashuToken | undefined, 
            newKeys: MintKeys | undefined, 
            errors: string[] | undefined
        }

        receiveResult = await MintClient.receiveFromMint(
            mintToReceive,
            encodedToken as string,
            amountPreferences,
            lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
        )        

        // auto recovery against annoying errors because of recovery counters not updated for yet unknown reasons        
        if(receiveResult.errors && 
            receiveResult.errors.length > 0 &&
            receiveResult.errors[0].includes('outputs have already been signed before')) {

            log.error('[receive] Emergency increase of proofsCounter and retrying the receive')
            
            mintInstance.increaseProofsCounter(20) 
            receiveResult = await MintClient.receiveFromMint(
                mintToReceive,
                encodedToken as string,
                amountPreferences,
                lockedProofsCounter.inFlightFrom as number + 20
            )

            log.error('[receive] Emergency increase of proofsCounter, receive retry result', {receiveResult})
        }
        
        // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
        mintInstance.decreaseProofsCounter(countOfInFlightProofs)

        const {updatedToken, errorToken, newKeys, errors} = receiveResult
        if(newKeys) { _updateMintKeys(mintToReceive, newKeys)}


        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            errorToken,
            updatedToken,            
            errors,
            createdAt: new Date(),
        })

        await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )

        let amountWithErrors = 0

        if (errorToken && errorToken.token.length > 0) {
            amountWithErrors += CashuUtils.getTokenAmounts(errorToken as Token).totalAmount
            log.warn('[receive]', 'amountWithErrors', {amountWithErrors, errors})
        }

        if (amountWithErrors === amountToReceive) {            
            throw new AppError(
                Err.MINT_ERROR,
                'Mint returned error on request to swap the received ecash.',
                {caller: 'receive', message: errors && errors.length > 0 ? errors[0] : undefined, errorToken}
            )
        }

        let receivedAmount = 0
        let addedProofsCount = 0

        if(updatedToken && updatedToken.token.length > 0) {
            for (const entry of updatedToken.token) {
                // create ProofModel instances and store them into the proofsStore
                const { addedProofs, addedAmount } = _addCashuProofs(
                    entry.proofs,
                    entry.mint,
                    transactionId as number                
                )
    
                receivedAmount += addedAmount 
                addedProofsCount += addedProofs.length         
            }
        }

        // release lock
        mintInstance.resetInFlight(transactionId)

        // temporary check of zero value tx until I figure out how it happens
        const receivedAmountCheck = CashuUtils.getTokenAmounts(updatedToken as Token).totalAmount

        if (receivedAmount !== receivedAmountCheck) {
            log.error('[receive]', 
            `Received per proofStore: ${receivedAmount} Received check using tokenAmounts: ${receivedAmountCheck}`, 
            {updatedToken})
        }        

        // Update tx amount if full amount was not received
        if (receivedAmount !== amountToReceive) {      
            await transactionsStore.updateReceivedAmount(
                transactionId,
                receivedAmount,
            )
        }

        // Finally, update completed transaction
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            receivedAmount,
            amountWithErrors,
            createdAt: new Date(),
        })

        const completedTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getBalances().totalBalance
        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)

        if (amountWithErrors > 0) {
            return {
                transaction: completedTransaction,
                message: `You've received ${receivedAmount} SATS to your Minibits wallet. ${amountWithErrors} could not be redeemed from the mint`,
                receivedAmount,
            } as TransactionResult
        }

        return {
            transaction: completedTransaction,
            message: `You've received ${receivedAmount} SATS to your Minibits wallet.`,
            receivedAmount,
        } as TransactionResult
        
    } catch (e: any) {

        let errorTransaction: TransactionRecord | undefined = undefined

        if (transactionId > 0) {            
            if(mintToReceive) {
                // release lock
                const mintInstance = mintsStore.findByUrl(mintToReceive)
                mintInstance?.resetInFlight(transactionId)
            }

            transactionData.push({
                status: TransactionStatus.ERROR,
                error: _formatError(e),
                errorToken: e.params?.errorToken || undefined
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error(e.name, e.message)

        return {
            transaction: errorTransaction || undefined,
            message: '',
            error: _formatError(e),
        } as TransactionResult
    }
}


const receiveOfflinePrepare = async function (
    token: Token,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
) {
  const transactionData: TransactionData[] = []
  let transactionId: number = 0

  try {
        const tokenMints: string[] = CashuUtils.getMintsFromToken(token as Token)
        log.trace('[receiveOfflinePrepare]', 'receiveToken tokenMints', tokenMints)

        if (tokenMints.length === 0) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not get any mint information from the ecash token.',
            )
        }


        if (tokenMints.length > 1) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Wallet does not support receiving of tokens with entries from multiple mints.',
            )
        }

        const mintToReceive = tokenMints[0]        

        // Let's create new draft receive transaction in database
        transactionData.push({
            status: TransactionStatus.DRAFT,
            amountToReceive,
            createdAt: new Date(),
        })

        const newTransaction: Transaction = {
            type: TransactionType.RECEIVE_OFFLINE,
            amount: amountToReceive,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintToReceive,
            status: TransactionStatus.DRAFT,
        }


        const draftTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
        transactionId = draftTransaction.id as number

        // Handle blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            const blockedTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.BLOCKED,
                JSON.stringify(transactionData),
            )

            return {
                transaction: blockedTransaction,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionResult
        }

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED_OFFLINE,
            encodedToken, // TODO store in model, MVP initial implementation
            createdAt: new Date(),
        })

        const preparedTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PREPARED_OFFLINE,
            JSON.stringify(transactionData),
        )

        // TODO store as proofs in new model and redeem on internet connection?
        /* const newProofs: Proof[] = []

        for (const entry of token) {
            for (const proof of entry.proofs) {
                proof.tId = transactionId
                proof.mintUrl = entry.mint //multimint support

                newProofs.push(proof)
            }
        } */

        return {
            transaction: preparedTransaction,
            message: `You received ${amountToReceive} SATS while offline. You need to redeem them to your wallet when you will be online again.`,            
        } as TransactionResult

    } catch (e: any) {
        let errorTransaction: TransactionRecord | undefined = undefined

        if (transactionId > 0) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: _formatError(e),
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error(e.name, e.message)

        return {
            transaction: errorTransaction || undefined,
            message: '',
            error: _formatError(e),
        } as TransactionResult
    }
}


const receiveOfflineComplete = async function (        
    transaction: Transaction
) {
    
    try {        
        const transactionData = JSON.parse(transaction.data)
        const {encodedToken} = transactionData.find(
            (record: any) => record.status === TransactionStatus.PREPARED_OFFLINE,
        )

        if (!encodedToken) {
            throw new AppError(Err.VALIDATION_ERROR, 'Could not find ecash token to redeem', {caller: 'receiveOfflineComplete'})
        }
        
        const token = CashuUtils.decodeToken(encodedToken)        
        const tokenMints: string[] = CashuUtils.getMintsFromToken(token as Token)
        const mintToReceive = tokenMints[0]

        // Re-check blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            const blockedTransaction = await transactionsStore.updateStatus(
                transaction.id as number,
                TransactionStatus.BLOCKED,
                JSON.stringify(transactionData),
            )

            return {
                transaction: blockedTransaction,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionResult
        }

        // Handle missing mint, we add it automatically
        const alreadyExists = mintsStore.alreadyExists(mintToReceive)

        if (!alreadyExists) {
            await mintsStore.addMint(mintToReceive)
        }

        const mintInstance = mintsStore.findByUrl(mintToReceive)

        if(!mintInstance) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing mint', {mintToReceive})
        }

        // Increase the proofs counter before the mint call so that in case the response
        // is not received our recovery index counts for sigs the mint has already issued (prevents duplicate b_b bug)
        const amountPreferences = getDefaultAmountPreference(transaction.amount)        
        const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences)
        
        log.trace('[receiveOfflineComplete]', 'amountPreferences', amountPreferences)
        log.trace('[receiveOfflineComplete]', 'countOfInFlightProofs', countOfInFlightProofs)  
        
        // temp increase the counter + acquire lock and set inFlight values        
        await lockAndSetInFlight(mintInstance, countOfInFlightProofs, transaction.id as number)
        
        // get locked counter values
        const lockedProofsCounter = mintInstance.getOrCreateProofsCounter?.()
        
        // Now we ask all mints to get fresh outputs for their tokenEntries, and create from them new proofs
        // As this method supports multiple token entries potentially from multiple mints processed in cycle it does not throw but returns collected errors
        let receiveResult: {
            updatedToken: CashuToken | undefined, 
            errorToken: CashuToken | undefined, 
            newKeys: MintKeys | undefined, 
            errors: string[] | undefined
        } 
        
        receiveResult = await MintClient.receiveFromMint(
            tokenMints[0],
            encodedToken as string,
            amountPreferences,
            lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
        )

        // auto recovery against annoying errors because of recovery counters not updated for yet unknown reasons
                   
        if(receiveResult.errors && 
            receiveResult.errors.length > 0 &&
            receiveResult.errors[0].includes('outputs have already been signed before')) {
            log.error('[receiveOfflineComplete] Emergency increase of proofsCounter and retrying the receive')
            
            mintInstance.increaseProofsCounter(20) 
            receiveResult = await MintClient.receiveFromMint(
                mintToReceive,
                encodedToken as string,
                amountPreferences,
                lockedProofsCounter.inFlightFrom as number + 20
            )

            log.error('[receiveOfflineComplete] Emergency increase of proofsCounter, receive retry result', {receiveResult})
        }        

        // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
        mintInstance.decreaseProofsCounter(countOfInFlightProofs)

        const {updatedToken, errorToken, errors, newKeys} = receiveResult
        if (newKeys) {_updateMintKeys(mintInstance.mintUrl, newKeys)}
        
        let amountWithErrors = 0

        if (errorToken && errorToken.token.length > 0) {            
            amountWithErrors += CashuUtils.getTokenAmounts(errorToken as Token).totalAmount
            log.warn('[receiveOfflineComplete]', 'receiveToken amountWithErrors', amountWithErrors)
        }

        if (amountWithErrors === transaction.amount) {            
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Ecash could not be redeemed.',
                {caller: 'receiveOfflineComplete', message: errors?.length ? errors[0] : undefined}
            )
        }        
        
        let receivedAmount = 0

        if(updatedToken && updatedToken.token.length > 0) {
            for (const entry of updatedToken.token) {
                // create ProofModel instances and store them into the proofsStore
                const { addedProofs, addedAmount } = _addCashuProofs(
                    entry.proofs,
                    entry.mint,
                    transaction.id as number                
                )
                
                receivedAmount += addedAmount            
            }
        }
        
        // release lock
        mintInstance.resetInFlight(transaction.id as number)

        // const receivedAmount = CashuUtils.getTokenAmounts(updatedToken as Token).totalAmount
        log.debug('[receiveOfflineComplete]', 'Received amount', receivedAmount)

        // Update tx amount if full amount was not received
        if (receivedAmount !== transaction.amount) {      
            await transactionsStore.updateReceivedAmount(
                transaction.id as number,
                receivedAmount,
            )
        }

        // Finally, update completed transaction        
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            receivedAmount,
            amountWithErrors,
            createdAt: new Date(),
        })

        const completedTransaction = await transactionsStore.updateStatus(
            transaction.id as number,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getBalances().totalBalance
        await transactionsStore.updateBalanceAfter(transaction.id as number, balanceAfter)

        if (amountWithErrors > 0) {
            return {
                transaction: completedTransaction,
                message: `You received ${receivedAmount} SATS to your minibits wallet. ${amountWithErrors} could not be redeemed from the mint`,
                receivedAmount,
            } as TransactionResult
        }

        return {
            transaction: completedTransaction,
            message: `You received ${receivedAmount} SATS to your minibits wallet.`,
            receivedAmount,
        } as TransactionResult
    } catch (e: any) {
        // release lock
        const mintInstance = mintsStore.findByUrl(transaction.mint)
        mintInstance?.resetInFlight(transaction.id as number)

        let errorTransaction: TransactionRecord | undefined = undefined
            
        const transactionData = JSON.parse(transaction.data)
        transactionData.push({
            status: TransactionStatus.ERROR,
            error: _formatError(e),
        })

        errorTransaction = await transactionsStore.updateStatus(
            transaction.id as number,
            TransactionStatus.ERROR,
            JSON.stringify(transactionData),
        )

        log.error(e.name, e.message)

        return {
            transaction: errorTransaction || undefined,
            message: '',
            error: _formatError(e),
        } as TransactionResult
    }
}


const _sendFromMint = async function (
    mintBalance: MintBalance,
    amountToSend: number,
    selectedProofs: Proof[],
    transactionId: number,
) {
    const mintUrl = mintBalance.mint
    const mintInstance = mintsStore.findByUrl(mintUrl)

    try {
        if (!mintInstance) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find mint', {mintUrl}
            )
        }

        const proofsFromMint = proofsStore.getByMint(mintUrl) as Proof[]

        log.debug('[_sendFromMint]', 'proofsFromMint count', proofsFromMint.length)

        if (proofsFromMint.length < 1) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find ecash for the selected mint',
            )
        }

        const totalAmountFromMint = CashuUtils.getProofsAmount(proofsFromMint)

        if (totalAmountFromMint < amountToSend) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'There is not enough funds to send this payment',
                {totalAmountFromMint, amountToSend},
            )
        }

        /* 
         * OFFLINE SEND
         * if we have selected ecash to send in offline mode, we do not interact with the mint        
         */

        const selectedProofsAmount = CashuUtils.getProofsAmount(selectedProofs)

        if(selectedProofsAmount > 0 && (amountToSend !== selectedProofsAmount)) { // failsafe for some unknown ecash selection UX error
            throw new AppError(Err.VALIDATION_ERROR, 'Requested amount to send does not equal sum of ecash denominations provided.')
        }

        if(selectedProofsAmount > 0) {
            for (const proof of selectedProofs) {                
                proof.setTransactionId(transactionId) // update txId                
            }

            // move sent proofs to pending
            proofsStore.removeProofs(selectedProofs)
            proofsStore.addProofs(selectedProofs, true) // pending true

            // Clean private properties to not to send them out. This returns plain js array, not model objects.
            const cleanedProofsToSend = selectedProofs.map(proof => {                
                const {mintUrl, tId, ...rest} = getSnapshot(proof)
                return rest                
            })

            // We return cleaned proofs to be encoded as a sendable token
            return cleanedProofsToSend
        }

        
        /* 
         * if we did not selected ecash but amount and we might need a split of ecash by the mint to match exact amount        
         */        
        
        const proofsToSendFrom = proofsStore.getProofsToSend(
            amountToSend,
            proofsFromMint,
        )

        const proofsToSendFromAmount = CashuUtils.getProofsAmount(proofsToSendFrom)

        // Increase the proofs counter before the mint call so that in case the response
        // is not received our recovery index counts for sigs the mint has already issued (prevents duplicate b_b bug)
        const amountPreferences = getDefaultAmountPreference(amountToSend)    
        const returnedAmountPreferences = getDefaultAmountPreference(proofsToSendFromAmount - amountToSend)   

        const countOfProofsToSend = CashuUtils.getAmountPreferencesCount(amountPreferences)
        const countOfReturnedProofs = CashuUtils.getAmountPreferencesCount(returnedAmountPreferences)
        const countOfInFlightProofs = countOfProofsToSend + countOfReturnedProofs        
        
        log.trace('[_sendFromMint]', 'amountPreferences', {amountPreferences, returnedAmountPreferences})
        log.trace('[_sendFromMint]', 'countOfInFlightProofs', countOfInFlightProofs)    
        
        // temp increase the counter + acquire lock and set inFlight values                
        await lockAndSetInFlight(mintInstance, countOfInFlightProofs, transactionId)
        
        // get locked counter values
        const lockedProofsCounter = mintInstance.getOrCreateProofsCounter?.()        
        
        // if split to required denominations was necessary, this gets it done with the mint and we get the return
        let sendResult: {returnedProofs: Proof[], proofsToSend: Proof[], newKeys: MintKeys | undefined} = {
            returnedProofs: [],
            proofsToSend: [],
            newKeys: undefined
        }

        try {
            sendResult = await MintClient.sendFromMint(
                mintUrl,
                amountToSend,
                proofsToSendFrom,
                amountPreferences,
                lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
            )    
        } catch (e: any) {
            if (e instanceof AppError && 
                e.params && 
                e.params.message?.includes('outputs have already been signed before')) {

                    log.error('[_sendFromMint] Emergency increase of proofsCounter and retrying the send')

                    mintInstance.increaseProofsCounter(20)
                    sendResult = await MintClient.sendFromMint(
                        mintUrl,
                        amountToSend,
                        proofsToSendFrom,
                        amountPreferences,
                        lockedProofsCounter.inFlightFrom as number + 20
                    )
                    
                    log.error('[_sendFromMint] Emergency increase of proofsCounter, send retry result', {sendResult})
            } else {
                throw e
            }
        }

        // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
        mintInstance.decreaseProofsCounter(countOfInFlightProofs) 

        const {returnedProofs, proofsToSend, newKeys} = sendResult        
        if (newKeys) {_updateMintKeys(mintUrl, newKeys)}

        // add proofs returned by the mint after the split
        if (returnedProofs.length > 0) {
            const { addedProofs, addedAmount } = _addCashuProofs(
                returnedProofs,
                mintUrl,
                transactionId          
            )            
        }

        // remove used proofs and move sent proofs to pending
        proofsStore.removeProofs(proofsToSendFrom)

        // these might be original proofToSendFrom if they matched the exact amount and split was not necessary        
        const { addedProofs, addedAmount } = _addCashuProofs(
            proofsToSend,
            mintUrl,
            transactionId,
            true       
        )

        // release lock
        mintInstance.resetInFlight(transactionId)

        // Clean private properties to not to send them out. This returns plain js array, not model objects.
        const cleanedProofsToSend = proofsToSend.map(proof => {
            if (isStateTreeNode(proof)) {
                const {mintUrl, tId, ...rest} = getSnapshot(proof)
                return rest
            } else {
                const {mintUrl, tId, ...rest} = proof as Proof
                return rest
            }
        })        
        
        // We return cleaned proofs to be encoded as a sendable token
        return cleanedProofsToSend
  } catch (e: any) {
        // release lock        
        mintInstance?.resetInFlight(transactionId)       

        if (e instanceof AppError) {
            throw e
        } else {
            throw new AppError(Err.WALLET_ERROR, e.message, e.stack.slice(0, 200))
        }
  }
}



const send = async function (
    mintBalanceToSendFrom: MintBalance,
    amountToSend: number,
    memo: string,
    selectedProofs: Proof[]
) {
    const mintUrl = mintBalanceToSendFrom.mint


    log.trace('[send]', 'mintBalanceToSendFrom', mintBalanceToSendFrom)
    log.trace('[send]', 'amountToSend', amountToSend)    
    log.trace('[send]', 'memo', memo)

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            mintBalanceToSendFrom,
            createdAt: new Date(),
        }
    ]

    let transactionId: number = 0

    try {
        const newTransaction: Transaction = {
            type: TransactionType.SEND,
            amount: amountToSend,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintUrl,
            status: TransactionStatus.DRAFT,
        }

        // store tx in db and in the model
        const storedTransaction: TransactionRecord =
        await transactionsStore.addTransaction(newTransaction)
        transactionId = storedTransaction.id as number

        // get ready proofs to send and update proofs and pending proofs storage
        const proofsToSend = await _sendFromMint(
            mintBalanceToSendFrom,
            amountToSend,
            selectedProofs,
            transactionId,
        )

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            proofsToSend,
            createdAt: new Date(),
        })

        await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )

        // Create sendable encoded token v3
        const tokenEntryToSend = {
            mint: mintUrl,
            proofs: proofsToSend,
        }

        if (!memo || memo === '') {
            memo = 'Sent from Minibits'
        }

        const encodedTokenToSend = getEncodedToken({
            token: [tokenEntryToSend as CashuTokenEntry],
            memo,
        })

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PENDING,
            encodedTokenToSend,
            createdAt: new Date(),
        })

        const pendingTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PENDING,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getBalances().totalBalance

        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)

        log.trace('[send] totalBalance after', balanceAfter)

        // Start polling for accepted payment
        poller(
            `checkSpentByMintPoller-${mintUrl}`,
            _checkSpentByMint,
            {
                interval: 6 * 1000,
                maxPolls: 20,
                maxErrors: 2
            },
            {mintUrl, isPending: true}
        )
        .then(() => log.trace('[checkSpentByMintPoller]', 'polling completed', {mintUrl}))
        .catch(error =>
            log.error(
                Err.POLLING_ERROR,
                error.message,
                {caller: '_checkSpentByMint'},
            ),
        )

        return {
            transaction: pendingTransaction,
            message: '',
            encodedTokenToSend,
        } as TransactionResult
    } catch (e: any) {
        // Update transaction status if we have any
        let errorTransaction: TransactionRecord | undefined = undefined        

        if (transactionId > 0) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: _formatError(e),
                createdAt: new Date()
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }        

        return {
            transaction: errorTransaction || undefined,
            error: _formatError(e),
        } as TransactionResult
    }
}



const transfer = async function (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    estimatedFee: number,
    invoiceExpiry: Date,
    memo: string,
    encodedInvoice: string,
) {
    const mintUrl = mintBalanceToTransferFrom.mint
    const mintInstance = mintsStore.findByUrl(mintUrl)

    log.debug('[transfer]', 'mintBalanceToTransferFrom', mintBalanceToTransferFrom)
    log.debug('[transfer]', 'amountToTransfer', amountToTransfer)
    log.debug('[transfer]', 'estimatedFee', estimatedFee)

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            mintBalanceToTransferFrom,
            encodedInvoice,
            amountToTransfer,
            estimatedFee,
            createdAt: new Date(),
        }
    ]


    let transactionId: number = 0
    let proofsToPay: CashuProof[] = []

    try {
        if (amountToTransfer + estimatedFee > mintBalanceToTransferFrom.balance) {
            throw new AppError(Err.VALIDATION_ERROR, 'Mint balance is insufficient to cover the amount to transfer with expected Lightning fees.')
        }
    
        if(isBefore(invoiceExpiry, new Date())) {
            throw new AppError(Err.VALIDATION_ERROR, 'This invoice has already expired and can not be paid.', {invoiceExpiry})
        }

        if (!mintInstance) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find mint', {mintUrl}
            )
        }

        const newTransaction: Transaction = {
            type: TransactionType.TRANSFER,
            amount: amountToTransfer,
            fee: estimatedFee,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintBalanceToTransferFrom.mint,
            status: TransactionStatus.DRAFT,
        }

        // store tx in db and in the model
        const storedTransaction: TransactionRecord =
        await transactionsStore.addTransaction(newTransaction)
        
        transactionId = storedTransaction.id as number

        // get proofs ready to be paid to the mint
        proofsToPay = await _sendFromMint(
            mintBalanceToTransferFrom,
            amountToTransfer + estimatedFee,
            [],
            transactionId,
        )

        const proofsAmount = CashuUtils.getProofsAmount(proofsToPay as Proof[])
        log.debug('[transfer]', 'Prepared poofsToPay amount', proofsAmount)

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            createdAt: new Date(),
        })

        await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )        

        // we do not know how much we will get so use big enough constant to increase and lock
        const countOfInFlightProofs = 10
        // temp increase the counter + acquire lock and set inFlight values                        
        await lockAndSetInFlight(mintInstance, countOfInFlightProofs, transactionId)

        // get locked counter values
        const lockedProofsCounter = mintInstance.getOrCreateProofsCounter?.() 
        
        let paymentResult: {feeSavedProofs: CashuProof[], isPaid: boolean, preimage: string | null, newKeys?: MintKeys} = {
            feeSavedProofs: [],
            isPaid: false,
            preimage: null,
            newKeys: undefined
        }

        try {
            paymentResult = await MintClient.payLightningInvoice(
                mintUrl,
                encodedInvoice,
                proofsToPay,
                estimatedFee,
                lockedProofsCounter.inFlightFrom as number
            )    
        } catch (e: any) {
            if (e instanceof AppError && 
                e.params && 
                e.params.message?.includes('outputs have already been signed before')) {

                    log.error('[transfer] Emergency increase of proofsCounter and retrying the send')

                    mintInstance.increaseProofsCounter(20)
                    paymentResult = await MintClient.payLightningInvoice(
                        mintUrl,
                        encodedInvoice,
                        proofsToPay,
                        estimatedFee,
                        lockedProofsCounter.inFlightFrom as number + 20 
                    )
                    
                    log.error('[transfer] Emergency increase of proofsCounter, payLightningInvoice retry result', {paymentResult})
            } else {
                throw e
            }
        }

        mintInstance.decreaseProofsCounter(countOfInFlightProofs) 
        
        const {newKeys, isPaid, feeSavedProofs} = paymentResult
        if (newKeys) {_updateMintKeys(mintUrl, newKeys)}

        // We've sent the proofsToPay to the mint, so we remove those pending proofs from model storage.
        // Hopefully mint gets important shit done synchronously.        
        await _checkSpentByMint({mintUrl, isPending: true})

        // I have no idea yet if this can happen, unpaid call throws, return sent Proofs to the store an track tx as Reverted
        if (!isPaid) {
            const { amountPendingByMint } = await _moveProofsFromPending(proofsToPay, mintUrl, transactionId)
            // release lock
            mintInstance.resetInFlight(transactionId)

            if(amountPendingByMint > 0) {
                transactionData.push({
                    status: TransactionStatus.PENDING,                    
                    amountPendingByMint,
                })

                const pendingTransaction = await transactionsStore.updateStatus(
                    transactionId,
                    TransactionStatus.PENDING,
                    JSON.stringify(transactionData),
                )
                
                // There is not clear way to get refund for saved fees later so we treat estimated fees as final
                await transactionsStore.updateFee(transactionId, estimatedFee)

                return {
                    transaction: pendingTransaction,
                    message: 'Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.',                    
                } as TransactionResult
            } else {
                transactionData.push({
                    status: TransactionStatus.REVERTED,
                    createdAt: new Date(),
                })
    
                const revertedTransaction = await transactionsStore.updateStatus(
                    transactionId,
                    TransactionStatus.REVERTED,
                    JSON.stringify(transactionData),
                )
    
                return {
                    transaction: revertedTransaction,
                    message: 'Payment of lightning invoice failed. Coins were returned to your wallet.',
                } as TransactionResult
            }            
        }

        // If real fees were less then estimated, cash the returned savings.
        let finalFee = estimatedFee

        if (feeSavedProofs.length) {
            
            const {addedAmount: feeSaved} = _addCashuProofs(
                feeSavedProofs, 
                mintUrl, 
                transactionId                
            )
            
            finalFee = estimatedFee - feeSaved            
        }

        // release lock
        mintInstance.resetInFlight(transactionId)

        // Save final fee in db
        await transactionsStore.updateFee(transactionId, finalFee)

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            finalFee,
            createdAt: new Date(),
        })

        // this overwrites transactionData and COMPLETED status already set by _checkSpentByMint
        const completedTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getBalances().totalBalance

        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)       

        return {
            transaction: completedTransaction,
            message: `Lightning invoice has been successfully paid and settled with your Minibits ecash. Final network fee has been ${finalFee} SATS.`,
            finalFee,
        } as TransactionResult
    } catch (e: any) {        
        // Update transaction status if we have any
        let errorTransaction: TransactionRecord | undefined = undefined

        if (transactionId > 0) {            
            // release lock  
            if(mintInstance) {
                mintInstance.resetInFlight(transactionId as number)
            }

            // Return tokens intended for payment to the wallet if payment failed with an error
            if (proofsToPay.length > 0) {
                log.warn('[transfer]', 'Returning proofsToPay to the wallet likely after failed lightning payment.', proofsToPay.length)
                
                const { 
                    amountToMove, 
                    amountPendingByMint 
                } = await _moveProofsFromPending(proofsToPay, mintUrl, transactionId)

                // keep tx as pending if proofs were not added because of a mint that keeps them as pending for timed out in-flight payment
                if(amountPendingByMint > 0) {
                    transactionData.push({
                        status: TransactionStatus.PENDING,
                        error: _formatError(e),
                        amountToMove,
                        amountPendingByMint,
                        createdAt: new Date()
                    })
    
                    const pendingTransaction = await transactionsStore.updateStatus(
                        transactionId,
                        TransactionStatus.PENDING,
                        JSON.stringify(transactionData),
                    )
                    
                    // There is not clear way to get refund for saved fees later so we treat estimated fees as final
                    await transactionsStore.updateFee(transactionId, estimatedFee)

                    return {
                        transaction: pendingTransaction,
                        message: 'Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.',
                        error: _formatError(e),
                    } as TransactionResult
                }

            }

            transactionData.push({
                status: TransactionStatus.ERROR,
                error: _formatError(e),
                createdAt: new Date()
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error('[transfer]', e.name, e.message, e.params)

        return {
            transaction: errorTransaction || undefined,
            message: '',
            error: _formatError(e),
        } as TransactionResult
  }
}



const _addCashuProofs = function (
    proofsToAdd: CashuProof[],
    mintUrl: string,
    transactionId: number,
    isPending: boolean = false  
): {  
    amountToAdd: number,  
    addedAmount: number,
    addedProofs: Proof[]
} {
    // Add internal references
    for (const proof of proofsToAdd as Proof[]) {
        if (isStateTreeNode(proof)) {
            proof.setTransactionId(transactionId)
            proof.setMintUrl(mintUrl)
        } else {
            ;(proof as Proof).tId = transactionId
            ;(proof as Proof).mintUrl = mintUrl
        }
    }

    const amountToAdd = CashuUtils.getProofsAmount(proofsToAdd as Proof[])    
    // Creates proper model instances and adds them to the wallet    
    const { addedAmount, addedProofs} = proofsStore.addProofs(proofsToAdd as Proof[], isPending)
   
    log.trace('[_addCashuProofs]', 'Added proofs to the wallet with amount', { amountToAdd, addedAmount, isPending })

    return {        
        amountToAdd,
        addedAmount,
        addedProofs
    }
}


const _moveProofsFromPending = async function (
    proofsToMove: CashuProof[],
    mintUrl: string,
    transactionId: number,    
): Promise<{
    amountToMove: number,
    amountPendingByMint: number,
    movedAmount: number
}> {
    // Add internal references
    for (const proof of proofsToMove as Proof[]) {
        proof.tId = transactionId
        proof.mintUrl = mintUrl
    }

    const amountToMove = CashuUtils.getProofsAmount(proofsToMove as Proof[])
    
    // Here we move proofs from pending back to spendable wallet in case of lightning payment failure
    
    // Check with the mint if the proofs are not marked as pending. This happens when lightning payment fails
    // due to the timeout but mint's node keeps the payment as in-flight (e.g. receiving node holds the invoice)
    // In this case we need to keep such proofs as pending and not move them back to wallet as in other payment failures.    
    const {pending: pendingByMint} = await MintClient.getSpentOrPendingProofsFromMint(
        mintUrl,
        proofsToMove as Proof[],
    )

    let amountPendingByMint: number = 0
    let movedAmount: number = 0
    const movedProofs: Proof[] = []

    for (const proof of proofsToMove) {
        // if proof to return to the wallet is tracked by mint as pending we do not move it from wallet's pending
        if(pendingByMint.some(p => p.secret === proof.secret)){
            // add it to the list of secrets so we can later handle them based on eventual lightning payment result
            if(proofsStore.addToPendingByMint(proof as Proof)) {
                amountPendingByMint += proof.amount
            }
        } else {
            movedAmount += proof.amount
            movedProofs.push(proof as Proof)
        }
    }

    if(movedProofs.length > 0) {
        // remove it from pending proofs in the wallet
        proofsStore.removeProofs(movedProofs, true, true)
        // add proofs back to the spendable wallet
        proofsStore.addProofs(movedProofs)

        log.trace('[_moveProofsFromPending]', 'Moved proofs back from pending to spendable', {amountToMove, amountPendingByMint, movedAmount})
    }
    
    if(amountPendingByMint > 0 && amountPendingByMint !== amountToMove) {
        // This should not happen, monitor
        log.warn('[_moveProofsFromPending]', 'Not all proofs to be moved were pending by the mint')
    }
    
    return {
        amountToMove,
        amountPendingByMint,
        movedAmount
    }
}



const topup = async function (
    mintBalanceToTopup: MintBalance,
    amountToTopup: number,
    memo: string,
    contactToSendTo?: Contact
) {
    log.info('[topup]', 'mintBalanceToTopup', mintBalanceToTopup)
    log.info('[topup]', 'amountToTopup', amountToTopup)

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            amountToTopup,
            createdAt: new Date(),
        },
    ]

    let transactionId: number = 0

    try {        
        const mintUrl = mintBalanceToTopup.mint

        const newTransaction: Transaction = {
            type: TransactionType.TOPUP,
            amount: amountToTopup,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintUrl,
            status: TransactionStatus.DRAFT,
        }
        // store tx in db and in the model
        const storedTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
        transactionId = storedTransaction.id as number        

        const {encodedInvoice, paymentHash} = await MintClient.requestLightningInvoice(mintUrl, amountToTopup)

        const decodedInvoice = LightningUtils.decodeInvoice(encodedInvoice)
        const {amount, expiry, timestamp} = LightningUtils.getInvoiceData(decodedInvoice)

        if (amount !== amountToTopup) {
            throw new AppError(
                Err.MINT_ERROR,
                'Received lightning invoice amount does not equal requested top-up amount.',
            )
        }        

        // sender is current wallet profile
        const {
            pubkey,
            npub,
            name,
            nip05,
            picture,
        } = walletProfileStore

        const contactFrom: Contact = {
            pubkey,
            npub,
            name,
            nip05,
            picture
        }

        // Private contacts are stored in model, public ones are plain objects
        const contactTo = isStateTreeNode(contactToSendTo) ? getSnapshot(contactToSendTo) : contactToSendTo

        log.trace('[topup]', 'contactTo', contactTo)

        const newPaymentRequest: PaymentRequest = {
            type: PaymentRequestType.OUTGOING,
            status: PaymentRequestStatus.ACTIVE,
            mint: mintUrl,
            encodedInvoice,
            amount,
            description: memo ? memo : contactTo ? `Pay to ${walletProfileStore.nip05}` : '',
            paymentHash,
            contactFrom,
            contactTo: contactTo || undefined,
            expiry: expiry || 600,
            transactionId,
            createdAt: timestamp ? new Date(timestamp * 1000) : new Date()
        }        

        // This calculates and sets expiresAt
        const paymentRequest = paymentRequestsStore.addPaymentRequest(newPaymentRequest)

        transactionData.push({
            status: TransactionStatus.PENDING,            
            paymentRequest,
        })

        const pendingTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PENDING,
            JSON.stringify(transactionData),
        )

        poller(`checkPendingTopupPoller-${paymentRequest.paymentHash}`, 
        _checkPendingTopup,
        {
            interval: 6 * 1000,
            maxPolls: 20,
            maxErrors: 5
        },        
        {paymentRequest})   
        .then(() => log.trace('Polling completed', [], 'checkPendingTopups'))
        .catch(error =>
            log.warn('[checkPendingTopups]', error.message),
        )

        return {
            transaction: pendingTransaction,
            message: '',
            encodedInvoice,
        } as TransactionResult

    } catch (e: any) {
        let errorTransaction: TransactionRecord | undefined = undefined

        if (transactionId > 0) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: _formatError(e),
                createdAt: new Date()
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error(e.name, e.message)

        return {
            transaction: errorTransaction || undefined,
            message: '',
            error: _formatError(e),
        } as TransactionResult
    }
}

const checkPendingTopups = async function () {
    log.trace('[checkPendingTopups] start')
    const paymentRequests: PaymentRequest[] = paymentRequestsStore.allOutgoing

    if (paymentRequests.length === 0) {
        log.trace('[checkPendingTopups]', 'No outgoing payment requests in store')
        return
    }

    for (const pr of paymentRequests) {
        // skip pr if active poller exists
        if(pollerExists(`checkPendingTopupPoller-${pr.paymentHash}`)) {
            log.trace('[checkPendingTopups] Skipping check of paymentRequest, poller exists', {paymentHash: pr.paymentHash})
            continue
        }

        await _checkPendingTopup({paymentRequest: pr})        
    }
}


const _checkPendingTopup = async function (params: {paymentRequest: PaymentRequest}) {
    const {paymentRequest: pr} = params
    const transactionId = {...pr}.transactionId // copy
    const mint = {...pr}.mint // copy
    const mintInstance = mintsStore.findByUrl(mint as string)

    try {
        if(!mintInstance) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing mint', {mintUrl: mint})
        }

        const amountPreferences = getDefaultAmountPreference(pr.amount)        
        const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences)
        
        log.trace('[_checkPendingTopup]', 'paymentRequest', pr.paymentHash)
        log.trace('[_checkPendingTopup]', 'amountPreferences', amountPreferences)
        log.trace('[_checkPendingTopup]', 'countOfInFlightProofs', countOfInFlightProofs)  
        
        // temp increase the counter + acquire lock and set inFlight values        
        await lockAndSetInFlight(mintInstance, countOfInFlightProofs, transactionId as number)
        
        // get locked counter values
        const lockedProofsCounter = mintInstance.getOrCreateProofsCounter?.()

        let requestResult: {proofs: CashuProof[], newKeys?: MintKeys} = {
            proofs: [],                
            newKeys: undefined
        }

        try {
            requestResult = (await MintClient.requestProofs(
                mint as string,
                pr.amount,
                pr.paymentHash,
                amountPreferences,
                lockedProofsCounter.inFlightFrom as number
            )) as {proofs: Proof[], newKeys: MintKeys}

        } catch (e: any) {
            if (e instanceof AppError && 
                e.params && 
                e.params.message?.includes('outputs have already been signed before')) {

                    log.error('[_checkPendingTopup] Emergency increase of proofsCounter and retrying to request proofs')

                    mintInstance.increaseProofsCounter(20)
                    requestResult = await MintClient.requestProofs(
                        mint as string,
                        pr.amount,
                        pr.paymentHash,
                        amountPreferences,
                        lockedProofsCounter.inFlightFrom as number + 20
                    )
                    
                    log.error('[_checkPendingTopup] Emergency increase of proofsCounter, retry result', {requestResult})
            } else {
                // decrease so that unpaid invoices does not cause counter gaps from polling
                mintInstance.decreaseProofsCounter(countOfInFlightProofs)
                mintInstance.resetInFlight(transactionId as number)

                // remove already expired invoices 
                if (isBefore(pr.expiresAt as Date, new Date())) {
                    log.debug('[_checkPendingTopup]', `Invoice expired, removing: ${pr.paymentHash}`)
                                        
                    stopPolling(`checkPendingTopupPoller-${pr.paymentHash}`)         
                    paymentRequestsStore.removePaymentRequest(pr)

                    // expire related tx - but only if it has not been completed before this check
                    const transaction = transactionsStore.findById(transactionId as number)

                    if(transaction && transaction.status !== TransactionStatus.COMPLETED) {
                        const transactionDataUpdate = {
                            status: TransactionStatus.EXPIRED,
                            createdAt: new Date(),
                        }                        
    
                        transactionsStore.updateStatuses(
                            [transactionId as number],
                            TransactionStatus.EXPIRED,
                            JSON.stringify(transactionDataUpdate),
                        ) 
                    }
                }

                // throw but keep polling
                throw e
            }
        }

        mintInstance.decreaseProofsCounter(countOfInFlightProofs)

        const {proofs, newKeys} = requestResult
        if(newKeys) {_updateMintKeys(mint as string, newKeys)}  
        
        // not sure this code ever runs, mint throws if not pais
        if (!proofs || proofs.length === 0) {
            log.trace('[_checkPendingTopup]', 'No proofs returned from mint')

            // remove already expired invoices only after check that they have not been paid                
            if (isBefore(pr.expiresAt as Date, new Date())) {
                log.debug('[_checkPendingTopup]', `Invoice expired, removing: ${pr.paymentHash}`)
                
                stopPolling(`checkPendingTopupPoller-${pr.paymentHash}`)
                paymentRequestsStore.removePaymentRequest(pr)
                
                // expire related tx - but only if it has not been completed before this check
                const transaction = transactionsStore.findById(transactionId as number)

                if(transaction && transaction.status !== TransactionStatus.COMPLETED) {
                    const transactionDataUpdate = {
                        status: TransactionStatus.EXPIRED,
                        createdAt: new Date(),
                    }                        

                    transactionsStore.updateStatuses(
                        [transactionId as number],
                        TransactionStatus.EXPIRED,
                        JSON.stringify(transactionDataUpdate),
                    ) 
                }                   
            }
            // release lock and move on (keep polling)
            mintInstance.resetInFlight(transactionId as number )            
            return
        }        

        // accept to the wallet whatever we've got
        const {addedAmount: receivedAmount} = _addCashuProofs(
            proofs,
            mint as string,
            transactionId as number                
        )    
        
        // release lock and cleanup
        mintInstance.resetInFlight(transactionId as number )
        stopPolling(`checkPendingTopupPoller-${pr.paymentHash}`)               

        if (receivedAmount !== pr.amount) {
            throw new AppError(
            Err.VALIDATION_ERROR,
            `Received amount ${receivedAmount} SATS is not equal to the requested amount ${pr.amount} SATS.`,
            )
        }

        // update related tx
        const transactionDataUpdate = {
            status: TransactionStatus.COMPLETED,
            createdAt: new Date(),
        }

        transactionsStore.updateStatuses(
            [transactionId as number],
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionDataUpdate),
        )

        transactionsStore.updateSentFrom(
            transactionId as number,
            pr.contactTo?.nip05 as string // payemnt has been sent from payment request receiver
        )

        // Fire event that the TopupScreen can listen to
        EventEmitter.emit('topupCompleted', {...pr})        
        
        // Update tx with current balance
        const balanceAfter = proofsStore.getBalances().totalBalance

        await transactionsStore.updateBalanceAfter(
            transactionId as number,
            balanceAfter,
        )     
    
        paymentRequestsStore.removePaymentRequest(pr)

    } catch (e: any) {
        // release lock  
        if(mintInstance) {
            mintInstance.resetInFlight(transactionId as number)
        }

        if(e.params && e.params.message.includes('quote not paid')) {            
            return
        }

        log.error('[_checkPendingTopup]', {error: e.toString()})                
    }

}

const _updateMintKeys = function (mintUrl: string, newKeys: MintKeys) {
    if(!CashuUtils.validateMintKeys(newKeys)) {
        // silent
        log.warn('[_updateMintKeys]', 'Invalid mint keys to update, skipping', newKeys)
        return
    }

    const keyset = deriveKeysetId(newKeys)
    const mint = mintsStore.findByUrl(mintUrl)
    mint?.updateKeys(keyset, newKeys)
    // needed to get rid of cached old keyset
    MintClient.resetCachedWallets()
}

const _formatError = function (e: AppError) {
    return {
        name: e.name,
        message: e.message.slice(0, 500),
        params: e.params || {},
    } as AppError 
}

export const Wallet: WalletService = {
    checkPendingSpent,
    checkPendingReceived,
    checkSpent,
    checkPendingTopups,
    checkInFlight,
    transfer,
    receive,
    receiveOfflinePrepare,
    receiveOfflineComplete,
    send,
    topup,
}
