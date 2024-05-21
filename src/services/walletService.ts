import {isBefore} from 'date-fns'
import {getSnapshot} from 'mobx-state-tree'
import {log} from './logService'
import {MintClient} from './cashuMintClient'
import {Proof} from '../models/Proof'
import {
  Transaction,
  TransactionStatus
} from '../models/Transaction'
import {rootStoreInstance} from '../models'
import {CashuUtils} from './cashu/cashuUtils'
import {LightningUtils} from './lightning/lightningUtils'
import AppError, {Err} from '../utils/AppError'
import {MintBalance, MintStatus} from '../models/Mint'
import {Token} from '../models/Token'
import {MeltQuoteResponse, type Proof as CashuProof} from '@cashu/cashu-ts'
import {Mint} from '../models/Mint'
import {pollerExists, stopPolling} from '../utils/poller'
import EventEmitter from '../utils/eventEmitter'
import { NostrClient, NostrEvent, NostrFilter, NostrProfile } from './nostrService'
import { MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST } from '@env'
import { PaymentRequest, PaymentRequestStatus, PaymentRequestType } from '../models/PaymentRequest'
import { IncomingDataType, IncomingParser } from './incomingParser'
import { Contact } from '../models/Contact'
import { getDefaultAmountPreference } from '@cashu/cashu-ts/src/utils'
import { SyncQueue } from './syncQueueService'
import { receiveTask, receiveOfflinePrepareTask, receiveOfflineCompleteTask} from './wallet/receiveTask'
import { sendTask } from './wallet/sendTask'
import { topupTask } from './wallet/topupTask'
import { transferTask } from './wallet/transferTask'
import { WalletUtils } from './wallet/utils'
import { NotificationService } from './notificationService'
import { CurrencyCode, MintUnit, formatCurrency, getCurrency } from './wallet/currency'


type WalletTaskService = {
    handleSpentFromPending: ()   => Promise<void>
    handleSpentFromSpendable: () => Promise<void>
    handleSpentByMint: (
        options: {
            mintUrl: string, 
            isPending: boolean
        }
    ) => Promise<void>
    handleInFlight: ()       => Promise<void>
    handlePendingTopups: ()   => Promise<void>
    handlePendingTopup: (params: {
        paymentRequest: PaymentRequest
    })   => Promise<void>
    receiveEventsFromRelays: () => Promise<void>
    transfer: (
        mintBalanceToTransferFrom: MintBalance,
        amountToTransfer: number,
        unit: MintUnit,
        meltQuote: MeltQuoteResponse,                
        memo: string,
        invoiceExpiry: Date,
        encodedInvoice: string,
    ) => Promise<void>
    receive: (
        token: Token,
        amountToReceive: number,
        memo: string,
        encodedToken: string,
    ) => Promise<void>
    receiveOfflinePrepare: (
        token: Token,
        amountToReceive: number,
        memo: string,
        encodedToken: string,
    ) => Promise<void>
    receiveOfflineComplete: (        
        transaction: Transaction
    ) => Promise<void>
    send: (
        mintBalanceToSendFrom: MintBalance,
        amountToSend: number,
        unit: MintUnit,
        memo: string,
        selectedProofs: Proof[]
    ) => Promise<void>
    topup: (
        mintBalanceToTopup: MintBalance,
        amountToTopup: number,
        unit: MintUnit,
        memo: string,
        contactToSendTo?: Contact
    ) => Promise<void>
}

export interface WalletTaskResult {
    taskFunction: string
    mintUrl: string
    message: string
    error?: AppError
    [key: string]: any
}

export interface TransactionTaskResult extends WalletTaskResult {
    transaction?: Transaction
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


const transfer = async function (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    unit: MintUnit,
    meltQuote: MeltQuoteResponse,
    memo: string,
    invoiceExpiry: Date,    
    encodedInvoice: string,
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addPrioritizedTask(
        `transferTask-${now}`,
        async () => await transferTask(
            mintBalanceToTransferFrom,
            amountToTransfer,
            unit,
            meltQuote,            
            memo,
            invoiceExpiry,
            encodedInvoice,
        )
    )
    return
}


const receive = async function (
    token: Token,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addPrioritizedTask(
        `receiveTask-${now}`,           
        async () => await receiveTask(
            token,
            amountToReceive,
            memo,
            encodedToken,
        )
    )
    return
}


const receiveOfflinePrepare = async function (
    token: Token,
    amountToReceive: number,    
    memo: string,
    encodedToken: string,
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addTask(
        `receiveOfflinePrepareTask-${now}`, 
        async () => await receiveOfflinePrepareTask(
            token,
            amountToReceive,            
            memo,
            encodedToken,
        )
    )
    return
}


const receiveOfflineComplete = async function (
    transaction: Transaction
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addTask(
        `receiveOfflineCompleteTask-${now}`,             
        async () => await receiveOfflineCompleteTask(
            transaction,            
        )
    )
    return
}


const send = async function (
    mintBalanceToSendFrom: MintBalance,
    amountToSend: number,
    unit: MintUnit,
    memo: string,
    selectedProofs: Proof[]
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addPrioritizedTask(
        `sendTask-${now}`,            
        async () => await sendTask(
            mintBalanceToSendFrom,
            amountToSend,
            unit,
            memo,
            selectedProofs       
        )
    )
    return
}


const topup = async function (
    mintBalanceToTopup: MintBalance,
    amountToTopup: number,
    unit: MintUnit,
    memo: string,
    contactToSendTo?: Contact
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addPrioritizedTask(
        `topupTask-${now}`,            
        async () => await topupTask(
            mintBalanceToTopup,
            amountToTopup,
            unit,
            memo,
            contactToSendTo  
        )
    )
    return
}


/*
 * Checks with all mints whether their proofs kept in pending state by the wallet have been spent.
 */
const handleSpentFromPending = async function (): Promise<void> {
    log.trace('[handleSpentFromPending] start')    
    if (mintsStore.mintCount === 0) {
        return
    }

    // group proofs by mint so that we do max one call per mint
    for (const mint of mintsStore.allMints) {

        if(pollerExists(`handleSpentByMintPoller-${mint.mintUrl}`)) {
            log.trace('[handleSpentFromPending] Skipping handleSpentByMintQueue, poller exists', {mintUrl: mint.mintUrl})
            continue
        }        
              
        handleSpentByMint({mintUrl: mint.mintUrl, isPending: true}) // isPending = true
    }
}


/*
 * Recover stuck wallet if tx error caused spent proof to remain in spendable state by the wallet.
 */
const handleSpentFromSpendable = async function (): Promise<void> {
    log.trace('[handleSpentFromSpendable] start')
    if (mintsStore.mintCount === 0) {
        return
    }

    // group proofs by mint so that we do max one call per mint
    // does not depend on unit
    for (const mint of mintsStore.allMints) {        
        handleSpentByMint({mintUrl: mint.mintUrl, isPending: false})
    }

    return    
}

/*
 * Pass _handleSpentByMintTask function into synchronous queue for safe processing without race conditions on proof counters.
 */
const handleSpentByMint = async function (
    options: {
        mintUrl: string,
        isPending: boolean
    }  
): Promise<void> {
    const {mintUrl, isPending} = options
    log.trace('[handleSpentByMint] start', {mintUrl, isPending})
    const now = new Date().getTime()

    return SyncQueue.addTask(
        `_handleSpentByMintTask-${now}`,            
        async () => await _handleSpentByMintTask({mintUrl, isPending})
    )    
}

    

/*
*  Checks with the mint whether proofs have been spent.
 *  Under normal wallet operations, it is used to check pending proofs that were sent to the payee.
 *
 *  However it is used as well as a recovery process to remove spent proofs from the live wallet itself.
 *  This situation occurs as a result of error during SEND or TRANSFER and causes failure of
 *  subsequent transactions because mint returns "Tokens already spent" if any spent proof is used as an input.
 * 
 *  It is a task function that should always be added to SyncQueue and not called directly
 *  
 *  @mintUrl URL of the mint to check for spent and pending proofs
 *  @isPending whether to work on proofs in spendable or pending state by the wallet
 *  @returns WalletTaskResult
 */
const _handleSpentByMintTask = async function (    
    options: {  
        mintUrl: string,           
        isPending: boolean
    }): Promise<WalletTaskResult> {

    let spentCount = 0
    let spentAmount = 0
    let pendingCount = 0
    let pendingAmount = 0
    let movedToSpendableCount = 0
    let movedToSpendableAmount = 0

    const {mintUrl, isPending} = options
    const mint = mintsStore.findByUrl(mintUrl as string)

    try {
    
        // select either spendable or pending proofs by the wallet
        // all units      
        const proofsFromMint = proofsStore.getByMint(mintUrl, {isPending}) as Proof[]

        if (proofsFromMint.length === 0) {
            const message = `No ${isPending ? 'pending' : ''} proofs found for mint, skipping mint call...`            
            log.trace('[_handleSpentByMintTask]', message, mintUrl)

            return {
                taskFunction: '_handleSpentByMintTask',
                mintUrl,
                message,
                proofsCount: 0,
                proofsAmount: 0
            } as WalletTaskResult
        }

        const {
            spent: spentProofs, 
            pending: pendingProofs
        } = await MintClient.getSpentOrPendingProofsFromMint(
            mintUrl,            
            proofsFromMint,
        )
    
        if(mint) { 
            mint.setStatus(MintStatus.ONLINE)                
        } 
        
        // If mint returned some proofs as pending, store their secrets in pendingByMint state
        for (const proof of pendingProofs) {
            proofsStore.addToPendingByMint(proof as Proof)
        }        

        spentCount = spentProofs.length
        spentAmount = CashuUtils.getProofsAmount(spentProofs as Proof[])
        pendingCount = pendingProofs.length
        pendingAmount = CashuUtils.getProofsAmount(pendingProofs as Proof[])
        
        log.trace('[_handleSpentByMintTask]', `${isPending ? 'Pending' : ''} spent and pending by mint amounts`, {spentAmount, pendingAmount, isPending})

        if (spentCount  > 0) {
            // identify txIds to update their statuses, there might be more then one tx to complete
            let relatedTransactionIds: number[] = []

            for (const spent of spentProofs) {
                const tId = proofsFromMint.find(
                    (proof: Proof) => proof.secret === spent.secret,
                )?.tId

                if (tId && !relatedTransactionIds.includes(tId)) {
                    relatedTransactionIds.push(tId)
                }
            }

            // Clean pendingByMint secrets if proofs came back as spent by mint            
            if(proofsStore.pendingByMintSecrets.length > 0) {

                log.trace('[_handleSpentByMintTask]', 'Starting sweep of spent pendingByMint proofs')

                for (const spent of spentProofs) {
                    const secret = proofsStore.pendingByMintSecrets.find((s => s === spent.secret))
                    if(secret) {
                        proofsStore.removeFromPendingByMint(spent as Proof)
                    }
                }
            }

            // Remove spent proofs model instances
            proofsStore.removeProofs(spentProofs as Proof[], isPending)

            // Update related transactions statuses
            log.debug('[_handleSpentByMintTask]', 'Transaction id(s) to complete', relatedTransactionIds.toString())

            // Complete related transactions
            if (relatedTransactionIds) {
                const transactionDataUpdate = {
                    status: TransactionStatus.COMPLETED,
                    createdAt: new Date(),
                }

                await transactionsStore.updateStatuses(
                    relatedTransactionIds,
                    TransactionStatus.COMPLETED,
                    JSON.stringify(transactionDataUpdate),
                )

                EventEmitter.emit('ev_sendCompleted', relatedTransactionIds) // TODO remove and listen to standard queue result event
                stopPolling(`handleSpentByMintPoller-${mintUrl}`)
            }
        }       
        
        // Check if remaining pendingByMint secrets are still pending with the mint. 
        // If not, move related wallet's pending proofs back to spendable as the payment failed 
        // and proofs did not come as spent (those are handled above). 
        const remainingSecrets = getSnapshot(proofsStore.pendingByMintSecrets) 
        
        log.trace('[_handleSpentByMintTask]', 'Remaining pendingByMintSecrets', remainingSecrets)
        
        if(pendingCount > 0 && remainingSecrets.length > 0) {

            log.trace('[_handleSpentByMintTask]', 'Starting sweep of pendingByMintSecrets back to spendable wallet')
            
            const movedProofs: Proof[] = []

            for (const secret of remainingSecrets) {
                const proofToMove = proofsStore.getBySecret(secret, true) // find the proof in wallet's pending
                
                // only move if it is from current mint
                if(proofToMove && proofToMove.mintUrl === mintUrl) {                     
                    const stillPendingByMint = pendingProofs.find((p => p.secret === secret))

                    if(!stillPendingByMint) {
                        // move to spendable if it is not pending by mint anymore
                        proofsStore.removeFromPendingByMint(proofToMove as Proof)                            
                        movedProofs.push(proofToMove)
                    }
                }                                
            }

            movedToSpendableCount = movedProofs.length
            movedToSpendableAmount = CashuUtils.getProofsAmount(movedProofs as Proof[])

            if(movedProofs.length > 0) {                
                log.trace('[_handleSpentByMintTask]', 'Moving proofs from pending to spendable', movedProofs.length)

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
            }            
        }        
        
        return {
            taskFunction: '_handleSpentByMintTask',
            mintUrl,
            message: `Completed check for ${isPending ? 'pending' : ''} proofs spent by mint`,
            spentCount,
            spentAmount,
            pendingByMintCount: pendingCount,
            pendingByMintAmount: pendingAmount,
            movedToSpendableCount,
            movedToSpendableAmount,
        } as WalletTaskResult
    } catch(e: any) {
        // silent
        log.error('[_handleSpentByMintTask]', e.name, {message: e.message, mintUrl})        
    
        if(mint && e.name === Err.MINT_ERROR) { 
            mint.setStatus(MintStatus.OFFLINE)                
        }        

        return {
            taskFunction: '_handleSpentByMintTask',
            mintUrl,
            message: `Check for ${isPending ? 'pending' : ''} ended with error: ${e.message}`,
            error: e,
            spentCount,
            spentAmount,
            pendingByMintCount: pendingCount,
            pendingByMintAmount: pendingAmount,
            movedToSpendableCount,
            movedToSpendableAmount,
        } as WalletTaskResult
    }
}


const handleInFlight = async function (): Promise<void> {
    log.trace('[handleInFlight] start')
    if (mintsStore.mintCount === 0) {
        return
    }

    const seed = await MintClient.getSeed()

    if(!seed) {return}

    for (const mint of mintsStore.allMints) {
        const now = new Date().getTime()

        SyncQueue.addTask( 
            `_handleInFlightByMintTask-${now}`,               
            async () => await _handleInFlightByMintTask(mint, seed)               
        )               
    }

    return
}

/*
 * Recover proofs that were issued by mint, but wallet failed to receive them if split did not complete.
 */
const _handleInFlightByMintTask = async function (mint: Mint, seed: Uint8Array): Promise<WalletTaskResult> {

    const mintUrl = mint.mintUrl
    const proofsCounter = mint.findInFlightProofsCounter?.()

    if(!proofsCounter) {
        const message = 'No inFlight proofs to restore, skipping mint call...'
        log.trace('[_handleInFlightByMintTask]', message, {mintUrl})
        return {
            taskFunction: '_handleInFlightByMintTask',
            mintUrl,
            message,
            proofsCount: 0,
            proofsAmount: 0,
        } as WalletTaskResult
    }

    try {
        log.info('[_handleInFlightByMintTask]', `Restoring from ${mint.hostname}...`)
        log.debug('[_handleInFlightByMintTask]', proofsCounter)        
                
        const { proofs } = await MintClient.restore(
            mint.mintUrl,
            seed as Uint8Array,
            {
                indexFrom: proofsCounter.inFlightFrom as number, 
                indexTo: proofsCounter.inFlightTo as number,
                keysetId: proofsCounter.keyset
            }
        )        

        if (proofs.length === 0) {
            mint.resetInFlight?.(proofsCounter.inFlightTid as number)
            
            return {
                taskFunction: '_handleInFlightByMintTask',
                mintUrl,
                message: 'No proofs were recovered.',
                proofsCount: 0,
                proofsAmount: 0,
            }  as WalletTaskResult          
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

        log.debug('[_handleInFlightByMintTask]', `Restored proofs`, {
            spentCount, 
            spentAmount, 
            pendingCount, 
            pendingAmount,
            unspentCount,
            unspentAmount
        })

        if(unspent.length === 0) {
            const message = 'Recovered proofs are already spent.'
            log.debug('[_handleInFlightByMintTask]',message)

            mint.resetInFlight?.(proofsCounter.inFlightTid as number)
            return {
                taskFunction: '_handleInFlightByMintTask',
                mintUrl,
                message,
                proofsCount: 0,
                proofsAmount: 0,
            } as WalletTaskResult
        }


         
        const { addedAmount, addedProofs } = WalletUtils.addCashuProofs(
            mint.mintUrl,
            unspent,
            {
                unit: proofsCounter.unit,
                transactionId: proofsCounter.inFlightTid as number,
                isPending: false
            }
                           
        )

        // release the lock
        mint.resetInFlight?.(proofsCounter.inFlightTid as number)

        const walletTaskResult: WalletTaskResult  = {
            taskFunction: '_handleInFlightByMintTask',
            mintUrl,
            message: 'In flight proofs were recovered.',
            proofsCount: addedProofs.length,
            proofsAmount: addedAmount,            
            inFlightFrom: proofsCounter.inFlightFrom,
            inFlightTo: proofsCounter.inFlightTo,
        }
        
        const transactionDataUpdate = {
            status: TransactionStatus.COMPLETED,
            walletTaskResult,
            message: 'This transaction failed to receive expected funds from the mint, but the wallet suceeded to recover them.',
            createdAt: new Date(),
        }

        transactionsStore.updateStatuses(
            [proofsCounter.inFlightTid as number],
            TransactionStatus.COMPLETED, // has been most likely DRAFT
            JSON.stringify(transactionDataUpdate),
        )

        log.debug('[_handleInFlightByMintTask]', `Completed`, {walletTaskResult})

        return walletTaskResult

    } catch (e: any) {
        // silent
        log.error('[_handleInFlightByMintTask]', e.name, {message: e.message, mintUrl})
        // make sure we release the lock
        mint.resetInFlight?.(proofsCounter.inFlightTid as number)

        return {
            taskFunction: '_handleInFlightByMintTask',
            mintUrl,
            message: `Error when handling inflight proof: ${e.message}`,
            proofsCount: 0,
            proofsAmount: 0,            
        } as WalletTaskResult
    }
}



const handlePendingTopups = async function (): Promise<void> {    
    const paymentRequests: PaymentRequest[] = paymentRequestsStore.allOutgoing

    log.trace('[handlePendingTopups] start', {paymentRequests})

    if (paymentRequests.length === 0) {
        log.trace('[handlePendingTopups]', 'No outgoing payment requests in store - skipping task send to the queue...')
        return
    }

    for (const pr of paymentRequests) {
        // skip pr if active poller exists
        if(pollerExists(`handlePendingTopupTaskPoller-${pr.paymentHash}`)) {
            log.trace('[handlePendingTopups] Skipping check of paymentRequest, poller exists', {paymentHash: pr.paymentHash})
            continue
        }

        const now = new Date().getTime()
        
        SyncQueue.addTask(
            `_handlePendingTopupTask-${now}`,               
            async () => await _handlePendingTopupTask({paymentRequest: pr})               
        )
    }
}



const handlePendingTopup = async function (params: {paymentRequest: PaymentRequest}): Promise<void> {
    const {paymentRequest} = params
    log.trace('[handlePendingTopup] start', {paymentHash: paymentRequest.paymentHash})
    
    const now = new Date().getTime()
    
    SyncQueue.addTask(    
        `_handlePendingTopupTask-${now}`,               
        async () => await _handlePendingTopupTask({paymentRequest})               
    )
}



const _handlePendingTopupTask = async function (params: {paymentRequest: PaymentRequest}): Promise<WalletTaskResult> {
    const {paymentRequest: pr} = params
    const transactionId = {...pr}.transactionId || 0// copy
    const mint = {...pr}.mint // copy
    const unit = {...pr}.mintUnit // copy, unit of proofs to be received
    const amount = {...pr}.amountToTopup // copy, amount of proofs to be received    
    const paymentHash = {...pr}.paymentHash // copy
    const mintQuote = {...pr}.mintQuote // copy
    const mintInstance = mintsStore.findByUrl(mint as string)

    try {
        if(!mintInstance || !mintQuote || !unit || !amount) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing mint or mint quote or mintUnit or amountToTopup', {mintUrl: mint})
        }
        
        const amountPreferences = getDefaultAmountPreference(amount)        
        const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences)
        
        log.trace('[_handlePendingTopupTask]', 'paymentRequest', paymentHash)
        log.trace('[_handlePendingTopupTask]', 'amountPreferences', amountPreferences)
        log.trace('[_handlePendingTopupTask]', 'countOfInFlightProofs', countOfInFlightProofs)
        
        // check is quote has been paid
        const { isPaid, mintQuote: quote } = await MintClient.getBolt11MintQuoteIsPaid(mint!, mintQuote)

        if (quote !== mintQuote) {
            throw new AppError(Err.VALIDATION_ERROR, 'Returned quote is different then the one requested', {mintUrl: mint, quote, mintQuote})
        }

        if (isPaid !== true) {
            log.trace('[_handlePendingTopupTask] Quot not paid', {mintUrl: mint, mintQuote})
            return {
                taskFunction: '_handlePendingTopupTask',
                mintUrl: mint,
                unit,
                amount,
                paymentHash,                
                message: `Quote ${mintQuote} not paid`,
            } as WalletTaskResult
        }
        
        // temp increase the counter + acquire lock and set inFlight values        
        await WalletUtils.lockAndSetInFlight(
            mintInstance, 
            unit, 
            countOfInFlightProofs, 
            transactionId,
        )   

        // get locked counter values        
        const lockedProofsCounter = await mintInstance.getProofsCounterByUnit(unit)

        let proofs: CashuProof[] = []

        try {
            proofs = (await MintClient.mintProofs(
                mint as string,
                unit,
                amount,
                mintQuote as string,
                amountPreferences,
                lockedProofsCounter.inFlightFrom as number
            )) as CashuProof[]

            // log.info('[_handlePendingTopupTask]', {proofs})

        } catch (e: any) {            
            // decrease so that unpaid invoices does not cause counter gaps from polling
            mintInstance.decreaseProofsCounter(lockedProofsCounter.keyset, countOfInFlightProofs)           

            // remove already expired invoices 
            if (isBefore(pr.expiresAt as Date, new Date())) {
                log.debug('[_handlePendingTopupTask]', `Invoice expired, removing: ${pr.paymentHash}`)

                // expire related tx - but only if it has not been completed before this check
                const transaction = transactionsStore.findById(transactionId as number)

                if(transaction && transaction.status !== TransactionStatus.COMPLETED) {
                    const transactionDataUpdate = {
                        status: TransactionStatus.EXPIRED,
                        message: 'Mint returned error and invoice expired',
                        error: {name: e.name, message: e.message, params: e.params},
                        createdAt: new Date(),
                    }                        

                    await transactionsStore.updateStatuses(
                        [transactionId as number],
                        TransactionStatus.EXPIRED,
                        JSON.stringify(transactionDataUpdate),
                    ) 
                }

                stopPolling(`handlePendingTopupPoller-${paymentHash}`)         
                paymentRequestsStore.removePaymentRequest(pr)
            }

            // throw but keep polling
            throw e        
        }

        mintInstance.decreaseProofsCounter(lockedProofsCounter.keyset, countOfInFlightProofs)
        
        // This runs if invoice has not yet been paid, w/o other error
        if (!proofs || proofs.length === 0) {
            log.trace('[_handlePendingTopupTask]', 'Invoice has not yet been paid')
            
            const transaction = transactionsStore.findById(transactionId as number)   
            let isExpired: boolean = false         

            // remove already expired invoices only after check that they have not been paid                
            if (isBefore(pr.expiresAt as Date, new Date())) {
                log.debug('[_handlePendingTopupTask]', `Invoice expired, removing: ${paymentHash}`)

                if(transaction && transaction.status !== TransactionStatus.COMPLETED) {
                    const transactionDataUpdate = {
                        status: TransactionStatus.EXPIRED,
                        message: 'Invoice expired before being paid.',
                        createdAt: new Date(),
                    }                        

                    await transactionsStore.updateStatuses(
                        [transactionId as number],
                        TransactionStatus.EXPIRED,
                        JSON.stringify(transactionDataUpdate),
                    ) 
                }

                stopPolling(`handlePendingTopupTaskPoller-${paymentHash}`)
                paymentRequestsStore.removePaymentRequest(pr)
                isExpired = true                
            }
            // release lock and move on (keep polling)
            mintInstance.resetInFlight(transactionId as number )
                      
            return {
                taskFunction: '_handlePendingTopupTask',
                mintUrl: mint,
                unit,
                amount,
                paymentHash,
                transaction,
                message: isExpired ? 'Lightning invoice expired unpaid.' : 'Lightning invoice has not yet been paid.',
            } as TransactionTaskResult
        }        

        // we got proofs, accept to the wallet asap
        const {addedAmount: receivedAmount} = WalletUtils.addCashuProofs(
            mint as string,
            proofs,
            {
                unit,
                transactionId,
                isPending: false               
            }
        )    
        
        // release lock and cleanup
        mintInstance.resetInFlight(transactionId as number )
        stopPolling(`handlePendingTopupTaskPoller-${paymentHash}`)               

        const currencyCode = getCurrency(pr.mintUnit!).code  

        if (receivedAmount !== amount) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                `Received amount ${formatCurrency(amount, currencyCode)} ${currencyCode} is not equal to the requested amount ${formatCurrency(amount, currencyCode)} ${currencyCode}.`,
            )
        }

        // update related tx
        const transactionDataUpdate = {
            status: TransactionStatus.COMPLETED,
            createdAt: new Date(),
        }

        // await for final status
        await transactionsStore.updateStatuses(
            [transactionId as number],
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionDataUpdate),
        )

        transactionsStore.updateSentFrom(
            transactionId as number,
            pr.contactTo?.nip05 as string // payemnt has been sent from payment request receiver
        )

        // Fire event that the TopupScreen can listen to // TODO replace by standard task result event
        // EventEmitter.emit('ev_topupCompleted', {...pr})
        
        // Update tx with current total balance of topup unit/currency
        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!

        await transactionsStore.updateBalanceAfter(
            transactionId as number,
            balanceAfter,
        )     
    
        _sendTopupNotification(pr)
        paymentRequestsStore.removePaymentRequest(pr)        
        
        return {
            taskFunction: '_handlePendingTopupTask',
            mintUrl: mint,
            unit,
            amount,
            paymentHash,
            transaction: transactionsStore.findById(transactionId as number),
            message: `Your invoice has been paid and your wallet balance credited with ${formatCurrency(amount, currencyCode)} ${currencyCode}.`,
        } as TransactionTaskResult

    } catch (e: any) {
        // release lock  
        if(mintInstance) {
            mintInstance.resetInFlight(transactionId as number)
        }
        return {
            taskFunction: '_handlePendingTopupTask',
            mintUrl: mint,
            unit,
            amount,
            paymentHash,
            transaction: transactionsStore.findById(transactionId as number),
            error: {name: e.name, message: e.message},
            message: `_handlePendingTopupTask ended with error: ${e.message}`,                        
        } as TransactionTaskResult
    }

}



const _sendTopupNotification = async function (pr: PaymentRequest) {
    
    const currencyCode = getCurrency(pr.mintUnit!).code

    await NotificationService.createLocalNotification(
        `⚡ ${formatCurrency(pr.amountToTopup!, currencyCode)} ${currencyCode} received!`,
        `Your invoice has been paid and your wallet balance credited with ${formatCurrency(pr.amountToTopup!, currencyCode)} ${currencyCode}.`,           
    ) 
}

/*
 * Checks with NOSTR relays whether there is ecash to be received or an invoice to be paid.
 */
const receiveEventsFromRelays = async function (): Promise<void> {
    log.trace('[receiveEventsFromRelays] start')

    if(!walletProfileStore.pubkey) { // New profile not yet created in ContactsScreen
        const message = `No wallet profile created.`            
        log.trace('[receiveEventsFromRelays]', message)
        return     
    }    
    
    try {            
        const { lastPendingReceivedCheck } = contactsStore

        const filter = [{            
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
            // ignore all kinds of duplicate events
            if(eventsBatch.some(ev => ev.id === event.id)) {
                log.warn(
                    Err.ALREADY_EXISTS_ERROR, 
                    'Duplicate event received by this subscription, skipping...', 
                    {id: event.id, created_at: event.created_at}
                )
                return
            }                

            if(contactsStore.eventAlreadyReceived(event.id)) {
                log.warn(
                    Err.ALREADY_EXISTS_ERROR, 
                    'Event has been processed in the past, skipping...', 
                    {id: event.id, created_at: event.created_at}
                )
                return
            }

            // eventsQueue.push(event)
            eventsBatch.push(event)
            contactsStore.addReceivedEventId(event.id)
            // move window to receive events to the last event created_at to avoid recive it again
            contactsStore.setLastPendingReceivedCheck(event.created_at)

            const now = new Date().getTime()
            SyncQueue.addTask(       
                `_handleReceivedEventTask-${now}`,          
                async () => await _handleReceivedEventTask(event)                
            )
        })        

        sub.on('eose', async () => {
            log.trace('[receiveEventsFromRelays]', `Eose: Got ${eventsBatch.length} receive events`)
        })        
    } catch (e: any) {
        log.error(e.name, e.message)
        return
    }
}



const _handleReceivedEventTask = async function (event: NostrEvent): Promise<WalletTaskResult> {
    // decrypt message content
    const decrypted = await NostrClient.decryptNip04(event.pubkey, event.content)

    log.trace('[_handleReceivedEventTask]', 'Received event', {id: event.id, created_at: event.created_at})
    
    // get sender profile and save it as a contact
    // this is not valid for events sent from LNURL bridge, that are sent and signed by a minibits server key
    // and *** do not contain sentFrom ***
    let sentFromPubkey = event.pubkey
    let sentFrom = NostrClient.getFirstTagValue(event.tags, 'from')
    let sentFromNpub = NostrClient.getNpubkey(sentFromPubkey)
    let contactFrom: Contact | undefined = undefined 
    let sentFromPicture: string | undefined = undefined          

    // add sender to contacts
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

    log.trace('[_handleReceivedEventTask]', 'Incoming data', {incoming})

    //
    // Receive token start
    //
    if(incoming.type === IncomingDataType.CASHU) {

        const decoded: Token = CashuUtils.decodeToken(incoming.encoded)
        const amountToReceive = CashuUtils.getTokenAmounts(decoded).totalAmount        
        const memo = decoded.memo || 'Received over Nostr'

        const {transaction, receivedAmount} = await receiveTask(
            decoded as Token,
            amountToReceive,
            memo,
            incoming.encoded as string,
        )

        // If the decrypted DM contains zap request, payment is a zap coming from LNURL server. 
        // We retrieve the sender, we do not save zap sender to contacts, just into tx details

        // We do it defensively only after cash is received
        // and asynchronously so we speed up queue, as for zaps relay comm takes long
        _sendReceiveNotification(event, decrypted, transaction as Transaction, receivedAmount) // TODO move to task result handler

        return {
            mintUrl: decoded.token[0].mint,
            taskFunction: '_handleReceivedEventTask',
            message: 'Incoming ecash token has been received.',
            proofsCount: decoded.token[0].proofs.length,
            proofsAmount: receivedAmount,
            notificationInputs: {
                event,
                decrypted,
                transaction,
                receivedAmount
            }
        } as WalletTaskResult                  
    }

    //
    // Receive bolt11 invoice start
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
        
        const maybeMemo = NostrClient.findMemo(decrypted)
        
        const paymentRequest = paymentRequestsStore.addPaymentRequest({
            type: PaymentRequestType.INCOMING,
            status: PaymentRequestStatus.ACTIVE,                            
            encodedInvoice: incoming.encoded,
            invoicedUnit: 'sat', // bolt11
            invoicedAmount: amount || 0,            
            description: maybeMemo ? maybeMemo : description,                            
            paymentHash,
            contactFrom: contactFrom || {pubkey: sentFromPubkey, npub: sentFromNpub},
            contactTo,                        
            expiry,
            createdAt: timestamp ? new Date(timestamp * 1000) : new Date()
        })        

        _sendPaymentRequestNotification(paymentRequest)
        
        return {
            mintUrl: '',
            taskFunction: '_processReceiveEvent',
            message: 'Incoming payment request been received.',
            proofsCount: 0,
            proofsAmount: amount,
            paymentRequest            
        } 
    }
        
    if (incoming.type === IncomingDataType.LNURL) {
        throw new AppError(Err.NOTFOUND_ERROR, 'LNURL support is not yet implemented.', {caller: '_handleReceivedEventTask'})
    }                      
        
    throw new AppError(Err.NOTFOUND_ERROR, 'Received unknown message', incoming)
}



const _sendReceiveNotification = async function (
    event: NostrEvent, 
    decrypted: string, 
    transaction: Transaction,
    receivedAmount: number
): Promise<void> {
    let sentFromPubkey = event.pubkey
    let sentFrom = NostrClient.getFirstTagValue(event.tags, 'from')
    let sentFromPicture: string | undefined = undefined

    if(transaction) {
        await transactionsStore.updateSentFrom(
            transaction.id as number,
            sentFrom as string
        ) 
    }

    // Do not spent time to connect to relays if user has not allowed notifications
    const enabled = await NotificationService.areNotificationsEnabled()
    if(!enabled) {
        return
    }

    const maybeZapSenderString = _extractZapSenderData(decrypted)

    if(maybeZapSenderString) {
        try {
            const zapSenderProfile: NostrProfile = JSON.parse(maybeZapSenderString)
            
            if(zapSenderProfile) {
                sentFromPubkey = zapSenderProfile.pubkey // zap sender pubkey                
                sentFrom = zapSenderProfile.nip05 || zapSenderProfile.name                
                sentFromPicture = zapSenderProfile.picture
                const sentFromLud16 = zapSenderProfile.lud16
                        
                // if we have such contact, set or update its lightning address by the one from profile
                const contactInstance = contactsStore.findByPubkey(sentFromPubkey)
                if(contactInstance && sentFromLud16) {                                        
                    contactInstance.setLud16(sentFromLud16)
                }                    
                
            }            
        } catch (e: any) {
            log.warn('[_handleReceivedEventTask]', 'Could not get sender from zapRequest', {message: e.message, maybeZapSenderString})
        }
    }

    //
    // Send notification event
    //
    const currencyCode = getCurrency(transaction.unit).code
    if(receivedAmount && receivedAmount > 0) {
        await NotificationService.createLocalNotification(
            `<b>⚡${formatCurrency(receivedAmount, currencyCode)} ${currencyCode}</b> received!`,
            `${maybeZapSenderString ? 'Zap' : 'Ecash'} from <b>${sentFrom || 'unknown payer'}</b> is now in your wallet.`,
            sentFromPicture       
        ) 
    }

    return
}


const _sendPaymentRequestNotification = async function (pr: PaymentRequest) {    
    await NotificationService.createLocalNotification(
        `⚡ Please pay <b>${formatCurrency(pr.invoicedAmount, getCurrency(pr.invoicedUnit!).code)} ${getCurrency(pr.invoicedUnit!).code}</b>!`,
        `${pr.contactFrom.nip05 || 'Unknown'} has sent you a request to pay an invoice.`,
        pr.contactFrom.picture,
    )
}

const _extractZapSenderData = function (str: string) {
    const match = str.match(/\{[^}]*\}/);
    return match ? match[0] : null;
}




export const WalletTask: WalletTaskService = {
    handleSpentFromPending,
    handleSpentFromSpendable,
    handleSpentByMint,
    handleInFlight,    
    handlePendingTopups,
    handlePendingTopup,
    receiveEventsFromRelays,
    receive,
    receiveOfflinePrepare,
    receiveOfflineComplete,        
    send,
    transfer,    
    topup,
}
