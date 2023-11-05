import {deriveKeysetId, getEncodedToken} from '@cashu/cashu-ts'
import {addSeconds, isBefore} from 'date-fns'
import {getSnapshot, isStateTreeNode} from 'mobx-state-tree'
import {log} from './logService'
import {MintClient, MintKeys, MintKeySets} from './cashuMintClient'
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
import {MintBalance} from '../models/Mint'
import {Token} from '../models/Token'
import {
  type TokenEntry as CashuTokenEntry,
  type Proof as CashuProof,
} from '@cashu/cashu-ts'
import {Mint} from '../models/Mint'
import {poller, stopPolling} from '../utils/poller'
import EventEmitter from '../utils/eventEmitter'
import { NostrClient, NostrEvent, NostrFilter } from './nostrService'
import { MINIBITS_SERVER_API_HOST } from '@env'
import { PaymentRequest, PaymentRequestStatus, PaymentRequestType } from '../models/PaymentRequest'
import { IncomingDataType, IncomingParser } from './incomingParser'
import { Contact } from '../models/Contact'

type WalletService = {
    checkPendingSpent: () => Promise<void>
    checkPendingReceived: () => Promise<void>
    checkSpent: () => Promise<
        {spentCount: number; spentAmount: number} | undefined
    >
    checkPendingTopups: () => Promise<void>
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
async function checkPendingSpent() {
    if (mintsStore.mintCount === 0) {
        return
    }

    // group proofs by mint so that we do max one call per mint
    for (const mint of mintsStore.allMints) {
        await _checkSpentByMint(mint.mintUrl, true) // pending true
    }
}


/*
 * Checks with NOSTR relays whether there is ecash to be received or an invoice to be paid.
 */
const checkPendingReceived = async function () {
    if(!walletProfileStore.pubkey) {
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

        log.trace('[checkPendingReceived]', 'Creating Nostr subscription...', filter)

        const pool = NostrClient.getRelayPool()
        let relaysToConnect = relaysStore.allUrls

        // TODO cleanup
        const defaultPublicRelays = NostrClient.getDefaultRelays()
        const minibitsRelays = NostrClient.getMinibitsRelays()

        if(!relaysStore.alreadyExists(minibitsRelays[0])) {                        
            relaysToConnect.push(minibitsRelays[0])
        }        

        if(!relaysStore.alreadyExists(defaultPublicRelays[0])) {                        
            relaysToConnect.push(defaultPublicRelays[0])
        }

        const sub = pool.sub(relaysToConnect , filter)
        const relaysConnections = pool._conn        

        for (const url in relaysConnections) {
            if (relaysConnections.hasOwnProperty(url)) {
                const relay = relaysConnections[url]                

                relay.on('error', (error: string) => {
                    const {url, status} = relay                    
                    relaysStore.addOrUpdateRelay({url, status, error})
                })

                relay.on('connect', () => {  
                    const {url, status} = relay                       
                    relaysStore.addOrUpdateRelay({url, status})
                })

                relay.on('disconnect', () => {                    
                    const {url, status} = relay                       
                    relaysStore.addOrUpdateRelay({url, status})
                })
            }            
        }

        let events: NostrEvent[] = []
        let result: ReceivedEventResult | undefined = undefined
        

        sub.on('event', async (event: NostrEvent) => {
            try {
                // ignore all kinds of duplicate events
                if(events.some(ev => ev.id === event.id)) {
                    log.error(Err.ALREADY_EXISTS_ERROR, 'Duplicate event received by this subscription, skipping...', event.id)
                    return
                }

                events.push(event)

                if(contactsStore.eventAlreadyReceived(event.id)) {
                    log.error(Err.ALREADY_EXISTS_ERROR, 'Event has been processed in the past, skipping...', {id: event.id})
                    return
                }                    
                
                // decrypt message content
                const decrypted = await NostrClient.decryptNip04(event.pubkey, event.content)               

                const incoming = IncomingParser.findAndExtract(decrypted)
    
                if(incoming.type === IncomingDataType.CASHU) {

                    const {
                        error, 
                        receivedAmount,
                        memo,
                        sentFrom, 
                        sentFromPubkey
                    } = await receiveFromNostrEvent(incoming.encoded, event)

                    let picture: string | undefined = undefined

                    if(sentFrom) {
                        picture = MINIBITS_SERVER_API_HOST + '/profile/avatar/' + sentFromPubkey
                    }
        
                    if(receivedAmount > 0) {
                        result = {
                            status: TransactionStatus.COMPLETED,                        
                            title: `⚡${receivedAmount} sats received!`,
                            message: `Ecash from <b>${sentFrom}</b> is now in your wallet.`,
                            memo,
                            picture,
                            token: CashuUtils.decodeToken(incoming.encoded)
                        }
            
                        EventEmitter.emit('receiveTokenCompleted', result)
                    }
        
                    if(error) {
                        throw new AppError(Err.MINT_ERROR, `Error while receiving transaction: ${error.message}`)                    
                    }

                    return
                }


                if (incoming.type === IncomingDataType.INVOICE) {

                    const sentFrom = getTagValue(event.tags, 'from')
                    const sentFromPubkey = event.pubkey
                    const maybeMemo = findMemo(decrypted)

                    const decoded = LightningUtils.decodeInvoice(incoming.encoded)
                    const {
                        amount, 
                        description, 
                        expiry, 
                        payment_hash: paymentHash, 
                        timestamp
                    } = LightningUtils.getInvoiceData(decoded)                
                    
                    const paymentRequest = paymentRequestsStore.addPaymentRequest({
                            type: PaymentRequestType.INCOMING,
                            status: PaymentRequestStatus.ACTIVE,                            
                            encodedInvoice: incoming.encoded,
                            amount: amount || 0,
                            description: maybeMemo ? maybeMemo : description,                            
                            paymentHash: paymentHash || '',
                            sentFrom,
                            sentFromPubkey,
                            sentTo: walletProfileStore.nip05,
                            sentToPubkey: walletProfileStore.pubkey,
                            expiry: expiry || 600,
                            createdAt: timestamp ? new Date(timestamp * 1000) : new Date()
                    })

                    let picture: string | undefined = undefined

                    if(sentFrom) {
                        picture = MINIBITS_SERVER_API_HOST + '/profile/avatar/' + sentFromPubkey
                    }    
                    
                    result = {
                        status: PaymentRequestStatus.ACTIVE,
                        title: `⚡ Please pay ${paymentRequest.amount} sats!`,                    
                        message: `${sentFrom} has sent you a request to pay an invoice.`,
                        memo: (maybeMemo) ? maybeMemo : paymentRequest.description,
                        picture,
                        paymentRequest,
                    }

                    EventEmitter.emit('receivePaymentRequest', result)
                    return
                }
                    
                if (incoming.type === IncomingDataType.LNURL) {
                    throw new AppError(Err.NOTFOUND_ERROR, 'LNURL support is not yet implemented.')
                }                      
                   
                throw new AppError(Err.NOTFOUND_ERROR, 'Received unknown message', incoming)
               
            } catch(e: any) {
                const result = {
                    status: TransactionStatus.ERROR,
                    message: e.message
                }
        
                EventEmitter.emit('receiveTokenOrInvoiceError', result) // so far not used
                log.error(e.name, e.message)
            }
        })

        sub.on('eose', async () => {
            log.trace(`Eose: Got ${events.length} receive events`, [], 'checkPendingReceived')
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


function getTagValue(tagsArray: [string, string][], tagName: string): string | undefined {
    const tag = tagsArray.find(([name]) => name === tagName)
    return tag ? tag[1] : undefined
}


function findMemo(message: string): string | undefined {
    // Find the last occurrence of "memo: "
    const lastIndex = message.lastIndexOf("memo: ")
    
    if (lastIndex !== -1) {        
        const memoAfterLast = message.substring(lastIndex + 6) // skip "memo: " itself
        return memoAfterLast;
    } 
        
    return undefined    
}


const receiveFromNostrEvent = async function (encoded: string, event: NostrEvent) {    
    try {
        const decoded: Token = CashuUtils.decodeToken(encoded)
        const sentFrom = getTagValue(event.tags, 'from')
        const sentFromPubkey = event.pubkey       
        const tokenAmounts = CashuUtils.getTokenAmounts(decoded)
        const amountToReceive = tokenAmounts.totalAmount
        const memo = decoded.memo || ''                    
        
        const {transaction, message, error, receivedAmount} =
            await receive(
                decoded as Token,
                amountToReceive,
                memo,
                encoded as string,
            )
        
        if(transaction && transaction.status === TransactionStatus.COMPLETED) {
            
            const updated = JSON.parse(transaction.data)
            updated[2].receivedEvent = event

            await transactionsStore.updateStatus(
                transaction.id as number,
                TransactionStatus.COMPLETED,
                JSON.stringify(updated),
            )

            await transactionsStore.updateSentFrom(
                transaction.id as number,
                sentFrom as string
            )                        
        }
        
        contactsStore.addReceivedEventId(event.id)

        return {
            error: null,
            receivedAmount: receivedAmount,
            memo,
            sentFrom: sentFrom || '',
            sentFromPubkey,
        }

    } catch (e: any) {
        return {error: e, receivedAmount: 0}
    }
}


/*
 * Recover stuck wallet if tx error caused spent proof to remain in wallet.
 */
async function checkSpent() {
    if (mintsStore.mintCount === 0) {
        return
    }

    let spentCount = 0
    let spentAmount = 0
    // group proofs by mint so that we do max one call per mint
    for (const mint of mintsStore.allMints) {
        const result = await _checkSpentByMint(mint.mintUrl, false) // pending false
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
async function _checkSpentByMint(mintUrl: string, isPending: boolean = false) {
    try {
        const proofsFromMint = proofsStore.getByMint(mintUrl, isPending) as Proof[]

        if (proofsFromMint.length < 1) {
            log.trace('[_checkSpentByMint]', `No ${isPending ? 'pending' : ''} proofs found for mint`, mintUrl)
            return
        }

        const spentProofs = await MintClient.getSpentProofsFromMint(
            mintUrl,
            proofsFromMint,
        )

        const spentCount = spentProofs.length
        const spentAmount = CashuUtils.getProofsAmount(spentProofs)

        log.trace('[_checkSpentByMint]', `spentProofs amount: ${spentAmount}`)

        if (spentProofs.length < 1) {
            log.trace('[_checkSpentByMint]', `No spent ${isPending ? 'pending' : ''} proofs returned from the mint`, mintUrl)
            return
        }

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
            stopPolling('checkSpentByMintPoller')
        }

        // TODO what to do with tx error status after removing spent proofs
        return {spentCount, spentAmount}

    } catch (e: any) {
        // silent
        log.warn('[_checkSpentByMint]', e.name, {message: e.message, mintUrl})
    }
}

const receive = async function (
    token: Token,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
) {
  const transactionData: TransactionData[] = []
  let transactionId: number = 0

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

        const mintToReceive = tokenMints[0]        

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
            const mintKeys: {
                keys: MintKeys
                keyset: string
            } = await MintClient.getMintKeys(mintToReceive)

            const newMint: Mint = {
                mintUrl: mintToReceive,
                keys: mintKeys.keys,
                keysets: [mintKeys.keyset]
            }

            mintsStore.addMint(newMint)
        }

        // Now we ask all mints to get fresh outputs for their tokenEntries, and create from them new proofs
        // 0.8.0-rc3 implements multimints receive however CashuMint constructor still expects single mintUrl
        const {updatedToken, errorToken, newKeys} = await MintClient.receiveFromMint(
            mintToReceive,
            encodedToken as string,
        )

        if(newKeys) {_updateMintKeys(mintToReceive, newKeys)}

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            errorToken,
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
            log.warn('[receive]', 'receiveToken amountWithErrors', amountWithErrors)
        }

        if (amountWithErrors === amountToReceive) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Received ecash token is not valid and can not be redeemed.',
            )
        }

        // attach transaction id and mintUrl to the proofs before storing them
        const newProofs: Proof[] = []

        for (const entry of updatedToken.token) {
            for (const proof of entry.proofs) {
                proof.tId = transactionId
                proof.mintUrl = entry.mint

                newProofs.push(proof)
            }
        }
        // create ProofModel instances and store them into the proofsStore
        proofsStore.addProofs(newProofs)

        // This should be amountToReceive - amountWithErrors but let's set it from updated token
        const receivedAmount = CashuUtils.getTokenAmounts(updatedToken as Token).totalAmount
        log.debug('[receive]', `Received amount: ${receivedAmount}`)

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
                message: `You've received ${receivedAmount} sats to your minibits wallet. ${amountWithErrors} could not be redeemed from the mint`,
                receivedAmount,
            } as TransactionResult
        }

        return {
            transaction: completedTransaction,
            message: `You've received ${receivedAmount} sats to your minibits wallet.`,
            receivedAmount,
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
            message: `You received ${amountToReceive} sats while offline. You need to redeem them to your wallet when you will be online again.`,            
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
            const mintKeys: {
                keys: MintKeys
                keyset: string
            } = await MintClient.getMintKeys(mintToReceive)

            const newMint: Mint = {
                mintUrl: mintToReceive,
                keys: mintKeys.keys,
                keysets: [mintKeys.keyset]
            }

            mintsStore.addMint(newMint)
        }

        // Now we ask all mints to get fresh outputs for their tokenEntries, and create from them new proofs
        // 0.8.0-rc3 implements multimints receive however CashuMint constructor still expects single mintUrl
        const {updatedToken, errorToken, newKeys} = await MintClient.receiveFromMint(
            tokenMints[0],
            encodedToken as string,
        )

        let amountWithErrors = 0

        if (errorToken && errorToken.token.length > 0) {
            amountWithErrors += CashuUtils.getTokenAmounts(errorToken as Token).totalAmount
            log.warn('[receiveOfflineComplete]', 'receiveToken amountWithErrors', amountWithErrors)
        }

        if (amountWithErrors === transaction.amount) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Received ecash token is not valid and can not be redeemed.',
            )
        }

        // attach transaction id and mintUrl to the proofs before storing them
        const newProofs: Proof[] = []

        for (const entry of updatedToken.token) {
            for (const proof of entry.proofs) {
                proof.tId = transaction.id
                proof.mintUrl = entry.mint

                newProofs.push(proof)
            }
        }
        // create ProofModel instances and store them into the proofsStore
        proofsStore.addProofs(newProofs)

        // This should be amountToReceive - amountWithErrors but let's set it from updated token
        const receivedAmount = CashuUtils.getTokenAmounts(updatedToken as Token).totalAmount
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
                message: `You received ${receivedAmount} sats to your minibits wallet. ${amountWithErrors} could not be redeemed from the mint`,
                receivedAmount,
            } as TransactionResult
        }

        return {
            transaction: completedTransaction,
            message: `You received ${receivedAmount} sats to your minibits wallet.`,
            receivedAmount,
        } as TransactionResult
    } catch (e: any) {
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

    try {
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

        const selectedProofsAmount = CashuUtils.getProofsAmount(selectedProofs)

        if(selectedProofsAmount > 0 && (amountToSend !== selectedProofsAmount)) { // failsafe for some unknown ecash selection UX error
            throw new AppError(Err.VALIDATION_ERROR, 'Requested amount to send does not equal sum of ecash denominations provided.')
        }

        /* 
         * if we have selected ecash to send in offline mode, we do not interact with the mint        
         */

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
         * if we do not have selected ecash and we might need a split of ecash by the mint to match exact amount        
         */        
        
        const proofsToSendFrom = proofsStore.getProofsToSend(
            amountToSend,
            proofsFromMint,
        )
        log.debug('[_sendFromMint]', 'proofsToSendFrom', proofsToSendFrom)

        // if split to required denominations was necessary, this gets it done with the mint and we get the return
        const {returnedProofs, proofsToSend, newKeys} = await MintClient.sendFromMint(
            mintUrl,
            amountToSend,
            proofsToSendFrom,
        )

        log.debug('[_sendFromMint]', 'returnedProofs', returnedProofs)
        log.debug('[_sendFromMint]', 'proofsToSend', proofsToSend)

        if (newKeys) {_updateMintKeys(mintUrl, newKeys)}

        // these might be original proofToSendFrom if they matched the exact amount and split was not necessary
        for (const proof of proofsToSend) {
            if (isStateTreeNode(proof)) {
                proof.setTransactionId(transactionId)
                proof.setMintUrl(mintUrl)
            } else {
                ;(proof as Proof).tId = transactionId
                ;(proof as Proof).mintUrl = mintUrl
            }
        }

        // add proofs returned by the mint after the split
        if (returnedProofs.length > 0) {
            // these should be fresh proofs from the mint but let's be defensive and cover the case that we over-send proofs while matching denominations
            for (const proof of returnedProofs) {
                if (isStateTreeNode(proof)) {
                    proof.setTransactionId(transactionId)
                    proof.setMintUrl(mintUrl)
                } else {
                    ;(proof as Proof).tId = transactionId
                    ;(proof as Proof).mintUrl = mintUrl
                }
            }
            
            proofsStore.addProofs(returnedProofs)
        }

        // remove used proofs and move sent proofs to pending
        proofsStore.removeProofs(proofsToSendFrom)
        proofsStore.addProofs(proofsToSend, true) // pending true

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
        if (e instanceof AppError) {
            throw e
        } else {
            throw new AppError(Err.WALLET_ERROR, e.message, e.stack.slice(0, 100))
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
            memo = 'Sent from Minibits wallet'
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

        // Start polling for accepted payment, what an ugly piece of code
        poller(
            'checkSpentByMintPoller',
            () => _checkSpentByMint(mintUrl, true),
            6 * 1000,
            20,
            5,
        )
        .then(() => log.trace('[checkSpentByMintPoller]', 'polling completed'))
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

    log.debug('[transfer]', 'mintBalanceToTransferFrom', mintBalanceToTransferFrom)
    log.debug('[transfer]', 'amountToTransfer', amountToTransfer)
    log.debug('[transfer]', 'estimatedFee', estimatedFee)
    
    if (amountToTransfer + estimatedFee > mintBalanceToTransferFrom.balance) {
        throw new AppError(Err.VALIDATION_ERROR, 'Mint balance is insufficient to cover the amount to transfer with expected Lightning fees.')
    }

    if(isBefore(invoiceExpiry, new Date())) {
        throw new AppError(Err.VALIDATION_ERROR, 'This invoice has already expired and can not be paid.', {invoiceExpiry})
    }

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

        // Use prepared proofs to settle with the mint the payment of the invoice on wallet behalf
        const {feeSavedProofs, isPaid, preimage, newKeys} =
            await MintClient.payLightningInvoice(
                mintUrl,
                encodedInvoice,
                proofsToPay,
                estimatedFee,
            )
        
        if (newKeys) {_updateMintKeys(mintUrl, newKeys)}

        // We've sent the proofsToPay to the mint, so we remove those pending proofs from model storage.
        // Hopefully mint gets important shit done synchronously.
        // We might not need to await for this and set it up as async poller with 1 poll?
        await _checkSpentByMint(mintUrl, true)

        // I have no idea yet if this can happen, return sent Proofs to the store an track tx as Reverted
        if (!isPaid) {
            _addCashuProofs(proofsToPay, mintUrl, transactionId, true)

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

        // If real fees were less then estimated, cash the returned savings.
        let finalFee = estimatedFee

        if (feeSavedProofs.length) {
            const feeSaved = _addCashuProofs(feeSavedProofs, mintUrl, transactionId)

            finalFee = estimatedFee - feeSaved            
        }
        // Save final fee in db
        await transactionsStore.updateFee(transactionId, finalFee)

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            finalFee,
            createdAt: new Date(),
        })

        const completedTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getBalances().totalBalance

        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)       

        return {
            transaction: completedTransaction,
            message: `Lightning invoice has been successfully paid and settled with your minibits coins. Final lightning network fee has been ${finalFee} sats.`,
            finalFee,
        } as TransactionResult
    } catch (e: any) {        
        // Update transaction status if we have any
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

            // Return tokens intended for payment to the wallet if payment failed with an error
            if (proofsToPay.length > 0) {
                log.info('[transfer]', 'Returning proofsToPay to the wallet likely after failed lightning payment', proofsToPay.length)
                const amount = _addCashuProofs(proofsToPay, mintUrl, transactionId, true)
            }
        }

        log.error(e.name, e.message, {}, 'transfer')

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
    isRecoveredFromPending: boolean = false
): number {
    for (const proof of proofsToAdd as Proof[]) {
        proof.tId = transactionId
        proof.mintUrl = mintUrl
    }
    // Creates proper model instances and adds them to storage
    proofsStore.addProofs(proofsToAdd as Proof[])
    const amount = CashuUtils.getProofsAmount(proofsToAdd as Proof[])

    log.trace('[_addCashuProofs]', 'Added proofs with amount', { amount, isRecoveredFromPending })
    
    if(isRecoveredFromPending) {
        // Remove them from pending if they are returned to the wallet due to failed lightning payment
        // Do not mark them as spent as they are recovered back to wallet
        proofsStore.removeProofs(proofsToAdd as Proof[], true, isRecoveredFromPending)
    }    

    return amount
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
        // const mint = mintsStore.findByUrl(mintBalanceToTopup.mint) as Mint
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

        const newPaymentRequest: PaymentRequest = {
            type: PaymentRequestType.OUTGOING,
            status: PaymentRequestStatus.ACTIVE,
            mint: mintUrl,
            encodedInvoice,
            amount,
            description: memo || `Pay to ${walletProfileStore.nip05}`,            
            paymentHash,
            sentFrom: walletProfileStore.nip05,
            sentFromPubkey: walletProfileStore.pubkey,
            sentTo: contactToSendTo?.nip05 || undefined,
            sentToPubkey: contactToSendTo?.pubkey || undefined,
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

        poller('checkPendingTopupsPoller', checkPendingTopups, 6 * 1000, 20, 5)
            .then(() => log.trace('Polling completed', [], 'checkPendingTopups'))
            .catch(error =>
                log.warn(error.message, [], 'checkPendingTopups'),
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

    const paymentRequests: PaymentRequest[] = paymentRequestsStore.allOutgoing

    if (paymentRequests.length === 0) {
        log.trace('[checkPendingTopups]', 'No outgoing payment requests in store')
        return
    }

    try {
        for (const pr of paymentRequests) {
            // claim tokens if invoice is paid
            const {proofs, newKeys} = (await MintClient.requestProofs(
                pr.mint as string,
                pr.amount,
                pr.paymentHash,
            )) as {proofs: Proof[], newKeys: MintKeys}

            if (!proofs || proofs.length === 0) {
                log.trace('[checkPendingTopups]', 'No proofs returned from mint')
                // remove already expired invoices only after check that they have not been paid                
                if (isBefore(pr.expiresAt as Date, new Date())) {
                    log.debug('[checkPendingTopups]', `Invoice expired, removing: ${pr.paymentHash}`)
                    
                    const transactionId = pr.transactionId
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

                continue
            }            

            if(newKeys) {_updateMintKeys(pr.mint as string, newKeys)}

            // accept whatever we've got
            const receivedAmount = _addCashuProofs(
                proofs,
                pr.mint as string,
                pr.transactionId as number,
            )

            if (receivedAmount !== pr.amount) {
                throw new AppError(
                Err.VALIDATION_ERROR,
                `Received amount ${receivedAmount} sats is not equal to the requested amount ${pr.amount} sats.`,
                )
            }

            // update related tx
            const transactionDataUpdate = {
                status: TransactionStatus.COMPLETED,
                createdAt: new Date(),
            }

            transactionsStore.updateStatus(
                pr.transactionId as number,
                TransactionStatus.COMPLETED,
                JSON.stringify(transactionDataUpdate),
            )

            // Fire event that the TopupScreen can listen to
            EventEmitter.emit('topupCompleted', pr)

            stopPolling('checkPendingTopupsPoller')

            // delete paid pr if we've got our cash
            paymentRequestsStore.removePaymentRequest(pr)
            // Update tx with current balance
            const balanceAfter = proofsStore.getBalances().totalBalance

            await transactionsStore.updateBalanceAfter(
                pr.transactionId as number,
                balanceAfter,
            )            
        }

    } catch (e: any) {
        // silent
        log.warn(e.name, e.message, 'checkPendingTopups')        
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

    return mint?.updateKeys(keyset, newKeys)
}

const _formatError = function (e: AppError) {
    return {
        name: e.name,
        message: e.message.slice(0, 100),
        params: e.params ? e.params.toString().slice(0, 200) : '',
    } as AppError
}

export const Wallet: WalletService = {
    checkPendingSpent,
    checkPendingReceived,
    checkSpent,
    checkPendingTopups,
    transfer,
    receive,
    receiveOfflinePrepare,
    receiveOfflineComplete,
    send,
    topup,
}
