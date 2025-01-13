import {isBefore} from 'date-fns'
import {getSnapshot} from 'mobx-state-tree'
import { GiftWrap, EncryptedDirectMessage } from 'nostr-tools/kinds'
import {log} from './logService'
import {Proof} from '../models/Proof'
import {
  Transaction,
  TransactionStatus
} from '../models/Transaction'
import {rootStoreInstance} from '../models'
import {CashuProof, CashuUtils} from './cashu/cashuUtils'
import {LightningUtils} from './lightning/lightningUtils'
import AppError, {Err} from '../utils/AppError'
import {MintBalance, MintProofsCounter, MintStatus} from '../models/Mint'
import {MeltQuoteResponse, MintQuoteState, Token, getDecodedToken, getEncodedToken} from '@cashu/cashu-ts'
import {Mint} from '../models/Mint'
import {pollerExists, stopPolling} from '../utils/poller'
import { NostrClient, NostrEvent, NostrProfile } from './nostrService'
import { MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST, MINIBIT_SERVER_NOSTR_PUBKEY } from '@env'
import { PaymentRequest, PaymentRequestStatus, PaymentRequestType } from '../models/PaymentRequest'
import { IncomingDataType, IncomingParser } from './incomingParser'
import { Contact } from '../models/Contact'
import { SyncQueue } from './syncQueueService'
import { receiveTask, receiveOfflinePrepareTask, receiveOfflineCompleteTask} from './wallet/receiveTask'
import { sendTask } from './wallet/sendTask'
import { topupTask } from './wallet/topupTask'
import { transferTask } from './wallet/transferTask'
import { revertTask } from './wallet/revertTask'
import { WalletUtils } from './wallet/utils'
import { NotificationService } from './notificationService'
import { MintUnit, formatCurrency, getCurrency } from './wallet/currency'
import { MinibitsClient } from './minibitsService'
import { getKeepAmounts } from '@cashu/cashu-ts/src/utils'
import { KeyChain } from './keyChain'
import { UnsignedEvent } from 'nostr-tools'


/**
 * The default number of proofs per denomination to keep in a wallet.
 */
export const DEFAULT_DENOMINATION_TARGET = 2

export const MAX_SWAP_INPUT_SIZE = 100
export const MAX_SYNC_INPUT_SIZE = 200 // 1000 hard mint limit

type WalletTaskService = {
    syncPendingStateWithMints: ()   => Promise<void>
    syncSpendableStateWithMints: () => Promise<void>
    syncStateWithMint: (
        options: {
            proofsToSync: Proof[],
            mintUrl: string, 
            isPending: boolean
        }
    ) => Promise<void>
    syncStateWithMintSync: (        
        options: {
            proofsToSync: Proof[],
            mintUrl: string, 
            isPending: boolean
        }        
    ) => Promise<SyncStateTaskResult>
    handleInFlight: ()        => Promise<void>    
    handlePendingTopups: ()   => Promise<void>
    handlePendingTopup: (params: {
        paymentRequest: PaymentRequest
    })   => Promise<void>
    handleClaim: ()   => Promise<void>
    receiveEventsFromRelays: () => Promise<void>
    transfer: (
        mintBalanceToTransferFrom: MintBalance,
        amountToTransfer: number,
        unit: MintUnit,
        meltQuote: MeltQuoteResponse,                
        memo: string,
        invoiceExpiry: Date,
        encodedInvoice: string,
        nwcEvent?: NostrEvent
    ) => Promise<void>
    receive: (
        token: Token,
        amountToReceive: number,
        memo: string,
        encodedToken: string,
    ) => Promise<void>
    receiveBatch: (
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
        transactionId: number
    ) => Promise<void>
    send: (
        mintBalanceToSendFrom: MintBalance,
        amountToSend: number,
        unit: MintUnit,
        memo: string,
        selectedProofs: Proof[]
    ) => Promise<void>
    sendAll: () => Promise<void>
    topup: (
        mintBalanceToTopup: MintBalance,
        amountToTopup: number,
        unit: MintUnit,
        memo: string,
        contactToSendTo?: Contact,
        nwcEvent?: NostrEvent
    ) => Promise<void>
    revert: (
        transaction: Transaction
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
} = rootStoreInstance


const transfer = async function (
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

/* 
 * Receive big tokens in batches to keep mint load reasonable. 
 * Used when optimizing wallet proof amounts but might become the default. 
 */
const receiveBatch = async function  (
    token: Token,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
) {    
    const maxBatchSize = MAX_SWAP_INPUT_SIZE
    const mintUrl = token.mint
    const proofsToReceive = token.proofs
    const unit = token.unit
        
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

            // Queued WalletTask
            receive(
                batchToken,
                batchAmount,
                `${memo} #${index}`,
                batchEncodedToken,
            )                
        }

    } else {
        // If the length is less than or equal to 100, do normal receive
        receive(
            token,
            amountToReceive,
            memo,
            encodedToken,
        )
    }
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


/*
 * sendAll moves all proofs to pending to prepare to swap them for standard amount preference 
 * This decreases the total number of proofs held by the wallet. Used to optimize exported backup size.
 */
const sendAll = async function (): Promise<void> {
    log.trace('[sendAll] start')
    if (mintsStore.mintCount === 0) {
        return
    }

    // Move all proofs by mint units to pending as in offline mode (do not ask for swap)
    for (const mint of mintsStore.allMints) {
        // Do not create a pending transaction above mint's spent sync (check) limit as it becomes stuck pending
        // As well keep tokens reasonably sized so that a device can keep related transaction in the state / load it from DB
        const maxBatchSize = MAX_SWAP_INPUT_SIZE

        for (const unit of mint.units) {
            const proofsToOptimize = proofsStore.getByMint(mint.mintUrl, { isPending: false, unit })
            const totalProofsCount = proofsToOptimize.length            
            const mintBalance = mint.balances
            
            if (totalProofsCount > maxBatchSize) {
                let index = 0
                for (let i = 0; i < totalProofsCount; i += maxBatchSize) {
                    index++
                    const batch = proofsToOptimize.slice(i, i + maxBatchSize)
                    const batchAmount = CashuUtils.getProofsAmount(batch)

                    send(
                        mintBalance!,
                        batchAmount,
                        unit,
                        `Optimize ecash #${index}`,
                        batch // forces offline mode
                    )
                }
            } else {
                // If the length is less than or equal to limit, run with all proofs.
                const proofsAmount = CashuUtils.getProofsAmount(proofsToOptimize)         
                send(
                    mintBalance!,
                    proofsAmount,
                    unit,
                    `Optimize ecash`,
                    proofsToOptimize // forces offline mode
                )
            }
        }
    }
}

    


const topup = async function (
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



const revert = async function (
    transaction: Transaction
): Promise<void> {
    const now = new Date().getTime()
    SyncQueue.addPrioritizedTask(
        `revertTask-${now}`,            
        async () => await revertTask(transaction)
    )
    return
}


/*
 * Checks with all mints whether their proofs kept in pending state by the wallet have been spent.
 */
const syncPendingStateWithMints = async function (): Promise<void> {
    log.trace('[syncPendingStateWithMint] start')    
    if (mintsStore.mintCount === 0) {
        return
    }

    const isPending = true
    const maxBatchSize = MAX_SYNC_INPUT_SIZE

    // group proofs by mint so that we do max one call per mint
    for (const mint of mintsStore.allMints) {

        if(pollerExists(`syncPendingStateWithMintPoller-${mint.mintUrl}`)) {
            log.trace('[syncPendingStateWithMint] Skipping, poller exists', {mintUrl: mint.mintUrl})
            continue
        }
        
        const proofsToSync = proofsStore.getByMint(mint.mintUrl, {isPending})
        const totalProofsCount = proofsToSync.length

        if (totalProofsCount > maxBatchSize) {
            for (let i = 0; i < totalProofsCount; i += maxBatchSize) {
              const batch = proofsToSync.slice(i, i + maxBatchSize)
              syncStateWithMint({ proofsToSync: batch, mintUrl: mint.mintUrl, isPending })
            }
        } else {
            // If the length is less than or equal to 100, run syncStateWithMint with all proofs.
            syncStateWithMint({ proofsToSync, mintUrl: mint.mintUrl, isPending });
        }        
    }
}


/*
 * Recover stuck wallet if tx error caused spent proof to remain in spendable state by the wallet.
 * TODO batching
 */
const syncSpendableStateWithMints = async function (): Promise<void> {
    log.trace('[syncSpendableStateWithMint] start')
    if (mintsStore.mintCount === 0) {
        return
    }

    const isPending = false
    const maxBatchSize = MAX_SYNC_INPUT_SIZE

    // group proofs by mint so that we do max one call per mint
    // does not depend on unit, process in batches by 100
    for (const mint of mintsStore.allMints) {        
        const proofsToSync = proofsStore.getByMint(mint.mintUrl, { isPending })
        const totalProofsCount = proofsToSync.length
        
        if (totalProofsCount > maxBatchSize) {
          for (let i = 0; i < totalProofsCount; i += maxBatchSize) {
            const batch = proofsToSync.slice(i, i + maxBatchSize)
            syncStateWithMint({ proofsToSync: batch, mintUrl: mint.mintUrl, isPending })
          }
        } else {
          // If the length is less than or equal to 100, run syncStateWithMint with all proofs.
          syncStateWithMint({ proofsToSync, mintUrl: mint.mintUrl, isPending });
        }
    }

    return    
}

/*
 * Pass _syncStateWithMintTask function into synchronous queue for safe processing without race conditions on proof counters. * 
 */
const syncStateWithMint = async function (    
    options: {
        proofsToSync: Proof[],
        mintUrl: string,
        isPending: boolean
    }  
): Promise<void> {
    const {mintUrl, isPending, proofsToSync} = options
    log.trace('[syncStateWithMint] start', {mintUrl, isPending, proofsToSyncCount: proofsToSync.length})
    const now = new Date().getTime()

    return SyncQueue.addTask(
        `_syncStateWithMintTask-${now}`,            
        async () => await _syncStateWithMintTask({proofsToSync, mintUrl, isPending})
    )    
}


// Use only within another queued task!
const syncStateWithMintSync = async function (    
    options: {
        proofsToSync: Proof[],
        mintUrl: string,
        isPending: boolean
    },
    
): Promise<SyncStateTaskResult> {
    const {mintUrl, isPending, proofsToSync} = options
    
    log.trace('[syncStateWithMintSync] start', {mintUrl, isPending, proofsToSyncCount: proofsToSync.length})
    
    return await _syncStateWithMintTask({proofsToSync, mintUrl, isPending})        
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

const _syncStateWithMintTask = async function (            
    options: {  
        proofsToSync: Proof[],
        mintUrl: string,           
        isPending: boolean
    }    
): Promise<SyncStateTaskResult> {

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
            log.trace('[_syncStateWithMintTask]', message, mintUrl)

            return {
                taskFunction: '_syncStateWithMintTask',
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

        log.debug('[_syncStateWithMintTask]', `${isPending ? 'Pending' : ''} spent and pending by mint amounts`, {
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
                                log.trace('[_syncStateWithMintTask]', `Moving ${unspentProofs.length} unspent proofs from pending back to spendable.`)
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

            log.trace('[_syncStateWithMintTask]', {spentStateUpdates})

            transactionStateUpdates.push(...spentStateUpdates)

            // Update related transactions statuses
            log.debug('[_syncStateWithMintTask]', 'Transaction id(s) to complete', completedTransactionIds.toString())

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

                log.error('[_syncStateWithMintTask]', `Transaction status update error`, {spentStateUpdates})
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

                log.trace('[_syncStateWithMintTask]', {pendingStateUpdates})

                transactionStateUpdates.push(...pendingStateUpdates)

                // If we somehow found new pending by mint proofs inside spendable balance during cleanup from spent, move them to pending
                if(!isPending) {
                    // remove it from spendable proofs in the wallet
                    proofsStore.removeProofs(newPendingByMintProofs as Proof[], false) // we clean spendable balance
                    // add proofs to the pending wallet                
                    proofsStore.addProofs(newPendingByMintProofs as Proof[], true)
                }

                // Update related transactions statuses
                log.debug('[_syncStateWithMintTask]', 'Transaction id(s) to be pending', pendingTransactionIds.toString())

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
        log.trace('[_syncStateWithMintTask]', 'Remaining pendingByMintSecrets', remainingSecrets)
        
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
                log.debug('[_syncStateWithMintTask]', 'Moving proofs from pendingByMint to spendable', {secretsTobeMovedToSpendable})

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

                log.trace('[_syncStateWithMintTask]', {revertedStateUpdates})

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
            taskFunction: '_syncStateWithMintTask',
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
        log.error('[_syncStateWithMintTask]', e.name, {message: e.message, mintUrl})        
    
        if(mint && e.name === Err.MINT_ERROR && e.message.includes('network')) { 
            mint.setStatus(MintStatus.OFFLINE)                
        }        

        return {
            taskFunction: '_syncStateWithMintTask',
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


const handleInFlight = async function (): Promise<void> {
    log.trace('[handleInFlight] start')
    if (mintsStore.mintCount === 0) {
        return
    }

    for (const mint of mintsStore.allMints) {
        const now = new Date().getTime()

        SyncQueue.addTask( 
            `_handleInFlightByMintTask-${now}`,               
            async () => await _handleInFlightByMintTask(mint)               
        )               
    }

    return
}


/*
 * Recover proofs that were issued by mint, but wallet failed to receive them if swap did not complete.
 */
const _handleInFlightByMintTask = async function (mint: Mint): Promise<WalletTaskResult> {

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

    const transactionId = proofsCounter.inFlightTid!

    try {
        const seed = await walletStore.getSeed()
        if(!seed) {
            throw new Error('Missing seed')
        }
        
        log.info('[_handleInFlightByMintTask]', `Restoring from ${mint.hostname}...`)
        log.debug('[_handleInFlightByMintTask]', proofsCounter)  

                
        const { proofs } : { proofs: Proof[]} = await walletStore.restore(
            mint.mintUrl,
            seed as Uint8Array,
            {
                indexFrom: proofsCounter.inFlightFrom as number, 
                indexTo: proofsCounter.inFlightTo as number,
                keysetId: proofsCounter.keyset
            }
        )        

        if (proofs.length === 0) {
            proofsCounter.resetInFlight(transactionId)
            
            return {
                taskFunction: '_handleInFlightByMintTask',
                mintUrl,
                message: 'No proofs were recovered.',
                proofsCount: 0,
                proofsAmount: 0,
            }  as WalletTaskResult          
        }        

        const proofsByState = await walletStore.getProofsStatesFromMint(
            mint.mintUrl,            
            mint.units ? mint.units[0] : 'sat',
            proofs as Proof[]
        )

        const spentCount = proofsByState.SPENT.length        
        const pendingCount = proofsByState.PENDING.length        
        const unspentCount = proofsByState.UNSPENT.length        

        log.debug('[_handleInFlightByMintTask]', `Restored proofs`, {
            spentCount, 
            pendingCount, 
            unspentCount,            
        })

        if(unspentCount === 0) {
            const message = 'Recovered proofs are already spent.'
            log.debug('[_handleInFlightByMintTask]', message)

            proofsCounter.resetInFlight(transactionId)
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
            proofsByState.UNSPENT,
            {
                unit: proofsCounter.unit,
                transactionId,
                isPending: false
            }                           
        )

        // release the lock
        proofsCounter.resetInFlight(transactionId)

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
            status: TransactionStatus.RECOVERED,
            walletTaskResult,
            message: 'This transaction failed to receive expected funds from the mint, but the wallet suceeded to recover them.',
            createdAt: new Date(),
        }

        await transactionsStore.updateStatuses(
            [transactionId],
            TransactionStatus.RECOVERED, // has been most likely DRAFT
            JSON.stringify(transactionDataUpdate),
        )

        log.debug('[_handleInFlightByMintTask]', `Completed`, {walletTaskResult})

        return walletTaskResult

    } catch (e: any) {
        // silent
        log.error('[_handleInFlightByMintTask]', e.name, {message: e.message, mintUrl})
        // make sure we release the lock // maybe we should keep inflight in case of error to retry next time?
        proofsCounter.resetInFlight(transactionId)

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
    const mintUrl = {...pr}.mint // copy
    const unit = {...pr}.mintUnit // copy, unit of proofs to be received
    const amount = {...pr}.amountToTopup // copy, amount of proofs to be received    
    const paymentHash = {...pr}.paymentHash // copy
    const mintQuote = {...pr}.mintQuote // copy
    const mintInstance = mintsStore.findByUrl(mintUrl as string)
    const transaction = transactionsStore.findById(transactionId)
    let lockedProofsCounter: MintProofsCounter | undefined = undefined

    try {
        if(!mintInstance || !mintQuote || !unit || !amount || !transaction) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing mint, mint quote, mintUnit, amountToTopup or transaction', {mintUrl})
        }
      
        // check is quote has been paid
        const { state, mintQuote: quote } = await walletStore.checkLightningMintQuote(mintUrl!, mintQuote)

        if (quote !== mintQuote) {
            throw new AppError(Err.VALIDATION_ERROR, 'Returned quote is different then the one requested', {mintUrl, quote, mintQuote})
        }

        switch (state) {
            /* 
             * UNPAID or ISSUED 
             */         
            case MintQuoteState.UNPAID:
            case MintQuoteState.ISSUED:
                if (isBefore(pr.expiresAt as Date, new Date())) {
                    log.debug('[_handlePendingTopupTask]', `Invoice expired, removing: ${pr.paymentHash}`)
    
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
                // continue
            case MintQuoteState.UNPAID:
                log.trace('[_handlePendingTopupTask] Quote not paid', {mintUrl, mintQuote})                
    
                return {
                    taskFunction: '_handlePendingTopupTask',
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
                const proofsByMint = proofsStore.getByMint(mintUrl!, {
                    isPending: false,
                    unit
                })
        
                const walletInstance = await walletStore.getWallet(mintUrl!, unit, {withSeed: true})
        
                const keepAmounts = getKeepAmounts(
                    proofsByMint,
                    amount,
                    (await walletInstance.getKeys()).keys,
                    DEFAULT_DENOMINATION_TARGET            
                )
                        
                log.trace('[_handlePendingTopupTask]', {paymentHash, keepAmounts})
                
                // temp increase the counter + acquire lock and set inFlight values        
                lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
                    mintInstance, 
                    unit, 
                    keepAmounts.length, 
                    transactionId,
                )
        
                let proofs: CashuProof[] = []
        
                try {        
                    proofs = (await walletStore.mintProofs(
                        mintUrl as string,
                        amount,
                        unit,
                        mintQuote,
                        {
                            outputAmounts: {keepAmounts, sendAmounts: []},
                            counter: lockedProofsCounter.inFlightFrom as number
                        }
                    ))
                } catch (e: any) {
                    if(e.message.includes('outputs have already been signed before')) {
                        
                        log.error('[_handlePendingTopupTask] Increasing proofsCounter outdated values and repeating mintProofs.')
                        lockedProofsCounter.resetInFlight(transactionId)
                        lockedProofsCounter.increaseProofsCounter(10)
                        lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
                            mintInstance, 
                            unit, 
                            keepAmounts.length, 
                            transactionId
                        )
        
                        proofs = (await walletStore.mintProofs(
                            mintUrl as string,
                            amount,
                            unit,
                            mintQuote,
                            {
                                outputAmounts: {keepAmounts, sendAmounts: []},
                                counter: lockedProofsCounter.inFlightFrom as number
                            }
                        ))
                    } else {
                        throw e
                    }
                }
        
                lockedProofsCounter.decreaseProofsCounter(keepAmounts.length)        
                
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
                
                // release lock and cleanup
                lockedProofsCounter.resetInFlight(transactionId)
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
                        JSON.stringify(getSnapshot(pr.contactTo)) 
                    )
                }
                
                // Update tx with current total balance of topup unit/currency
                const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
                transaction.setBalanceAfter(balanceAfter)     
            
                _sendTopupNotification(pr)
                paymentRequestsStore.removePaymentRequest(pr)        
                
                return {
                    taskFunction: '_handlePendingTopupTask',
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
                log.trace('[_handlePendingTopupTask] Quote already issued', {mintUrl, mintQuote})            

                return {
                    taskFunction: '_handlePendingTopupTask',
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
                log.error(`[_handlePendingTopupTask] Unknown MintQuoteState`, {state})
                return {
                    taskFunction: '_handlePendingTopupTask',
                    transaction,
                    mintUrl,
                    unit,
                    amount,
                    paymentHash,                     
                    message: `Unknown MintQuoteState ${state}`,
                } as WalletTaskResult          
        }

    } catch (e: any) {
        // release lock  
        if(lockedProofsCounter) {
            lockedProofsCounter.resetInFlight(transactionId)
        }
        return {
            taskFunction: '_handlePendingTopupTask',
            mintUrl,
            unit,
            amount,
            paymentHash,
            transaction,
            error: {name: e.name, message: e.message, params: e.params || undefined},
            message: `_handlePendingTopupTask ended with error: ${e.message}`,                        
        } as TransactionTaskResult
    }

}


const handleClaim = async function (): Promise<void> {
    
    log.info('[handleClaim] start')
    const {walletId, seedHash, pubkey} = walletProfileStore
    const {isBatchClaimOn} = userSettingsStore    
    let recoveredSeedHash: string | undefined = undefined    

    // If we somehow lost walletProfile state, try to recover is from the server using the seedHash stored in KeyChain
    if(!seedHash) {
        recoveredSeedHash = await KeyChain.loadSeedHash()

        if(!recoveredSeedHash) {
            throw new AppError(Err.VALIDATION_ERROR, 'Wallet data were damaged, please reinstall wallet.')
        }
    }

    if(!walletId || !pubkey) {
        // recover profile from the server       
        const profile = await MinibitsClient.getWalletProfileBySeedHash(seedHash || recoveredSeedHash!)

        if(profile) {
            walletProfileStore.hydrate(profile)
        }
    }

    // Based on user setting, ask for batched token if more then 5 payments are waiting to be claimed
    const claimedTokens = await MinibitsClient.createClaim(
        walletProfileStore.walletId,
        walletProfileStore.seedHash as string, 
        walletProfileStore.pubkey,
        isBatchClaimOn ? 5 : undefined
    )

    if(claimedTokens.length === 0) {
        log.debug('[handleClaim] No claimed invoices returned from the server...')
        return
    }
    
    log.debug(`[handleClaim] Claimed ${claimedTokens.length} tokens from the server...`)    

    for(const claimedToken of claimedTokens) {
        const now = new Date().getTime()

        SyncQueue.addTask( 
            `_handleClaimTask-${now}`,               
            async () => await _handleClaimTask({claimedToken})               
        )               
    }        
    return
}


const _handleClaimTask = async function (params: {
    claimedToken: {
        token: string, 
        zapSenderProfile?: string,
        zapRequest?: string,
    }}) {
    let decoded: Token | undefined = undefined

    try {
        const {claimedToken} = params
        
        log.debug('[_handleClaimTask] claimed token', {claimedToken})

        if(!claimedToken.token) {
            throw new AppError(Err.VALIDATION_ERROR, '[_handleClaimTask] Missing encodedToken to receive.')
        }

        const encryptedToken = claimedToken.token
        const encodedToken = await NostrClient.decryptNip04(MINIBIT_SERVER_NOSTR_PUBKEY, encryptedToken)

        log.debug('[_handleClaimTask] decrypted token', {encodedToken})

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
            taskFunction: '_handleClaimTask',
            message: result.error ? result.error.message : 'Ecash sent to your lightning address has been received.',
            error: result.error || undefined,
            proofsCount: decoded.proofs.length,
            proofsAmount: result.transaction?.amount,
        } as WalletTaskResult
        
    } catch (e: any) {
        log.error(e.name, e.message)

        return {
            mintUrl: decoded ? decoded.mint : '',            
            taskFunction: '_handleClaimTask',            
            message: e.message,
            error: WalletUtils.formatError(e),
        } as WalletTaskResult
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
                    `_handleReceivedEventTask-${now}`,          
                    async () => await _handleReceivedEventTask(event)                
                )
            },
            oneose() {
                log.trace('[receiveEventsFromRelays]', `Eose: Got ${eventsBatch.length} receive events`)
                
                const connections = pool.listConnectionStatus()                
                for (const conn of connections) {
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

const _handleReceivedEventTask = async function (encryptedEvent: NostrEvent): Promise<WalletTaskResult> {    
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

        log.trace('[_handleReceivedEventTask]', 'Received event', {directMessageEvent})
        
        // get sender profile and save it as a contact
        // this is not valid for events sent from LNURL bridge, that are sent and signed by a minibits server key
        // and *** do not contain sentFrom *** // LEGACY, replaced by claim api
        let sentFromPubkey = directMessageEvent.pubkey
        let sentFrom = NostrClient.getFirstTagValue(directMessageEvent.tags, 'from')
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
                    log.warn('[_handleReceivedEventTask]', 'Could not get sender from zapRequest', {message: e.message, maybeZapSenderString})
                }
            }
        }

        // parse incoming message
        const incoming = IncomingParser.findAndExtract(decryptedMessage)

        log.trace('[_handleReceivedEventTask]', 'Incoming data', {incoming})

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
                taskFunction: '_handleReceivedEventTask',
                message: 'Incoming ecash token has been received.',
                proofsCount: decoded.proofs.length,
                proofsAmount: receivedAmount,
                notificationInputs: {
                    event: directMessageEvent,
                    decrypted: decryptedMessage,
                    transaction,
                    receivedAmount
                } // not used`
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
                taskFunction: '_handleReceivedEventTask',
                message: 'Incoming payment request been received.',
                proofsCount: 0,
                proofsAmount: amount,
                paymentRequest            
            } as WalletTaskResult
        }
        else if(incoming.type === IncomingDataType.CASHU_PAYMENT_REQUEST) {
            throw new AppError(Err.NOTFOUND_ERROR, 'CASHU_PAYMENT_REQUEST support is not yet implemented.', {caller: '_handleReceivedEventTask'})
        }            
        else if (incoming.type === IncomingDataType.LNURL) {
            throw new AppError(Err.NOTFOUND_ERROR, 'LNURL support is not yet implemented.', {caller: '_handleReceivedEventTask'})
        } else {
            throw new AppError(Err.NOTFOUND_ERROR, 'Received unknown message', incoming)
        }
    } catch (e: any) {
        log.error('[_handleReceivedEventTask]', e.name, e.message)

        return {
            mintUrl: '',
            taskFunction: '_handleReceivedEventTask',
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
    
    const enabled = await NotificationService.areNotificationsEnabled()
    if(!enabled) {
        return
    }

    //
    // Send notification event
    //
    const currencyCode = getCurrency(unit).code
    if(receivedAmount && receivedAmount > 0) {
        await NotificationService.createLocalNotification(
            `<b>⚡${formatCurrency(receivedAmount, currencyCode)} ${currencyCode}</b> received!`,
            `${isZap ? 'Zap' : 'Ecash'} from <b>${sentFrom || 'unknown payer'}</b> is now in your wallet.`,
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
    syncPendingStateWithMints,
    syncSpendableStateWithMints,
    syncStateWithMint,
    syncStateWithMintSync,    
    handleInFlight,    
    handlePendingTopups,
    handlePendingTopup,
    handleClaim,
    receiveEventsFromRelays,
    receive,
    receiveBatch,
    receiveOfflinePrepare,
    receiveOfflineComplete,        
    send,
    sendAll,
    transfer,      
    topup,
    revert
}