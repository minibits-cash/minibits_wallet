/**
 * Transfer (lightning melt) operation lifecycle API.
 *
 * Splits the historical monolithic `transferTask` into explicit lifecycle methods:
 *
 *   prepare()  →  PreparedTransferData  (DRAFT → PREPARED, melt reservation OPEN,
 *                                        preemptive swap done if beneficial)
 *   execute()  →  PendingTransaction |
 *                 CompletedTransaction  (PREPARED → EXECUTING →
 *                                        PENDING/COMPLETED, atomic commit)
 *   cancel()   →  RevertedTransaction   (PREPARED → REVERTED, reservation ROLLED BACK)
 *   reclaim()  →  RevertedTransaction   (PENDING → REVERTED via existing revertTask)
 *   finalize() →  CompletedTransaction  (PENDING → COMPLETED after mint reports PAID)
 *   refresh()  →  Transaction           (re-check PENDING with mint; mirrors the
 *                                        legacy handlePendingMeltTask: PAID →
 *                                        COMPLETED, UNPAID → ERROR + revert)
 *
 * Between `prepare` and either `execute` or `cancel`, the melt reservation row
 * stays in SQLite — so a crash leaves an orphan that startup recovery rolls
 * back automatically. No proofs get stuck.
 *
 * The legacy `WalletTask.transferQueueAwaitable` and `handlePendingMeltTask`
 * continue to work via thin wrappers in `transferTask.ts` and
 * `meltOperations.ts` that call into this API.
 */

import {isBefore} from 'date-fns'
import {
    getEncodedToken,
    normalizeProofAmounts,
    MeltProofsResponse,
    MeltQuoteBolt11Response,
    MeltQuoteState,
    Mint as CashuMint,
    Wallet as CashuWallet,
} from '@cashu/cashu-ts'
import {log} from '../../logService'
import {MintError, ValidationError, WalletError} from '../../../utils/AppError'
import EventEmitter from '../../../utils/eventEmitter'
import {rootStoreInstance} from '../../../models'
import {MintBalance} from '../../../models/Mint'
import {Proof} from '../../../models/Proof'
import {
    Transaction,
    TransactionData,
    TransactionStatus,
    TransactionType,
} from '../../../models/Transaction'
import {
    CompletedTransaction,
    PendingTransaction,
    PreparedTransaction,
    RevertedTransaction,
    isCompleted,
    isPending,
    isPrepared,
    isReverted,
} from '../../../models/TransactionStates'
import {CashuUtils} from '../../cashu/cashuUtils'
import {LightningUtils} from '../../lightning/lightningUtils'
import {MintUnit, formatCurrency, getCurrency} from '../currency'
import {NostrEvent} from '../../nostrService'
import {WalletUtils} from '../utils'
import {WalletTask} from '../../walletService'
import {ProofReservation} from '../proofReservation'
import {Database, ReservationRow} from '../../sqlite'
import {poller} from '../../../utils/poller'
import {Err} from '../../../utils/AppError'
import {TransferMethodInput} from './transferMethods'

const {mintsStore, proofsStore, transactionsStore, walletStore} = rootStoreInstance

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareTransferInput {
    mintBalance: MintBalance
    /** Amount the recipient receives (excludes lightning + mint fees). */
    amount: number
    unit: MintUnit
    memo: string
    /** Transfer method discriminator (currently only `bolt11`). */
    method: TransferMethodInput
    /** NWC request that triggered this transfer (optional). */
    nwcEvent?: NostrEvent
    /** Resume from an existing DRAFT transaction (e.g. retry after error). */
    draftTransactionId?: number
}

/**
 * Path the prepared transfer will follow when executed.
 * - `direct-melt`: locked proofs are paid out as-is.
 * - `preemptive-swap-then-melt`: oversized inputs were swapped for tighter
 *    denominations during prepare to keep mint melt fees low; the swap output
 *    becomes the melt input.
 */
export type TransferPath = 'direct-melt' | 'preemptive-swap-then-melt'

/**
 * Returned by `prepare`. Holds enough computed metadata for execute() to
 * proceed without recomputing fees or re-selecting proofs.
 */
export interface PreparedTransferData {
    transactionId: number
    /** Snapshot of the tx at prepare time. Re-fetch by id for live state. */
    tx: PreparedTransaction
    mintUrl: string
    unit: MintUnit
    amountToTransfer: number
    meltQuote: MeltQuoteBolt11Response
    invoiceExpiry: Date
    path: TransferPath
    method: TransferMethodInput
    /** Proofs locked under the melt reservation (the operation's inputs). */
    proofsToMeltFrom: Proof[]
    proofsToMeltFromAmount: number
    /** Mint swap fee charged for melting these specific proofs. */
    meltFeeReserve: number
    /** Lightning fee reserve (mirror of meltQuote.fee_reserve). */
    lightningFeeReserve: number
    /** Fee paid for the preemptive swap (0 if no swap ran). */
    preemptiveSwapFeePaid: number
    nwcEvent?: NostrEvent
}

// ─────────────────────────────────────────────────────────────────────────────
// prepare()
// ─────────────────────────────────────────────────────────────────────────────

async function prepare(input: PrepareTransferInput): Promise<PreparedTransferData> {
    const {mintBalance, amount, unit, memo, method, nwcEvent, draftTransactionId} = input

    if (amount <= 0) {
        throw new ValidationError('Amount to transfer must be above zero.')
    }
    if (method.method !== 'bolt11') {
        throw new ValidationError(`Unsupported transfer method: ${(method as any).method}`)
    }

    const {meltQuote, encodedInvoice, invoiceExpiry} = method.options
    const mintUrl = mintBalance.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)
    if (!mintInstance) {
        throw new ValidationError('Could not find mint', {mintUrl})
    }

    // ── Create or load the draft transaction ────────────────────────────
    let transaction: Transaction | undefined
    let transactionData: TransactionData[] = []

    if (draftTransactionId && draftTransactionId > 0) {
        transaction = transactionsStore.findById(draftTransactionId)!
        try {
            transactionData = JSON.parse(transaction.data)
        } catch {
            transactionData = []
        }
    } else {
        transactionData.push({
            status: TransactionStatus.DRAFT,
            mintBalanceToTransferFrom: mintBalance,
            amountToTransfer: amount,
            unit,
            meltQuote,
            isNwc: !!nwcEvent,
            createdAt: new Date(),
        })
        transaction = await transactionsStore.addTransaction({
            type: TransactionType.TRANSFER,
            amount,
            fee: meltQuote.fee_reserve.toNumber(),
            unit,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintUrl,
            status: TransactionStatus.DRAFT,
        })
    }
    if (!transaction) {
        throw new ValidationError('Failed to create or load draft transaction')
    }

    const transactionId = transaction.id
    const paymentHash = LightningUtils.getInvoiceData(
        LightningUtils.decodeInvoice(encodedInvoice),
    ).payment_hash
    transaction.update({paymentId: paymentHash, quote: meltQuote.quote})

    // ── Validations ─────────────────────────────────────────────────────
    const lightningFeeReserve = meltQuote.fee_reserve.toNumber()
    if (amount + lightningFeeReserve > mintBalance.balances[unit]!) {
        throw new ValidationError(
            'Mint balance is insufficient to cover the amount to transfer with the expected Lightning fees.',
            {transactionId},
        )
    }
    if (isBefore(invoiceExpiry, new Date())) {
        throw new ValidationError(
            'This invoice has already expired and can not be paid.',
            {invoiceExpiry, transactionId},
        )
    }

    // ── Select proofs and compute fees ──────────────────────────────────
    const proofsFromMint = proofsStore.getByMint(mintUrl, {state: 'UNSPENT', unit})
    const totalAmountFromMint = CashuUtils.getProofsAmount(proofsFromMint)

    let proofsToMeltFrom = CashuUtils.getProofsToSend(
        amount + lightningFeeReserve,
        proofsFromMint,
    )
    let proofsToMeltFromAmount = CashuUtils.getProofsAmount(proofsToMeltFrom)

    const walletInstance = (await walletStore.getWallet(mintUrl, unit, {withSeed: true})) as CashuWallet
    let meltFeeReserve = walletInstance.getFeesForProofs(proofsToMeltFrom).toNumber()
    const amountWithFees = amount + lightningFeeReserve + meltFeeReserve

    if (totalAmountFromMint < amountWithFees) {
        throw new ValidationError('There is not enough funds to send this amount.', {
            totalAmountFromMint,
            amountWithFees,
            transactionId,
            caller: 'TransferOperationApi.prepare',
        })
    }

    if (meltFeeReserve > 0) {
        proofsToMeltFrom = CashuUtils.getProofsToSend(amountWithFees, proofsFromMint)
        proofsToMeltFromAmount = CashuUtils.getProofsAmount(proofsToMeltFrom)
    }

    // ── Preemptive swap path ────────────────────────────────────────────
    // Inputs that overshoot needed amount by >20% get swapped for tighter
    // denominations so the mint charges lower per-proof melt fees. The swap
    // is best-effort: on failure we keep the original proofs.
    let path: TransferPath = 'direct-melt'
    let preemptiveSwapFeePaid = 0

    if (proofsToMeltFromAmount > amountWithFees * 1.2) {
        log.info(
            '[TransferOperationApi.prepare] proofsToMeltFromAmount overshoots amountWithFees by >20%, running preemptive swap',
            {proofsToMeltFromAmount, amountWithFees},
        )

        const swapInputProofs = proofsToMeltFrom
        const swapReservation = proofsStore.reserve(swapInputProofs, {
            transactionId,
            mintUrl,
            unit,
            operationType: 'transfer-swap',
            rollbackTo: 'UNSPENT',
        })

        try {
            const swapResult = await walletStore.send(
                mintUrl,
                amountWithFees,
                unit,
                swapInputProofs,
                transactionId,
            )

            const returnedSecrets = new Set(swapResult.returnedProofs.map(p => p.secret))
            const consumedBySwap = swapInputProofs.filter(p => !returnedSecrets.has(p.secret))

            const {added} = proofsStore.commitReservation(swapReservation, {
                toSpent: consumedBySwap,
                newProofs: [
                    {proofs: swapResult.returnedProofs, state: 'UNSPENT', tId: transactionId},
                    {proofs: swapResult.proofsToSend, state: 'PENDING', tId: transactionId},
                ],
            })

            const swapOutputSecrets = new Set(swapResult.proofsToSend.map(p => p.secret))
            const pendingSwapProofs = added.filter(p => swapOutputSecrets.has(p.secret))

            proofsToMeltFromAmount =
                CashuUtils.getProofsAmount(swapResult.proofsToSend) + swapResult.swapFeePaid
            meltFeeReserve += swapResult.swapFeePaid
            preemptiveSwapFeePaid = swapResult.swapFeePaid
            proofsToMeltFrom = pendingSwapProofs
            path = 'preemptive-swap-then-melt'

            log.debug('[TransferOperationApi.prepare] Preemptive swap completed', {
                proofsToMeltFromAmount,
                preemptiveSwapFeePaid,
                meltFeeReserve,
            })
        } catch (swapError: any) {
            log.warn(
                '[TransferOperationApi.prepare] Preemptive swap failed, continuing with original proofs',
                {error: swapError.message},
            )
            proofsStore.rollbackReservation(swapReservation)
        }
    }

    // ── Open MELT reservation (left OPEN — execute/cancel resolves) ─────
    // If the swap path ran, proofsToMeltFrom are already PENDING (from the
    // swap commit). Reserving them again creates an orphan-recovery marker
    // for the melt phase; rollback restores them to UNSPENT (the swap output
    // is freshly-minted ecash, safely spendable on failure).
    proofsStore.reserve(proofsToMeltFrom, {
        transactionId,
        mintUrl,
        unit,
        operationType: path === 'preemptive-swap-then-melt' ? 'transfer-melt-after-swap' : 'transfer-melt',
        rollbackTo: 'UNSPENT',
    })

    // ── Transition DRAFT → PREPARED ─────────────────────────────────────
    transactionData.push({
        status: TransactionStatus.PREPARED,
        proofsToMeltFromAmount,
        lightningFeeReserve,
        meltFeeReserve,
        path,
        method: method.method,
        ...(preemptiveSwapFeePaid > 0 && {preemptiveSwapFeePaid}),
        createdAt: new Date(),
    })

    const inputToken = getEncodedToken({
        mint: mintUrl,
        proofs: normalizeProofAmounts(proofsToMeltFrom),
        unit,
    })

    transaction.update({
        status: TransactionStatus.PREPARED,
        data: JSON.stringify(transactionData),
        keysetId: proofsToMeltFrom[0].id,
        inputToken,
    })

    if (!isPrepared(transaction)) {
        throw new WalletError('Failed to transition transaction to PREPARED', {
            transactionId,
            status: transaction.status,
        })
    }

    log.debug('[TransferOperationApi.prepare]', 'Prepared', {
        transactionId,
        path,
        amount,
        meltFeeReserve,
        lightningFeeReserve,
        preemptiveSwapFeePaid,
        lockedCount: proofsToMeltFrom.length,
    })

    return {
        transactionId,
        tx: transaction,
        mintUrl,
        unit,
        amountToTransfer: amount,
        meltQuote,
        invoiceExpiry,
        path,
        method,
        proofsToMeltFrom,
        proofsToMeltFromAmount,
        meltFeeReserve,
        lightningFeeReserve,
        preemptiveSwapFeePaid,
        nwcEvent,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// execute()
//
// Marks tx EXECUTING, calls payLightningMelt, then commits atomically based on
// the mint's quote state:
//   - PAID:    inputs → SPENT, change → UNSPENT, tx → COMPLETED.
//   - PENDING: no proof changes, tx → PENDING; async ws/poller resolves later.
//   - UNPAID:  rollback reservation (proofs → UNSPENT) and throw.
//
// Errors are routed through `_handleExecuteError` which re-checks the quote
// (the mint may have paid even though the client errored) and chooses the
// right cleanup path.
// ─────────────────────────────────────────────────────────────────────────────

async function execute(
    prepared: PreparedTransferData,
): Promise<PendingTransaction | CompletedTransaction> {
    const tx = transactionsStore.findById(prepared.transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId: prepared.transactionId})
    }
    if (!isPrepared(tx)) {
        throw new ValidationError(
            `Cannot execute transfer in state ${tx.status}. Expected PREPARED.`,
            {transactionId: tx.id, status: tx.status},
        )
    }

    const reservation = _findReservationForTx(tx.id)
    if (!reservation) {
        throw new ValidationError(
            'No open reservation for transaction. The reservation may have been rolled back by orphan recovery.',
            {transactionId: tx.id},
        )
    }

    let transactionData: TransactionData[] = _parseData(tx)
    const {
        mintUrl,
        unit,
        amountToTransfer,
        meltQuote,
        proofsToMeltFrom,
        proofsToMeltFromAmount,
        meltFeeReserve,
        nwcEvent,
    } = prepared

    tx.update({status: TransactionStatus.EXECUTING})

    let meltResponse: MeltProofsResponse
    try {
        meltResponse = await walletStore.payLightningMelt(
            mintUrl,
            unit,
            meltQuote,
            proofsToMeltFrom,
            tx.id,
            {preferAsync: nwcEvent ? false : true},
        )
    } catch (e: any) {
        if (WalletUtils.shouldHealOutputsError(e)) {
            log.error(
                '[TransferOperationApi.execute] Increasing proofsCounter outdated values and repeating payLightningMelt.',
            )
            try {
                meltResponse = await walletStore.payLightningMelt(
                    mintUrl,
                    unit,
                    meltQuote,
                    proofsToMeltFrom,
                    tx.id,
                    {increaseCounterBy: 10, preferAsync: nwcEvent ? false : true},
                )
            } catch (e2: any) {
                return _handleExecuteError(e2, {
                    tx,
                    transactionData,
                    reservation,
                    prepared,
                })
            }
        } else {
            return _handleExecuteError(e, {
                tx,
                transactionData,
                reservation,
                prepared,
            })
        }
    }

    // ── PAID synchronously → finalize now ───────────────────────────────
    if (meltResponse.quote.state === MeltQuoteState.PAID) {
        const returnedAmount = CashuUtils.getProofsAmount(meltResponse.change)
        const totalFeePaid = proofsToMeltFromAmount - amountToTransfer - returnedAmount
        const lightningFeePaid = totalFeePaid - meltFeeReserve
        const meltFeePaid = meltFeeReserve

        let outputToken: string | undefined
        if (meltResponse.change.length > 0) {
            outputToken = getEncodedToken({
                mint: mintUrl,
                proofs: meltResponse.change,
                unit,
            })
        }

        const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
        const balanceAfter = currentSpendable + returnedAmount

        transactionData.push({
            status: TransactionStatus.COMPLETED,
            lightningFeePaid,
            meltFeePaid,
            returnedAmount,
            //@ts-ignore — payment_preimage is loosely typed in cashu-ts
            preimage: meltResponse.quote.payment_preimage,
            createdAt: new Date(),
        })

        proofsStore.commitReservation(reservation, {
            toSpent: proofsToMeltFrom,
            newProofs:
                meltResponse.change.length > 0
                    ? [{proofs: meltResponse.change, state: 'UNSPENT', tId: tx.id}]
                    : [],
            transactionUpdate: {
                id: tx.id,
                status: TransactionStatus.COMPLETED,
                data: JSON.stringify(transactionData),
                fee: totalFeePaid,
                balanceAfter,
                ...(outputToken && {outputToken}),
                //@ts-ignore — payment_preimage is loosely typed in cashu-ts
                ...(meltResponse.quote.payment_preimage && {proof: meltResponse.quote.payment_preimage}),
            },
        })

        log.debug('[TransferOperationApi.execute] Invoice PAID', {transactionId: tx.id, totalFeePaid})
        return _assertCompleted(tx, tx.id)
    }

    // ── PENDING async → tx PENDING, monitor will finalize via refresh ───
    if (meltResponse.quote.state === MeltQuoteState.PENDING) {
        transactionData.push({
            status: TransactionStatus.PENDING,
            createdAt: new Date(),
        })

        proofsStore.commitReservation(reservation, {
            transactionUpdate: {
                id: tx.id,
                status: TransactionStatus.PENDING,
                data: JSON.stringify(transactionData),
            },
        })

        _monitorAsyncMeltQuote({
            mintUrl,
            unit,
            quoteId: meltResponse.quote.quote,
            transactionId: tx.id,
        })

        log.debug('[TransferOperationApi.execute] Invoice PENDING, async melt in progress', {
            quoteId: meltResponse.quote.quote,
            transactionId: tx.id,
        })

        const refreshed = transactionsStore.findById(tx.id)!
        if (!isPending(refreshed)) {
            throw new WalletError(
                'Transaction did not transition to PENDING after execute',
                {transactionId: tx.id, status: refreshed.status},
            )
        }
        return refreshed
    }

    // ── UNPAID → throw so caller (wrapper) can mark ERROR. Rollback the
    //    reservation atomically to restore proofs to UNSPENT.
    proofsStore.rollbackReservation(reservation)
    throw new MintError('Lightning payment has not been paid.', {
        meltResponseQuote: meltResponse.quote,
        transactionId: tx.id,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel() — PREPARED → REVERTED
// ─────────────────────────────────────────────────────────────────────────────

async function cancel(transactionId: number): Promise<RevertedTransaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (!isPrepared(tx)) {
        throw new ValidationError(
            `Cannot cancel transfer in state ${tx.status}. Expected PREPARED.`,
            {transactionId, status: tx.status},
        )
    }

    const reservation = _findReservationForTx(transactionId)
    if (!reservation) {
        const transactionData = _parseData(tx)
        transactionData.push({
            status: TransactionStatus.REVERTED,
            message: 'No reservation to roll back',
            createdAt: new Date(),
        })
        tx.update({status: TransactionStatus.REVERTED, data: JSON.stringify(transactionData)})
        log.warn(
            '[TransferOperationApi.cancel]',
            'No open reservation found; marked tx REVERTED',
            {transactionId},
        )
        return _assertReverted(tx, transactionId)
    }

    const transactionData = _parseData(tx)
    transactionData.push({
        status: TransactionStatus.REVERTED,
        cancelledBy: 'user',
        createdAt: new Date(),
    })

    proofsStore.rollbackReservation(reservation)
    tx.update({
        status: TransactionStatus.REVERTED,
        data: JSON.stringify(transactionData),
    })

    log.info('[TransferOperationApi.cancel]', 'Cancelled', {transactionId})
    return _assertReverted(tx, transactionId)
}

// ─────────────────────────────────────────────────────────────────────────────
// reclaim() — PENDING → REVERTED via existing revertTask path
// ─────────────────────────────────────────────────────────────────────────────

async function reclaim(transactionId: number): Promise<RevertedTransaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (!isPending(tx)) {
        throw new ValidationError(
            `Cannot reclaim transfer in state ${tx.status}. Expected PENDING.`,
            {transactionId, status: tx.status},
        )
    }
    const {revertTask} = await import('../revertTask')
    const result = await revertTask(tx)
    if (result.error) {
        throw new MintError(result.error.message ?? 'Reclaim failed', {transactionId})
    }
    const refreshed = transactionsStore.findById(transactionId)!
    return refreshed as RevertedTransaction
}

// ─────────────────────────────────────────────────────────────────────────────
// finalize() — PENDING → COMPLETED (after mint confirms PAID).
//
// Mirrors the COMPLETED branch of the legacy `handlePendingMeltTask`: unblinds
// the deterministic change proofs (using the meltPreview stashed at execute
// time), then atomically commits proofs SPENT, change UNSPENT, tx COMPLETED.
// ─────────────────────────────────────────────────────────────────────────────

async function finalize(transactionId: number): Promise<CompletedTransaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (tx.status === TransactionStatus.COMPLETED) {
        return tx as CompletedTransaction
    }
    if (!isPending(tx)) {
        throw new ValidationError(
            `Cannot finalize transfer in state ${tx.status}. Expected PENDING or COMPLETED.`,
            {transactionId, status: tx.status},
        )
    }
    if (!tx.quote) {
        throw new ValidationError('Transfer has no quote id; cannot finalize.', {transactionId})
    }

    const quote = await walletStore.checkLightningMeltQuote(tx.mint, tx.quote)
    if (quote.state !== MeltQuoteState.PAID) {
        throw new MintError(
            `Cannot finalize transfer; mint reports quote state ${quote.state}.`,
            {transactionId, state: quote.state},
        )
    }

    return _finalizePaid(tx, quote)
}

// ─────────────────────────────────────────────────────────────────────────────
// refresh() — re-check PENDING transfer with the mint.
//
// Mirrors the full legacy `handlePendingMeltTask` flow:
//   - quote PAID:   → finalize (COMPLETED, recover change atomically).
//   - quote UNPAID: revert proofs to UNSPENT and mark tx ERROR.
//   - quote PENDING: no-op, async monitor will call again.
// ─────────────────────────────────────────────────────────────────────────────

async function refresh(transactionId: number): Promise<Transaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (!isPending(tx)) {
        return tx
    }
    if (!tx.quote) {
        log.warn('[TransferOperationApi.refresh] PENDING transfer missing quote id; skipping', {
            transactionId,
        })
        return tx
    }

    const quote = await walletStore.checkLightningMeltQuote(tx.mint, tx.quote)

    if (quote.state === MeltQuoteState.PAID) {
        const completed = await _finalizePaid(tx, quote)
        EventEmitter.emit('ev_asyncMeltResult', {
            transactionId,
            status: TransactionStatus.COMPLETED,
            message: `Lightning invoice paid. Fee: ${formatCurrency(tx.fee, getCurrency(tx.unit).code)} ${getCurrency(tx.unit).code}.`,
        })
        return completed
    }

    if (quote.state === MeltQuoteState.UNPAID) {
        // Lightning failed → proofs go back to spendable, tx is REVERTED.
        // (Original `handlePendingMeltTask` stamped ERROR here, but sync has
        // always used REVERTED for the same logical event — REVERTED is the
        // accurate terminal status, since the ecash IS recoverable.)
        const pendingProofs = proofsStore
            .getByTransactionId(tx.id)
            .filter(p => p.state === 'PENDING')
        if (pendingProofs.length > 0) {
            proofsStore.revertToSpendable(pendingProofs)
        }

        const txData = _parseData(tx)
        txData.push({
            status: TransactionStatus.REVERTED,
            message: 'Lightning payment failed – ecash returned to spendable balance',
            createdAt: new Date(),
        })
        tx.update({status: TransactionStatus.REVERTED, data: JSON.stringify(txData)})

        log.debug('[TransferOperationApi.refresh] Transaction reverted (UNPAID)', {transactionId})

        EventEmitter.emit('ev_asyncMeltResult', {
            transactionId,
            status: TransactionStatus.REVERTED,
            message: 'Lightning payment failed. Ecash returned to spendable balance.',
        })
        return tx
    }

    // PENDING: ws/poller will call back later.
    return tx
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Centralised error-recovery flow for `execute`. The mint may have paid the
 * invoice even though the client errored — so we re-check the quote and choose
 * the right cleanup path before rethrowing.
 */
async function _handleExecuteError(
    e: any,
    ctx: {
        tx: Transaction
        transactionData: TransactionData[]
        reservation: ProofReservation
        prepared: PreparedTransferData
    },
): Promise<never> {
    const {tx, transactionData, reservation, prepared} = ctx
    const {mintUrl, unit, meltQuote, proofsToMeltFrom, proofsToMeltFromAmount} = prepared

    let meltQuoteCheck: MeltQuoteBolt11Response
    try {
        meltQuoteCheck = await walletStore.checkLightningMeltQuote(mintUrl, meltQuote.quote)
    } catch (checkError: any) {
        // Quote check itself failed — leave the reservation as-is, the orphan
        // recovery sweep + sync will reconcile on the next startup.
        log.error(
            '[TransferOperationApi.execute] Quote re-check failed after execute error; reservation left open for recovery',
            {transactionId: tx.id, originalError: e.message, checkError: checkError.message},
        )
        throw e
    }

    // ── PAID despite client error → recover change, mark RECOVERED ──────
    if (meltQuoteCheck.state === MeltQuoteState.PAID) {
        proofsStore.commitReservation(reservation, {
            toSpent: proofsToMeltFrom,
        })

        let recoveredAmount = 0
        try {
            const recovery = await WalletTask.recoverMeltQuoteChange({
                mintUrl,
                meltQuote: meltQuoteCheck,
            })
            recoveredAmount = recovery.recoveredAmount
        } catch (recoverError: any) {
            log.error('[TransferOperationApi.execute] Change recovery failed', {
                transactionId: tx.id,
                error: recoverError.message,
            })
        }

        transactionData.push({
            status: TransactionStatus.RECOVERED,
            recoveredChangeAmount: recoveredAmount,
            error: WalletUtils.formatError(e),
            createdAt: new Date(),
        })
        tx.update({
            status: TransactionStatus.RECOVERED,
            data: JSON.stringify(transactionData),
        })

        log.error('[TransferOperationApi.execute]', 'PAID despite error; recovered change.', {
            recoveredAmount,
            error: e.message,
            transactionId: tx.id,
        })
        throw e
    }

    // ── PENDING by mint → leave proofs PENDING, drop reservation row ────
    if (meltQuoteCheck.state === MeltQuoteState.PENDING) {
        proofsStore.commitReservation(reservation)
        log.error(
            '[TransferOperationApi.execute]',
            'Lightning payment did not complete in time. Will remain pending.',
            {error: e.message, transactionId: tx.id},
        )
        throw e
    }

    // ── UNPAID by mint ──────────────────────────────────────────────────
    if (WalletUtils.isTokenAlreadySpentError(e)) {
        // Mint says one of our inputs is already spent. Sync will reconcile;
        // drop the reservation without restoring (proofs likely SPENT at mint).
        proofsStore.commitReservation(reservation)
        log.error(
            '[TransferOperationApi.execute]',
            'Token already spent, sync will reconcile.',
            {transactionId: tx.id},
        )
        await WalletTask.syncStateWithMintTask({
            proofsToSync: proofsStore.getByMint(mintUrl, {state: 'PENDING', unit}),
            mintUrl,
            proofState: 'PENDING',
        })
        throw e
    }
    if (WalletUtils.isTokenPendingError(e)) {
        // Mint says an input is pending in another in-flight melt. Don't
        // release proofs — sync resolves it once the other op settles.
        proofsStore.commitReservation(reservation)
        log.error(
            '[TransferOperationApi.execute]',
            'Pending proofs were used for this transaction, syncing.',
            {transactionId: tx.id},
        )
        await WalletTask.syncStateWithMintTask({
            proofsToSync: proofsToMeltFrom,
            mintUrl,
            proofState: 'PENDING',
        })
        await WalletTask.syncStateWithMintTask({
            proofsToSync: proofsStore.getByMint(mintUrl, {state: 'PENDING', unit}),
            mintUrl,
            proofState: 'PENDING',
        })
        throw e
    }

    // Clean unpaid: rollback restores proofs to UNSPENT.
    proofsStore.rollbackReservation(reservation)
    log.error(
        '[TransferOperationApi.execute]',
        'Ecash reserved for this payment was returned to spendable balance.',
        {proofsToMeltFromAmount, transactionId: tx.id},
    )
    throw e
}

/**
 * Atomic settle of a confirmed-PAID transfer: unblind change, commit
 * (proofs → SPENT, change → UNSPENT, tx → COMPLETED) in one SQLite txn.
 */
async function _finalizePaid(
    tx: Transaction,
    quote: MeltQuoteBolt11Response,
): Promise<CompletedTransaction> {
    const transactionId = tx.id
    const mintUrl = tx.mint
    const unit = tx.unit

    // pendingProofs may be empty when called from sync after a bulk SPENT
    // marking — but we still need to unblind change and atomic-commit the tx
    // transition. The empty-array branches inside reservation/commitReservation
    // make `toSpent: []` a no-op, while change INSERT + tx UPDATE still land
    // in one SQLite transaction.
    const pendingProofs = proofsStore
        .getByTransactionId(transactionId)
        .filter(p => p.state === 'PENDING')

    // Fee math: when sync already moved proofs SPENT, the locally-PENDING set
    // is empty, so reconstruct the input amount from the tx record (the
    // original `proofsToMeltFromAmount` was stored on tx.data at PREPARED time).
    const proofsToMeltFromAmount =
        pendingProofs.length > 0
            ? CashuUtils.getProofsAmount(pendingProofs)
            : (_readNumberFromData(tx, 'proofsToMeltFromAmount') ?? tx.amount)
    const amountToTransfer = tx.amount
    const meltFeeReserve = _readNumberFromData(tx, 'meltFeeReserve') ?? 0
    let totalFeePaid = proofsToMeltFromAmount - amountToTransfer
    let lightningFeePaid = totalFeePaid - meltFeeReserve
    const meltFeePaid = meltFeeReserve

    // Unblind change BEFORE opening the reservation; same fallback behaviour as
    // the pre-reservation code — change recovery failure doesn't block finalize.
    const unblinded = await _unblindMeltChange({
        mintUrl,
        unit,
        quoteId: quote.quote,
        transaction: tx,
        quoteChange: quote.change,
    })

    let returnedAmount = 0
    let outputToken: string | undefined
    if (unblinded.change.length > 0) {
        returnedAmount = CashuUtils.getProofsAmount(unblinded.change)
        outputToken = getEncodedToken({mint: mintUrl, proofs: unblinded.change, unit})
        totalFeePaid -= returnedAmount
        lightningFeePaid = totalFeePaid - meltFeeReserve
    }

    const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
    const balanceAfter = currentSpendable + returnedAmount

    const txData = _parseData(tx)
    txData.push({
        status: TransactionStatus.COMPLETED,
        lightningFeePaid,
        meltFeePaid,
        returnedAmount,
        //@ts-ignore
        preimage: quote.payment_preimage,
        createdAt: new Date(),
    })

    const reservation = proofsStore.reserve(pendingProofs, {
        transactionId,
        mintUrl,
        unit,
        operationType: 'pending-melt-finalize-paid',
        rollbackTo: 'PENDING',
    })

    proofsStore.commitReservation(reservation, {
        toSpent: pendingProofs,
        newProofs:
            unblinded.change.length > 0
                ? [{proofs: unblinded.change, state: 'UNSPENT', tId: transactionId}]
                : [],
        transactionUpdate: {
            id: transactionId,
            status: TransactionStatus.COMPLETED,
            data: JSON.stringify(txData),
            fee: totalFeePaid,
            balanceAfter,
            ...(outputToken && {outputToken}),
            //@ts-ignore — payment_preimage is loosely typed in cashu-ts
            ...(quote.payment_preimage && {proof: quote.payment_preimage}),
        },
    })

    log.debug('[TransferOperationApi._finalizePaid] Transaction completed', {
        transactionId,
        totalFeePaid,
    })
    return _assertCompleted(tx, transactionId)
}

/**
 * Reconstruct deterministic change proofs from the mint's quote.change blinded
 * signatures using the meltPreview captured at execute time. Logs but never
 * throws — failure just means no change recovery, matching pre-reservation
 * behaviour. Lifted from `meltOperations.unblindPendingMeltChange`.
 */
async function _unblindMeltChange(params: {
    mintUrl: string
    unit: MintUnit
    quoteId: string
    transaction: Transaction
    quoteChange: MeltQuoteBolt11Response['change']
}) {
    const {mintUrl, unit, quoteId, transaction, quoteChange} = params
    try {
        const mintInstance = mintsStore.findByUrl(mintUrl)
        if (!mintInstance || !transaction.keysetId) return {change: []}

        const currentCounter = mintInstance.getProofsCounterByKeysetId!(transaction.keysetId)
        const meltCounterValue = currentCounter?.getMeltCounterValue(transaction.id)

        if (!meltCounterValue?.meltPreview || !quoteChange?.length) {
            return {change: []}
        }

        const {meltPreview} = meltCounterValue
        const cashuWallet = await walletStore.getWallet(mintUrl, unit, {
            withSeed: true,
            keysetId: meltPreview.keysetId,
        })
        const keyset = cashuWallet.getKeyset(meltPreview.keysetId)

        const reconstructedOutputData = CashuUtils.deserializeOutputData(meltPreview.outputData)
        const change = quoteChange.map((sig, i) =>
            reconstructedOutputData[i].toProof(sig, keyset),
        )

        log.trace('[TransferOperationApi._unblindMeltChange] Change unblinded', {
            transactionId: transaction.id,
            quoteId,
            change,
        })

        currentCounter.removeMeltCounterValue(transaction.id)
        return {change}
    } catch (e: any) {
        log.error(
            '[TransferOperationApi._unblindMeltChange] Change recovery failed; completing without change',
            {message: e.message},
        )
        return {change: []}
    }
}

/**
 * Subscribe to mint websocket for meltQuoteUpdates. When the mint signals
 * PAID or UNPAID, call `refresh` to resolve the tx. Falls back to a poller
 * if the websocket subscription fails.
 */
async function _monitorAsyncMeltQuote(params: {
    mintUrl: string
    unit: MintUnit
    quoteId: string
    transactionId: number
}) {
    const {mintUrl, quoteId, transactionId} = params
    const wsMint = new CashuMint(mintUrl)
    const wsWallet = new CashuWallet(wsMint)

    try {
        log.trace('[TransferOperationApi]', 'Subscribing to meltQuoteUpdates', {quoteId})
        const unsub = await wsWallet.on.meltQuoteUpdates(
            [quoteId],
            async (updatedQuote: MeltQuoteBolt11Response) => {
                if (
                    updatedQuote.state === MeltQuoteState.PAID ||
                    updatedQuote.state === MeltQuoteState.UNPAID
                ) {
                    try {
                        await refresh(transactionId)
                    } catch (refreshError: any) {
                        log.error(
                            '[TransferOperationApi] refresh failed in ws callback',
                            {transactionId, error: refreshError.message},
                        )
                    }
                    unsub()
                }
            },
            async (error: any) => {
                throw error
            },
        )
    } catch (error: any) {
        log.error(
            Err.NETWORK_ERROR,
            '[TransferOperationApi] WebSocket error for async melt, starting poller.',
            error.message,
        )
        poller(
            `meltQuotePoller-${quoteId}`,
            () => refresh(transactionId),
            {interval: 15 * 1000, maxPolls: 8, maxErrors: 2},
        ).then(() => log.trace('[meltQuotePoller] polling completed', {quoteId}))
    }
}

function _findReservationForTx(transactionId: number): ProofReservation | undefined {
    const all = Database.getOpenReservations()
    const row = all.find(r => r.transactionId === transactionId)
    return row ? _rowToReservation(row) : undefined
}

function _rowToReservation(row: ReservationRow): ProofReservation {
    return {
        id: row.id,
        transactionId: row.transactionId,
        mintUrl: row.mintUrl,
        unit: row.unit as MintUnit,
        operationType: row.operationType,
        lockedProofs: row.lockedProofs,
    }
}

function _parseData(tx: Transaction): TransactionData[] {
    try {
        return JSON.parse(tx.data)
    } catch {
        return []
    }
}

/** Best-effort read of a numeric field from the most recent matching entry in tx.data. */
function _readNumberFromData(tx: Transaction, field: string): number | undefined {
    const arr = _parseData(tx)
    for (let i = arr.length - 1; i >= 0; i--) {
        const v = (arr[i] as any)[field]
        if (typeof v === 'number') return v
    }
    return undefined
}

function _assertReverted(tx: Transaction, transactionId: number): RevertedTransaction {
    const refreshed = transactionsStore.findById(transactionId) ?? tx
    if (!isReverted(refreshed)) {
        throw new WalletError('Transaction did not transition to REVERTED', {
            transactionId,
            status: refreshed.status,
        })
    }
    return refreshed
}

function _assertCompleted(tx: Transaction, transactionId: number): CompletedTransaction {
    const refreshed = transactionsStore.findById(transactionId) ?? tx
    if (!isCompleted(refreshed)) {
        throw new WalletError('Transaction did not transition to COMPLETED', {
            transactionId,
            status: refreshed.status,
        })
    }
    return refreshed
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API export
// ─────────────────────────────────────────────────────────────────────────────

export const TransferOperationApi = {
    prepare,
    execute,
    cancel,
    reclaim,
    finalize,
    refresh,
}
