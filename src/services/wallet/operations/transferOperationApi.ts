/**
 * Transfer (melt) operation lifecycle API — one lifecycle, two payment rails.
 *
 * Handles BOLT11 lightning melt (NUT-05) and Bitcoin onchain melt (NUT-30). The rails
 * share every step below; what differs between them is resolved once, in
 * `resolveTransferMethod` (see transferMethods.ts), rather than branched on at each
 * site that needs a fee or an expiry. There is deliberately ONE copy of the proof
 * reservation, the preemptive swap, and `_handleExecuteError` — that error matrix
 * (paid-despite-error / already-spent / pending-at-mint / clean-unpaid) is the most
 * safety-critical code in the wallet and must not be forked per rail.
 *
 * The one place the rails genuinely diverge is settlement:
 *
 *   bolt11  — usually settles synchronously (PAID on the melt response). When it does
 *             not, a websocket + poller watch the quote.
 *   onchain — NEVER settles synchronously. NUT-30 mandates that the mint answer
 *             PENDING and broadcast in the background, so every onchain melt goes
 *             through the PENDING path and is resolved later by the pending-queue
 *             sweep. Confirmation is bounded by block times, so there is no websocket
 *             and no poller: a ~60s sweep is already far finer-grained than the thing
 *             it waits for. (Same reasoning as the onchain deposit watcher.)
 *
 * Lifecycle methods:
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
    MeltQuoteOnchainResponse,
    MeltQuoteState,
    Mint as CashuMint,
    Wallet as CashuWallet,
} from '@cashu/cashu-ts'
import {log} from '../../logService'
import {translate} from '../../../i18n'
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
import {
    ResolvedTransferMethod,
    TransferMethod,
    TransferMethodInput,
    resolveTransferMethod,
} from './transferMethods'
import {BitcoinUtils} from '../../bitcoin/bitcoinUtils'

/** Any melt quote, whichever rail produced it. */
type AnyMeltQuote = MeltQuoteBolt11Response | MeltQuoteOnchainResponse

const {mintsStore, proofsStore, transactionsStore, walletStore} = rootStoreInstance

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareTransferInput {
    mintBalance: MintBalance
    /** Amount the recipient receives (excludes network + mint fees). */
    amount: number
    unit: MintUnit
    memo: string
    /** Transfer method discriminator: `bolt11` or `onchain`. */
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
    meltQuote: AnyMeltQuote
    path: TransferPath
    method: TransferMethodInput
    /** The rail's facts, resolved once (fee reserve, expiry, tx type, quote id). */
    resolved: ResolvedTransferMethod
    /** Proofs locked under the melt reservation (the operation's inputs). */
    proofsToMeltFrom: Proof[]
    proofsToMeltFromAmount: number
    /** Mint swap fee charged for melting these specific proofs. */
    meltFeeReserve: number
    /**
     * The network fee the mint may charge to settle: the quote's `fee_reserve` for
     * bolt11, the SELECTED tier's `fee_reserve` for onchain. Whatever the mint does
     * not spend comes back as NUT-08 change.
     */
    feeReserve: number
    /** Fee paid for the preemptive swap (0 if no swap ran). */
    preemptiveSwapFeePaid: number
    nwcEvent?: NostrEvent
}

/**
 * Which audit-trail keys a rail writes its fees under.
 *
 * The numbers mean the same thing on both rails, but a transaction's data is read by
 * humans looking at a support ticket — calling a miner fee "lightningFeePaid" would be
 * actively misleading. bolt11 keeps its historical names so existing history renders
 * unchanged.
 */
const FEE_KEYS: Record<TransferMethod, {reserve: string; paid: string}> = {
    bolt11: {reserve: 'lightningFeeReserve', paid: 'lightningFeePaid'},
    onchain: {reserve: 'onchainFeeReserve', paid: 'onchainFeePaid'},
}

// ─────────────────────────────────────────────────────────────────────────────
// prepare()
// ─────────────────────────────────────────────────────────────────────────────

async function prepare(input: PrepareTransferInput): Promise<PreparedTransferData> {
    const {mintBalance, amount, unit, memo, method, nwcEvent, draftTransactionId} = input

    if (amount <= 0) {
        throw new ValidationError('Amount to transfer must be above zero.')
    }
    if (method.method !== 'bolt11' && method.method !== 'onchain') {
        throw new ValidationError(`Unsupported transfer method: ${(method as any).method}`)
    }

    const resolved = resolveTransferMethod(method)
    const meltQuote = method.options.meltQuote
    const mintUrl = mintBalance.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)
    if (!mintInstance) {
        throw new ValidationError('Could not find mint', {mintUrl})
    }

    // Second line of defence on the destination network. The Pay screen already refuses
    // non-mainnet addresses, but this is the last point before real money moves and an
    // onchain payment cannot be taken back — so the check lives here too, where every
    // caller (screen, NWC, a future one) must pass through it.
    if (method.method === 'onchain' && !BitcoinUtils.isPayableBitcoinAddress(resolved.paymentRequest)) {
        throw new ValidationError(
            'Not a mainnet Bitcoin address. Minibits will not pay to testnet or regtest addresses.',
            {address: resolved.paymentRequest},
        )
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
            type: resolved.transactionType,
            amount,
            fee: resolved.feeReserve,
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

    transaction.update({
        quote: resolved.quoteId,
        // The destination, so the transaction detail can show it (and, for onchain,
        // so the user can check where their money actually went).
        paymentRequest: resolved.paymentRequest,
        // bolt11 has a payment hash; onchain has nothing equivalent until the mint
        // broadcasts, at which point it gets an `outpoint` instead.
        ...(resolved.paymentId && {paymentId: resolved.paymentId}),
    })

    // ── Validations ─────────────────────────────────────────────────────
    const feeReserve = resolved.feeReserve
    if (amount + feeReserve > mintBalance.balances[unit]!) {
        throw new ValidationError(
            'Mint balance is insufficient to cover the amount to transfer with the expected network fees.',
            {transactionId},
        )
    }
    if (isBefore(resolved.expiry, new Date())) {
        throw new ValidationError(
            resolved.method === 'bolt11'
                ? 'This invoice has already expired and can not be paid.'
                : 'This payment quote has expired. Please request a new one.',
            {expiry: resolved.expiry, transactionId},
        )
    }

    // ── Select proofs and compute fees ──────────────────────────────────
    const proofsFromMint = proofsStore.getByMint(mintUrl, {state: 'UNSPENT', unit})
    const totalAmountFromMint = CashuUtils.getProofsAmount(proofsFromMint)

    const walletInstance = (await walletStore.getWallet(mintUrl, unit, {withSeed: true})) as CashuWallet

    // Select proofs covering amount + the network fee_reserve + the mint's per-proof
    // input fee on the selected proofs — `amount + fee_reserve + input_fee`, which is
    // what both NUT-05 and NUT-30 require the inputs to cover. The helper iterates to a
    // fixed point so the inputs always cover their own input fee — without it, the fee
    // computed on the first selection can be too low for the (larger) re-selected
    // set and the mint rejects with "not enough inputs provided for melt".
    let proofsToMeltFrom: Proof[]
    let meltFeeReserve: number
    try {
        ;({proofsToSend: proofsToMeltFrom, feeReserve: meltFeeReserve} =
            CashuUtils.selectProofsToSendWithFeeReserve(
                amount + feeReserve,
                proofsFromMint,
                selected => walletInstance.getFeesForProofs(selected).toNumber(),
                {caller: 'TransferOperationApi.prepare'},
            ))
    } catch (e: any) {
        throw new ValidationError('There is not enough funds to send this amount.', {
            totalAmountFromMint,
            transactionId,
            caller: 'TransferOperationApi.prepare',
            message: e.message,
        })
    }

    let amountWithFees = amount + feeReserve + meltFeeReserve
    let proofsToMeltFromAmount = CashuUtils.getProofsAmount(proofsToMeltFrom)

    // ── Preemptive swap path ────────────────────────────────────────────
    // Inputs that overshoot needed amount by >20% get swapped for tighter
    // denominations so the mint charges lower per-proof melt fees. The swap
    // is best-effort: on failure we keep the original proofs.
    let path: TransferPath = 'direct-melt'
    let preemptiveSwapFeePaid = 0

    if (proofsToMeltFromAmount > amountWithFees * 1.1) {
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
        [FEE_KEYS[resolved.method].reserve]: feeReserve,
        meltFeeReserve,
        path,
        method: method.method,
        ...(method.method === 'onchain' && {feeIndex: method.options.feeIndex}),
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
        method: resolved.method,
        path,
        amount,
        meltFeeReserve,
        feeReserve,
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
        path,
        method,
        resolved,
        proofsToMeltFrom,
        proofsToMeltFromAmount,
        meltFeeReserve,
        feeReserve,
        preemptiveSwapFeePaid,
        nwcEvent,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// execute()
//
// Marks tx EXECUTING, submits the melt, then commits atomically based on the
// mint's quote state:
//   - PAID:    inputs → SPENT, change → UNSPENT, tx → COMPLETED.
//   - PENDING: inputs stay PENDING, change committed IF the mint already returned
//              any, tx → PENDING; the watcher/monitor resolves it later.
//   - UNPAID:  rollback reservation (proofs → UNSPENT) and throw.
//
// An onchain melt ALWAYS lands in PENDING — NUT-30 requires the mint to answer
// PENDING and broadcast in the background. It is never PAID here.
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
        method,
        resolved,
        proofsToMeltFrom,
        proofsToMeltFromAmount,
        meltFeeReserve,
    } = prepared

    tx.update({status: TransactionStatus.EXECUTING})

    /**
     * Submit the melt on whichever rail this transfer is on.
     *
     * `increaseCounterBy` is the shared outputs-error healing path: the mint says our
     * blinded outputs were already signed, so we skip the counter forward and retry.
     */
    const submitMelt = (increaseCounterBy?: number): Promise<MeltProofsResponse> => {
        if (method.method === 'onchain') {
            return walletStore.payOnchainMelt(
                mintUrl,
                unit,
                method.options.meltQuote,
                proofsToMeltFrom,
                method.options.feeIndex,
                tx.id,
                increaseCounterBy ? {increaseCounterBy} : undefined,
            )
        }

        return walletStore.payLightningMelt(
            mintUrl,
            unit,
            method.options.meltQuote,
            proofsToMeltFrom,
            tx.id,
            // Always async — including NWC. The mint ACKs immediately and the
            // monitor finalizes on settlement, so the background isn't held for
            // the lightning round-trip. NWC pay_invoice waits a bounded time for
            // the preimage (see NwcStore.payInvoice); zaps confirm via the NIP-57
            // receipt regardless.
            {preferAsync: true, ...(increaseCounterBy && {increaseCounterBy})},
        )
    }

    let meltResponse: MeltProofsResponse
    try {
        meltResponse = await submitMelt()
    } catch (e: any) {
        if (WalletUtils.shouldHealOutputsError(e)) {
            log.error(
                '[TransferOperationApi.execute] Increasing proofsCounter outdated values and repeating the melt.',
            )
            try {
                meltResponse = await submitMelt(10)
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
    // bolt11 only. An onchain melt is never PAID at this point (NUT-30 mandates the
    // mint answer PENDING and broadcast in the background).
    if (meltResponse.quote.state === MeltQuoteState.PAID) {
        const returnedAmount = CashuUtils.getProofsAmount(meltResponse.change)
        const totalFeePaid = proofsToMeltFromAmount - amountToTransfer - returnedAmount
        const networkFeePaid = totalFeePaid - meltFeeReserve
        const meltFeePaid = meltFeeReserve
        const preimage = _preimageOf(meltResponse.quote)

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
            [FEE_KEYS[resolved.method].paid]: networkFeePaid,
            meltFeePaid,
            returnedAmount,
            preimage,
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
                ...(preimage && {proof: preimage}),
            },
        })

        log.debug('[TransferOperationApi.execute] Payment PAID', {transactionId: tx.id, totalFeePaid})
        return _assertCompleted(tx, tx.id)
    }

    // ── PENDING async → tx PENDING; the watcher/monitor finalizes via refresh ───
    if (meltResponse.quote.state === MeltQuoteState.PENDING) {
        const outpoint = _outpointOf(meltResponse.quote)

        // CHANGE MAY ALREADY BE HERE. On bolt11 a PENDING melt has no change yet — the
        // fee is not known until the payment settles. On onchain it can: the mint knows
        // exactly what it is paying in miner fees the moment it builds the transaction,
        // so it can return the unclaimed reserve straight away, with the PENDING
        // response. Dropping it (as the bolt11 path safely does) would strand those
        // proofs — they are signed, they are ours, and nothing would ever look for them
        // again, because `refresh` only reconstructs change it has not already taken.
        const change = meltResponse.change ?? []
        const returnedAmount = CashuUtils.getProofsAmount(change)

        let outputToken: string | undefined
        if (change.length > 0) {
            outputToken = getEncodedToken({mint: mintUrl, proofs: change, unit})
        }

        const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
        const balanceAfter = currentSpendable + returnedAmount

        transactionData.push({
            status: TransactionStatus.PENDING,
            ...(outpoint && {outpoint}),
            ...(change.length > 0 && {returnedAmount}),
            createdAt: new Date(),
        })

        proofsStore.commitReservation(reservation, {
            // Inputs stay PENDING: the mint has taken them but the payment has not
            // settled. Only `refresh` (on a PAID quote) moves them to SPENT.
            newProofs:
                change.length > 0
                    ? [{proofs: change, state: 'UNSPENT', tId: tx.id}]
                    : [],
            transactionUpdate: {
                id: tx.id,
                status: TransactionStatus.PENDING,
                data: JSON.stringify(transactionData),
                ...(outpoint && {outpoint}),
                ...(change.length > 0 && {balanceAfter, outputToken}),
            },
        })

        // bolt11 gets a websocket + poller. Onchain does not: confirmation is bounded by
        // block times, so the ~60s pending-queue sweep is already far finer-grained than
        // the thing it waits for, and a 2-minute poller would just burn requests.
        if (resolved.method === 'bolt11') {
            _monitorAsyncMeltQuote({
                mintUrl,
                unit,
                quoteId: meltResponse.quote.quote,
                transactionId: tx.id,
            })
        }

        log.debug('[TransferOperationApi.execute] Payment PENDING, async melt in progress', {
            method: resolved.method,
            quoteId: meltResponse.quote.quote,
            transactionId: tx.id,
            outpoint,
            returnedAmount,
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
    throw new MintError(
        resolved.method === 'onchain'
            ? 'The onchain payment has not been made.'
            : 'Lightning payment has not been paid.',
        {
            meltResponseQuote: meltResponse.quote,
            transactionId: tx.id,
        },
    )
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

    const quote = await _checkQuote(tx, tx.quote)
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

    const isOnchain = _isOnchainTransfer(tx)
    const quote = await _checkQuote(tx, tx.quote)

    if (quote.state === MeltQuoteState.PAID) {
        const completed = await _finalizePaid(tx, quote)
        EventEmitter.emit('ev_asyncMeltResult', {
            transactionId,
            status: TransactionStatus.COMPLETED,
            message: isOnchain
                ? translate('transactionResult_onchainPaymentConfirmed')
                : translate('transactionResult_lightningInvoicePaidFee', {
                      fee: `${formatCurrency(tx.fee, getCurrency(tx.unit).code)} ${getCurrency(tx.unit).code}`,
                  }),
        })
        return completed
    }

    if (quote.state === MeltQuoteState.UNPAID) {
        // The payment failed → proofs go back to spendable, tx is REVERTED.
        // (Original `handlePendingMeltTask` stamped ERROR here, but sync has
        // always used REVERTED for the same logical event — REVERTED is the
        // accurate terminal status, since the ecash IS recoverable.)
        //
        // For onchain this means the mint never broadcast, or dropped the transaction
        // before it was mined. A CONFIRMED payment can never come back here: once it is
        // in a block the mint reports PAID, and PAID is terminal.
        const pendingProofs = proofsStore
            .getByTransactionId(tx.id)
            .filter(p => p.state === 'PENDING')
        if (pendingProofs.length > 0) {
            proofsStore.revertToSpendable(pendingProofs)
        }

        const failureMessage = isOnchain
            ? translate('transactionResult_onchainPaymentFailed')
            : translate('transactionResult_lightningPaymentFailed')

        const txData = _parseData(tx)
        txData.push({
            status: TransactionStatus.REVERTED,
            message: failureMessage,
            createdAt: new Date(),
        })
        tx.update({status: TransactionStatus.REVERTED, data: JSON.stringify(txData)})

        log.debug('[TransferOperationApi.refresh] Transaction reverted (UNPAID)', {transactionId})

        EventEmitter.emit('ev_asyncMeltResult', {
            transactionId,
            status: TransactionStatus.REVERTED,
            message: failureMessage,
        })
        return tx
    }

    // ── Still PENDING ───────────────────────────────────────────────────
    // For onchain, the mint may only have broadcast between our last check and this
    // one — so the outpoint can appear now, while the state has not moved. Record it
    // as soon as it exists: it is the only way the user can follow their payment on a
    // block explorer, independently of the mint, and it is the thing they will ask for
    // if the mint goes quiet.
    const outpoint = _outpointOf(quote)
    if (outpoint && !tx.outpoint) {
        tx.update({outpoint})
        log.debug('[TransferOperationApi.refresh] Onchain payment broadcast', {
            transactionId,
            outpoint,
        })
    }

    return tx
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The proof-of-payment a rail produces, if any.
 *
 * bolt11 settles with a preimage. Onchain has no preimage — its evidence is the
 * `outpoint`, handled separately — so this is simply absent there, and the tx's
 * `proof` column stays empty rather than holding something invented.
 */
function _preimageOf(quote: object): string | undefined {
    const preimage = (quote as MeltQuoteBolt11Response).payment_preimage
    return preimage ?? undefined
}

/**
 * `txid:vout` of the onchain payment, once the mint has broadcast it.
 *
 * Null until then, and never present on bolt11. This is the only handle the user has
 * on an onchain payment: with it they can watch the transaction confirm on any block
 * explorer, independently of the mint.
 */
function _outpointOf(quote: object): string | undefined {
    const outpoint = (quote as MeltQuoteOnchainResponse).outpoint
    return outpoint ?? undefined
}

/** Is this transaction an onchain melt? The tx type is the discriminator. */
function _isOnchainTransfer(tx: Transaction): boolean {
    return tx.type === TransactionType.TRANSFER_ONCHAIN
}

/**
 * Ask the mint for the current state of a transfer's quote, on the right rail.
 *
 * For onchain this — and ONLY this — is what says whether the payment settled. The
 * mint spending our inputs means it BROADCAST; it does not mean the transaction
 * confirmed. Reading settlement off proof state (as sync does for bolt11) would
 * complete an onchain transfer the moment it left the mint, which is exactly when it
 * is least certain.
 */
async function _checkQuote(tx: Transaction, quoteId: string): Promise<AnyMeltQuote> {
    return _isOnchainTransfer(tx)
        ? await walletStore.checkOnchainMeltQuote(tx.mint, quoteId)
        : await walletStore.checkLightningMeltQuote(tx.mint, quoteId)
}

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
    const {mintUrl, unit, resolved, proofsToMeltFrom, proofsToMeltFromAmount} = prepared

    let meltQuoteCheck: AnyMeltQuote
    try {
        meltQuoteCheck = await _checkQuote(tx, resolved.quoteId)
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
    quote: AnyMeltQuote,
): Promise<CompletedTransaction> {
    const transactionId = tx.id
    const mintUrl = tx.mint
    const unit = tx.unit
    const method: TransferMethod = _isOnchainTransfer(tx) ? 'onchain' : 'bolt11'

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

    // An onchain melt may have had its change returned ALREADY, on the PENDING melt
    // response (the mint knows its miner fee as soon as it builds the transaction).
    // That change is banked and `_unblindMeltChange` will correctly find nothing left
    // to reconstruct — but it is still not fee. Counting it here would report the
    // user's own returned money as money they spent. Read it before pushing this
    // status entry, which writes a `returnedAmount` of its own.
    const alreadyReturned = _readNumberFromData(tx, 'returnedAmount') ?? 0

    // Unblind change BEFORE opening the reservation; same fallback behaviour as
    // the pre-reservation code — change recovery failure doesn't block finalize.
    const unblinded = await _unblindMeltChange({
        mintUrl,
        unit,
        quoteId: quote.quote,
        transaction: tx,
        quoteChange: quote.change,
    })

    let returnedNow = 0
    let outputToken: string | undefined
    if (unblinded.change.length > 0) {
        returnedNow = CashuUtils.getProofsAmount(unblinded.change)
        outputToken = getEncodedToken({mint: mintUrl, proofs: unblinded.change, unit})
    }

    const returnedAmount = alreadyReturned + returnedNow
    const totalFeePaid = proofsToMeltFromAmount - amountToTransfer - returnedAmount
    const networkFeePaid = totalFeePaid - meltFeeReserve
    const meltFeePaid = meltFeeReserve

    const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
    const balanceAfter = currentSpendable + returnedNow

    const preimage = _preimageOf(quote)
    const outpoint = _outpointOf(quote)

    const txData = _parseData(tx)
    txData.push({
        status: TransactionStatus.COMPLETED,
        [FEE_KEYS[method].paid]: networkFeePaid,
        meltFeePaid,
        returnedAmount,
        ...(preimage && {preimage}),
        ...(outpoint && {outpoint}),
        createdAt: new Date(),
    })

    // Surface change-recovery anomalies onto the (still COMPLETED) tx so they are
    // visible per-transaction. Only genuine errors (proofs recovered without a
    // verifiable DLEQ, or change that couldn't be reconstructed at all) are
    // recorded — benign reordering against pre-0.20.1 mints is not an error.
    if (unblinded.stats && CashuUtils.meltChangeRecoveryHasError(unblinded.stats)) {
        txData.push({
            status: TransactionStatus.COMPLETED,
            error: 'Melt change recovery completed with unverifiable DLEQ',
            meltChangeRecovery: unblinded.stats,
            createdAt: new Date(),
        })
    }

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
            ...(preimage && {proof: preimage}),
            ...(outpoint && {outpoint}),
        },
    })

    log.debug('[TransferOperationApi._finalizePaid] Transaction completed', {
        transactionId,
        method,
        totalFeePaid,
        returnedAmount,
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

        const meltRecovery = Database.getMeltRecovery(transaction.id)

        if (!meltRecovery?.meltPreview || !quoteChange?.length) {
            return {change: []}
        }

        const {meltPreview} = meltRecovery
        const cashuWallet = await walletStore.getWallet(mintUrl, unit, {
            withSeed: true,
            keysetId: meltPreview.keysetId,
        })
        const keyset = cashuWallet.getKeyset(meltPreview.keysetId)

        const reconstructedOutputData = CashuUtils.deserializeOutputData(meltPreview.outputData)
        const {change, stats} = CashuUtils.recoverMeltChange({
            outputData: reconstructedOutputData,
            quoteChange,
            keyset,
        })

        log.trace('[TransferOperationApi._unblindMeltChange] Change unblinded', {
            transactionId: transaction.id,
            quoteId,
            stats,
            change,
        })

        Database.removeMeltRecovery(transaction.id)
        return {change, stats}
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
