import {isBefore} from 'date-fns'
import {getSnapshot} from 'mobx-state-tree'
import {log} from './logService'
import {Proof} from '../models/Proof'
import {
  Transaction,
  TransactionStatus
} from '../models/Transaction'
import {rootStoreInstance} from '../models'
import {CashuUtils, ProofV3, TokenV3} from './cashu/cashuUtils'
import {LightningUtils} from './lightning/lightningUtils'
import AppError, {Err} from '../utils/AppError'
import {MintBalance, MintProofsCounter, MintStatus} from '../models/Mint'
import {MeltQuoteResponse, MintQuoteState} from '@cashu/cashu-ts'
import {Mint} from '../models/Mint'
import {pollerExists, stopPolling} from '../utils/poller'
import EventEmitter from '../utils/eventEmitter'
import { NostrClient, NostrEvent, NostrProfile } from './nostrService'
import { MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST, MINIBIT_SERVER_NOSTR_PUBKEY } from '@env'
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
import { MintUnit, formatCurrency, getCurrency } from './wallet/currency'
import { MinibitsClient } from './minibitsService'


type WalletTaskService = {
    syncPendingStateWithMints: ()   => Promise<void>
    syncSpendableStateWithMints: () => Promise<void>
    syncStateWithMint: (
        options: {
            mintUrl: string, 
            isPending: boolean
        }
    ) => Promise<void>
    syncStateWithMintSync: (
        options: {
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
        token: TokenV3,
        amountToReceive: number,
        memo: string,
        encodedToken: string,
    ) => Promise<void>
    receiveOfflinePrepare: (
        token: TokenV3,
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
    topup: (
        mintBalanceToTopup: MintBalance,
        amountToTopup: number,
        unit: MintUnit,
        memo: string,
        contactToSendTo?: Contact,
        nwcEvent?: NostrEvent
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
    lightningFeePaid?: number
    mintFeePaid?: number
    meltQuote?: MeltQuoteResponse
    nwcEvent?: NostrEvent
}


export interface TransactionStateUpdate {    
    tId: number
    amount?: number
    spentByMintAmount?: number
    pendingByMintAmount?: number
    movedToSpendableAmount?: number,
    updatedStatus: TransactionStatus    
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
    token?: TokenV3
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
    token: TokenV3,
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
    token: TokenV3,
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


/*
 * Checks with all mints whether their proofs kept in pending state by the wallet have been spent.
 */
const syncPendingStateWithMints = async function (): Promise<void> {
    log.trace('[syncPendingStateWithMint] start')    
    if (mintsStore.mintCount === 0) {
        return
    }

    // group proofs by mint so that we do max one call per mint
    for (const mint of mintsStore.allMints) {

        if(pollerExists(`syncPendingStateWithMintPoller-${mint.mintUrl}`)) {
            log.trace('[syncPendingStateWithMint] Skipping, poller exists', {mintUrl: mint.mintUrl})
            continue
        }        
              
        syncStateWithMint({mintUrl: mint.mintUrl, isPending: true}) // isPending = true
    }
}


/*
 * Recover stuck wallet if tx error caused spent proof to remain in spendable state by the wallet.
 */
const syncSpendableStateWithMints = async function (): Promise<void> {
    log.trace('[syncSpendableStateWithMint] start')
    if (mintsStore.mintCount === 0) {
        return
    }

    // group proofs by mint so that we do max one call per mint
    // does not depend on unit
    for (const mint of mintsStore.allMints) {        
        syncStateWithMint({mintUrl: mint.mintUrl, isPending: false})
    }

    return    
}

/*
 * Pass _syncStateWithMintTask function into synchronous queue for safe processing without race conditions on proof counters.
 */
const syncStateWithMint = async function (
    options: {
        mintUrl: string,
        isPending: boolean
    }  
): Promise<void> {
    const {mintUrl, isPending} = options
    log.trace('[syncStateWithMint] start', {mintUrl, isPending})
    const now = new Date().getTime()

    return SyncQueue.addTask(
        `_syncStateWithMintTask-${now}`,            
        async () => await _syncStateWithMintTask({mintUrl, isPending})
    )    
}


// Use only within another queued task!
const syncStateWithMintSync = async function (
    options: {
        mintUrl: string,
        isPending: boolean
    }  
): Promise<SyncStateTaskResult> {
    const {mintUrl, isPending} = options
    log.trace('[syncStateWithMintSync] start', {mintUrl, isPending})
    
    return await _syncStateWithMintTask({mintUrl, isPending})        
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
 *  @isPending whether to work on proofs in spendable or pending state by the wallet
 *  @returns WalletTaskResult
 */

const _syncStateWithMintTask = async function (    
    options: {  
        mintUrl: string,           
        isPending: boolean
    }): Promise<SyncStateTaskResult> {

    const transactionStateUpdates: TransactionStateUpdate[] = []
    const completedTransactionIds: number[] = []
    const errorTransactionIds: number[] = []
    const pendingTransactionIds: number[] = []
    const revertedTransactionIds: number[] = []

    const {mintUrl, isPending} = options
    const mint = mintsStore.findByUrl(mintUrl as string)

    try {
    
        // select either spendable or pending proofs by the wallet
        // all units      
        const proofsFromMint = proofsStore.getByMint(mintUrl, {isPending})

        if (proofsFromMint.length === 0) {
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

        const {
            spent: spentByMintProofs, 
            pending: pendingByMintProofs
        } = await walletStore.getSpentOrPendingProofsFromMint(
            mintUrl,            
            mint && mint.units ? mint.units[0] : 'sat', // likely not to be unit-dependent
            proofsFromMint
        )
    
        if(mint) { 
            mint.setStatus(MintStatus.ONLINE)                
        }
       
        const spentByMintAmount = CashuUtils.getProofsAmount(spentByMintProofs as Proof[])
        const pendingByMintAmount = CashuUtils.getProofsAmount(pendingByMintProofs as Proof[])        
        
        log.trace('[_syncStateWithMintTask]', `${isPending ? 'Pending' : ''} spent and pending by mint amounts`, {
            spentByMintAmount, 
            pendingByMintAmount, 
            isPending
        })

        // 1. Complete transactions with their proofs becoming spent by mint
        if (spentByMintProofs.length  > 0) {
            
            // Clean pendingByMint secrets from state if proofs came back as spent by mint            
            if(proofsStore.pendingByMintSecrets.length > 0) {
                const spentByMintSecrets = new Set(spentByMintProofs.map(proof => proof.secret))
                const tobeRemoved =  proofsStore.pendingByMintSecrets.filter(secret => spentByMintSecrets.has(secret))

                if(tobeRemoved.length > 0) {                    
                    proofsStore.removeManyFromPendingByMint(tobeRemoved)
                }                
            }

            // Map to track spent amounts by transaction ID
            const transactionStateMap: { [key: number]: number } = {}  

            for (const spent of spentByMintProofs) {
                // Find the matching proof in the MST state by the secret
                const spentProof = proofsStore.getBySecret(spent.secret, isPending)
                
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
            const spentStateUpdates = Object.entries(transactionStateMap).map(([tId, spentByMintAmount]) => {
                // fix: make sure whole amount is spent before completing the transnaction                 
                const tx = transactionsStore.findById(Number(tId))                

                if (tx) {
                    // spent amount does not cover matched tx amount 
                    // means that some spent proofs were used as inputs into the send
                    if(spentByMintAmount < tx.amount) {

                        errorTransactionIds.push(Number(tId))

                        return {
                            tId: Number(tId),
                            amount: tx.amount,
                            spentByMintAmount: spentByMintAmount as number,
                            updatedStatus: TransactionStatus.ERROR
                        } as TransactionStateUpdate

                    } else {

                        completedTransactionIds.push(Number(tId))

                        return {
                            tId: Number(tId),
                            amount: tx.amount,
                            spentByMintAmount: spentByMintAmount as number,
                            updatedStatus: TransactionStatus.COMPLETED
                        } as TransactionStateUpdate
                    }
                }

                return {
                    tId: Number(tId),
                    updatedStatus: TransactionStatus.ERROR
                } as TransactionStateUpdate
            })

            log.trace('[_syncStateWithMintTask]', {spentStateUpdates})

            transactionStateUpdates.push(...spentStateUpdates)

            // Remove spent proofs model instances
            proofsStore.removeProofs(spentByMintProofs as Proof[], isPending)

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
        if (pendingByMintProofs.length > 0) {

            // To prevent multiple pending status updates we select only those
            // pending by mint proofs that the wallet does not track yet
            const newPendingByMintProofs = pendingByMintProofs.filter(
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
                    // Find the matching proof in the MST state by the secret
                    const pendingProof = proofsStore.getBySecret(pending.secret, true) // only pending
                    
                    if (pendingProof) {
                        // Get the transaction ID (tId) from the matching proof
                        const tId = pendingProof.tId
                        
                        // Add the tId to the list of transactions to complete
                        if(!pendingTransactionIds.includes(tId)) {
                            pendingTransactionIds.push(tId)
                        }                   

                        // Accumulate the spent amount for this transaction ID
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

                // If we somehow found pending proofs inside spendable balance during cleanup from spent, move them to pending
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

            if(pendingByMintProofs.length > 0) {
                // Filter remainingSecrets to get those that do not exist in pendingByMintProofs
                const pendingByMintSecrets = new Set(pendingByMintProofs.map(proof => proof.secret))
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
    
        if(mint && e.name === Err.MINT_ERROR && e.message.includes('netowrk')) { 
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
 * Recover proofs that were issued by mint, but wallet failed to receive them if split did not complete.
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

                
        const { proofs } = await walletStore.restore(
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

        const {spent, pending} = await walletStore.getSpentOrPendingProofsFromMint(
            mint.mintUrl,            
            mint.units ? mint.units[0] : 'sat',
            proofs as Proof[]
        )

        const spentCount = spent.length        
        const pendingCount = pending.length
        
        const spentAmount = CashuUtils.getProofsAmount(spent as Proof[])
        const pendingAmount = CashuUtils.getProofsAmount(pending as Proof[])

        const unspent = proofs.filter((proof: Proof) => !spent.includes(proof))
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
            unspent,
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
            status: TransactionStatus.COMPLETED,
            walletTaskResult,
            message: 'This transaction failed to receive expected funds from the mint, but the wallet suceeded to recover them.',
            createdAt: new Date(),
        }

        await transactionsStore.updateStatuses(
            [transactionId],
            TransactionStatus.COMPLETED, // has been most likely DRAFT
            JSON.stringify(transactionDataUpdate),
        )

        log.debug('[_handleInFlightByMintTask]', `Completed`, {walletTaskResult})

        return walletTaskResult

    } catch (e: any) {
        // silent
        log.error('[_handleInFlightByMintTask]', e.name, {message: e.message, mintUrl})
        // make sure we release the lock
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
        
        const amountPreferences = getDefaultAmountPreference(amount)        
        const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences)
        
        log.trace('[_handlePendingTopupTask]', 'paymentHash', paymentHash)
        log.trace('[_handlePendingTopupTask]', 'amountPreferences', amountPreferences)
        log.trace('[_handlePendingTopupTask]', 'countOfInFlightProofs', countOfInFlightProofs)
        
        // check is quote has been paid
        const { state, mintQuote: quote } = await walletStore.checkLightningMintQuote(mintUrl!, mintQuote)

        if (quote !== mintQuote) {
            throw new AppError(Err.VALIDATION_ERROR, 'Returned quote is different then the one requested', {mintUrl, quote, mintQuote})
        }

        if (state !== MintQuoteState.PAID) {
            log.trace('[_handlePendingTopupTask] Quote not paid', {mintUrl, mintQuote})

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

            return {
                taskFunction: '_handlePendingTopupTask',
                transaction,
                mintUrl,
                unit,
                amount,
                paymentHash,                     
                message: `Quote ${mintQuote} has not yet been paid`,
            } as WalletTaskResult
        }
        
        // temp increase the counter + acquire lock and set inFlight values        
        lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
            mintInstance, 
            unit, 
            countOfInFlightProofs, 
            transactionId,
        )

        let proofs: ProofV3[] = []
        
        proofs = (await walletStore.mintProofs(
            mintUrl as string,
            amount,
            unit,
            mintQuote,
            {
              preference: amountPreferences,
              counter: lockedProofsCounter.inFlightFrom as number
            }
        )) as ProofV3[] 

        lockedProofsCounter.decreaseProofsCounter(countOfInFlightProofs)        
        
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
    let recoveredWalletId: string | null = null

    if(!seedHash || !pubkey) {
        throw new AppError(
            Err.VALIDATION_ERROR, 
            'Skipping claim of ecash received to your lightning address, missing profile data. Reinstall wallet to fix it.', 
            {walletId, seedHash, pubkey}
        )
    }

    if(!walletId) {
        // fix immediately in case only walletId missing in walletProfile
        const profile = await MinibitsClient.getWalletProfileBySeedHash(seedHash)

        if(profile) {
            recoveredWalletId = profile.walletId
            walletProfileStore.setWalletId(recoveredWalletId)
        }
    }

    // Based on user setting, ask for batched token if more then 5 payments are waiting to be claimed
    const claimedTokens = await MinibitsClient.createClaim(
        walletId || recoveredWalletId as string,
        seedHash, 
        pubkey,
        isBatchClaimOn ? 5 : undefined
    )

    if(claimedTokens.length === 0) {
        log.debug('[handleClaim] No claimed invoices returned from the server...')
        return
    } else {
        log.debug(`[handleClaim] Claimed ${claimedTokens.length} tokens from the server...`)
    }

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
    let decoded: TokenV3 | undefined = undefined

    try {
        const {claimedToken} = params
        
        log.debug('[_handleClaimTask] claimed token', {claimedToken})

        if(!claimedToken.token) {
            throw new AppError(Err.VALIDATION_ERROR, '[_handleClaimTask] Missing encodedToken to receive.')
        }

        const encryptedToken = claimedToken.token
        const encodedToken = await NostrClient.decryptNip04(MINIBIT_SERVER_NOSTR_PUBKEY, encryptedToken)

        log.debug('[_handleClaimTask] decrypted token', {encodedToken})

        decoded = CashuUtils.decodeToken(encodedToken)
        const amountToReceive = CashuUtils.getTokenAmounts(decoded).totalAmount
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
            mintUrl: decoded.token[0].mint,
            taskFunction: '_handleClaimTask',
            message: 'Ecash sent to your lightning address has been received.',
            proofsCount: decoded.token[0].proofs.length,
            proofsAmount: result.transaction?.amount,
        } as WalletTaskResult
    } catch (e: any) {
        log.error(e.name, e.message)

        return {
            mintUrl: decoded ? decoded.token[0].mint : '',            
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
    log.trace('[receiveEventsFromRelays] start')

    if(!walletProfileStore.pubkey) {
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
    // and *** do not contain sentFrom *** // LEGACY, replaced by claim api
    let sentFromPubkey = event.pubkey
    let sentFrom = NostrClient.getFirstTagValue(event.tags, 'from')
    let sentFromNpub = NostrClient.getNpubkey(sentFromPubkey)
    let contactFrom: Contact | undefined = undefined
    let zapSenderProfile: NostrProfile | undefined = undefined 
    let sentFromPicture: string | undefined = undefined          

    // add ecash sender to the contacts
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
        const maybeZapSenderString = _extractZapSenderData(decrypted)

        if(maybeZapSenderString) {
            try {
                zapSenderProfile = JSON.parse(maybeZapSenderString)            

                if(zapSenderProfile) {
                    sentFromPubkey = zapSenderProfile.pubkey // zap sender pubkey                
                    sentFrom = zapSenderProfile.nip05 ?? zapSenderProfile.name                
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
    }

    // parse incoming message
    const incoming = IncomingParser.findAndExtract(decrypted)

    log.trace('[_handleReceivedEventTask]', 'Incoming data', {incoming})

    //
    // Receive token start
    //
    if(incoming.type === IncomingDataType.CASHU) {

        const decoded = CashuUtils.decodeToken(incoming.encoded)
        const amountToReceive = CashuUtils.getTokenAmounts(decoded).totalAmount        
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
            } // not used`
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
    receiveOfflinePrepare,
    receiveOfflineComplete,        
    send,
    transfer,    
    topup,
}
