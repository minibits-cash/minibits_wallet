import {MeltQuoteBaseResponse} from '@cashu/cashu-ts'
import {NostrEvent} from '../nostrService'
import {Transaction, TransactionStatus} from '../../models/Transaction'
import AppError from '../../utils/AppError'

export const DEFAULT_DENOMINATION_TARGET = 2

export const MAX_SWAP_INPUT_SIZE = 100
export const MAX_SYNC_INPUT_SIZE = 200 // 1000 hard mint limit
export const TASK_QUEUE_TIMEOUT = 30 * 1000

export const TEST_TASK = 'testTask'
export const SWAP_ALL_TASK = 'swapAllTask'
export const SWAP_DENOMINATION_TASK = 'swapDenominationTask'
export const SYNC_STATE_WITH_ALL_MINTS_TASK = 'syncStateWithAllMintsTask'
export const SYNC_STATE_WITH_MINT_TASK = 'syncStateWithMintTask'
export const HANDLE_NWC_REQUEST_TASK = 'handleNwcRequestTask'
export const HANDLE_CLAIM_TASK = 'handleClaimTask'
export const HANDLE_PENDING_TOPUP_TASK = 'handlePendingTopupTask'
export const HANDLE_INFLIGHT_BY_MINT_TASK = 'handleInFlightByMintTask'
export const HANDLE_RECEIVED_EVENT_TASK = 'handleReceivedEventTask'

export interface WalletTaskResult {
    taskFunction: string
    message: string
    mintUrl?: string
    error?: AppError
    [key: string]: any
}

export interface TransactionTaskResult extends WalletTaskResult {
    mintUrl: string
    transaction?: Transaction
    swapFeePaid?: number
    lightningFeePaid?: number
    meltFeePaid?: number
    meltQuote?: MeltQuoteBaseResponse
    nwcEvent?: NostrEvent
}

export interface TransactionStateUpdate {
    tId: number
    amount?: number
    spentByMintAmount?: number
    pendingByMintAmount?: number
    movedToSpendableAmount?: number
    meltQuoteToRecover?: string
    recoveredChangeAmount?: number
    message?: string
    updatedStatus: TransactionStatus
}

export interface SyncStateTaskResult extends WalletTaskResult {
    transactionStateUpdates: TransactionStateUpdate[]
    completedTransactionIds: number[]
    errorTransactionIds: number[]
    revertedTransactionIds: number[]
}
