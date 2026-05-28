// Side-effect import: registers wallet event names + payloads with the
// typed EventEmitter via TypeScript declaration merging.
import './wallet/events'

import {Proof, ProofState} from '../models/Proof'
import {
    Transaction,
} from '../models/Transaction'
import {MeltQuoteBolt11Response, TokenMetadata} from '@cashu/cashu-ts'
import {Mint, MintBalance} from '../models/Mint'
import {NostrEvent} from './nostrService'
import {Contact} from '../models/Contact'
import {SyncQueue} from './syncQueueService'
import {MintUnit} from './wallet/currency'
import {MintOperationService} from './wallet/operations/mintOperations'
import {MeltOperationService} from './wallet/operations/meltOperations'
import {SendOperationService} from './wallet/operations/sendOperations'
import {ReceiveOperationService} from './wallet/operations/receiveOperations'
import {SyncOperationService} from './wallet/operations/syncOperations'
import {InFlightOperationService} from './wallet/operations/inFlightOperations'
import {PendingOperationService} from './wallet/operations/pendingOperations'
import {NostrOperationService} from './wallet/operations/nostrOperations'
import {RevertOperationService} from './wallet/operations/revertOperations'
import {
    SyncStateTaskResult,
    TransactionTaskResult,
} from './wallet/types'

// Re-export constants, types, and interfaces for backward compatibility
export {
    DEFAULT_DENOMINATION_TARGET,
    MAX_SWAP_INPUT_SIZE,
    MAX_SYNC_INPUT_SIZE,
    TASK_QUEUE_TIMEOUT,
    TEST_TASK,
    SWAP_ALL_TASK,
    SWAP_DENOMINATION_TASK,
    SYNC_STATE_WITH_ALL_MINTS_TASK,
    SYNC_STATE_WITH_MINT_TASK,
    HANDLE_NWC_REQUEST_TASK,
    HANDLE_CLAIM_TASK,
    HANDLE_PENDING_TOPUP_TASK,
    HANDLE_INFLIGHT_BY_MINT_TASK,
    HANDLE_RECEIVED_EVENT_TASK,
} from './wallet/types'
export type {
    WalletTaskResult,
    TransactionTaskResult,
    TransactionStateUpdate,
    SyncStateTaskResult,
} from './wallet/types'

type WalletTaskService = {
    syncStateWithAllMintsQueueAwaitable: (
        options: {proofState: ProofState},
    ) => Promise<SyncStateTaskResult>
    syncStateWithMintQueueAwaitable: (
        options: {
            proofsToSync: Proof[]
            mintUrl: string
            proofState: ProofState
        },
    ) => Promise<SyncStateTaskResult>
    syncStateWithMintTask: (
        options: {
            proofsToSync: Proof[]
            mintUrl: string
            proofState: ProofState
        },
    ) => Promise<SyncStateTaskResult | void>
    handleInFlightQueue: () => Promise<void>
    handlePendingQueue: () => Promise<void>
    handleClaimQueue: () => Promise<void>
    handleNwcRequestQueue: (params: {
        requestEvent: NostrEvent
    }) => Promise<void>
    receiveEventsFromRelaysQueue: () => Promise<void>
    transferQueueAwaitable: (
        mintBalanceToTransferFrom: MintBalance,
        amountToTransfer: number,
        unit: MintUnit,
        meltQuote: MeltQuoteBolt11Response,
        memo: string,
        invoiceExpiry: Date,
        encodedInvoice: string,
        nwcEvent?: NostrEvent,
        draftTransactionId?: number,
    ) => Promise<TransactionTaskResult>
    receiveQueueAwaitable: (
        mint: Mint,
        tokenMetadata: TokenMetadata,
        encodedToken: string,
    ) => Promise<TransactionTaskResult>
    receiveOfflinePrepareQueueAwaitable: (
        tokenMetadata: TokenMetadata,
        encodedToken: string,
    ) => Promise<TransactionTaskResult>
    receiveOfflineCompleteQueueAwaitable: (
        transactionId: number,
    ) => Promise<TransactionTaskResult>
    sendQueueAwaitable: (
        mintBalanceToSendFrom: MintBalance,
        amountToSend: number,
        unit: MintUnit,
        memo: string,
        selectedProofs: Proof[],
        p2pk?: {pubkey: string; locktime?: number; refundKeys?: Array<string>},
        draftTransactionId?: number,
    ) => Promise<TransactionTaskResult>
    swapAllQueue: () => Promise<void>
    swapByDenominationQueue: (denomination: number, mintUrl: string) => Promise<void>
    topupQueueAwaitable: (
        mintBalanceToTopup: MintBalance,
        amountToTopup: number,
        unit: MintUnit,
        memo: string,
        contactToSendTo?: Contact,
        nwcEvent?: NostrEvent,
    ) => Promise<TransactionTaskResult>
    cashuPaymentRequestQueueAwaitable: (
        mintBalanceToReceiveTo: MintBalance,
        amountToRequest: number,
        unit: MintUnit,
        memo: string,
    ) => Promise<TransactionTaskResult>
    revertQueueAwaitable: (
        transaction: Transaction,
    ) => Promise<TransactionTaskResult>
    testQueue: () => Promise<void>
    recoverMintQuote: (params: {
        mintUrl: string
        mintQuote: string
    }) => Promise<{recoveredAmount: number}>
    recoverMeltQuoteChange: (params: {
        mintUrl: string
        meltQuote: string | MeltQuoteBolt11Response
    }) => Promise<{recoveredAmount: number}>
    handlePendingMeltTask: (params: {
        mintUrl: string
        unit: MintUnit
        quoteId: string
        proofsToMeltFrom: Proof[]
        proofsToMeltFromAmount: number
        amountToTransfer: number
        meltFeeReserve: number
        transactionId: number
    }) => Promise<void>
}

const testQueue = async () => {
    const now = new Date().getTime()

    SyncQueue.addTask(
        `testTask-${now}`,
        async () => {
            await new Promise(res => setTimeout(res, 10 * 1000))
            return `testTask-${now} result`
        },
    )
}

/**
 * Thin coordinator that aggregates operation services into a single
 * task surface for screens and other consumers. Each method delegates
 * to a focused service object under `src/services/wallet/operations/`.
 */
export const WalletTask: WalletTaskService = {
    // Sync + swap
    syncStateWithAllMintsQueueAwaitable: SyncOperationService.syncStateWithAllMintsQueueAwaitable,
    syncStateWithMintQueueAwaitable: SyncOperationService.syncStateWithMintQueueAwaitable,
    syncStateWithMintTask: SyncOperationService.syncStateWithMintTask,
    swapAllQueue: SyncOperationService.swapAllQueue,
    swapByDenominationQueue: SyncOperationService.swapByDenominationQueue,
    // In-flight recovery
    handleInFlightQueue: InFlightOperationService.handleInFlightQueue,
    // Pending orchestration
    handlePendingQueue: PendingOperationService.handlePendingQueue,
    // Nostr
    handleClaimQueue: NostrOperationService.handleClaimQueue,
    handleNwcRequestQueue: NostrOperationService.handleNwcRequestQueue,
    receiveEventsFromRelaysQueue: NostrOperationService.receiveEventsFromRelaysQueue,
    // Receive
    receiveQueueAwaitable: ReceiveOperationService.receiveQueueAwaitable,
    receiveOfflinePrepareQueueAwaitable: ReceiveOperationService.receiveOfflinePrepareQueueAwaitable,
    receiveOfflineCompleteQueueAwaitable: ReceiveOperationService.receiveOfflineCompleteQueueAwaitable,
    // Send
    sendQueueAwaitable: SendOperationService.sendQueueAwaitable,
    cashuPaymentRequestQueueAwaitable: SendOperationService.cashuPaymentRequestQueueAwaitable,
    // Mint (topup)
    topupQueueAwaitable: MintOperationService.topupQueueAwaitable,
    recoverMintQuote: MintOperationService.recoverMintQuote,
    // Melt (transfer)
    transferQueueAwaitable: MeltOperationService.transferQueueAwaitable,
    recoverMeltQuoteChange: MeltOperationService.recoverMeltQuoteChange,
    handlePendingMeltTask: MeltOperationService.handlePendingMeltTask,
    // Revert
    revertQueueAwaitable: RevertOperationService.revertQueueAwaitable,
    // Test
    testQueue,
}
