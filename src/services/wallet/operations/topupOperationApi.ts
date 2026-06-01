/**
 * Topup (lightning mint) operation lifecycle API.
 *
 * Splits the historical `topupTask` + `handlePendingTopupTask` pair into
 * explicit lifecycle methods:
 *
 *   prepare()  →  PreparedTopupData    (DRAFT → PREPARED, mint quote created)
 *   execute()  →  PendingTransaction   (PREPARED → PENDING, ws/poller armed
 *                                       to watch for external payment)
 *   cancel()   →  RevertedTransaction  (PREPARED|PENDING → REVERTED, polling
 *                                       stopped)
 *   reclaim()  →  never                (not applicable to topups — nothing to
 *                                       reclaim)
 *   finalize() →  CompletedTransaction (PENDING → COMPLETED, mint proofs and
 *                                       add them as UNSPENT)
 *   refresh()  →  Transaction          (re-check the mint quote; routes to
 *                                       finalize / EXPIRED / no-op based on
 *                                       quote state)
 *
 * Unlike SEND/TRANSFER, the "lock" here is a mint-side quote, not local
 * proofs. There's no reservation row opened during prepare/execute — the
 * waiting-for-payment window is driven by the mint quote's expiry.
 *
 * `finalize` opens a short-lived empty reservation purely to leverage the
 * atomic-commit primitive (proofs INSERT + tx UPDATE in one SQLite txn).
 *
 * The legacy `WalletTask.topupQueueAwaitable` and `handlePendingTopupTask`
 * continue to work via thin wrappers that call into this API.
 */

import {addSeconds, isBefore} from 'date-fns'
import {
    Mint as CashuMint,
    Wallet as CashuWallet,
    MintQuoteBolt11Response,
    MintQuoteState,
} from '@cashu/cashu-ts'
import {getSnapshot, isStateTreeNode} from 'mobx-state-tree'
import {log} from '../../logService'
import {MintError, ValidationError, WalletError} from '../../../utils/AppError'
import {rootStoreInstance} from '../../../models'
import {MintBalance} from '../../../models/Mint'
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
import {CashuProof} from '../../cashu/cashuUtils'
import {LightningUtils} from '../../lightning/lightningUtils'
import {MintUnit, formatCurrency, getCurrency} from '../currency'
import {NostrEvent} from '../../nostrService'
import {WalletUtils} from '../utils'
import {poller, stopPolling} from '../../../utils/poller'
import {Err} from '../../../utils/AppError'
import {TopupMethodInput} from './topupMethods'
import {sendTopupNotification} from '../notifications'

const {mintsStore, proofsStore, transactionsStore, walletStore, walletProfileStore} =
    rootStoreInstance

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareTopupInput {
    mintBalance: MintBalance
    /** Amount in `unit` to mint. */
    amount: number
    unit: MintUnit
    memo: string
    /** Topup method discriminator (currently only `bolt11`). */
    method: TopupMethodInput
    /** NWC request that triggered this topup (optional). */
    nwcEvent?: NostrEvent
}

/**
 * Returned by `prepare`. Carries the encoded invoice the user needs to pay
 * externally, plus everything `execute` needs to start the watch.
 */
export interface PreparedTopupData {
    transactionId: number
    /** Snapshot of the tx at prepare time. Re-fetch by id for live state. */
    tx: PreparedTransaction
    mintUrl: string
    unit: MintUnit
    amountToTopup: number
    /** Mint quote id — used for state checks and finalize. */
    quote: string
    /** BOLT11 invoice the user pays to fund the mint. */
    encodedInvoice: string
    /** Parsed invoice expiry (or 24h fallback if invoice has no expiry tag). */
    expiresAt: Date
    method: TopupMethodInput
    nwcEvent?: NostrEvent
}

// ─────────────────────────────────────────────────────────────────────────────
// prepare()
// ─────────────────────────────────────────────────────────────────────────────

async function prepare(input: PrepareTopupInput): Promise<PreparedTopupData> {
    const {mintBalance, amount, unit, memo, method, nwcEvent} = input

    if (amount <= 0) {
        throw new ValidationError('Amount to topup must be above zero.')
    }
    if (method.method !== 'bolt11') {
        throw new ValidationError(`Unsupported topup method: ${(method as any).method}`)
    }

    const mintUrl = mintBalance.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)
    if (!mintInstance) {
        throw new ValidationError('Could not find mint', {mintUrl})
    }

    // ── Create the draft transaction ────────────────────────────────────
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            amountToTopup: amount,
            unit,
            createdAt: new Date(),
        },
    ]

    const transaction = await transactionsStore.addTransaction({
        type: TransactionType.TOPUP,
        amount,
        fee: 0,
        unit,
        data: JSON.stringify(transactionData),
        memo,
        mint: mintUrl,
        status: TransactionStatus.DRAFT,
    })
    if (!transaction) {
        throw new ValidationError('Failed to create draft transaction')
    }
    const transactionId = transaction.id

    // ── Ask the mint for a quote (the BOLT11 invoice the user will pay) ─
    const {encodedInvoice, mintQuote} = await walletStore.createLightningMintQuote(
        mintUrl,
        unit,
        amount,
        memo,
    )

    const decodedInvoice = LightningUtils.decodeInvoice(encodedInvoice)
    const {
        payment_hash: paymentHash,
        expiry,
        timestamp,
    } = LightningUtils.getInvoiceData(decodedInvoice)

    // Fallback to 24h if the invoice has no expiry tag.
    const expiresAt =
        expiry && expiry > 0
            ? addSeconds(new Date(timestamp * 1000), expiry)
            : addSeconds(new Date(timestamp * 1000), 86400)

    // Snapshot the (private) contact for display in the history. Public
    // contacts are plain objects already.
    const contactTo = isStateTreeNode(method.options.contactToSendTo)
        ? getSnapshot(method.options.contactToSendTo)
        : method.options.contactToSendTo
    const sentFromValue = contactTo?.nip05 || contactTo?.name || ''
    const sentToValue = walletProfileStore.nip05 || ''

    // ── Transition DRAFT → PREPARED ─────────────────────────────────────
    transactionData.push({
        status: TransactionStatus.PREPARED,
        quote: mintQuote,
        method: method.method,
        createdAt: new Date(),
    })

    transaction.update({
        status: TransactionStatus.PREPARED,
        quote: mintQuote,
        paymentId: paymentHash,
        paymentRequest: encodedInvoice,
        expiresAt,
        sentFrom: sentFromValue || undefined,
        sentTo: sentToValue || undefined,
        data: JSON.stringify(transactionData),
    })

    if (!isPrepared(transaction)) {
        throw new WalletError('Failed to transition transaction to PREPARED', {
            transactionId,
            status: transaction.status,
        })
    }

    log.debug('[TopupOperationApi.prepare]', 'Prepared', {
        transactionId,
        amount,
        quote: mintQuote,
        expiresAt,
    })

    return {
        transactionId,
        tx: transaction,
        mintUrl,
        unit,
        amountToTopup: amount,
        quote: mintQuote,
        encodedInvoice,
        expiresAt,
        method,
        nwcEvent,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// execute()
//
// Transitions PREPARED → PENDING and arms the ws/poller watcher.
// The user pays the invoice externally; the watcher calls `refresh` when the
// mint reports state change.
// ─────────────────────────────────────────────────────────────────────────────

async function execute(prepared: PreparedTopupData): Promise<PendingTransaction> {
    const tx = transactionsStore.findById(prepared.transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId: prepared.transactionId})
    }
    if (!isPrepared(tx)) {
        throw new ValidationError(
            `Cannot execute topup in state ${tx.status}. Expected PREPARED.`,
            {transactionId: tx.id, status: tx.status},
        )
    }

    const transactionData = _parseData(tx)
    transactionData.push({
        status: TransactionStatus.PENDING,
        createdAt: new Date(),
    })

    tx.update({
        status: TransactionStatus.PENDING,
        data: JSON.stringify(transactionData),
    })

    // NWC-driven topups are short-lived requests; the caller polls the queue,
    // so we don't set up a long-running ws/poller for them.
    if (!prepared.nwcEvent) {
        _monitorMintQuote({
            mintUrl: prepared.mintUrl,
            quote: prepared.quote,
            paymentHash: tx.paymentId ?? prepared.quote,
            transactionId: tx.id,
        })
    }

    const refreshed = transactionsStore.findById(tx.id)!
    if (!isPending(refreshed)) {
        throw new WalletError(
            'Transaction did not transition to PENDING after execute',
            {transactionId: tx.id, status: refreshed.status},
        )
    }
    return refreshed
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel() — PREPARED|PENDING → REVERTED
//
// Marks the topup as abandoned. The mint quote stays open at the mint
// (no API to invalidate it), so if the user later pays the invoice anyway,
// the funds can be recovered via `recoverMintQuote`.
// ─────────────────────────────────────────────────────────────────────────────

async function cancel(transactionId: number): Promise<RevertedTransaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (!isPrepared(tx) && !isPending(tx)) {
        throw new ValidationError(
            `Cannot cancel topup in state ${tx.status}. Expected PREPARED or PENDING.`,
            {transactionId, status: tx.status},
        )
    }

    const transactionData = _parseData(tx)
    transactionData.push({
        status: TransactionStatus.REVERTED,
        cancelledBy: 'user',
        createdAt: new Date(),
    })

    tx.update({
        status: TransactionStatus.REVERTED,
        data: JSON.stringify(transactionData),
    })

    if (tx.paymentId) stopPolling(`handlePendingTopupPoller-${tx.paymentId}`)

    log.info('[TopupOperationApi.cancel]', 'Cancelled', {transactionId})
    return _assertReverted(tx, transactionId)
}

// ─────────────────────────────────────────────────────────────────────────────
// reclaim() — not applicable to topup
//
// Once a topup is finalized (proofs minted), there's nothing to reclaim — the
// ecash is already in the wallet. Before finalize, cancel() handles abandonment.
// Kept on the API surface for symmetry with the other operation APIs.
// ─────────────────────────────────────────────────────────────────────────────

async function reclaim(_transactionId: number): Promise<never> {
    throw new ValidationError(
        'Topup operations cannot be reclaimed. Use cancel() to abandon a PENDING topup.',
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// finalize() — PENDING → COMPLETED (mint proofs after invoice is PAID).
//
// Verifies the quote is PAID, then mints proofs and atomically commits:
//   - new proofs INSERT (UNSPENT)
//   - tx UPDATE → COMPLETED + balanceAfter
// in one SQLite transaction (via an empty reservation used purely as the
// atomic-batch primitive).
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
            `Cannot finalize topup in state ${tx.status}. Expected PENDING or COMPLETED.`,
            {transactionId, status: tx.status},
        )
    }
    if (!tx.quote) {
        throw new ValidationError('Topup has no quote id; cannot finalize.', {transactionId})
    }

    const {state} = await walletStore.checkLightningMintQuote(tx.mint, tx.quote)
    if (state !== MintQuoteState.PAID) {
        throw new MintError(
            `Cannot finalize topup; mint reports quote state ${state}.`,
            {transactionId, state},
        )
    }

    return _finalizePaid(tx)
}

// ─────────────────────────────────────────────────────────────────────────────
// refresh() — re-check PENDING topup with the mint.
//
// Mirrors the legacy `handlePendingTopupTask` flow:
//   - quote PAID:     → finalize (COMPLETED).
//   - quote ISSUED:   proofs already minted (likely from another device);
//                     mark COMPLETED with a note, don't try to re-mint.
//   - quote UNPAID:
//       - invoice expired → mark EXPIRED, stop polling.
//       - invoice still valid → no-op, watcher will fire again later.
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
        log.warn('[TopupOperationApi.refresh] PENDING topup missing quote id; skipping', {
            transactionId,
        })
        return tx
    }

    const {state} = await walletStore.checkLightningMintQuote(tx.mint, tx.quote)
    const isExpired = !!tx.expiresAt && isBefore(tx.expiresAt, new Date())
    const paymentHash = tx.paymentId

    if (isExpired && state !== MintQuoteState.PAID) {
        const txData = _parseData(tx)
        txData.push({
            status: TransactionStatus.EXPIRED,
            message: 'Invoice expired',
            createdAt: new Date(),
        })
        tx.update({status: TransactionStatus.EXPIRED, data: JSON.stringify(txData)})
        if (paymentHash) stopPolling(`handlePendingTopupPoller-${paymentHash}`)
        log.debug('[TopupOperationApi.refresh] Invoice expired and not paid', {
            transactionId,
            paymentHash,
        })
        return tx
    }

    switch (state) {
        case MintQuoteState.UNPAID:
            log.trace('[TopupOperationApi.refresh] Quote still unpaid', {
                transactionId,
                quote: tx.quote,
            })
            return tx

        case MintQuoteState.ISSUED: {
            // Proofs already minted at the mint (likely from another device
            // sharing the same seed). We can't double-mint, so just mark the
            // tx COMPLETED with a note.
            const txData = _parseData(tx)
            txData.push({
                status: TransactionStatus.COMPLETED,
                note: 'Already issued',
                createdAt: new Date(),
            })
            tx.update({status: TransactionStatus.COMPLETED, data: JSON.stringify(txData)})
            if (paymentHash) stopPolling(`handlePendingTopupPoller-${paymentHash}`)
            log.info(
                '[TopupOperationApi.refresh] Proofs already issued (likely from another device)',
                {transactionId, quote: tx.quote},
            )
            return tx
        }

        case MintQuoteState.PAID:
            log.debug('[TopupOperationApi.refresh] Quote PAID, minting proofs', {
                transactionId,
                paymentHash,
            })
            return _finalizePaid(tx)

        default:
            log.error('[TopupOperationApi.refresh] Unknown quote state', {state})
            return tx
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomic settle of a confirmed-PAID topup: mint proofs, then commit
 * (proofs INSERT + tx UPDATE → COMPLETED) in one SQLite transaction.
 *
 * Uses an empty reservation purely as the atomic-batch primitive — there are
 * no local proofs to lock for a topup (the "lock" is the mint-side quote).
 */
async function _finalizePaid(tx: Transaction): Promise<CompletedTransaction> {
    const transactionId = tx.id
    const mintUrl = tx.mint
    const unit = tx.unit
    const amount = tx.amount
    const mintQuote = tx.quote!
    const paymentHash = tx.paymentId

    let proofs: CashuProof[] = []
    try {
        proofs = await walletStore.mintProofs(mintUrl, amount, unit, mintQuote, transactionId)
    } catch (e: any) {
        if (WalletUtils.shouldHealOutputsError(e)) {
            log.error(
                '[TopupOperationApi._finalizePaid] Increasing proofsCounter outdated values and repeating mintProofs.',
            )
            proofs = await walletStore.mintProofs(
                mintUrl,
                amount,
                unit,
                mintQuote,
                transactionId,
                {increaseCounterBy: 10},
            )
        } else {
            throw e
        }
    }

    if (proofs.length === 0) {
        throw new MintError('Mint returned no proofs after payment', {transactionId})
    }

    // Empty reservation used purely for the atomic-commit primitive: the
    // proofs INSERT and the tx UPDATE both live in one SQLite txn.
    const reservation = proofsStore.reserve([], {
        transactionId,
        mintUrl,
        unit,
        operationType: 'topup-finalize-paid',
        rollbackTo: 'UNSPENT',
    })

    const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
    const proofsAmount = proofs.reduce((acc, p) => acc + Number(p.amount), 0)
    const balanceAfter = currentSpendable + proofsAmount

    const txData = _parseData(tx)
    txData.push({status: TransactionStatus.COMPLETED, createdAt: new Date()})

    proofsStore.commitReservation(reservation, {
        newProofs: [{proofs, state: 'UNSPENT', tId: transactionId}],
        transactionUpdate: {
            id: transactionId,
            status: TransactionStatus.COMPLETED,
            data: JSON.stringify(txData),
            balanceAfter,
        },
    })

    if (paymentHash) stopPolling(`handlePendingTopupPoller-${paymentHash}`)
    sendTopupNotification(amount, unit)

    log.debug('[TopupOperationApi._finalizePaid] Topup completed', {transactionId, amount})
    return _assertCompleted(tx, transactionId)
}

/**
 * Subscribe to mint websocket for mintQuotePaid events. When the mint signals
 * PAID, route through the `handlePendingTopupTask` queue task (which calls
 * `refresh` internally and emits `ev_handlePendingTopupTask_result` for the
 * screen listener). Falls back to a poller if the websocket subscription fails.
 *
 * Going through the queue rather than calling `refresh` directly preserves the
 * legacy event surface that screens depend on (TopupScreen, POSScreen,
 * TranDetailScreen all listen for `ev_handlePendingTopupTask_result`).
 */
async function _monitorMintQuote(params: {
    mintUrl: string
    quote: string
    paymentHash: string
    transactionId: number
}) {
    const {mintUrl, quote, paymentHash, transactionId} = params
    const wsMint = new CashuMint(mintUrl)
    const wsWallet = new CashuWallet(wsMint)

    // Lazy import avoids a circular dep: mintOperations imports
    // TopupOperationApi for the refresh delegation.
    const enqueueRefresh = async () => {
        const tx = transactionsStore.findById(transactionId)
        if (!tx) return
        const {MintOperationService} = await import('./mintOperations')
        MintOperationService.enqueuePendingTopupCheck(tx)
    }

    try {
        log.trace('[TopupOperationApi]', 'Subscribing to mintQuotePaid', {quote})
        const unsub = await wsWallet.on.mintQuotePaid(
            quote,
            async (_m: MintQuoteBolt11Response) => {
                try {
                    await enqueueRefresh()
                } catch (e: any) {
                    log.error(
                        '[TopupOperationApi] enqueue refresh failed in ws callback',
                        {transactionId, error: e.message},
                    )
                }
                unsub()
            },
            async (error: any) => {
                throw error
            },
        )
    } catch (error: any) {
        log.error(
            Err.NETWORK_ERROR,
            '[TopupOperationApi] WebSocket error for mint quote, starting poller.',
            error.message,
        )
        poller(
            `handlePendingTopupPoller-${paymentHash}`,
            enqueueRefresh,
            {interval: 10 * 1000, maxPolls: 6, maxErrors: 2},
        ).then(() => log.trace('[handlePendingTopupPoller] polling completed', {quote}))
    }
}

function _parseData(tx: Transaction): TransactionData[] {
    try {
        return JSON.parse(tx.data)
    } catch {
        return []
    }
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

/**
 * Format the topup result message in the same style as the legacy
 * `handlePendingTopupTask`. Exposed for the wrapper.
 */
export function topupSuccessMessage(amount: number, unit: MintUnit, paidAfterExpiry: boolean) {
    const currencyCode = getCurrency(unit).code
    return `Your balance was credited with ${formatCurrency(amount, currencyCode)} ${currencyCode}`
}

export const TopupOperationApi = {
    prepare,
    execute,
    cancel,
    reclaim,
    finalize,
    refresh,
}
