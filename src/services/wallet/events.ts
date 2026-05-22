/**
 * Typed event registry for the wallet domain (Phase 7 of refactoring).
 *
 * Augments the `CoreEvents` interface declared in
 * [src/utils/eventEmitter.ts](src/utils/eventEmitter.ts) so that
 * `EventEmitter.on/emit/off` are type-checked when called with one of the
 * registered event names.
 *
 * This file is purely a type-side contribution — there is no runtime export.
 * It is imported for its side effects on the type system (declaration merging)
 * from [src/services/walletService.ts](src/services/walletService.ts).
 */
import {TransactionStatus} from '../../models/Transaction'
import {
    SyncStateTaskResult,
    TransactionTaskResult,
    WalletTaskResult,
} from './types'

// Auto-generated SyncQueue completion events: `ev_${result.taskFunction}_result`.
// See syncQueueService._handleTaskResult.
export type WalletEvents = {
    // TransactionTaskResult-shaped events
    ev_sendTask_result: TransactionTaskResult
    ev_receiveTask_result: TransactionTaskResult
    ev_receiveBatchTask_result: TransactionTaskResult
    ev_receiveOfflinePrepareTask_result: TransactionTaskResult
    ev_receiveOfflineCompleteTask_result: TransactionTaskResult
    ev_transferTask_result: TransactionTaskResult
    ev_topupTask_result: TransactionTaskResult
    ev_revertTask_result: TransactionTaskResult
    ev_cashuPaymentRequestTask_result: TransactionTaskResult

    // SyncStateTaskResult-shaped events
    ev_syncSpendableStateTask_result: SyncStateTaskResult
    ev_syncStateWithMintTask_result: SyncStateTaskResult

    // TransactionTaskResult-shaped (returns include mintUrl)
    ev_handleClaimTask_result: TransactionTaskResult
    ev_handleReceivedEventTask_result: TransactionTaskResult
    ev_handlePendingTopupTask_result: TransactionTaskResult
    ev_handleInFlightByMintTask_result: TransactionTaskResult

    // WalletTaskResult-shaped (multi-mint or no specific mint context)
    ev_handleNwcRequestTask_result: WalletTaskResult
    ev_swapAllTask_result: WalletTaskResult
    ev_swapDenominationTask_result: WalletTaskResult
    ev_testTask_result: WalletTaskResult

    // Manually emitted by MeltOperationService.handlePendingMeltTask
    ev_asyncMeltResult: {
        transactionId: number
        status: TransactionStatus
        message: string
    }
}

declare module '../../utils/eventEmitter' {
    // Merge wallet event names + payloads into the global CoreEvents map.
    interface CoreEvents extends WalletEvents {}
}
