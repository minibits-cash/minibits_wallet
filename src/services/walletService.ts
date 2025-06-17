import {isBefore} from 'date-fns'
import {getSnapshot} from 'mobx-state-tree'
import notifee, { AndroidImportance } from '@notifee/react-native'
import { GiftWrap, EncryptedDirectMessage } from 'nostr-tools/kinds'
import {log} from './logService'
import {Proof} from '../models/Proof'
import {
  Transaction,
  TransactionData,
  TransactionStatus,
  TransactionType
} from '../models/Transaction'
import {rootStoreInstance} from '../models'
import {CashuProof, CashuUtils} from './cashu/cashuUtils'
import {LightningUtils} from './lightning/lightningUtils'
import AppError, {Err} from '../utils/AppError'
import {MintBalance, MintStatus} from '../models/Mint'
import {MeltQuoteResponse, MeltQuoteState, MintQuoteState, PaymentRequestPayload, Token, getDecodedToken, getEncodedToken} from '@cashu/cashu-ts'
import {Mint} from '../models/Mint'
import {pollerExists, stopPolling} from '../utils/poller'
import { NostrClient, NostrEvent, NostrProfile } from './nostrService'
import { MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST, MINIBIT_SERVER_NOSTR_PUBKEY } from '@env'
import { PaymentRequest, PaymentRequestStatus, PaymentRequestType } from '../models/PaymentRequest'
import { IncomingDataType, IncomingParser } from './incomingParser'
import { Contact } from '../models/Contact'
import { SyncQueue } from './syncQueueService'
import { 
    receiveTask, 
    receiveOfflinePrepareTask, 
    receiveOfflineCompleteTask, 
    receiveByCashuPaymentRequestTask
} from './wallet/receiveTask'
import { sendTask } from './wallet/sendTask'
import { topupTask } from './wallet/topupTask'
import { transferTask } from './wallet/transferTask'
import { revertTask } from './wallet/revertTask'
import { WalletUtils } from './wallet/utils'
import { NotificationService } from './notificationService'
import { CurrencyCode, MintUnit, formatCurrency, getCurrency } from './wallet/currency'
import { MinibitsClient } from './minibitsService'
import { UnsignedEvent } from 'nostr-tools'
import { Platform } from 'react-native'
import { cashuPaymentRequestTask } from './wallet/cashuPaymentRequestTask'
import { sumBlindSignatures } from '@cashu/cashu-ts/src/utils'

/**
 * The default number of proofs per denomination to keep in a wallet.
 */
export const DEFAULT_DENOMINATION_TARGET = 2

export const MAX_SWAP_INPUT_SIZE = 100
export const MAX_SYNC_INPUT_SIZE = 200 // 1000 hard mint limit

export const TEST_TASK = 'testTask'
export const SWAP_ALL_TASK = 'swapAllTask'
export const SYNC_STATE_WITH_ALL_MINTS_TASK = 'syncStateWithAllMintsTask'
export const SYNC_STATE_WITH_MINT_TASK = 'syncStateWithMintTask'
export const HANDLE_NWC_REQUEST_TASK = 'handleNwcRequestTask'
export const HANDLE_CLAIM_TASK = 'handleClaimTask'
export const HANDLE_PENDING_TOPUP_TASK = 'handlePendingTopupTask'
export const HANDLE_INFLIGHT_BY_MINT_TASK = 'handleInFlightByMintTask'
export const HANDLE_RECEIVED_EVENT_TASK = 'handleReceivedEventTask'

type WalletTaskService = {
    syncStateWithAllMintsQueue: (
        options: {
            isPending: boolean
        }
    ) => Promise<void>
    syncStateWithMintQueue: (
        options: {
            proofsToSync: Proof[],
            mintUrl: string, 
            isPending: boolean
        }
    ) => Promise<void>
    syncStateWithMintTask: (        
        options: {
            proofsToSync: Proof[],
            mintUrl: string, 
            isPending: boolean
        }        
    ) => Promise<SyncStateTaskResult | void>
    handleInFlightQueue: ()        => Promise<void>    
    handlePendingTopupsQueue: ()   => Promise<void>
    handlePendingTopupQueue: (params: {
        paymentRequest: PaymentRequest
    })   => Promise<void>
    handleClaimQueue: ()   => Promise<void>
    handleNwcRequestQueue: (params: {
        requestEvent: NostrEvent
    })   => Promise<void>
    receiveEventsFromRelaysQueue: () => Promise<void>
    transferQueue: (
        mintBalanceToTransferFrom: MintBalance,
        amountToTransfer: number,
        unit: MintUnit,
        meltQuote: MeltQuoteResponse,                
        memo: string,
        invoiceExpiry: Date,
        encodedInvoice: string,
        nwcEvent?: NostrEvent
    ) => Promise<void>
    receiveQueue: (
        token: Token,
        amountToReceive: number,
        memo: string,
        encodedToken: string,
    ) => Promise<void>
    receiveOfflinePrepareQueue: (
        token: Token,
        amountToReceive: number,
        memo: string,
        encodedToken: string,
    ) => Promise<void>
    receiveOfflineCompleteQueue: (        
        transactionId: number
    ) => Promise<void>
    sendQueue: (
        mintBalanceToSendFrom: MintBalance,
        amountToSend: number,
        unit: MintUnit,
        memo: string,
        selectedProofs: Proof[],
        p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> }
    ) => Promise<void>
    swapAllQueue: () => Promise<void>
    topupQueue: (
        mintBalanceToTopup: MintBalance,
        amountToTopup: number,
        unit: MintUnit,
        memo: string,
        contactToSendTo?: Contact,
        nwcEvent?: NostrEvent
    ) => Promise<void>
    cashuPaymentRequestQueue: (
        mintBalanceToReceiveTo: MintBalance,
        amountToRequest: number,
        unit: MintUnit,
        memo: string,
    ) => Promise<void>
    revertQueue: (
        transaction: Transaction
    ) => Promise<void>
    testQueue: () => Promise<void>
    recoverMintQuote: (params: {
        mintUrl: string, 
        mintQuote: string
    }) => Promise<{recoveredAmount: number}>
    recoverMeltQuoteChange: (params: {
        mintUrl: string, 
        meltQuote: string
    }) => Promise<{recoveredAmount: number}>
}

export interface WalletTaskResult {
    taskFunction: string
    message: string
    mintUrl?: string    
    error?: AppError
    [key: string]: any
}

export interface TransactionTaskResult extends WalletTaskResult {
    mintUrl: string,
    transaction?: Transaction
    swapFeePaid?: number
    lightningFeePaid?: number
    meltFeePaid?: number
    meltQuote?: MeltQuoteResponse
    nwcEvent?: NostrEvent
}


export interface TransactionStateUpdate {    
    tId: number
    amount?: number
    spentByMintAmount?: number
    pendingByMintAmount?: number
    movedToSpendableAmount?: number,
    meltQuoteToRecover?: string,
    recoveredChangeAmount?: number,
    message?: string 
    updatedStatus: TransactionStatus,      
}

export interface SyncStateTaskResult extends WalletTaskResult {
    transactionStateUpdates: TransactionStateUpdate[],
    completedTransactionIds: number[],
    errorTransactionIds: number[],
    revertedTransactionIds: number[]
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
    userSettingsStore,
    walletProfileStore,
    mintsStore,
    proofsStore,
    transactionsStore,    
    paymentRequestsStore,
    contactsStore,
    relaysStore,    
    walletStore,
    nwcStore,
} = rootStoreInstance


const transferQueue = async function (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    unit: MintUnit,
    meltQuote: MeltQuoteResponse,
    memo: string,
    invoiceExpiry: Date,    
    encodedInvoice: string,
    nwcEvent?: NostrEvent
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
            nwcEvent
        )
    )
    return
}


const receiveQueue = async function (
    token: Token,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
): Promise<void> {
    const now = new Date().getTime()
    const proofsCount = token.proofs.length

    if(proofsCount > MAX_SWAP_INPUT_SIZE) {

        SyncQueue.addPrioritizedTask(
            `receiveBatchTask-${now}`,           
            async () => await receiveBatchTask(
                token,
                amountToReceive,
                memo,
                encodedToken,
            )
        )

    } else {

        SyncQueue.addPrioritizedTask(
            `receiveTask-${now}`,           
            async () => await receiveTask(
                token,
                amountToReceive,
                memo,
                encodedToken,
            )
        )
    }

    return
}

/* 
 * Receive big tokens in batches to keep mint load reasonable. 
 * 
 */
const receiveBatchTask = async function  (
    token: Token,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
) : Promise<WalletTaskResult> {

    const maxBatchSize = MAX_SWAP_INPUT_SIZE
    const mintUrl = token.mint
    const proofsToReceive = token.proofs
    const unit = token.unit

    let receivedProofsCount = 0
        
    if (proofsToReceive.length > maxBatchSize) {

        let index =0
        for (let i = 0; i < proofsToReceive.length; i += maxBatchSize) {

            index++
            const batch = proofsToReceive.slice(i, i + maxBatchSize)
            const batchAmount = CashuUtils.getProofsAmount(batch)

            const batchToken: Token = {
                mint: mintUrl,
                proofs: batch,
                memo: `${memo} #${index}`,
                unit
            }

            const batchEncodedToken = getEncodedToken(batchToken)
            
            const result = await receiveTask(
                batchToken,
                batchAmount,
                `${memo} #${index}`,
                batchEncodedToken,
            )
            
            if(result.receivedProofsCount) {
                receivedProofsCount += result.receivedProofsCount
            }            
        }

    } else {
        // If the length is less than or equal to 100, do normal receive
        const result = await receiveTask(
            token,
            amountToReceive,
            memo,
            encodedToken,
        )

        if(result.receivedProofsCount) {
            receivedProofsCount += result.receivedProofsCount
        } 
    }

    return {
        taskFunction: 'receiveBatchTask',
        mintUrl,
        message: 'receiveBatchTask completed. ',
        receivedProofsCount
    }
}
    



const receiveOfflinePrepareQueue = async function (
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


const receiveOfflineCompleteQueue = async function (
    transactionId: number
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addTask(
        `receiveOfflineCompleteTask-${now}`,             
        async () => await receiveOfflineCompleteTask(
            transactionId            
        )
    )
    return
}


const sendQueue = async function (
    mintBalanceToSendFrom: MintBalance,
    amountToSend: number,
    unit: MintUnit,
    memo: string,
    selectedProofs: Proof[],
    p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> }
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addPrioritizedTask(
        `sendTask-${now}`,            
        async () => await sendTask(
            mintBalanceToSendFrom,
            amountToSend,
            unit,
            memo,
            selectedProofs,
            p2pk     
        )
    )
    return
}


/*
 * swapAllTask sends all proofs to pending and swaps them with the mint for standard amount preference 
 * This decreases the total number of proofs held by the wallet. Used to optimize exported backup size.
 * Heavy, needs to run using the foreground service. May freeze the wallet.
 */

const swapAllQueue = async function (): Promise<void> {
    const now = new Date().getTime()
    return SyncQueue.addPrioritizedTask(
        `swapAllTask-${now}`,            
        async () => await swapAllTask()
    )    
}

const swapAllTask = async function (): Promise<WalletTaskResult> {
    log.trace('[swapAllTask] start')
    
    if (mintsStore.mintCount === 0) {
        return {    
            taskFunction: SWAP_ALL_TASK,            
            message: 'No mints to swap with.'            
        }
    }

    let initialProofsCount = 0
    let finalProofsCount = 0
    const errors: string[] = []
    // Do not create a pending transaction above mint's spent sync (check) limit as it becomes stuck pending
    // As well keep tokens reasonably sized so that a device can keep related transaction in the state / load it from DB
    const maxBatchSize = MAX_SWAP_INPUT_SIZE
    
    for (const mint of mintsStore.allMints) {     

        for (const unit of mint.units) {
            const proofsToOptimize = proofsStore.getByMint(mint.mintUrl, { isPending: false, unit, ascending: true })

            if(proofsToOptimize.length === 0) {
                continue
            }

            initialProofsCount += proofsToOptimize.length            
            const mintBalance = mint.balances

            if (proofsToOptimize.length > maxBatchSize) {
                let index = 0
                for (let i = 0; i < proofsToOptimize.length; i += maxBatchSize) {
                    index++
                    const batch = proofsToOptimize.slice(i, i + maxBatchSize)
                    const batchAmount = CashuUtils.getProofsAmount(batch)

                    const sendResult = await sendTask(
                        mintBalance!,
                        batchAmount,
                        unit,
                        `Optimize ecash #${index}`,
                        batch // forces offline mode
                    )

                    const encodedTokenToReceive: string = sendResult.encodedTokenToSend
                    const tokenToReceive = getDecodedToken(encodedTokenToReceive)              
                    const tokenAmount = CashuUtils.getProofsAmount(tokenToReceive.proofs)

                    const receiveResult = await receiveBatchTask(
                        tokenToReceive,
                        tokenAmount,
                        tokenToReceive.memo as string,
                        encodedTokenToReceive
                    )

                    if(receiveResult.receivedProofsCount && receiveResult.receivedProofsCount > 0) {
                        finalProofsCount += receiveResult.receivedProofsCount
                    }

                    if(receiveResult.error) {
                        errors.push(receiveResult.error.message)
                    }
                }
            } else {
                // If the length is less than or equal to limit, run with all proofs.
                const proofsAmount = CashuUtils.getProofsAmount(proofsToOptimize)
                
                const sendResult = await sendTask(
                    mintBalance!,
                    proofsAmount,
                    unit,
                    `Optimize ecash`,
                    proofsToOptimize // forces offline mode
                )

                const encodedTokenToReceive: string = sendResult.encodedTokenToSend
                const tokenToReceive = getDecodedToken(encodedTokenToReceive)              
                const tokenAmount = CashuUtils.getProofsAmount(tokenToReceive.proofs)

                const receiveResult = await receiveBatchTask(
                    tokenToReceive,
                    tokenAmount,
                    tokenToReceive.memo as string,
                    encodedTokenToReceive
                )

                if(receiveResult.receivedProofsCount && receiveResult.receivedProofsCount > 0) {
                    finalProofsCount += receiveResult.receivedProofsCount
                }

                if(receiveResult.error) {
                    errors.push(receiveResult.error.message)
                }
            }
           
        }
    }

    return {    
        taskFunction: SWAP_ALL_TASK,           
        message: `Proofs optimization completed with ${errors.length} errors. Proofs number went from ${initialProofsCount} to ${finalProofsCount}`,
        initialProofsCount,
        finalProofsCount,
        errors,            
    }
}

    


const topupQueue = async function (
    mintBalanceToTopup: MintBalance,
    amountToTopup: number,
    unit: MintUnit,
    memo: string,
    contactToSendTo?: Contact,
    nwcEvent?: NostrEvent
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addPrioritizedTask(
        `topupTask-${now}`,            
        async () => await topupTask(
            mintBalanceToTopup,
            amountToTopup,
            unit,
            memo,
            contactToSendTo,
            nwcEvent
        )
    )
    return
}


const cashuPaymentRequestQueue = async function (
    mintBalanceToReceiveTo: MintBalance,
    amountToRequest: number,
    unit: MintUnit,
    memo: string,
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addPrioritizedTask(
        `cashuPaymentRequestTask-${now}`,            
        async () => await cashuPaymentRequestTask(
            mintBalanceToReceiveTo,
            amountToRequest,
            unit,
            memo,
        )
    )
    return
}



const revertQueue = async function (
    transaction: Transaction
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addPrioritizedTask(
        `revertTask-${now}`,            
        async () => await revertTask(transaction)
    )
    return
}



const syncStateWithAllMintsQueue = async function (options: {
    isPending: boolean
}): Promise<void> {
    const { isPending } = options
    const now = new Date().getTime()
    return SyncQueue.addPrioritizedTask(
        `syncSpendableStateTask-${now}`,            
        async () => await syncStateWithAllMintsTask({ isPending })
    )    
}



const syncStateWithAllMintsTask = async function (options: {
    isPending: boolean
}): Promise<SyncStateTaskResult> {
    log.trace('[syncStateWithAllMintsTask] start')
    if (mintsStore.mintCount === 0) {
        return {
            taskFunction: SYNC_STATE_WITH_ALL_MINTS_TASK,
            transactionStateUpdates: [],
            completedTransactionIds: [],
            errorTransactionIds: [],
            revertedTransactionIds: [],
            message: 'No mints'
        }
    }

    const { isPending } = options
    const maxBatchSize = MAX_SYNC_INPUT_SIZE
    const transactionStateUpdates: TransactionStateUpdate[] = []
    const completedTransactionIds: number[] = []
    const errorTransactionIds: number[] = []
    const revertedTransactionIds: number[] = []
    const errors: string[] = []

    // group proofs by mint so that we do max one call per mint
    // does not depend on unit, process in batches by 100
    for (const mint of mintsStore.allMints) {        
        const proofsToSync = proofsStore.getByMint(mint.mintUrl, { isPending })
        const totalProofsCount = proofsToSync.length

        if(totalProofsCount === 0) {
            log.trace('[syncStateWithAllMintsTask] No proofs to sync, skipping...', { mint: mint.mintUrl })
            continue
        }
        
        if (totalProofsCount > maxBatchSize) {
          
            for (let i = 0; i < totalProofsCount; i += maxBatchSize) {
                const batch = proofsToSync.slice(i, i + maxBatchSize)
                const result = await syncStateWithMintTask({ proofsToSync: batch, mintUrl: mint.mintUrl, isPending })

                transactionStateUpdates.push(...result.transactionStateUpdates)
                completedTransactionIds.push(...result.completedTransactionIds)
                errorTransactionIds.push(...result.errorTransactionIds)
                revertedTransactionIds.push(...result.revertedTransactionIds)

                if(result.error) {
                    errors.push(result.error.message)
                }
            }

        } else {
            // If the length is less than or equal to 100, run syncStateWithMint with all proofs.
            const result = await syncStateWithMintTask({ proofsToSync, mintUrl: mint.mintUrl, isPending })

            transactionStateUpdates.push(...result.transactionStateUpdates)
            completedTransactionIds.push(...result.completedTransactionIds)
            errorTransactionIds.push(...result.errorTransactionIds)
            revertedTransactionIds.push(...result.revertedTransactionIds)

            if(result.error) {
                errors.push(result.error.message)
            }
        }
    }

    let totalSpent = 0    
    let message = ''

    for (const update of transactionStateUpdates) {                    
        if(update.spentByMintAmount) {
            totalSpent += update.spentByMintAmount        
        }                
    }

    if(isPending) {
        message = 'Pending proofs were synced with the mints.'
    } else {
        message =  `Sync completed with ${errors.length} errors. Spent ecash with ${totalSpent} amount was cleaned.`
    }

    return {
        taskFunction: SYNC_STATE_WITH_ALL_MINTS_TASK,
        transactionStateUpdates,
        completedTransactionIds,
        errorTransactionIds,
        revertedTransactionIds,
        errors,
        message
    } 
}

/*
 * Pass syncStateWithMintTask function into synchronous queue for safe processing without race conditions on proof counters. * 
 */
const syncStateWithMintQueue = async function (    
    options: {
        proofsToSync: Proof[],
        mintUrl: string,
        isPending: boolean
    }  
): Promise<void> {
    const {mintUrl, isPending, proofsToSync} = options
    log.trace('[syncStateWithMintQueue] start', {mintUrl, isPending, proofsToSyncCount: proofsToSync.length})
    const now = new Date().getTime()

    return SyncQueue.addTask(
        `syncStateWithMintTask-${now}`,            
        async () => await syncStateWithMintTask({proofsToSync, mintUrl, isPending})
    )    
}

  

/*
*  Checks with the mint whether proofs have been spent / pending by mint.
 *  Under normal wallet operations, it is used to check pending proofs that were sent to the payee.
 *
 *  However it is used as well as a recovery process to remove spent proofs from the spendable balance itself.
 *  This situation occurs as a result of broken wallet state and causes failure of
 *  subsequent transactions because mint returns "Tokens already spent" if any spent proof is used as an input.
 * 
 *  It is a task function that should always be added to SyncQueue and not called directly
 *  
 *  @mintUrl URL of the mint to check for spent and pending proofs
 *  @isPending whether the proofs come from spendable or pending state by the wallet
 *  @proofsToSync optional proofs to check the spent / pending status, otherwise all mint proofs are synced
 *  @returns WalletTaskResult
 */

const syncStateWithMintTask = async function (            
    options: {  
        proofsToSync: Proof[],
        mintUrl: string,           
        isPending: boolean
    }    
): Promise<SyncStateTaskResult> {

    log.trace('[syncStateWithMintTask] start', {mintUrl: options.mintUrl})

    const transactionStateUpdates: TransactionStateUpdate[] = []
    const completedTransactionIds: number[] = []
    const errorTransactionIds: number[] = []
    const pendingTransactionIds: number[] = []
    const revertedTransactionIds: number[] = []

    const {proofsToSync, mintUrl, isPending} = options
    const mint = mintsStore.findByUrl(mintUrl as string)    

    try {        

        if (proofsToSync.length === 0) {
            const message = `No ${isPending ? 'pending' : ''} proofs found for mint, skipping mint call...`            
            log.trace('[syncStateWithMintTask]', message, mintUrl)

            return {
                taskFunction: SYNC_STATE_WITH_MINT_TASK,
                mintUrl,
                message,
                transactionStateUpdates: [],
                completedTransactionIds: [],
                errorTransactionIds: [],
                revertedTransactionIds: []
            } as SyncStateTaskResult
        }       

        const proofsByState = await walletStore.getProofsStatesFromMint(
            mintUrl,            
            mint && mint.units ? mint.units[0] : 'sat', // likely not to be unit-dependent
            proofsToSync
        )        
    
        if(mint) { 
            mint.setStatus(MintStatus.ONLINE)                
        }
       
        const spentByMintAmount = CashuUtils.getProofsAmount(proofsByState.SPENT)
        const pendingByMintAmount = CashuUtils.getProofsAmount(proofsByState.PENDING)
        const unspentByMintAmount = CashuUtils.getProofsAmount(proofsByState.UNSPENT)  

        log.debug('[syncStateWithMintTask]', `${isPending ? 'Pending' : ''} spent and pending by mint amounts`, {
            spentByMintAmount, 
            pendingByMintAmount,
            unspentByMintAmount,
            isPending
        })

        // 1. Complete transactions with their proofs becoming spent by mint
        if (proofsByState.SPENT.length  > 0) {

            // Remove spent proofs model instances
            proofsStore.removeProofs(proofsByState.SPENT as Proof[], isPending)
            
            // Clean pendingByMint secrets from state if proofs came back as spent by mint            
            if(proofsStore.pendingByMintSecrets.length > 0) {
                const spentByMintSecrets = new Set(proofsByState.SPENT.map(proof => proof.secret))
                const tobeRemoved = proofsStore.pendingByMintSecrets.filter(secret => spentByMintSecrets.has(secret))

                if(tobeRemoved.length > 0) {                    
                    proofsStore.removeManyFromPendingByMint(tobeRemoved)
                }                
            }

            // Map to track spent amounts by transaction ID
            const transactionStateMap: { [key: number]: number } = {}  

            for (const spent of proofsByState.SPENT) {
                // Find the matching proof
                const spentProof = proofsToSync.find(proof => spent.secret === proof.secret)
                
                if (spentProof) {
                    // Get the transaction ID (tId) from the matching proof
                    const tId = spentProof.tId              
            
                    // Accumulate the spent amount for this transaction ID
                    if (!transactionStateMap[tId]) {
                        transactionStateMap[tId] = 0
                    }
                    transactionStateMap[tId] += spentProof.amount
                }
            }
            
            // Convert the transactionStateMap to an array of transactionStateUpdate objects
            const spentStateUpdates = Object.entries(transactionStateMap).map(([tId, spentByMintTxAmount]) => {                                 
                const tx = transactionsStore.findById(Number(tId))                

                if (tx) {
                    // spent amount does not cover matched tx amount 
                    // means that some spent proofs were used as inputs into the swap / melt
                    if(spentByMintTxAmount < tx.amount) {

                        errorTransactionIds.push(Number(tId))

                        // return unspent proofs from pending back to spendable
                        if(isPending) {
                            const unspentProofs = proofsToSync.filter(proof => 
                                proofsByState.SPENT.find(spent => spent.secret !== proof.secret)
                            )

                            if(unspentProofs.length > 0) {
                                log.trace('[syncStateWithMintTask]', `Moving ${unspentProofs.length} unspent proofs from pending back to spendable.`)
                                // remove it from pending proofs in the wallet
                                proofsStore.removeProofs(unspentProofs, true, true)
                                // add proofs back to the spendable wallet                
                                proofsStore.addProofs(unspentProofs)
                            }
                        }

                        return {
                            tId: Number(tId),
                            amount: tx.amount,
                            spentByMintAmount: spentByMintTxAmount as number,
                            message: 'Some spent ecash has been used as an input for this transaction.',
                            updatedStatus: TransactionStatus.ERROR
                        } as TransactionStateUpdate

                    } else {

                        completedTransactionIds.push(Number(tId))

                        return {
                            tId: Number(tId),
                            amount: tx.amount,
                            spentByMintAmount: spentByMintTxAmount as number,
                            meltQuoteToRecover: tx.type === TransactionType.TRANSFER && tx.quote.length > 0 ? tx.quote : null,
                            updatedStatus: TransactionStatus.COMPLETED
                        } as TransactionStateUpdate
                    }
                }

                return {
                    tId: Number(tId),
                    updatedStatus: TransactionStatus.ERROR,
                    message: 'Could not find transaction in the database.'
                } as TransactionStateUpdate
            })

            log.trace('[syncStateWithMintTask]', {spentStateUpdates})

            transactionStateUpdates.push(...spentStateUpdates)

            // Recover melt quote change for long pending, now completed transactions
            for (const update of spentStateUpdates) {
                if(update.meltQuoteToRecover) {
                    
                    const {recoveredAmount} = await recoverMeltQuoteChange({
                        mintUrl,
                        meltQuote: update.meltQuoteToRecover
                    })
                    update.recoveredChangeAmount = recoveredAmount
                }
            }
            
            // Update related transactions statuses
            log.debug('[syncStateWithMintTask]', 'Transaction id(s) to complete', completedTransactionIds.toString())

            // Complete related transactions
            if (completedTransactionIds.length > 0) {
                const transactionDataUpdate = {
                    status: TransactionStatus.COMPLETED,
                    spentStateUpdates,
                    createdAt: new Date(),
                }

                await transactionsStore.updateStatuses(
                    completedTransactionIds,
                    TransactionStatus.COMPLETED,
                    JSON.stringify(transactionDataUpdate),
                )
                
                stopPolling(`syncStateWithMintPoller-${mintUrl}`)
            }

            if (errorTransactionIds.length > 0) {
                const transactionDataUpdate = {
                    status: TransactionStatus.ERROR,
                    spentStateUpdates,
                    createdAt: new Date(),
                }

                await transactionsStore.updateStatuses(
                    errorTransactionIds,
                    TransactionStatus.ERROR,
                    JSON.stringify(transactionDataUpdate),
                )

                log.error('[syncStateWithMintTask]', `Transaction status update error`, {spentStateUpdates})
                stopPolling(`syncStateWithMintPoller-${mintUrl}`)
            }
        }
        
        // 2. Make sure that transactions with proofs pending by mint are pending
        //    and that we keep their secrets in pendingByMint state
        if (proofsByState.PENDING.length > 0) {

            // To prevent multiple pending status updates we select only those
            // pending by mint proofs that the wallet does not track yet
            const newPendingByMintProofs = proofsByState.PENDING.filter(
                proof => !proofsStore.pendingByMintSecrets.includes(proof.secret)
            )

            if(newPendingByMintProofs.length > 0) {
                // Now we add them to the state
                for (const proof of newPendingByMintProofs) {
                    proofsStore.addToPendingByMint(proof as Proof)
                }

                // Map to track pending amounts by transaction ID
                const transactionStateMap: { [key: number]: number } = {}  

                for (const pending of newPendingByMintProofs) {
                    // Find the matching pending proof
                    const pendingProof = proofsToSync.find(proof => pending.secret === proof.secret)                    
                    
                    if (pendingProof) {
                        // Get the transaction ID (tId) from the matching proof
                        const tId = pendingProof.tId
                        
                        // Add the tId to the list of transactions to complete
                        if(!pendingTransactionIds.includes(tId)) {
                            pendingTransactionIds.push(tId)
                        }                   

                        // Accumulate the pending amount for this transaction ID
                        if (!transactionStateMap[tId]) {
                            transactionStateMap[tId] = 0
                        }
                        transactionStateMap[tId] += pendingProof.amount
                    }
                }

                // Convert the transactionStateMap to an array of transactionStateUpdate objects
                const pendingStateUpdates = Object.entries(transactionStateMap).map(([tId, pendingByMintAmount]) => ({
                    tId: Number(tId),
                    pendingByMintAmount: pendingByMintAmount as number,
                    updatedStatus: TransactionStatus.PENDING
                } as TransactionStateUpdate))

                log.trace('[syncStateWithMintTask]', {pendingStateUpdates})

                transactionStateUpdates.push(...pendingStateUpdates)

                // If we somehow found new pending by mint proofs inside spendable balance during cleanup from spent, move them to pending
                if(!isPending) {
                    // remove it from spendable proofs in the wallet
                    proofsStore.removeProofs(newPendingByMintProofs as Proof[], false) // we clean spendable balance
                    // add proofs to the pending wallet                
                    proofsStore.addProofs(newPendingByMintProofs as Proof[], true)
                }

                // Update related transactions statuses
                log.debug('[syncStateWithMintTask]', 'Transaction id(s) to be pending', pendingTransactionIds.toString())

                // Keep or make related transactions pending (mostly timed-out transfers from PREPARED status)
                if (pendingTransactionIds.length > 0) {
                    const transactionDataUpdate = {
                        status: TransactionStatus.PENDING,
                        pendingStateUpdates,
                        message: 'Ecash has been moved to pending while the mint waits for related lightning payment to settle.',
                        createdAt: new Date(),
                    }

                    await transactionsStore.updateStatuses(
                        pendingTransactionIds,
                        TransactionStatus.PENDING,
                        JSON.stringify(transactionDataUpdate),
                    )
                }
            }
        }
       
        // 3. Revert transactions that were pending by mint back to spendable if they
        //    are not pending anymore nor were spent - thus lightning payment failed

        const remainingSecrets: string[] = getSnapshot(proofsStore.pendingByMintSecrets)
        log.trace('[syncStateWithMintTask]', 'Remaining pendingByMintSecrets', remainingSecrets)
        
        if(remainingSecrets.length > 0) {
            let secretsTobeMovedToSpendable: string[] = []           

            if(proofsByState.PENDING.length > 0) {
                // Filter remainingSecrets to get those that do not exist in pendingByMintProofs
                const pendingByMintSecrets = new Set(proofsByState.PENDING.map(proof => proof.secret))
                secretsTobeMovedToSpendable =  remainingSecrets.filter(secret => !pendingByMintSecrets.has(secret))
            } else {
                secretsTobeMovedToSpendable = remainingSecrets
            }

            if(secretsTobeMovedToSpendable.length > 0) {                
                log.debug('[syncStateWithMintTask]', 'Moving proofs from pendingByMint to spendable', {secretsTobeMovedToSpendable})

                // Map to track reverted amounts by transaction ID
                const transactionStateMap: { [key: number]: number } = {}
                const proofsToBeMovedToSpendable: Proof[] = []

                for (const secret of secretsTobeMovedToSpendable) {
                    // Find the matching proof in the MST state by the secret
                    const revertedProof = proofsStore.getBySecret(secret, true) // only pending
                    
                    if (revertedProof) {
                        // Get the transaction ID (tId) from the matching proof
                        const tId = revertedProof.tId
                        
                        // Add the tId to the list of transactions to complete
                        if(!revertedTransactionIds.includes(tId)) {
                            revertedTransactionIds.push(tId)
                        }                   

                        // Accumulate the spent amount for this transaction ID
                        if (!transactionStateMap[tId]) {
                            transactionStateMap[tId] = 0
                        }
                        transactionStateMap[tId] += revertedProof.amount
                        proofsToBeMovedToSpendable.push(revertedProof)
                    }
                }

                // Convert the transactionStateMap to an array of transactionStateUpdate objects
                const revertedStateUpdates = Object.entries(transactionStateMap).map(([tId, revertedByMintAmount]) => ({
                    tId: Number(tId),
                    revertedByMintAmount: revertedByMintAmount as number,
                    updatedStatus: TransactionStatus.REVERTED
                } as TransactionStateUpdate))

                log.trace('[syncStateWithMintTask]', {revertedStateUpdates})

                transactionStateUpdates.push(...revertedStateUpdates)

                if(proofsToBeMovedToSpendable.length > 0) {
                    // remove it from pending proofs in the wallet
                    proofsStore.removeProofs(proofsToBeMovedToSpendable, true, true)
                    // add proofs back to the spendable wallet                
                    proofsStore.addProofs(proofsToBeMovedToSpendable)
                }

                if(revertedTransactionIds.length > 0) {
                    const transactionDataUpdate = {
                        status: TransactionStatus.REVERTED,
                        revertedStateUpdates,
                        message: 'Ecash has been returned to spendable balance.',
                        createdAt: new Date(),
                    }

                    await transactionsStore.updateStatuses(
                        revertedTransactionIds,
                        TransactionStatus.REVERTED,
                        JSON.stringify(transactionDataUpdate),
                    )
                }

                // remove handled secrets from pendingByMint state
                proofsStore.removeManyFromPendingByMint(secretsTobeMovedToSpendable)
            }
        }
        
        return {
            taskFunction: SYNC_STATE_WITH_MINT_TASK,
            mintUrl,
            message: `Completed sync for ${isPending ? 'pending' : ''} proofs with the mint`,
            transactionStateUpdates,
            completedTransactionIds,
            errorTransactionIds,
            pendingTransactionIds,
            revertedTransactionIds
        } as SyncStateTaskResult
    } catch(e: any) {
        // silent
        log.error('[syncStateWithMintTask]', e.name, {message: e.message, mintUrl})        
    
        if(mint && e.name === Err.MINT_ERROR && e.message.includes('network')) { 
            mint.setStatus(MintStatus.OFFLINE)                
        }        

        return {
            taskFunction: SYNC_STATE_WITH_MINT_TASK,
            mintUrl,
            message: `Sync for ${isPending ? 'pending' : ''} proofs with the mint ended with error: ${e.message}`,
            error: e,
            transactionStateUpdates,
            completedTransactionIds,
            errorTransactionIds,
            pendingTransactionIds,
            revertedTransactionIds
        } as SyncStateTaskResult
    }
}


const handleInFlightQueue = async function (): Promise<void> {
    log.trace('[handleInFlight] start')
    if (mintsStore.mintCount === 0) {
        return
    }

    for (const mint of mintsStore.allMints) {
        
        if(mint.proofsCountersWithInFlightRequests.length === 0) {
            log.trace('No proofCounters with inFlight requests, skipping...')
            continue
        }

        const now = new Date().getTime()

        SyncQueue.addTask( 
            `${HANDLE_INFLIGHT_BY_MINT_TASK}-${now}`,               
            async () => await handleInFlightByMintTask(mint)               
        )               
    }

    return
}


/*
 * Recover proofs that were issued by mint, but wallet failed to receive them if swap did not complete.
 */
const handleInFlightByMintTask = async function (mint: Mint): Promise<WalletTaskResult> {

    const mintUrl = mint.mintUrl
    const inFlightCounters =  mint.proofsCountersWithInFlightRequests

    log.trace('[handleInFlightByMintTask]', {mintUrl: mint.mintUrl, inFlightCounters})

    const allInFlightRequestLength = mint.allInFLightRequests?.length
    const errors: string[] = []

    if(inFlightCounters && inFlightCounters.length > 0) {        

        for(const counter of inFlightCounters) {

            for(const inFlight of counter.inFlightRequests) {
                
                const transaction = transactionsStore.findById(inFlight.transactionId)
    
                if(!transaction) {
                    counter.removeInFlightRequest(inFlight.transactionId)
                    continue
                }
                
                const {mint, unit} = transaction
    
                switch(transaction.type) {
                    case TransactionType.RECEIVE:
                        try {
    
                            const {proofs, swapFeePaid} = await walletStore.receive(
                                mint,
                                unit,
                                inFlight.request.token,
                                transaction.id,
                                {
                                    inFlightRequest: inFlight
                                }
                            )
    
                            const { addedAmount: receivedAmount } = WalletUtils.addCashuProofs(
                                mint,
                                proofs,
                                {
                                    unit,
                                    transactionId: transaction.id,
                                    isPending: false
                                }                    
                            )
    
                            if(proofs.length > 0 &&  receivedAmount === 0) {
                                throw new AppError(Err.WALLET_ERROR, 
                                    'Received proofs could not be stored into the wallet, most likely are already there.',
                                    {
                                        caller: HANDLE_INFLIGHT_BY_MINT_TASK,
                                        numberOfProofs: proofs.length
                                    }
                                )
                            }
    
                            const outputToken = getEncodedToken({
                                mint,
                                proofs,
                                unit                        
                            })
    
                            // Update tx amount if full amount was not received
                            if (receivedAmount !== transaction.amount) {      
                                transaction.setReceivedAmount(receivedAmount)
                            }
                            
                            await transactionsStore.updateStatuses(
                                [transaction.id],
                                TransactionStatus.COMPLETED,
                                JSON.stringify({
                                    status: TransactionStatus.COMPLETED,  
                                    receivedAmount,
                                    swapFeePaid,
                                    unit,                     
                                    createdAt: new Date(),
                                }),
                            )
    
                            transaction.setOutputToken(outputToken)
    
                            const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
                            transaction.setBalanceAfter(balanceAfter)
    
                            if(swapFeePaid > 0) {
                                transaction.setFee(swapFeePaid)
                            }
                            break                 
    
                        } catch (e: any) {
                            log.error('[handleInFlightByMintTask] Receive', e.name, e.message)
                            errors.push(e.message)
                            break                    
                        }
    
    
                    case TransactionType.SEND:
                        try {                    
                            const {
                                returnedProofs,
                                proofsToSend, 
                                swapFeePaid
                            } = await walletStore.send(
                                mintUrl,
                                inFlight.request.amount,                
                                unit,            
                                inFlight.request.proofs,
                                transaction.id,
                                {
                                    inFlightRequest: inFlight,
                                    p2pk: undefined
                                }
                            )
    
                            WalletUtils.addCashuProofs(
                                mintUrl,
                                returnedProofs,
                                {
                                    unit,
                                    transactionId: transaction.id,
                                    isPending: false
                                }
                            )
    
                            // remove used proofs and move sent proofs to pending
                            proofsStore.removeProofs(inFlight.request.proofs)
                            
                            const { addedAmount: sentAmount } = WalletUtils.addCashuProofs(            
                                mintUrl,
                                proofsToSend,
                                {
                                    unit,
                                    transactionId: transaction.id,
                                    isPending: true
                                }       
                            )
    
                            if(proofsToSend.length > 0 &&  sentAmount === 0) {
                                throw new AppError(Err.WALLET_ERROR, 
                                    'Sent proofs could not be moved to pending, most likely are already there.',
                                    {
                                        caller: HANDLE_INFLIGHT_BY_MINT_TASK,
                                        numberOfProofs: proofsToSend.length
                                    }
                                )
                            }
    
                            const outputToken = getEncodedToken({
                                mint: mintUrl,
                                proofs: proofsToSend,
                                unit,
                            })
                    
                            transaction.setOutputToken(outputToken)
                            
                            // Finally, update completed transaction
                            await transactionsStore.updateStatuses(
                                [transaction.id],
                                TransactionStatus.PENDING,
                                JSON.stringify({
                                    status: TransactionStatus.PENDING,                      
                                    createdAt: new Date(),
                                })
                            )
                    
                            const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
                            transaction.setBalanceAfter(balanceAfter)
                            
                            if(swapFeePaid > 0) {
                                transaction.setFee(swapFeePaid)
                            }
                            break                  
    
                        } catch (e: any) {
                            log.error('[handleInFlightByMintTask] Send', e.name, e.message)
                            errors.push(e.message)
                            break 
                        }
                      
                    case TransactionType.TOPUP:
                        try {
                            const proofs = await walletStore.mintProofs(  
                                mintUrl,
                                inFlight.request.amount,
                                unit,
                                inFlight.request.quote,
                                transaction.id,
                                {                              
                                  inFlightRequest: inFlight
                                }                            
                            )
    
                            const pr = paymentRequestsStore.findByTransactionId(transaction.id)
                            
                            const {addedAmount: mintedAmount} = WalletUtils.addCashuProofs(
                                mintUrl as string,
                                proofs,
                                {
                                    unit,
                                    transactionId: transaction.id,
                                    isPending: false               
                                }
                            )
                            
                            if(proofs.length > 0 &&  mintedAmount === 0) {
                                throw new AppError(Err.WALLET_ERROR, 
                                    'Minted proofs could not be stored into the wallet, most likely are already there.',
                                    {
                                        caller: HANDLE_INFLIGHT_BY_MINT_TASK,
                                        numberOfProofs: proofs.length
                                    }
                                )
                            }
    
                            stopPolling(`handlePendingTopupPoller-${pr?.paymentHash}`)                        
    
                            await transactionsStore.updateStatuses(
                                [transaction.id],
                                TransactionStatus.COMPLETED,
                                JSON.stringify({
                                    status: TransactionStatus.COMPLETED,
                                    createdAt: new Date(),
                                })
                            )
                            
                            // Update tx with current total balance of topup unit/currency
                            const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
                            transaction.setBalanceAfter(balanceAfter)
                            break   
    
                        } catch(e: any) {
                            log.error('[handleInFlightByMintTask] Topup', e.name, e.message)
                            errors.push(e.message)
                            break 
                        }
    
    
                    case TransactionType.TRANSFER:
                        try {
    
                            const {quote, change} = await walletStore.payLightningMelt(                            
                                mintUrl,
                                unit,
                                inFlight.request.meltQuote,
                                inFlight.request.proofsToSend,
                                transaction.id,
                                {
                                    inFlightRequest: inFlight
                                }
                            )
                
                            // Spend pending proofs that were used to settle the lightning invoice
                            proofsStore.removeProofs(inFlight.request.proofsToSend as Proof[], true, false)
                
                            // Save preimage asap
                            if(quote.payment_preimage) {
                                transaction.setProof(quote.payment_preimage)
                            }
    
                            const proofsToMeltFromAmount = CashuUtils.getProofsAmount(inFlight.request.proofsToSend)
                            
                            let totalFeePaid = proofsToMeltFromAmount - transaction.amount
                            let returnedAmount = CashuUtils.getProofsAmount(change)
                
                            if(change.length > 0) {            
                                const {addedAmount: changeAmount} = WalletUtils.addCashuProofs(
                                    mintUrl, 
                                    change, 
                                    {
                                        unit,
                                        transactionId: transaction.id,
                                        isPending: false
                                    }                
                                )
    
                                if(changeAmount === 0) {
                                    throw new AppError(Err.WALLET_ERROR, 
                                        'Proofs returned as a change could not be stored into the wallet, most likely are already there.',
                                        {
                                            caller: 'handleInFlightByMintTask',
                                            numberOfProofs: change.length
                                        }
                                    )
                                }
                        
                                const outputToken = getEncodedToken({
                                    mint: mintUrl,
                                    proofs: change,
                                    unit,            
                                })
                    
                                transaction.setOutputToken(outputToken)    
                                
                                totalFeePaid = totalFeePaid - returnedAmount                            
                            }           
                    
                            // Save final fee in db
                            if(totalFeePaid !== transaction.fee) {
                                transaction.setFee(totalFeePaid)
                            }        
    
                            await transactionsStore.updateStatuses(
                                [transaction.id],
                                TransactionStatus.COMPLETED,
                                JSON.stringify({
                                    status: TransactionStatus.COMPLETED,                
                                    returnedAmount,       
                                    preimage: quote.payment_preimage,                
                                    createdAt: new Date(),
                                })
                            )
                    
                            const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
                            transaction.setBalanceAfter(balanceAfter)
                            break      
    
                        } catch(e: any) {
                            log.error('[handleInFlightByMintTask] Topup', e.name, e.message)
                            errors.push(e.message)
                            break
                        }
                    default:
                        log.error('[handleInFlightByMintTask] Unknown transaction type', {type: transaction.type})
                }
            }
        }

        return {
            taskFunction: HANDLE_INFLIGHT_BY_MINT_TASK,
            mintUrl,
            errors,
            message: `${allInFlightRequestLength} inFlight requests were resent and processed with ${errors.length} errors.`,        
        }
        
    }

    
    return {
        taskFunction: HANDLE_INFLIGHT_BY_MINT_TASK,
        mintUrl,
        message: 'No proofCounters with inFlight requests, skipping...',
    } as WalletTaskResult
}



const handlePendingTopupsQueue = async function (): Promise<void> {    
    const paymentRequests: PaymentRequest[] = paymentRequestsStore.allOutgoing

    log.trace('[handlePendingTopupsQueue] start', {paymentRequests})

    if (paymentRequests.length === 0) {
        log.trace('[handlePendingTopupsQueue]', 'No outgoing payment requests in store - skipping task send to the queue...')
        return
    }

    for (const pr of paymentRequests) {
        // skip pr if active poller exists
        if(pollerExists(`handlePendingTopupPoller-${pr.paymentHash}`)) {
            log.trace('[handlePendingTopupsQueue] Skipping check of paymentRequest, poller exists', {paymentHash: pr.paymentHash})
            continue
        }

        const now = new Date().getTime()
        
        SyncQueue.addTask(
            `handlePendingTopupTask-${now}`,               
            async () => await handlePendingTopupTask({paymentRequest: pr})               
        )
    }
}



const handlePendingTopupQueue = async function (params: {paymentRequest: PaymentRequest}): Promise<void> {
    const {paymentRequest} = params
    log.trace('[handlePendingTopup] start', {paymentHash: paymentRequest.paymentHash})
    
    const now = new Date().getTime()
    
    SyncQueue.addTask(    
        `_handlePendingTopupTask-${now}`,               
        async () => await handlePendingTopupTask({paymentRequest})               
    )
}



const handlePendingTopupTask = async function (params: {paymentRequest: PaymentRequest}): Promise<WalletTaskResult> {
    const {paymentRequest: pr} = params
    const transactionId = {...pr}.transactionId || 0// copy
    const mintUrl = {...pr}.mint // copy
    const unit = {...pr}.mintUnit // copy, unit of proofs to be received
    const amount = {...pr}.amountToTopup // copy, amount of proofs to be received    
    const paymentHash = {...pr}.paymentHash // copy
    const mintQuote = {...pr}.mintQuote // copy
    const mintInstance = mintsStore.findByUrl(mintUrl as string)
    const transaction = transactionsStore.findById(transactionId)    

    try {
        if(!mintInstance || !mintQuote || !unit || !amount || !transaction) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing mint, mint quote, mintUnit, amountToTopup or transaction', {mintUrl})
        }
      
        // check is quote has been paid
        const { state, mintQuote: quote } = await walletStore.checkLightningMintQuote(mintUrl!, mintQuote)

        if (quote !== mintQuote) {
            throw new AppError(Err.VALIDATION_ERROR, 'Returned quote is different then the one requested', {mintUrl, quote, mintQuote})
        }

        if (isBefore(pr.expiresAt as Date, new Date())) {
            log.debug('[handlePendingTopupTask]', `Invoice expired, removing: ${pr.paymentHash}`)

            // expire related tx - but only if it has not been completed before this check
            if(transaction.status !== TransactionStatus.COMPLETED) {
                const transactionDataUpdate = {
                    status: TransactionStatus.EXPIRED,
                    message: 'Invoice expired',                        
                    createdAt: new Date(),
                }                        

                await transactionsStore.updateStatuses(
                    [transactionId],
                    TransactionStatus.EXPIRED,
                    JSON.stringify(transactionDataUpdate),
                ) 
            }

            stopPolling(`handlePendingTopupPoller-${paymentHash}`)         
            paymentRequestsStore.removePaymentRequest(pr)
        }

        switch (state) {            
            case MintQuoteState.UNPAID:
                log.trace('[handlePendingTopupTask] Quote not paid', {mintUrl, mintQuote})                
    
                return {
                    taskFunction: HANDLE_PENDING_TOPUP_TASK,
                    transaction,
                    mintUrl,
                    unit,
                    amount,
                    paymentHash,                     
                    message: `Quote ${mintQuote} has not yet been paid.`,
                } as WalletTaskResult
            
            /* 
             * PAID 
             */
            case MintQuoteState.PAID:                
        
                let proofs: CashuProof[] = []
        
                try {        
                    proofs = (await walletStore.mintProofs(
                        mintUrl as string,
                        amount,
                        unit,
                        mintQuote,
                        transactionId
                    ))
                } catch (e: any) {
                    if(e.message.includes('outputs have already been signed before')) {
                        
                        log.error('[handlePendingTopupTask] Increasing proofsCounter outdated values and repeating mintProofs.')                        
        
                        proofs = (await walletStore.mintProofs(
                            mintUrl as string,
                            amount,
                            unit,
                            mintQuote,
                            transactionId,
                            {increaseCounterBy: 10}
                        ))
                    } else {
                        throw e
                    }
                }
                
                if (!proofs || proofs.length === 0) {        
                    throw new AppError(Err.VALIDATION_ERROR, 'Mint did not return any proofs.')
                }        
        
                // we got proofs, accept to the wallet asap
                const {addedAmount: receivedAmount} = WalletUtils.addCashuProofs(
                    mintUrl as string,
                    proofs,
                    {
                        unit,
                        transactionId,
                        isPending: false               
                    }
                )                
                
                stopPolling(`handlePendingTopupPoller-${paymentHash}`)
                const currencyCode = getCurrency(pr.mintUnit!).code  
        
                // update related tx
                const transactionDataUpdate = {
                    status: TransactionStatus.COMPLETED,
                    createdAt: new Date(),
                }
        
                // await for final status
                await transactionsStore.updateStatuses(
                    [transactionId],
                    TransactionStatus.COMPLETED,
                    JSON.stringify(transactionDataUpdate),
                )
        
                // payment has been sent from payment request receiver
                if(pr.contactTo) {
                    transaction.setSentFrom(
                        pr.contactTo.nip05handle ?? pr.contactTo.name!
                    )
        
                    transaction.setProfile(
                        JSON.stringify(pr.contactTo) 
                    )
                }
                
                // Update tx with current total balance of topup unit/currency
                const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
                transaction.setBalanceAfter(balanceAfter)     
            
                _sendTopupNotification(pr)
                paymentRequestsStore.removePaymentRequest(pr)        
                
                return {
                    taskFunction: HANDLE_PENDING_TOPUP_TASK,
                    mintUrl,
                    unit,
                    amount,
                    paymentHash,
                    transaction,
                    message: `Your invoice has been paid and your wallet balance credited with ${formatCurrency(amount, currencyCode)} ${currencyCode}.`,
                } as TransactionTaskResult
            /* 
             * ISSUED 
             */
            case MintQuoteState.ISSUED:
                log.trace('[handlePendingTopupTask] Quote already issued', {mintUrl, mintQuote})            

                paymentRequestsStore.removePaymentRequest(pr)  
                
                return {
                    taskFunction: HANDLE_PENDING_TOPUP_TASK,
                    transaction,
                    mintUrl,
                    unit,
                    amount,
                    paymentHash,                     
                    message: `Ecash for quote ${mintQuote} has already been issued.`,
                } as WalletTaskResult
            /* 
             * UNKNOWN 
             */
            default:
                log.error(`[handlePendingTopupTask] Unknown MintQuoteState`, {state})
                return {
                    taskFunction: HANDLE_PENDING_TOPUP_TASK,
                    transaction,
                    mintUrl,
                    unit,
                    amount,
                    paymentHash,                     
                    message: `Unknown MintQuoteState ${state}`,
                } as WalletTaskResult          
        }

    } catch (e: any) {        
        return {
            taskFunction: HANDLE_PENDING_TOPUP_TASK,
            mintUrl,
            unit,
            amount,
            paymentHash,
            transaction,
            error: {name: e.name, message: e.message, params: e.params || undefined},
            message: `handlePendingTopupTask ended with error: ${e.message}`,                        
        } as TransactionTaskResult
    }

}


const recoverMintQuote = async function (params: {mintUrl: string, mintQuote: string}): Promise<{recoveredAmount: number}> {
    const {mintUrl, mintQuote} = params
    const mintInstance = mintsStore.findByUrl(mintUrl as string)
    const unit = 'sat'    
    
    if(!mintInstance || !mintQuote) {
        throw new AppError(Err.VALIDATION_ERROR, 'Missing mint or mint quote', {mintUrl})
    }
    
    // check is quote has been paid
    const { state, mintQuote: quote, encodedInvoice } = await walletStore.checkLightningMintQuote(mintUrl, mintQuote)

    if (quote !== mintQuote) {
        throw new AppError(Err.VALIDATION_ERROR, 'Returned quote is different then the one requested', {mintUrl, quote, mintQuote})
    }

    switch (state) {            
        case MintQuoteState.UNPAID:
            log.trace('[recoverMintQuote] Quote not paid', {mintUrl, mintQuote})                
            throw new AppError(Err.VALIDATION_ERROR, `Quote ${mintQuote} is not paid`)                
        case MintQuoteState.PAID:
            const invoice = LightningUtils.decodeInvoice(encodedInvoice)
            const {amount, description} = LightningUtils.getInvoiceData(invoice)

            const transactionData: TransactionData[] = [
                {
                    status: TransactionStatus.DRAFT,
                    amount,
                    unit,
                    createdAt: new Date(),
                }
            ]

            const newTransaction = {
                type: TransactionType.TOPUP,
                amount,
                fee: 0,
                unit,
                data: JSON.stringify(transactionData),
                memo: description,
                mint: mintUrl,
                status: TransactionStatus.DRAFT,
            }
            // store tx in db and in the model
            const transaction = await transactionsStore.addTransaction(newTransaction)
            const transactionId = transaction.id                 
    
            let proofs: CashuProof[] = []
    
            try {        
                proofs = (await walletStore.mintProofs(
                    mintUrl as string,
                    amount,
                    'sat',
                    mintQuote,
                    transactionId
                ))
            } catch (e: any) {
                if(e.message.includes('outputs have already been signed before')) {
                    
                    log.error('[recoverMintQuote] Increasing proofsCounter outdated values and repeating mintProofs.')                        
    
                    proofs = (await walletStore.mintProofs(
                        mintUrl as string,
                        amount,
                        unit,
                        mintQuote,
                        transactionId,
                        {increaseCounterBy: 10}
                    ))
                } else {
                    throw e
                }
            }
            
            if (!proofs || proofs.length === 0) {        
                throw new AppError(Err.VALIDATION_ERROR, 'Mint did not return any proofs.')
            }        
    
            // we got proofs, accept to the wallet asap
            const {addedAmount: recoveredAmount} = WalletUtils.addCashuProofs(
                mintUrl as string,
                proofs,
                {
                    unit,
                    transactionId,
                    isPending: false               
                }
            )                
            
            const currencyCode = getCurrency(unit).code  
    
            // update related tx
            const transactionDataUpdate = {
                status: TransactionStatus.RECOVERED,
                createdAt: new Date(),
            }
    
            // await for final status
            await transactionsStore.updateStatuses(
                [transactionId],
                TransactionStatus.RECOVERED,
                JSON.stringify(transactionDataUpdate),
            )
            
            // Update tx with current total balance of topup unit/currency
            const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
            transaction.setBalanceAfter(balanceAfter)            
                    
            
            return { recoveredAmount }
        /* 
            * ISSUED 
            */
        case MintQuoteState.ISSUED:
            log.trace('[recoverMintQuote] Quote already issued', {mintUrl, mintQuote})            

            throw new AppError(Err.VALIDATION_ERROR, `Quote ${mintQuote} already issued.`) 
        /* 
            * UNKNOWN 
            */
        default:
            log.error(`[recoverMintQuote] Unknown MintQuoteState`, {state})
            throw new AppError(Err.VALIDATION_ERROR, `Quote ${mintQuote} has unknown state ${state}`)        
    }   

}


const recoverMeltQuoteChange = async function (params: {mintUrl: string, meltQuote: string}): Promise<{recoveredAmount: number}> {
    const {mintUrl, meltQuote} = params
    const mintInstance = mintsStore.findByUrl(mintUrl as string)
    const unit = 'sat'    
    
    if(!mintInstance || !meltQuote) {
        throw new AppError(Err.VALIDATION_ERROR, 'Missing mint or melt quote', {mintUrl})
    }
    
    // check is quote has been paid
    const meltQuoteResponse: MeltQuoteResponse = await walletStore.checkLightningMeltQuote(mintUrl, meltQuote)
    const {quote, state} = meltQuoteResponse
    const amountToRecover = sumBlindSignatures(meltQuoteResponse.change)

    if (quote !== meltQuote) {
        throw new AppError(Err.VALIDATION_ERROR, 'Returned quote is different then the one requested', {mintUrl, meltQuoteResponse, meltQuote})
    }

    switch (state) {
        /* 
        * UNPAID 
        */          
        case MeltQuoteState.UNPAID:
            log.trace('[recoverMeltQuoteChange] Quote not paid', {mintUrl, meltQuote})                
            throw new AppError(Err.VALIDATION_ERROR, `Quote ${meltQuote} is not paid`) 
        /* 
        * PENDING 
        */
        case MeltQuoteState.PENDING:
            log.trace('[recoverMeltQuoteChange] Quote is pending', {mintUrl, meltQuote})            

            throw new AppError(Err.VALIDATION_ERROR, `Quote ${meltQuote} is still pending.`)   
        /* 
        * PAID 
        */             
        case MeltQuoteState.PAID:

            if(!meltQuoteResponse.change || meltQuoteResponse.change.length === 0) {
                throw new AppError(Err.VALIDATION_ERROR, `Quote ${meltQuote} has not any change to recover.`) 
            }

            let transaction: Transaction | undefined = undefined
            let transactionId: number | undefined = undefined

            transaction = transactionsStore.findByQuote(meltQuote)
            transactionId = transaction?.id

            // Older transactions might not have quote set
            if(!transaction) {
                const transactionData: TransactionData[] = [
                    {
                        status: TransactionStatus.DRAFT,
                        amountToRecover,
                        unit,
                        meltQuoteToRecover: quote,
                        createdAt: new Date(),
                    }
                ]

                const newTransaction = {
                    type: TransactionType.RECEIVE,
                    amount: amountToRecover,
                    fee: 0,
                    unit,
                    data: JSON.stringify(transactionData),
                    memo: 'Melt quote change recovery',
                    mint: mintUrl,
                    status: TransactionStatus.DRAFT,
                }
                // store tx in db and in the model
                const transaction = await transactionsStore.addTransaction(newTransaction)
                transaction.setQuote(meltQuote)
                transactionId = transaction.id
            }

            try {

                const change = await walletStore.recoverMeltQuoteChange(
                    mintUrl as string,
                    meltQuoteResponse
                )
                
                // Force swap with the mint to make sure that change proofs are valid
                const {proofsToSend, returnedProofs} = await walletStore.send(
                    mintUrl as string,
                    0,
                    unit,
                    change as Proof[],
                    transactionId,
                    {
                        increaseCounterBy: change.length, //if we missed to receive the change before, counter might be outdated
                        p2pk: undefined,
                    }
                )

                log.debug('[recoverMeltQuoteChange] Swapped proofs', {proofsToSend, returnedProofs})

                
                if (!returnedProofs || returnedProofs.length === 0) {        
                    throw new AppError(Err.VALIDATION_ERROR, 'Mint did not return any proofs.')
                }
        
                const {addedAmount: recoveredAmount} = WalletUtils.addCashuProofs(
                    mintUrl as string,
                    returnedProofs,
                    {
                        unit,
                        transactionId,
                        isPending: false               
                    }
                )
                
                if(amountToRecover !== recoveredAmount) {
                    transaction.setReceivedAmount(recoveredAmount)
                }
        
                // update related tx
                const transactionDataUpdate = {
                    status: TransactionStatus.RECOVERED,
                    recoveredAmount,
                    createdAt: new Date(),
                }
        
                // await for final status
                await transactionsStore.updateStatuses(
                    [transactionId],
                    TransactionStatus.RECOVERED,
                    JSON.stringify(transactionDataUpdate),
                )
                
                // Update tx with current total balance of topup unit/currency
                const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!            
                const outputToken = getEncodedToken({
                    mint: mintUrl,
                    proofs: returnedProofs,
                    unit,
                })
                transaction.setBalanceAfter(balanceAfter)
                transaction.setOutputToken(outputToken)          
                                
                return { recoveredAmount }

            } catch (e: any) {
                const transactionData: TransactionData[] = JSON.parse(transaction?.data || '[]')
                
                transactionData.push({
                    status: TransactionStatus.ERROR,
                    error: WalletUtils.formatError(e),
                    createdAt: new Date()
                })
    
                transaction.setStatus(                
                    TransactionStatus.ERROR,
                    JSON.stringify(transactionData),
                )
            }
        /* 
        * UNKNOWN 
        */
        default:
            log.error(`[recoverMeltQuoteChange] Unknown MeltQuoteState`, {state: meltQuoteResponse.state})
            throw new AppError(Err.VALIDATION_ERROR, `Quote ${meltQuote} has unknown state ${meltQuoteResponse.state}`)        
    }   

}


const handleClaimQueue = async function (): Promise<void> {
    
    log.info('[handleClaimQueue] start')
    const {isOwnProfile} = walletProfileStore

    if(isOwnProfile) {
        log.info('[handleClaimQueue] Skipping claim queue, wallet uses own Nostr keys...')
        return
    }

    const {isBatchClaimOn} = userSettingsStore
    const keys = await walletStore.getCachedWalletKeys() // throws  

    // Based on user setting, ask for batched token if more then 5 payments are waiting to be claimed
    const claimedTokens = await MinibitsClient.createClaim(
        keys.walletId,
        keys.SEED.seedHash, 
        keys.NOSTR.publicKey,
        isBatchClaimOn ? 5 : undefined
    )

    if(claimedTokens.length === 0) {
        log.debug('[handleClaimQueue] No claimed invoices returned from the server...')
        return
    }
    
    log.debug(`[handleClaimQueue] Claimed ${claimedTokens.length} tokens from the server...`)    

    for(const claimedToken of claimedTokens) {
        const now = new Date().getTime()

        SyncQueue.addTask( 
            `handleClaimTask-${now}`,               
            async () => await handleClaimTask({claimedToken})               
        )               
    }        
    return
}


const handleClaimTask = async function (params: {
    claimedToken: {
        token: string, 
        zapSenderProfile?: string,
        zapRequest?: string,
    }}) {
    let decoded: Token | undefined = undefined

    try {
        const {claimedToken} = params
        
        log.debug('[handleClaimTask] claimed token', {claimedToken})

        if(!claimedToken.token) {
            throw new AppError(Err.VALIDATION_ERROR, '[handleClaimTask] Missing encodedToken to receive.')
        }

        const encryptedToken = claimedToken.token
        const encodedToken = await NostrClient.decryptNip04(MINIBIT_SERVER_NOSTR_PUBKEY, encryptedToken)

        log.debug('[handleClaimTask] decrypted token', {encodedToken})

        decoded = getDecodedToken(encodedToken)
        const amountToReceive = CashuUtils.getProofsAmount(decoded.proofs)
        const memo = decoded.memo || 'Received to Lightning address'

        const result: TransactionTaskResult = await receiveTask(
            decoded,
            amountToReceive,
            memo,
            encodedToken,
        )

        if(result && result.transaction) {
            const transaction = transactionsStore.findById(result.transaction.id!)
            const {zapSenderProfile, zapRequest} = claimedToken
            let message: string = ''

            if(transaction) {
                if (zapSenderProfile) {
                    transaction.setProfile(zapSenderProfile as string)
                    try {
                        const profile: NostrProfile = JSON.parse(zapSenderProfile)
                        transaction.setSentFrom(profile.nip05 ?? profile.name)
                    } catch(e: any) {}
                }

                if (zapRequest) {
                    transaction.setZapRequest(zapRequest as string)
                }
            }
        }

        return { 
            mintUrl: decoded.mint,
            taskFunction: HANDLE_CLAIM_TASK,
            message: result.error ? result.error.message : 'Ecash sent to your lightning address has been received.',
            error: result.error || undefined,
            proofsCount: decoded.proofs.length,
            proofsAmount: result.transaction?.amount,
        } as WalletTaskResult
        
    } catch (e: any) {
        log.error(e.name, e.message)

        return {
            mintUrl: decoded ? decoded.mint : '',            
            taskFunction: HANDLE_CLAIM_TASK,            
            message: e.message,
            error: WalletUtils.formatError(e),
        } as WalletTaskResult
    } 
}



const handleNwcRequestQueue = async function (params: {requestEvent: NostrEvent}): Promise<void> {
    const {requestEvent} = params
    log.trace('[handleNwcRequestQueue] start')
    
    const now = new Date().getTime()
    
    SyncQueue.addTask(    
        `handleNwcRequestTask-${now}`,               
        async () => await nwcStore.handleNwcRequestTask(requestEvent)                
    )
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
const receiveEventsFromRelaysQueue = async function (): Promise<void> {
    log.trace('[receiveEventsFromRelays] starting listening for events')

    if(!walletProfileStore.pubkey) {
        const message = `No wallet profile created.`            
        log.trace('[receiveEventsFromRelays]', message)
        return     
    }    
    
    try {            
        const { lastPendingReceivedCheck } = contactsStore
        const TWO_DAYS = 2 * 24 * 60 * 60

        const filter = {            
            kinds: [GiftWrap, EncryptedDirectMessage],
            "#p": [walletProfileStore.pubkey],
            since: lastPendingReceivedCheck ?  lastPendingReceivedCheck - TWO_DAYS : 0 
        } // 2 days variance to the past from real event created_at for dm sent as gift wraps

        log.trace('[receiveEventsFromRelays]', {filter})

        contactsStore.setLastPendingReceivedCheck()         
        const pool = NostrClient.getRelayPool()

        // make sure we have at least default relays
        if(relaysStore.allRelays.length < 3) {
            relaysStore.addDefaultRelays()
        }
        
        let relaysToConnect = relaysStore.allUrls
        let eventsBatch: NostrEvent[] = []

        const sub = pool.subscribeMany(relaysToConnect , [filter], {
            onevent(event) {
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
                
                eventsBatch.push(event)
                contactsStore.addReceivedEventId(event.id)
                
                // move window to receive events to the last event created_at to avoid recive it again
                // contactsStore.setLastPendingReceivedCheck(event.created_at)

                const now = new Date().getTime()
                SyncQueue.addTask(       
                    `handleReceivedEventTask-${now}`,          
                    async () => await handleReceivedEventTask(event)                
                )
            },
            oneose() {
                log.trace('[receiveEventsFromRelays]', `Eose: Got ${eventsBatch.length} receive events`)
                
                const connections = pool.listConnectionStatus()                
                for (const conn of Array.from(connections)) {
                    const relayInstance = relaysStore.findByUrl(conn[0])
                    if(conn[1] === true) {
                        log.trace('[receiveEventsFromRelays] Connection is OPEN', {conn: conn[0]})             
                        relayInstance?.setStatus(WebSocket.OPEN)
                    } else {
                        log.trace('[receiveEventsFromRelays] Connection is CLOSED', {conn: conn[0]})             
                        relayInstance?.setStatus(WebSocket.CLOSED)
                    }
                }                
            }
        })
        
    } catch (e: any) {
        log.error(e.name, e.message)
        return
    }
}

const handleReceivedEventTask = async function (encryptedEvent: NostrEvent): Promise<WalletTaskResult> {    
    try {
        let directMessageEvent: NostrEvent | UnsignedEvent | undefined = undefined
        let decryptedMessage: string | undefined = undefined
         
        if (encryptedEvent.kind === EncryptedDirectMessage) {
            directMessageEvent = encryptedEvent
            decryptedMessage = await NostrClient.decryptNip04(encryptedEvent.pubkey, encryptedEvent.content)
        }

        if (encryptedEvent.kind === GiftWrap) {
            directMessageEvent = await NostrClient.decryptDirectMessageNip17(encryptedEvent)
            decryptedMessage = directMessageEvent.content
        }

        if(!directMessageEvent || !decryptedMessage) {
            throw new AppError(Err.VALIDATION_ERROR, 'Unrecognized direct message kind', {kind: encryptedEvent.kind})
        }
        
        // set REAL direct message created_at as the lastPendingReceivedCheck
        contactsStore.setLastPendingReceivedCheck(directMessageEvent.created_at)    

        log.trace('[handleReceivedEventTask]', 'Received event', {directMessageEvent})
        
        // get sender profile and save it as a contact
        // this is not valid for events sent from LNURL bridge, that are sent and signed by a minibits server key
        // and *** do not contain sentFrom *** // LEGACY, replaced by claim api
        let sentFromPubkey = directMessageEvent.pubkey
        let sentFrom = NostrClient.getFirstTagValue(directMessageEvent.tags, 'from') as string
        let sentFromNpub = NostrClient.getNpubkey(sentFromPubkey)
        let contactFrom: Contact | undefined = undefined
        let zapSenderProfile: NostrProfile | undefined = undefined 
        let sentFromPicture: string | undefined = undefined          

        // add ecash or pr sender to the contacts
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
        } else {
            // Event was sent from Minibits server
            const maybeZapSenderString = _extractZapSenderData(decryptedMessage)

            if(maybeZapSenderString) {
                try {
                    zapSenderProfile = JSON.parse(maybeZapSenderString)            

                    if(zapSenderProfile) {
                        sentFromPubkey = zapSenderProfile.pubkey // zap sender pubkey                
                        sentFrom = zapSenderProfile.nip05 ?? zapSenderProfile.name                
                        sentFromPicture = zapSenderProfile.picture
                        const sentFromLud16 = zapSenderProfile.lud16
                                
                        // we do not add zappers to contacts but if we have such contact, set or update its lightning address by the one from profile
                        const contactInstance = contactsStore.findByPubkey(sentFromPubkey)
                        if(contactInstance && sentFromLud16) {                                        
                            contactInstance.setLud16(sentFromLud16)
                        }
                    }            
                } catch (e: any) {
                    log.warn('[handleReceivedEventTask]', 'Could not get sender from zapRequest', {message: e.message, maybeZapSenderString})
                }
            }
        }

        // parse incoming message
        const incoming = IncomingParser.findAndExtract(decryptedMessage)

        log.trace('[handleReceivedEventTask]', 'Incoming data', {incoming})

        //
        // Receive token start
        //
        if(incoming.type === IncomingDataType.CASHU) {

            const decoded = getDecodedToken(incoming.encoded)
            const amountToReceive = CashuUtils.getProofsAmount(decoded.proofs)        
            const memo = decoded.memo || 'Received over Nostr'

            const {transaction, receivedAmount} = await receiveTask(
                decoded,
                amountToReceive,
                memo,
                incoming.encoded as string,
            )

            // store contact or zapseder in tx details
            if(transaction && sentFrom) {
                if (contactFrom) {
                    transaction.setProfile(JSON.stringify(contactFrom))
                    transaction.setSentFrom(sentFrom)
                }
        
                if (zapSenderProfile) {
                    transaction.setProfile(JSON.stringify(zapSenderProfile))
                    transaction.setSentFrom(sentFrom)
                }

                const isZap = zapSenderProfile ? true : false

                // We do it defensively only after cash is received
                // and asynchronously so we speed up queue
                _sendReceiveNotification(
                    receivedAmount,
                    transaction.unit,
                    isZap,
                    sentFrom,
                    sentFromPicture                
                ) // TODO move to task result handler
            }

            return {
                mintUrl: decoded.mint,
                taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                message: 'Incoming ecash token has been received.',
                proofsCount: decoded.proofs.length,
                proofsAmount: receivedAmount,
                transaction
            } as WalletTaskResult                  
        }

        //
        // Receive bolt11 invoice start
        //
        else if (incoming.type === IncomingDataType.INVOICE) {
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
            
            const maybeMemo = NostrClient.findMemo(decryptedMessage)
            
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
                taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                message: 'Incoming payment request been received.',
                proofsCount: 0,
                proofsAmount: amount,
                paymentRequest            
            } as WalletTaskResult
        }

        else if(incoming.type === IncomingDataType.CASHU_PAYMENT_REQUEST_PAYLOAD) {
            const decoded: PaymentRequestPayload = JSON.parse(incoming.encoded)
            log.trace('[handleReceivedEventTask]', 'Decoded payment request payload', {decoded})

            const {transaction, receivedAmount, message} = await receiveByCashuPaymentRequestTask(
                decoded
            )

            // store contact or zapseder in tx details
            if(transaction && sentFrom) {
                if (contactFrom) {
                    transaction.setProfile(JSON.stringify(contactFrom))
                    transaction.setSentFrom(sentFrom)
                }
    
                // We do it defensively only after cash is received
                // and asynchronously so we speed up queue
                _sendReceiveNotification(
                    receivedAmount,
                    transaction.unit,
                    false,
                    sentFrom,
                    sentFromPicture                
                ) // TODO move to task result handler
            }

            return {
                mintUrl: decoded.mint,
                taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                message,
                proofsCount: decoded.proofs.length,
                proofsAmount: receivedAmount,
                transaction,
            } as WalletTaskResult   
        }            
        else if (incoming.type === IncomingDataType.LNURL) {
            throw new AppError(Err.NOTFOUND_ERROR, 'LNURL support is not yet implemented.', {caller: HANDLE_RECEIVED_EVENT_TASK})
        } else {
            throw new AppError(Err.NOTFOUND_ERROR, 'Received unknown event message', {caller: HANDLE_RECEIVED_EVENT_TASK,incoming})
        }
    } catch (e: any) {
        log.error('[handleReceivedEventTask]', e.name, e.message)

        return {            
            taskFunction: HANDLE_RECEIVED_EVENT_TASK,
            message: e.message,
            error: WalletUtils.formatError(e)                  
        } as WalletTaskResult
    }
}



const _sendReceiveNotification = async function (
    receivedAmount: number,
    unit: MintUnit,
    isZap: boolean,
    sentFrom: string,
    sentFromPicture?: string
): Promise<void> {
    const getNotificationContent = (
        amount: number,
        currency: CurrencyCode,
        zap: boolean,
        sender: string
    ): { title: string; body: string } => {
        const title = Platform.OS === 'android'
            ? `<b>⚡${formatCurrency(amount, currency)} ${currency}</b> received!`
            : `⚡${formatCurrency(amount, currency)} ${currency} received!`
        const body = Platform.OS === 'android'
            ? `${zap ? 'Zap' : 'Ecash'} from <b>${sender || 'unknown payer'}</b> is now in your wallet.`
            : `${zap ? 'Zap' : 'Ecash'} from ${sender || 'unknown payer'} is now in your wallet.`
        return { title, body };
    }
    
    const enabled = await NotificationService.areNotificationsEnabled()
    if(!enabled) {
        return
    }

    //
    // Send notification event
    //
    const currencyCode = getCurrency(unit).code
    if(receivedAmount && receivedAmount > 0) {
        const { title, body } = getNotificationContent(receivedAmount, currencyCode, isZap, sentFrom);
        await NotificationService.createLocalNotification(title, body, sentFromPicture);
    }

    return
}


const _sendPaymentRequestNotification = async function (pr: PaymentRequest) {    
    await NotificationService.createLocalNotification(
        Platform.OS === 'android' ? `⚡ Please pay <b>${formatCurrency(pr.invoicedAmount, getCurrency(pr.invoicedUnit!).code)} ${getCurrency(pr.invoicedUnit!).code}</b>!` : `⚡ Please pay ${formatCurrency(pr.invoicedAmount, getCurrency(pr.invoicedUnit!).code)} ${getCurrency(pr.invoicedUnit!).code}!`,
        `${pr.contactFrom.nip05 || 'Unknown'} has sent you a request to pay an invoice.`,
        pr.contactFrom.picture,
    )
}

const _extractZapSenderData = function (str: string) {
    const match = str.match(/\{[^}]*\}/);
    return match ? match[0] : null;
}


const testQueue = async () => {
    const now = new Date().getTime()
    
    SyncQueue.addTask(    
        `testTask-${now}`,               
        async () => {
            await new Promise((res) => setTimeout(res, 10 * 1000)) 
            return `testTask-${now} result`           
        }
    )
};


export const WalletTask: WalletTaskService = {    
    syncStateWithAllMintsQueue,
    syncStateWithMintQueue,
    syncStateWithMintTask,
    handleInFlightQueue,    
    handlePendingTopupsQueue,
    handlePendingTopupQueue,
    handleClaimQueue,
    handleNwcRequestQueue,
    receiveEventsFromRelaysQueue,
    receiveQueue,      
    receiveOfflinePrepareQueue,
    receiveOfflineCompleteQueue,        
    sendQueue,
    swapAllQueue,
    transferQueue,      
    topupQueue,
    cashuPaymentRequestQueue,
    revertQueue,
    testQueue,
    recoverMintQuote,
    recoverMeltQuoteChange
}