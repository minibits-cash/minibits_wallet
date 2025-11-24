import {addSeconds, isBefore} from 'date-fns'
import {getSnapshot} from 'mobx-state-tree'
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
import { MINIBITS_NIP05_DOMAIN, MINIBIT_SERVER_NOSTR_PUBKEY } from '@env'
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
import { CurrencyCode, MintUnit, MintUnitCurrencyPairs, MintUnits, formatCurrency, getCurrency } from './wallet/currency'
import { MinibitsClient } from './minibitsService'
import { UnsignedEvent } from 'nostr-tools'
import { Platform } from 'react-native'
import { cashuPaymentRequestTask } from './wallet/cashuPaymentRequestTask'
import { decodePaymentRequest, sumBlindSignatures } from '@cashu/cashu-ts/src/utils'



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
    handlePendingQueue: ()   => Promise<void>
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
        nwcEvent?: NostrEvent,
        draftTransactionId?: number
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
        p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> },
        draftTransactionId?: number
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


const {
    userSettingsStore,
    walletProfileStore,
    mintsStore,
    proofsStore,
    transactionsStore,    
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
    nwcEvent?: NostrEvent,
    draftTransactionId?: number
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
            nwcEvent,
            draftTransactionId
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
    p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> },
    draftTransactionId?: number
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
            p2pk,
            draftTransactionId  
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
    const maxBatchSize = 2
    
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

                    // sync pending proofs state (from pending to spent) from current round send so that there is not big pile of pending at the end 
                    // that makes wallet freeze on next startup
                    await syncStateWithMintTask({proofsToSync: batch, mintUrl: mint.mintUrl, isPending: true})

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

  

/**
 * Sync wallet proof state with mint reality (SPENT / PENDING / UNSPENT)
 * Used both for pending proof resolution and recovery of broken wallet state.
 */
const syncStateWithMintTask = async function (
    options: {
      proofsToSync: Proof[]
      mintUrl: string
      isPending: boolean
    }
  ): Promise<SyncStateTaskResult> {
    const { proofsToSync, mintUrl, isPending } = options
    const mint = mintsStore.findByUrl(mintUrl)
  
    log.trace('[syncStateWithMintTask] start', { mintUrl, proofCount: proofsToSync.length, isPending })
  
    // Result accumulators
    const transactionStateUpdates: TransactionStateUpdate[] = []
    const completedTxIds: number[] = []
    const errorTxIds: number[] = []
    const pendingTxIds: number[] = []
    const revertedTxIds: number[] = []
  
    try {
      if (proofsToSync.length === 0) {
        const message = `No ${isPending ? 'pending ' : ''}proofs to sync with mint`
        log.trace('[syncStateWithMintTask]', message)
        return { 
            taskFunction: SYNC_STATE_WITH_MINT_TASK, 
            mintUrl, 
            message, 
            transactionStateUpdates, 
            completedTransactionIds: [], 
            errorTransactionIds: [], 
            revertedTransactionIds: [] 
        }
      }
  
      // 1. Ask mint what it thinks about these proofs
      const statesFromMint = await walletStore.getProofsStatesFromMint(
        mintUrl,
        mint?.units?.[0] ?? 'sat',
        proofsToSync
      )
  
      if (mint) mint.setStatus(MintStatus.ONLINE)
  
      const byMintState = {
        SPENT: statesFromMint.SPENT.map(p => p.secret),
        PENDING: statesFromMint.PENDING.map(p => p.secret),
        UNSPENT: statesFromMint.UNSPENT.map(p => p.secret),
      }
  
      const secrets = {
        spent: new Set(byMintState.SPENT),
        pending: new Set(byMintState.PENDING),
        unspent: new Set(byMintState.UNSPENT),
      }
  
      log.debug('[syncStateWithMintTask] Mint state', {
        spent: secrets.spent.size,
        pending: secrets.pending.size,
        unspent: secrets.unspent.size,
        isPending,
      })
  
      // Helper: group proofs by tId and compute total amount
      const groupByTId = (proofs: Proof[]) => {
        const map = new Map<number, { proofs: Proof[]; amount: number }>()
        for (const p of proofs) {
          if (!p.tId) continue
          const entry = map.get(p.tId) ?? { proofs: [], amount: 0 }
          entry.proofs.push(p)
          entry.amount += p.amount
          map.set(p.tId, entry)
        }
        return map
      }
  
      // ─────────────────────────────────────────────────────────────
      // 1. Proofs now SPENT at mint → transaction succeeded
      // ─────────────────────────────────────────────────────────────
      if (secrets.spent.size > 0) {
        const spentProofs = proofsToSync.filter(p => secrets.spent.has(p.secret))        

        proofsStore.moveToSpent(spentProofs) // sets isSpent = true, isPending = false + clean if they were in pendingByMintSecrets
    
        const spentByTx = groupByTId(spentProofs)
  
        for (const [tId, { amount: spentAmount }] of spentByTx) {
          const tx = transactionsStore.findById(tId)
          if (!tx) {
            errorTxIds.push(tId)
            transactionStateUpdates.push({
              tId,
              updatedStatus: TransactionStatus.ERROR,
              message: 'Transaction not found in DB',
            })
            continue
          }
  
          if (spentAmount < tx.amount) {
            // Partial spend → some proofs reused in another pending op → error
            errorTxIds.push(tId)
            transactionStateUpdates.push({
              tId,
              amount: tx.amount,
              spentByMintAmount: spentAmount,
              updatedStatus: TransactionStatus.ERROR,
              message: 'Partial spend detected – proofs reused',
            })
  
            // If we were checking pending proofs, move unspent ones back
            if (isPending) {
              const stillUnspent = proofsToSync.filter(p => secrets.unspent.has(p.secret))
              proofsStore.revertToSpendable(stillUnspent)
            }
          } else if (tx.status !== TransactionStatus.REVERTED) {
            // Full success
            completedTxIds.push(tId)
            const update: TransactionStateUpdate = {
              tId,
              amount: tx.amount,
              spentByMintAmount: spentAmount,
              updatedStatus: TransactionStatus.COMPLETED,
            }
            if (tx.type === TransactionType.TRANSFER && tx.quote) {
              update.meltQuoteToRecover = tx.quote
            }
            transactionStateUpdates.push(update)
          }
        }
  
        // Recover change from completed melts
        for (const update of transactionStateUpdates) {
          if (update.meltQuoteToRecover) {
            const { recoveredAmount } = await recoverMeltQuoteChange({
              mintUrl,
              meltQuote: update.meltQuoteToRecover,
            })
            update.recoveredChangeAmount = recoveredAmount
          }
        }
  
        // Persist transaction status changes
        if (completedTxIds.length > 0) {
          await transactionsStore.updateStatuses(
            completedTxIds,
            TransactionStatus.COMPLETED,
            JSON.stringify({ 
                status: TransactionStatus.COMPLETED, 
                spentStateUpdates: transactionStateUpdates.filter(u => completedTxIds.includes(u.tId)), createdAt: new Date() 
            })
          )
          stopPolling(`syncStateWithMintPoller-${mintUrl}`)
        }
        if (errorTxIds.length > 0) {
          await transactionsStore.updateStatuses(
            errorTxIds,
            TransactionStatus.ERROR,
            JSON.stringify({ 
                status: TransactionStatus.ERROR, 
                spentStateUpdates: transactionStateUpdates.filter(u => errorTxIds.includes(u.tId)), createdAt: new Date() 
            })
          )
          stopPolling(`syncStateWithMintPoller-${mintUrl}`)
        }
      }
  
      // ─────────────────────────────────────────────────────────────
      // 2. Proofs still PENDING at mint → keep pending in wallet
      // ─────────────────────────────────────────────────────────────
      if (secrets.pending.size > 0) {
        const newPendingProofs = proofsToSync.filter(p => secrets.pending.has(p.secret) && !proofsStore.pendingByMintSecrets.includes(p.secret))
  
        if (newPendingProofs.length > 0) {
          proofsStore.registerAsPendingAtMint(newPendingProofs)
          const pendingByTx = groupByTId(newPendingProofs)

          for (const [tId, { amount: pendingAmount }] of pendingByTx) {
            if (!pendingTxIds.includes(tId)) pendingTxIds.push(tId)
              transactionStateUpdates.push({
                  tId,
                  pendingByMintAmount: pendingAmount,
                  updatedStatus: TransactionStatus.PENDING,
              })
          }
  
          // If we discovered pending proofs in spendable balance (recovery mode), move them
          if (!isPending) {
            proofsStore.moveToPending(newPendingProofs)
          }
  
          if (pendingTxIds.length > 0) {
            await transactionsStore.updateStatuses(
              pendingTxIds,
              TransactionStatus.PENDING,
              JSON.stringify({
                message: 'Waiting for a payment to settle',
                pendingStateUpdates: transactionStateUpdates.filter(u => u.updatedStatus === TransactionStatus.PENDING),
                createdAt: new Date(),
              })
            )
          }
        }
      }
  
      // ─────────────────────────────────────────────────────────────
      // 3. Proofs no longer pending at mint → lightning failed → revert
      // ─────────────────────────────────────────────────────────────
      const noLongerPendingSecrets = proofsStore.pendingByMintSecrets.filter(
        s => !secrets.pending.has(s)
      )
  
      if (noLongerPendingSecrets.length > 0) {
        const revertedProofs: Proof[] = []
        const revertedByTx = new Map<number, number>()
  
        for (const secret of noLongerPendingSecrets) {
          const proof = proofsStore.getBySecret(secret)
          if (!proof || !proof.tId) continue
  
          revertedProofs.push(proof)
          revertedByTx.set(proof.tId, (revertedByTx.get(proof.tId) ?? 0) + proof.amount)
          if (!revertedTxIds.includes(proof.tId)) revertedTxIds.push(proof.tId)
        }
  
        if (revertedProofs.length > 0) {
          proofsStore.revertToSpendable(revertedProofs)
          proofsStore.unregisterFromPendingAtMint(new Set(noLongerPendingSecrets))
  
          for (const [tId, amount] of revertedByTx) {
            transactionStateUpdates.push({
              tId,
              movedToSpendableAmount: amount,
              updatedStatus: TransactionStatus.REVERTED,
            })
          }
  
          if (revertedTxIds.length > 0) {
            await transactionsStore.updateStatuses(
              revertedTxIds,
              TransactionStatus.REVERTED,
              JSON.stringify({
                message: 'Lightning payment failed – ecash returned to spendable balance',
                revertedStateUpdates: transactionStateUpdates.filter(u => u.updatedStatus === TransactionStatus.REVERTED),
                createdAt: new Date(),
              })
            )
          }
        }
      }
  
      // ─────────────────────────────────────────────────────────────
      // Final success result
      // ─────────────────────────────────────────────────────────────
      return {
        taskFunction: SYNC_STATE_WITH_MINT_TASK,
        mintUrl,
        message: `Sync completed for ${proofsToSync.length} ${isPending ? 'pending ' : ''}proofs`,
        transactionStateUpdates,
        completedTransactionIds: completedTxIds,
        errorTransactionIds: errorTxIds,
        pendingTransactionIds: pendingTxIds,
        revertedTransactionIds: revertedTxIds,
      }
    } catch (e: any) {
      log.error('[syncStateWithMintTask] failed', { mintUrl, error: e.message })
  
      if (mint && e.name === Err.MINT_ERROR && e.message.includes('network')) {
        mint.setStatus(MintStatus.OFFLINE)
      }
  
      return {
        taskFunction: SYNC_STATE_WITH_MINT_TASK,
        mintUrl,
        message: `Sync failed: ${e.message}`,
        error: e,
        transactionStateUpdates,
        completedTransactionIds: completedTxIds,
        errorTransactionIds: errorTxIds,
        pendingTransactionIds: pendingTxIds,
        revertedTransactionIds: revertedTxIds,
      }
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


/**
 * Recover proofs from in-flight mint/swap requests that failed due to network issues.
 * Uses mint's idempotent endpoints to safely retry and complete pending operations.
 */
const handleInFlightByMintTask = async (mint: Mint): Promise<WalletTaskResult> => {
    const mintUrl = mint.mintUrl
    const countersWithInFlight = mint.proofsCountersWithInFlightRequests || []
  
    log.trace('[handleInFlightByMintTask] start', {
      mintUrl,
      counters: countersWithInFlight?.length,
      totalRequests: mint.allInFlightRequests?.length ?? 0,
    })
  
    if (countersWithInFlight.length === 0) {
      return {
        taskFunction: HANDLE_INFLIGHT_BY_MINT_TASK,
        mintUrl,
        message: 'No in-flight requests found',
      }
    }
  
    const errors: string[] = []
  
    for (const counter of countersWithInFlight) {
      for (const inFlight of [...counter.inFlightRequests]) { // clone to allow safe removal
        const tx = transactionsStore.findById(inFlight.transactionId)
        if (!tx) {
          counter.removeInFlightRequest(inFlight.transactionId)
          continue
        }
  
        let txData: TransactionData[] = []
        try {
          txData = tx.data ? JSON.parse(tx.data) : []
        } catch (e) {
          log.warn('Failed to parse transaction.data', { tId: tx.id })
        }
  
        const { unit } = tx
  
        try {
          switch (tx.type) {
            // ─── RECEIVE (token receive retry) ─────────────────────
            case TransactionType.RECEIVE: {
              const { proofs, swapFeePaid } = await walletStore.receive(
                mintUrl,
                unit,
                inFlight.request.token,
                tx.id,
                { inFlightRequest: inFlight }
              )
  
              const { updatedAmount: receivedAmount } = proofsStore.addOrUpdate(proofs, {
                mintUrl,
                tId: tx.id,
                unit,
                isPending: false,
                isSpent: false,
              })

  
              const outputToken = getEncodedToken({ mint: mintUrl, proofs, unit })
              const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance
  
              txData.push({ status: TransactionStatus.COMPLETED, receivedAmount, swapFeePaid, createdAt: new Date() })
  
              tx.update({
                amount: receivedAmount,
                status: TransactionStatus.COMPLETED,
                data: JSON.stringify(txData),
                outputToken,
                balanceAfter,
                fee: swapFeePaid > 0 ? swapFeePaid : tx.fee,
              })
  
              break
            }
  
            // ─── SEND (ecash send retry) ───────────────────────────
            case TransactionType.SEND: {
              const { returnedProofs, proofsToSend, swapFeePaid } = await walletStore.send(
                mintUrl,
                inFlight.request.amount,
                unit,
                inFlight.request.proofs,
                tx.id,
                { inFlightRequest: inFlight }
              )
  
              // Mark inputs as spent
              proofsStore.addOrUpdate(inFlight.request.proofs, {
                mintUrl,
                tId: tx.id,
                unit,
                isPending: false,
                isSpent: true,
              })
  
              // Add change + outgoing proofs
              proofsStore.addOrUpdate(returnedProofs, { mintUrl, tId: tx.id, unit, isPending: false, isSpent: false })
              proofsStore.addOrUpdate(proofsToSend, { mintUrl, tId: tx.id, unit, isPending: true, isSpent: false })
  
              const outputToken = getEncodedToken({ mint: mintUrl, proofs: proofsToSend, unit })
              const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance
  
              txData.push({ status: TransactionStatus.PENDING, createdAt: new Date() })
  
              tx.update({
                status: TransactionStatus.PENDING,
                data: JSON.stringify(txData),
                outputToken,
                balanceAfter,
                fee: swapFeePaid > 0 ? swapFeePaid : tx.fee,
              })
  
              break
            }
  
            // ─── TOPUP (minting retry) ─────────────────────────────
            case TransactionType.TOPUP: {
              const proofs = await walletStore.mintProofs(
                mintUrl,
                inFlight.request.amount,
                unit,
                inFlight.request.quote,
                tx.id,
                { inFlightRequest: inFlight }
              )
  
              proofsStore.addOrUpdate(proofs, {
                mintUrl,
                tId: tx.id,
                unit,
                isPending: false,
                isSpent: false,
              })
  
              stopPolling(`handlePendingTopupPoller-${tx.paymentId}`)
  
              const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance
  
              txData.push({ status: TransactionStatus.COMPLETED, createdAt: new Date() })
  
              tx.update({
                status: TransactionStatus.COMPLETED,
                data: JSON.stringify(txData),
                balanceAfter,
              })
  
              break
            }
  
            // ─── TRANSFER (melt / lightning out retry) ─────────────
            case TransactionType.TRANSFER: {
              const { quote, change } = await walletStore.payLightningMelt(
                mintUrl,
                unit,
                inFlight.request.meltQuote,
                inFlight.request.proofsToSend,
                tx.id,
                { inFlightRequest: inFlight }
              )
  
              // Mark spent inputs
              proofsStore.addOrUpdate(inFlight.request.proofsToSend, {
                mintUrl,
                tId: tx.id,
                unit,
                isPending: false,
                isSpent: true,
              })
  
              if (change.length > 0) {
                proofsStore.addOrUpdate(change, {
                  mintUrl,
                  tId: tx.id,
                  unit,
                  isPending: false,
                  isSpent: false,
                })
  
                const outputToken = getEncodedToken({ mint: mintUrl, proofs: change, unit })
                tx.update({ outputToken })
              }
  
              if (quote.payment_preimage) {
                tx.update({ proof: quote.payment_preimage })
              }
  
              const inputAmount = CashuUtils.getProofsAmount(inFlight.request.proofsToSend)
              const changeAmount = CashuUtils.getProofsAmount(change)
              const totalFee = inputAmount - tx.amount - changeAmount
  
              const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance
  
              txData.push({
                status: TransactionStatus.COMPLETED,
                changeAmount,
                preimage: quote.payment_preimage,
                createdAt: new Date(),
              })
  
              tx.update({
                status: TransactionStatus.COMPLETED,
                data: JSON.stringify(txData),
                fee: totalFee,
                balanceAfter,
              })
  
              break
            }
  
            default:
              log.error('[handleInFlightByMintTask] Unknown tx type', { type: tx.type, tId: tx.id })
          }
  
          // Success → remove from in-flight
          counter.removeInFlightRequest(inFlight.transactionId)
  
        } catch (e: any) {
          log.error(`[handleInFlightByMintTask] ${tx.type} failed`, {
            tId: tx.id,
            error: e.name,
            message: e.message,
          })
          errors.push(`${tx.type} tId=${tx.id}: ${e.message}`)
          // Do NOT remove from inFlight — will retry next time
        }
      }
    }
  
    const totalProcessed = mint.allInFlightRequests?.length ?? 0
  
    return {
      taskFunction: HANDLE_INFLIGHT_BY_MINT_TASK,
      mintUrl,
      errors,
      message: `Processed ${totalProcessed} in-flight requests (${errors.length} failed)`,
    }
  }



/**
 * Process all pending topups and expired lightning transfers
 */
const handlePendingQueue = async (): Promise<void> => {
    const pendingTopups = transactionsStore.getPendingTopups()
    const pendingTransfers = transactionsStore.getPendingTransfers()
  
    log.trace('[handlePendingQueue] start', {
      pendingTopups: pendingTopups.length,
      pendingTransfers: pendingTransfers.length,
    })
  
    // 1. Expire old lightning transfers (no ecash ops needed)
    for (const tx of pendingTransfers) {
      if (tx.expiresAt && isBefore(tx.expiresAt, new Date())) {
        log.debug('[handlePendingQueue] Expiring transfer', { paymentId: tx.paymentId })
  
        const update = {
          status: TransactionStatus.EXPIRED,
          message: 'Lightning invoice expired',
          createdAt: new Date(),
        }
  
        const txData = tx.data ? [...JSON.parse(tx.data), update] : [update]
  
        tx.update({
          status: TransactionStatus.EXPIRED,
          data: JSON.stringify(txData),
        })
      }
    }
  
    // 2. Schedule pending topups (only if not already being polled)
    for (const tx of pendingTopups) {
      if (pollerExists(`handlePendingTopupPoller-${tx.paymentId}`)) {
        log.trace('[handlePendingQueue] Skipping topup – poller active', { paymentId: tx.paymentId })
        continue
      }
  
      // Unique task ID to prevent duplicates
      const taskId = `handlePendingTopupTask-${tx.id}-${Date.now()}`
      SyncQueue.addTask(taskId, () => handlePendingTopupTask({ transaction: tx }))
    }
  
    if (pendingTopups.length === 0) {
      log.trace('[handlePendingQueue] No pending topups')
    }
  }
  
  
/**
 * Check a single pending mint quote and mint proofs if paid — even after expiry
 */
const handlePendingTopupTask = async (
    params: { transaction: Transaction }
  ): Promise<WalletTaskResult> => {
    const { transaction: tx } = params
    const {
      id: tId,
      mint: mintUrl,
      unit,
      amount,
      paymentId: paymentHash,
      quote: mintQuote,
      expiresAt,
    } = tx
  
    log.warn('[handlePendingTopupTask] start', {tx})
  
    const mint = mintsStore.findByUrl(mintUrl)
    if (!mint || !mintQuote || !unit || !amount) {      
      throw new AppError(Err.VALIDATION_ERROR, 'Invalid pending topup transaction', { tId })
    }
  
    let txData: TransactionData = tx.data ? JSON.parse(tx.data) : []
  
    try {
      // ─── Ask mint about the quote state FIRST (this is authoritative) ───
      const { state, mintQuote: returnedQuote } = await walletStore.checkLightningMintQuote(mintUrl, mintQuote)
  
      // ─── If invoice is expired → mark transaction as expired BUT still try to mint if paid ───
      const isExpired = expiresAt && isBefore(expiresAt, new Date())
  
      if (isExpired && state !== MintQuoteState.PAID) {
        log.debug('[handlePendingTopupTask] Invoice expired and not paid', { paymentHash })
  
        txData.push({ status: TransactionStatus.EXPIRED, message: 'Invoice expired', createdAt: new Date() })
        tx.update({ status: TransactionStatus.EXPIRED, data: JSON.stringify(txData) })
        stopPolling(`handlePendingTopupPoller-${paymentHash}`)
  
        return {
          taskFunction: HANDLE_PENDING_TOPUP_TASK,
          transaction: tx,
          mintUrl,
          unit,
          amount,
          paymentHash,
          message: 'Topup invoice expired and was not paid',
        }
      }
  
      // ─── Main state handling (UNPAID / PAID / ISSUED) ───
      switch (state) {
        case MintQuoteState.UNPAID:
          log.trace('[handlePendingTopupTask] Quote still unpaid', { mintQuote })
  
          // If expired → final failure
          if (isExpired) {
            txData.push({ status: TransactionStatus.EXPIRED, message: 'Invoice expired (unpaid)', createdAt: new Date() })
            tx.update({ status: TransactionStatus.EXPIRED, data: JSON.stringify(txData) })
            stopPolling(`handlePendingTopupPoller-${paymentHash}`)
          }
  
          return {
            taskFunction: HANDLE_PENDING_TOPUP_TASK,
            transaction: tx,
            mintUrl,
            unit,
            amount,
            paymentHash,
            message: isExpired ? 'Invoice expired (unpaid)' : 'Quote not paid yet',
          }
  
        case MintQuoteState.ISSUED:
          log.info('[handlePendingTopupTask] Proofs already issued (likely from another device)', { mintQuote })
          // Mark as completed even if expired
          txData.push({ status: TransactionStatus.COMPLETED, note: 'Already issued', createdAt: new Date() })
          tx.update({ status: TransactionStatus.COMPLETED, data: JSON.stringify(txData) })
          stopPolling(`handlePendingTopupPoller-${paymentHash}`)
          return {
            taskFunction: HANDLE_PENDING_TOPUP_TASK,
            transaction: tx,
            mintUrl,
            unit,
            amount,
            paymentHash,
            message: 'Ecash already issued',
          }
  
        case MintQuoteState.PAID: {
          log.debug('[handlePendingTopupTask] Quote PAID – minting proofs (even if expired)', { paymentHash, amount, unit, isExpired })
  
          let proofs: CashuProof[] = []
  
          try {
            proofs = await walletStore.mintProofs(mintUrl, amount, unit, mintQuote, tId)
          } catch (e: any) {
            if (/already.*signed|duplicate key/i.test(e.message) || e.code && e.code === 10002) {
              log.error('[handlePendingTopupTask] Idempotency conflict – retrying with counter bump')
              proofs = await walletStore.mintProofs(mintUrl, amount, unit, mintQuote, tId, { increaseCounterBy: 10 })
            } else {
              throw e
            }
          }
  
          if (proofs.length === 0) {
            throw new AppError(Err.MINT_ERROR, 'Mint returned no proofs after payment')
          }
  
          proofsStore.addOrUpdate(proofs, {
            mintUrl,
            unit,
            tId,
            isPending: false,
            isSpent: false,
          })
  
          const currencyCode = getCurrency(unit).code
          const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance
  
          txData.push({ status: TransactionStatus.COMPLETED, createdAt: new Date() })
  
          tx.update({
            status: TransactionStatus.COMPLETED,
            data: JSON.stringify(txData),
            balanceAfter,
          })
  
          stopPolling(`handlePendingTopupPoller-${paymentHash}`)
          _sendTopupNotification(amount, unit)
  
          return {
            taskFunction: HANDLE_PENDING_TOPUP_TASK,
            transaction: tx,
            mintUrl,
            unit,
            amount,
            paymentHash,
            message: `Topup successful: +${formatCurrency(amount, currencyCode)} ${currencyCode}${isExpired ? ' (paid after expiry)' : ''}`,
          }
        }
  
        default:
          log.error('[handlePendingTopupTask] Unknown quote state', { state })
          return {
            taskFunction: HANDLE_PENDING_TOPUP_TASK,
            transaction: tx,
            mintUrl,
            unit,
            amount,
            paymentHash,
            message: `Unknown quote state: ${state}`,
          }
      }
    } catch (e: any) {
      log.error('[handlePendingTopupTask] failed', {
        tId,
        paymentHash,
        error: e.name,
        message: e.message,
      })
  
      return {
        taskFunction: HANDLE_PENDING_TOPUP_TASK,
        transaction: tx,
        mintUrl,
        unit,
        amount,
        paymentHash,
        error: { name: e.name, message: e.message },
        message: `Topup failed: ${e.message}`,
      }
    }
  }



/**
 * Manually recover minted ecash from a paid mint quote (e.g. lost topup)
 */
const recoverMintQuote = async (
    params: { mintUrl: string; mintQuote: string }
  ): Promise<{ recoveredAmount: number }> => {
    const { mintUrl, mintQuote } = params
    const mint = mintsStore.findByUrl(mintUrl)
    const unit: MintUnit = 'sat'
  
    if (!mint || !mintQuote) {
      throw new AppError(Err.VALIDATION_ERROR, 'Missing mint or mint quote', { mintUrl, mintQuote })
    }
  
    log.trace('[recoverMintQuote] start', { mintUrl, mintQuote })
  
    const { state, mintQuote: returnedQuote, encodedInvoice } = await walletStore.checkLightningMintQuote(mintUrl, mintQuote)
  
    if (returnedQuote !== mintQuote) {
      throw new AppError(Err.VALIDATION_ERROR, 'Mint returned mismatched quote', { mintQuote, returnedQuote })
    }
  
    switch (state) {
      case MintQuoteState.UNPAID:
        throw new AppError(Err.VALIDATION_ERROR, `Quote ${mintQuote} is not paid`)
  
      case MintQuoteState.ISSUED:
        throw new AppError(Err.VALIDATION_ERROR, `Quote ${mintQuote} already issued – nothing to recover`)
  
      case MintQuoteState.PAID: {
        const invoice = LightningUtils.decodeInvoice(encodedInvoice)
        const { amount, description } = LightningUtils.getInvoiceData(invoice)
  
        // Create recovery transaction
        const txData: TransactionData[] = [        
          { status: TransactionStatus.DRAFT, amount, unit, createdAt: new Date() },
        ]
  
        const tx = await transactionsStore.addTransaction({
          type: TransactionType.TOPUP,
          amount,
          fee: 0,
          unit,
          data: JSON.stringify(txData),
          memo: description || 'Recovered topup',
          mint: mintUrl,
          status: TransactionStatus.DRAFT,
          quote: mintQuote,
        })
  
        let proofs: CashuProof[] = []
  
        try {
          proofs = await walletStore.mintProofs(mintUrl, amount, unit, mintQuote, tx.id)
        } catch (e: any) {
          if (/already.*signed|duplicate key/i.test(e.message) || e.code && e.code === 10002) {
            log.error('[recoverMintQuote] Increasing proofsCounter outdated values and repeating mintProofs')
            proofs = await walletStore.mintProofs(mintUrl, amount, unit, mintQuote, tx.id, { increaseCounterBy: 10 })
          } else {
            throw e
          }
        }
  
        if (proofs.length === 0) {
          throw new AppError(Err.MINT_ERROR, 'Mint returned no proofs to recover')
        }
  
        const { updatedAmount: recoveredAmount } = proofsStore.addOrUpdate(proofs, {
          mintUrl,
          unit,
          tId: tx.id,
          isPending: false,
          isSpent: false,
        })
  
        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance
  
        txData.push({ status: TransactionStatus.RECOVERED, recoveredAmount, createdAt: new Date() })
  
        tx.update({
          status: TransactionStatus.RECOVERED,
          amount: recoveredAmount,
          balanceAfter,
          data: JSON.stringify(txData),
        })
  
        log.debug('[recoverMintQuote] Success', { mintUrl, mintQuote, recoveredAmount })
        return { recoveredAmount }
      }
  
      default:
        log.error('[recoverMintQuote] Unknown quote state', { state })
        throw new AppError(Err.VALIDATION_ERROR, `Unknown quote state: ${state}`)
    }
  }
  
  /**
   * Manually recover change from a paid melt quote (lightning out)
   */
  const recoverMeltQuoteChange = async (
    params: { mintUrl: string; meltQuote: string }
  ): Promise<{ recoveredAmount: number }> => {
    const { mintUrl, meltQuote } = params
    const mint = mintsStore.findByUrl(mintUrl)
    const unit: MintUnit = 'sat'
  
    if (!mint || !meltQuote) {
      throw new AppError(Err.VALIDATION_ERROR, 'Missing mint or melt quote', { mintUrl, meltQuote })
    }
  
    log.trace('[recoverMeltQuoteChange] start', { mintUrl, meltQuote })
  
    const response = await walletStore.checkLightningMeltQuote(mintUrl, meltQuote)
    const { quote, state, change, amount } = response
  
    if (quote !== meltQuote) {
      throw new AppError(Err.VALIDATION_ERROR, 'Mint returned mismatched melt quote', { meltQuote, returned: quote })
    }
  
    switch (state) {
      case MeltQuoteState.UNPAID:
        throw new AppError(Err.VALIDATION_ERROR, `Melt quote ${meltQuote} was not paid`)
  
      case MeltQuoteState.PENDING:
        throw new AppError(Err.VALIDATION_ERROR, `Melt quote ${meltQuote} is still pending – cannot recover change yet`)
  
      case MeltQuoteState.PAID: {
        if (!change || change.length === 0) {
          throw new AppError(Err.VALIDATION_ERROR, `No change available for melt quote ${meltQuote}`)
        }
  
        let tx = transactionsStore.findBy({ quote: meltQuote })
  
        if (!tx) {
          // Create recovery tx if not exists
          tx = await transactionsStore.addTransaction({
            type: TransactionType.RECEIVE,
            amount,
            fee: 0,
            unit,
            data: JSON.stringify([{ status: TransactionStatus.DRAFT, createdAt: new Date() }]),
            memo: 'Recovered melt change',
            mint: mintUrl,
            status: TransactionStatus.DRAFT,
            quote: meltQuote,
          })
        }
  
        let txData: TransactionData = tx.data ? JSON.parse(tx.data) : []
  
        try {
          // Recover blind signatures
          const change = await walletStore.recoverMeltQuoteChange(mintUrl, response)
  
          // Force zero-value swap to validate + unblind them
          const { returnedProofs } = await walletStore.send(
            mintUrl,
            0,
            unit,
            change as Proof[],
            tx.id,
            { increaseCounterBy: change.length } // ?
          )
  
          if (!returnedProofs || returnedProofs.length === 0) {
            throw new AppError(Err.MINT_ERROR, 'Mint returned no proofs during change recovery')
          }
  
          const { updatedAmount: recoveredAmount } = proofsStore.addOrUpdate(returnedProofs, {
            mintUrl,
            unit,
            tId: tx.id,
            isPending: false,
            isSpent: false,
          })
  
          const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance
          const outputToken = getEncodedToken({ mint: mintUrl, proofs: returnedProofs, unit })
  
          txData.push({
            status: TransactionStatus.RECOVERED,
            recoveredAmount,
            createdAt: new Date(),
          })
  
          tx.update({
            status: TransactionStatus.RECOVERED,
            amount: recoveredAmount,
            balanceAfter,
            outputToken,
            data: JSON.stringify(txData),
          })
  
          log.debug('[recoverMeltQuoteChange] Success', { meltQuote, recoveredAmount })
          return { recoveredAmount }
        } catch (e: any) {
          log.error('[recoverMeltQuoteChange] Failed', { meltQuote, error: e.message })
  
          txData.push({
            status: TransactionStatus.ERROR,
            error: WalletUtils.formatError(e),
            createdAt: new Date(),
          })
  
          tx.update({
            status: TransactionStatus.ERROR,
            data: JSON.stringify(txData),
          })
  
          return { recoveredAmount: 0 }
        }
      }
  
      default:
        log.error('[recoverMeltQuoteChange] Unknown melt state', { state })
        throw new AppError(Err.VALIDATION_ERROR, `Unknown melt quote state: ${state}`)
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
                    let sentFrom: string = ''
                    try {
                        const profile: NostrProfile = JSON.parse(zapSenderProfile)
                        sentFrom = profile.nip05 ?? profile.name
                    } catch(e: any) {}
                    
                    transaction.update({profile: zapSenderProfile, sentFrom})
                }

                if (zapRequest) {
                    transaction.update({zapRequest})
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



const _sendTopupNotification = async function (amount: number, unit: MintUnit) {
    
    const currencyCode = getCurrency(unit).code

    await NotificationService.createLocalNotification(
        `⚡ ${formatCurrency(amount, currencyCode)} ${currencyCode} received!`,
        `Your invoice has been paid and your wallet balance credited with ${formatCurrency(amount, currencyCode)} ${currencyCode}.`,           
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

        // do not use event timestamp as it might be in the future, preventing further checks
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
        // but only if it is in the past (so that malicious event won't block future checks)
        if(directMessageEvent.created_at < new Date().getTime() / 1000) {
            contactsStore.setLastPendingReceivedCheck(directMessageEvent.created_at)
        }  

        log.trace('[handleReceivedEventTask]', 'Received event', {directMessageEvent})

        let sentFromPubkey = directMessageEvent.pubkey
        let sentFrom = NostrClient.getFirstTagValue(directMessageEvent.tags, 'from') as string | undefined
        let sentFromNpub = NostrClient.getNpubkey(sentFromPubkey)

        // Drop message if user wants to receive only from contacts and sender is not in
        if(userSettingsStore.isReceiveOnlyFromContactsOn 
            && sentFromPubkey !== MINIBIT_SERVER_NOSTR_PUBKEY) {

            const contactInstance = contactsStore.findByPubkey(sentFromPubkey)

            if(!contactInstance) {
                // drop silently
                let message = 'Message received over Nostr has been blocked, the sender is not in your contacts.'
                log.error(message, {sentFromPubkey, sentFrom, decryptedMessage})

                return {            
                    taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                    message,            
                } as WalletTaskResult
            }
        }
        
        // get sender profile and save it as a contact
        // this is not valid for events sent from Minibits LNURL bridge, that are sent and signed by a minibits server key
        // and *** do not contain sentFrom *** // LEGACY, replaced by claim api

        let contactFrom: Contact | undefined = undefined
        let zapSenderProfile: NostrProfile | undefined = undefined 
        let sentFromPicture: string | undefined = undefined          

        // Add ecash or pr sender to the contacts.
        // To avoid malicious events (from tag can be faked), add only minibits.cash addresses
        // where we check, that sentFromPubkey matches the pubkey of sentFrom name on the Minibits server
                                              
        if( sentFrom 
            && sentFrom.includes(MINIBITS_NIP05_DOMAIN) 
            && userSettingsStore.isReceiveOnlyFromContactsOn === false
        ) {

            const serverProfile = await MinibitsClient.getWalletProfileByNip05(sentFrom)

            if(serverProfile.pubkey !== sentFromPubkey) {
                throw new AppError(Err.UNAUTHORIZED_ERROR, 'Sender pubkey does not match the one on the Minibits server.', {sentFrom, sentFromPubkey, serverProfile})
            }

            log.info('[handleReceivedEventTask]', 'Event sent from Minibits server user, adding to contacts...', {sentFrom, sentFromPubkey})
            
            contactFrom = {                        
                pubkey: sentFromPubkey,
                npub: sentFromNpub,
                nip05: serverProfile.nip05,
                lud16: serverProfile.lud16,
                name: serverProfile.name,
                picture: serverProfile.avatar,
                isExternalDomain: false                       
            } as Contact
            
            contactsStore.addContact(contactFrom)  
        }
         
        
        // Event was sent from Minibits server, try to extract zap sender profile from the message
        if(sentFromPubkey === MINIBIT_SERVER_NOSTR_PUBKEY) {
            log.info('[handleReceivedEventTask]', 'Event sent from Minibits server, extracting zap sender profile...')
            
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

            // do not allow to receive automatically from unknown mints
            if(!mintsStore.mintExists(decoded.mint)) {
                let message = 'Receiving ecash token over Nostr from unknown mint is not allowed.'

                const transactionData: TransactionData[] = []  
                let transaction: Transaction | undefined = undefined
                const {unit, mint} = decoded

                transactionData.push({
                    status: TransactionStatus.ERROR,
                    amountToReceive,
                    unit,            
                    createdAt: new Date(),
                })
    
                const newTransaction = {
                    type: TransactionType.RECEIVE,
                    amount: amountToReceive,
                    fee: 0,
                    unit: unit as MintUnit,
                    data: JSON.stringify(transactionData),
                    memo,
                    mint,            
                    status: TransactionStatus.DRAFT,
                }
        
                transaction = await transactionsStore.addTransaction(newTransaction)
                transaction.update({inputToken: incoming.encoded})

                await _sendErrorReceiveNotification(
                    amountToReceive,
                    decoded.unit as MintUnit,
                    decoded.mint              
                )

                throw new AppError(Err.VALIDATION_ERROR, message, {decoded})  
            }

            const {transaction, receivedAmount} = await receiveTask(
                decoded,
                amountToReceive,
                memo,
                incoming.encoded as string,
            )

            // store contact or zapseder in tx details
            if(transaction && sentFrom) {
                if (contactFrom) {                    
                    transaction.update({profile: JSON.stringify(contactFrom), sentFrom})                    
                }
        
                if (zapSenderProfile) {
                    transaction.update({profile: JSON.stringify(zapSenderProfile), sentFrom})                    
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
            // payer is current wallet profile
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
            
            // create draft transaction
            const defaultMintBalance: MintBalance | undefined = proofsStore.getMintBalanceWithMaxBalance('sat')
            
            if(!defaultMintBalance) {
                let message = 'Wallet does not have any mint with SATS unit.'
                throw new AppError(Err.VALIDATION_ERROR, message, {decoded})  
            }

            const transactionData: TransactionData[] = [
                {
                    status: TransactionStatus.DRAFT,
                    mintBalanceToTransferFrom: defaultMintBalance.mintUrl,
                    amountToTransfer: amount,
                    unit: 'sat',                    
                    isNwc: false,        
                    createdAt: new Date(),
                }
            ]

            const newTransaction = {
                type: TransactionType.TRANSFER,
                amount,
                fee: 0,
                unit: 'sat' as MintUnit,
                data: JSON.stringify(transactionData),
                memo: maybeMemo || description,
                mint: defaultMintBalance.mintUrl,
                status: TransactionStatus.DRAFT,
            }

            const transaction = await transactionsStore.addTransaction(newTransaction)            

            transaction.update({
                paymentId: paymentHash,
                paymentRequest: incoming.encoded,
                expiresAt: addSeconds(new Date(timestamp * 1000), expiry),
                profile: JSON.stringify(contactFrom),
                sentTo: contactFrom?.nip05 ?? contactFrom?.name, // payee
                sentFrom: contactTo.nip05 ?? contactTo.name // payer
            })   

            if(contactFrom) _sendIncomingInvoiceNotification(amount, 'sat', contactFrom)            
            
            return {
                mintUrl: '',
                taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                message: 'Incoming Lightning payment request been received.',
                proofsCount: 0,
                proofsAmount: amount                     
            } as WalletTaskResult
        }
        //
        // Receive cashu payment requet to pay
        //
        else if (incoming.type === IncomingDataType.CASHU_PAYMENT_REQUEST) {
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
            
            const decoded = decodePaymentRequest(incoming.encoded)

            
            // do not create draft transaction for amount-less pr
            if(!decoded.amount || !decoded.unit) {
                let message = 'Cashu payment request is missing amount or unit.'
                throw new AppError(Err.VALIDATION_ERROR, message, {decoded})  
            }
            
            // create draft transaction
            const {amount, unit, description, id, mints} = decoded
            
            const availableBalances: MintBalance[] = []

            if (mints && mints.length > 0) {                        

                for (const mint of mints) {
                    if (mintsStore.mintExists(mint)) {
                        const mintBalance = proofsStore.getMintBalance(mint)
                        if(mintBalance) {
                            availableBalances.push(mintBalance)
                        }
                    }
                }

            } else {
                const mintBalance = proofsStore.getMintBalanceWithMaxBalance(unit as MintUnit)
                if(!mintBalance) {
                    let message = 'Wallet does not have any mint with this unit.'
                    throw new AppError(Err.VALIDATION_ERROR, message, {decoded})  
                }
                availableBalances.push(mintBalance)
            }

            if(availableBalances.length === 0) {
                let message = 'Wallet does not have any of the mints accepted by Cashu payment request.'
                throw new AppError(Err.VALIDATION_ERROR, message, {decoded})  
            }

            const transactionData: TransactionData[] = [{
                    status: TransactionStatus.DRAFT,
                    mintBalanceToSendFrom: availableBalances[0],
                    amountToSend: amount,
                    unit,                       
                    createdAt: new Date(),
            }]

            const newTransaction = {
                type: TransactionType.SEND,
                amount,
                fee: 0,
                unit: unit as MintUnit,
                data: JSON.stringify(transactionData),
                memo: description,
                mint: availableBalances[0].mintUrl,
                status: TransactionStatus.DRAFT,
            }

            const transaction = await transactionsStore.addTransaction(newTransaction)            
            // TODO make single insert
            transaction.update({
                paymentId: id,
                paymentRequest: incoming.encoded,                
                profile: JSON.stringify(contactFrom),
                sentTo: contactFrom?.nip05 ?? contactFrom?.name, // payee
                sentFrom: contactTo.nip05 ?? contactTo.name // payer
            })  

            if(contactFrom) _sendIncomingInvoiceNotification(amount, unit as MintUnit, contactFrom)
            
            return {
                mintUrl: '',
                taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                message: 'Incoming Cashu payment request been received.',
                proofsCount: 0,
                proofsAmount: amount                     
            } as WalletTaskResult
        }

        //
        // Receive ecash from paid cashu payment requet
        //
        else if(incoming.type === IncomingDataType.CASHU_PAYMENT_REQUEST_PAYLOAD) {
            const decoded: PaymentRequestPayload = JSON.parse(incoming.encoded)
            log.trace('[handleReceivedEventTask]', 'Decoded payment request payload', {decoded})

            const {transaction, receivedAmount, message} = await receiveByCashuPaymentRequestTask(
                decoded
            )

            // store contact or zapseder in tx details
            if(transaction && sentFrom) {
                if (contactFrom) {
                    transaction.update({profile: JSON.stringify(contactFrom), sentFrom})
                }

                transaction.update({paymentId: decoded.id})
    
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

const _sendErrorReceiveNotification = async function (
    amountToReceive: number,
    unit: MintUnit,
    mint: string
): Promise<void> {
    const getNotificationContent = (
        amount: number,
        currency: CurrencyCode,
    ): { title: string; body: string } => {
        const title = Platform.OS === 'android'
            ? `<b>Received ${formatCurrency(amount, currency)} ${currency} ecash token from unknonw mint!</b>`
            : `Received ${formatCurrency(amount, currency)} ${currency} ecash token from unknonw mint!`
        const body = Platform.OS === 'android'
            ? `Add <b>${mint}</b> to your wallet first to receive ecash over the Nostr network.`
            : `Add ${mint} to your wallet first to receive ecash over the Nostr network.`
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
    if(amountToReceive && amountToReceive > 0) {
        const { title, body } = getNotificationContent(amountToReceive, currencyCode);
        await NotificationService.createLocalNotification(title, body);
    }

    return
}


const _sendIncomingInvoiceNotification = async function (amount: number, unit: MintUnit, from: Contact) {    
    await NotificationService.createLocalNotification(
        Platform.OS === 'android' ? `⚡ Please pay <b>${formatCurrency(amount, getCurrency(unit).code)} ${getCurrency(unit).code}</b>!` : `⚡ Please pay ${formatCurrency(amount, getCurrency(unit).code)} ${getCurrency(unit).code}!`,
        `${from.nip05 || 'Unknown'} has sent you a request to pay.`,
        from.picture,
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
    handlePendingQueue,
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