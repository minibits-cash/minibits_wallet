import {log} from '../logService'
import {
    Transaction,
    TransactionData,
    TransactionStatus,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {WalletUtils} from './utils'
import {TransactionTaskResult} from '../walletService'
import {MintUnit, formatCurrency, getCurrency} from './currency'
import {PaymentRequestPayload, Token} from '@cashu/cashu-ts'

const {transactionsStore} = rootStoreInstance

// Task function names — preserved for the event-bus surface (`ev_<task>_result`).
export const RECEIVE_TASK = 'receiveTask'
export const RECEIVE_OFFLINE_PREPARE_TASK = 'receiveOfflinePrepareTask'
export const RECEIVE_OFFLINE_COMPLETE_TASK = 'receiveOfflineCompleteTask'
export const RECEIVE_BY_CASHU_PAYMENT_REQUEST_TASK = 'receiveByCashuPaymentRequestTask'

/**
 * Backward-compatible online-receive task wrapper.
 *
 * Preserves the legacy `WalletTask.receiveQueueAwaitable` contract: a single
 * call that creates the draft, validates, swaps proofs with the mint, and
 * returns a `TransactionTaskResult`.
 *
 * Internally delegates to the lifecycle API:
 *   `ReceiveOperationApi.prepare()` (DRAFT → PREPARED; BLOCKED short-circuit)
 *   `ReceiveOperationApi.execute()` (PREPARED → COMPLETED; atomic commit)
 */
export const receiveTask = async function (
    token: Token,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
): Promise<TransactionTaskResult> {
    const mintToReceive = token.mint
    const unit = ((token.unit as MintUnit) || 'sat') as MintUnit

    // Lazy import avoids a circular dep across the operations module graph.
    const {ReceiveOperationApi, receiveSuccessMessage} = await import(
        './operations/receiveOperationApi'
    )

    let transactionIdForRecovery: number | undefined

    try {
        const prepared = await ReceiveOperationApi.prepare({
            mintUrl: mintToReceive,
            amount: amountToReceive,
            unit,
            memo,
            method: {method: 'cashu-token', options: {token, encodedToken, offline: false}},
        })
        transactionIdForRecovery = prepared.transactionId

        if (prepared.blocked) {
            return {
                taskFunction: RECEIVE_TASK,
                mintUrl: mintToReceive,
                transaction: prepared.tx,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionTaskResult
        }

        const completed = await ReceiveOperationApi.execute(prepared)

        const swapFeePaid = completed.fee ?? 0
        const receivedAmount = completed.amount
        // receiveBatchTask sums these to track progress across split batches.
        const {proofsStore} = rootStoreInstance
        const receivedProofsCount = proofsStore
            .getByTransactionId(completed.id)
            .filter(p => p.state === 'UNSPENT').length

        return {
            taskFunction: RECEIVE_TASK,
            mintUrl: mintToReceive,
            transaction: completed,
            message: receiveSuccessMessage(amountToReceive, unit, swapFeePaid),
            receivedAmount,
            receivedProofsCount,
        } as TransactionTaskResult
    } catch (e: any) {
        _stampErrorIfNeeded(transactionIdForRecovery, e)
        log.error(e.name, e.message)
        return {
            taskFunction: RECEIVE_TASK,
            mintUrl: mintToReceive,
            transaction: transactionIdForRecovery
                ? transactionsStore.findById(transactionIdForRecovery)
                : undefined,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}

/**
 * Backward-compatible offline-prepare task wrapper.
 *
 * Calls `ReceiveOperationApi.prepare({offline: true})` to DLEQ-verify the
 * token locally without contacting the mint. The transaction lands in
 * `PREPARED_OFFLINE` and can be completed later via `receiveOfflineCompleteTask`.
 */
export const receiveOfflinePrepareTask = async function (
    mintUrl: string,
    unit: MintUnit,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
): Promise<TransactionTaskResult> {
    const mintToReceive = mintUrl.replace(/\/$/, '')

    const {ReceiveOperationApi} = await import('./operations/receiveOperationApi')
    const {getDecodedToken} = await import('@cashu/cashu-ts')

    let transactionIdForRecovery: number | undefined

    try {
        // Pre-decode the token so prepare() doesn't need the wallet's keysetIds
        // separately — it'll re-verify DLEQ regardless.
        const {mintsStore} = rootStoreInstance
        const mintInstance = mintsStore.findByUrl(mintToReceive)
        const token = getDecodedToken(encodedToken, mintInstance?.keysetIds ?? [])

        const prepared = await ReceiveOperationApi.prepare({
            mintUrl: mintToReceive,
            amount: amountToReceive,
            unit,
            memo,
            method: {method: 'cashu-token', options: {token, encodedToken, offline: true}},
        })
        transactionIdForRecovery = prepared.transactionId

        if (prepared.blocked) {
            return {
                taskFunction: RECEIVE_OFFLINE_PREPARE_TASK,
                mintUrl: mintToReceive,
                transaction: prepared.tx,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionTaskResult
        }

        const code = getCurrency(unit).code
        return {
            taskFunction: RECEIVE_OFFLINE_PREPARE_TASK,
            mintUrl: mintToReceive,
            transaction: prepared.tx,
            message: `You received ${formatCurrency(amountToReceive, code)} ${code} while offline. You need to redeem them to your wallet when you will be online again.`,
        } as TransactionTaskResult
    } catch (e: any) {
        _stampErrorIfNeeded(transactionIdForRecovery, e)
        log.error(e.name, e.message)
        return {
            taskFunction: RECEIVE_OFFLINE_PREPARE_TASK,
            mintUrl: mintToReceive,
            transaction: transactionIdForRecovery
                ? transactionsStore.findById(transactionIdForRecovery)
                : undefined,
            message: '',
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}

/**
 * Backward-compatible offline-complete task wrapper.
 *
 * Resumes a previously-prepared offline receive: re-builds the prepared
 * snapshot from disk (tx.inputToken) and runs `ReceiveOperationApi.execute`.
 */
export const receiveOfflineCompleteTask = async function (
    transactionId: number,
): Promise<TransactionTaskResult> {
    const tx = transactionsStore.findById(transactionId)
    let mintToReceive = tx?.mint ?? ''

    const {ReceiveOperationApi, receiveSuccessMessage, loadPreparedForOfflineComplete} =
        await import('./operations/receiveOperationApi')

    try {
        if (!tx) {
            const {default: AppError, Err} = await import('../../utils/AppError')
            throw new AppError(Err.VALIDATION_ERROR, 'Could not retrieve transaction.', {transactionId})
        }
        mintToReceive = tx.mint

        const prepared = loadPreparedForOfflineComplete(transactionId)

        if (prepared.blocked) {
            return {
                taskFunction: RECEIVE_OFFLINE_COMPLETE_TASK,
                mintUrl: mintToReceive,
                transaction: prepared.tx,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionTaskResult
        }

        const completed = await ReceiveOperationApi.execute(prepared)

        const swapFeePaid = completed.fee ?? 0
        const receivedAmount = completed.amount

        return {
            taskFunction: RECEIVE_OFFLINE_COMPLETE_TASK,
            mintUrl: mintToReceive,
            transaction: completed,
            message: receiveSuccessMessage(receivedAmount, completed.unit, swapFeePaid),
            receivedAmount,
        } as TransactionTaskResult
    } catch (e: any) {
        _stampErrorIfNeeded(transactionId, e)
        return {
            taskFunction: RECEIVE_OFFLINE_COMPLETE_TASK,
            mintUrl: mintToReceive,
            transaction: transactionsStore.findById(transactionId),
            message: '',
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}

/**
 * Backward-compatible Cashu Payment Request fulfillment wrapper.
 *
 * Triggered by NostrOperationService when a DM arrives matching one of our
 * outstanding PRs. Delegates to `CashuPaymentRequestApi.finalize`.
 */
export const receiveByCashuPaymentRequestTask = async function (
    paymentRequestPayload: PaymentRequestPayload,
): Promise<TransactionTaskResult> {
    const mintToReceive = paymentRequestPayload.mint
    const paymentRequestId = paymentRequestPayload.id

    // The tx was created by `cashuPaymentRequestTask` (now CashuPaymentRequestApi)
    // and parked at PENDING with paymentId === paymentRequestId.
    const tx = transactionsStore.findLastBy({paymentId: paymentRequestId}) as
        | Transaction
        | undefined

    const {CashuPaymentRequestApi, cashuPaymentRequestSuccessMessage} = await import(
        './operations/cashuPaymentRequestApi'
    )

    try {
        if (!tx) {
            const {default: AppError, Err} = await import('../../utils/AppError')
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Related Payment request could not be found in the wallet.',
                {paymentRequestPayload},
            )
        }

        const completed = await CashuPaymentRequestApi.finalize(tx.id, paymentRequestPayload)

        const receivedAmount = completed.amount
        const message = cashuPaymentRequestSuccessMessage(
            paymentRequestId ?? '',
            receivedAmount,
            completed.unit,
        )

        return {
            taskFunction: RECEIVE_BY_CASHU_PAYMENT_REQUEST_TASK,
            mintUrl: mintToReceive,
            transaction: completed,
            message,
            receivedAmount,
        } as TransactionTaskResult
    } catch (e: any) {
        log.error(e.name, e.message)
        if (tx && tx.status !== TransactionStatus.ERROR && tx.status !== TransactionStatus.BLOCKED) {
            _stampErrorIfNeeded(tx.id, e)
        }
        return {
            taskFunction: RECEIVE_BY_CASHU_PAYMENT_REQUEST_TASK,
            mintUrl: mintToReceive,
            transaction: tx,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}

function _stampErrorIfNeeded(transactionId: number | undefined, e: any) {
    if (!transactionId) return
    const tx = transactionsStore.findById(transactionId)
    if (!tx) return
    if (tx.status === TransactionStatus.ERROR || tx.status === TransactionStatus.BLOCKED) return

    let transactionData: TransactionData[] = []
    try { transactionData = JSON.parse(tx.data) } catch {}
    transactionData.push({
        status: TransactionStatus.ERROR,
        error: WalletUtils.formatError(e),
        errorToken: e?.params?.errorToken || undefined,
    })
    tx.update({
        status: TransactionStatus.ERROR,
        data: JSON.stringify(transactionData),
    })
}
