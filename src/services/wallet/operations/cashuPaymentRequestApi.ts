/**
 * Cashu Payment Request (NUT-18) operation lifecycle API.
 *
 * A Cashu Payment Request is the wallet *asking* an external party to pay it
 * a specified amount in ecash. The lifecycle is:
 *
 *   prepare()  →  PreparedCashuPaymentRequestData  (DRAFT → PREPARED, draft
 *                                                    tx created)
 *   execute()  →  PendingTransaction               (PREPARED → PENDING; the
 *                                                    PR object is built, the
 *                                                    encoded request is
 *                                                    returned for sharing)
 *   cancel()   →  RevertedTransaction              (PREPARED|PENDING →
 *                                                    REVERTED; user closes
 *                                                    the PR before payment)
 *   reclaim()  →  never                            (not applicable)
 *   finalize() →  CompletedTransaction             (PENDING → COMPLETED;
 *                                                    proofs arrived via the
 *                                                    transport, swap with
 *                                                    the mint and add as
 *                                                    UNSPENT)
 *   refresh()  →  Transaction                      (no-op; payments arrive
 *                                                    via push, not pull)
 *
 * The `finalize` here takes an additional `PaymentRequestPayload` parameter
 * (the proofs that arrived via the Nostr transport) — necessary because the
 * proofs aren't stored locally; they come from outside the wallet.
 */

import {
    PaymentRequestPayload,
    PaymentRequest as CashuPaymentRequest,
    PaymentRequestTransport,
    PaymentRequestTransportType,
    getEncodedToken,
    normalizeProofAmounts,
} from '@cashu/cashu-ts'
import QuickCrypto from 'react-native-quick-crypto'
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
import {CashuProof, CashuUtils} from '../../cashu/cashuUtils'
import {MintUnit, formatCurrency, getCurrency} from '../currency'
import {NostrClient} from '../../nostrService'
import {WalletUtils} from '../utils'
import {CashuPaymentRequestMethodInput} from './cashuPaymentRequestMethods'

const {mintsStore, proofsStore, transactionsStore, walletStore, walletProfileStore, relaysStore} =
    rootStoreInstance

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareCashuPaymentRequestInput {
    mintBalance: MintBalance
    /** Amount to request (in `unit`). */
    amount: number
    unit: MintUnit
    memo: string
    /** Transport discriminator. Defaults to `nostr`. */
    method?: CashuPaymentRequestMethodInput
}

/**
 * Returned by `prepare`. Carries the draft tx + everything execute() needs to
 * build the encoded payment request.
 */
export interface PreparedCashuPaymentRequestData {
    transactionId: number
    tx: PreparedTransaction
    mintUrl: string
    unit: MintUnit
    amount: number
    memo: string
    method: CashuPaymentRequestMethodInput
}

/**
 * Returned by `execute`. The PENDING transaction plus the encoded payment
 * request the caller shares with the payer (QR code, copy-paste, etc.).
 */
export interface ExecutedCashuPaymentRequestData {
    transaction: PendingTransaction
    /** Built CashuPaymentRequest object. */
    cashuPaymentRequest: CashuPaymentRequest
    /** Encoded form ready to share / display. */
    encodedCashuPaymentRequest: string
}

// ─────────────────────────────────────────────────────────────────────────────
// prepare()
// ─────────────────────────────────────────────────────────────────────────────

async function prepare(
    input: PrepareCashuPaymentRequestInput,
): Promise<PreparedCashuPaymentRequestData> {
    const {mintBalance, amount, unit, memo} = input
    const method = input.method ?? {method: 'nostr' as const, options: {}}

    if (amount <= 0) {
        throw new ValidationError('Amount to request must be above zero.')
    }
    if (method.method !== 'nostr') {
        throw new ValidationError(
            `Unsupported payment request method: ${(method as any).method}`,
        )
    }

    const mintUrl = mintBalance.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)
    if (!mintInstance) {
        throw new ValidationError('Could not find mint', {mintUrl})
    }

    // Create draft + PREPARED in one step (no validation that requires a
    // separate DRAFT pause — keeps the lifecycle visible in tx.data).
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            amountToReceive: amount,
            unit,
            createdAt: new Date(),
        },
    ]

    const transaction = await transactionsStore.addTransaction({
        type: TransactionType.RECEIVE_BY_PAYMENT_REQUEST,
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

    transactionData.push({
        status: TransactionStatus.PREPARED,
        method: method.method,
        createdAt: new Date(),
    })
    transaction.update({
        status: TransactionStatus.PREPARED,
        data: JSON.stringify(transactionData),
    })

    if (!isPrepared(transaction)) {
        throw new WalletError('Failed to transition transaction to PREPARED', {
            transactionId: transaction.id,
            status: transaction.status,
        })
    }

    log.debug('[CashuPaymentRequestApi.prepare]', 'Prepared', {
        transactionId: transaction.id,
        amount,
        mintUrl,
    })

    return {
        transactionId: transaction.id,
        tx: transaction,
        mintUrl,
        unit,
        amount,
        memo,
        method,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// execute() — PREPARED → PENDING. Builds the PR and returns the encoded form.
// ─────────────────────────────────────────────────────────────────────────────

async function execute(
    prepared: PreparedCashuPaymentRequestData,
): Promise<ExecutedCashuPaymentRequestData> {
    const tx = transactionsStore.findById(prepared.transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {
            transactionId: prepared.transactionId,
        })
    }
    if (!isPrepared(tx)) {
        throw new ValidationError(
            `Cannot execute payment request in state ${tx.status}. Expected PREPARED.`,
            {transactionId: tx.id, status: tx.status},
        )
    }

    // ── Build the Nostr transport ───────────────────────────────────────
    const tags = [['n', '17']]
    const transport: PaymentRequestTransport[] = [
        {
            type: PaymentRequestTransportType.NOSTR,
            target: NostrClient.encodeNprofile(walletProfileStore.pubkey, relaysStore.allUrls),
            tags,
        },
    ]

    const cashuPrId = QuickCrypto.randomBytes(4).toString('hex')
    const cashuPaymentRequest = new CashuPaymentRequest(
        transport,
        cashuPrId,
        prepared.amount,
        prepared.unit,
        [prepared.mintUrl],
        prepared.memo,
    )
    const encoded = cashuPaymentRequest.toEncodedRequest()

    log.trace('[CashuPaymentRequestApi.execute]', 'Created cashu payment request', {
        cashuPrId,
        amount: prepared.amount,
    })

    // ── Transition PREPARED → PENDING ───────────────────────────────────
    const txData = _parseData(tx)
    txData.push({
        status: TransactionStatus.PENDING,
        cashuPaymentRequest,
        createdAt: new Date(),
    })

    tx.update({
        status: TransactionStatus.PENDING,
        data: JSON.stringify(txData),
        paymentId: cashuPrId,
    })

    const refreshed = transactionsStore.findById(tx.id)!
    if (!isPending(refreshed)) {
        throw new WalletError(
            'Transaction did not transition to PENDING after execute',
            {transactionId: tx.id, status: refreshed.status},
        )
    }

    return {
        transaction: refreshed,
        cashuPaymentRequest,
        encodedCashuPaymentRequest: encoded,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel() — PREPARED|PENDING → REVERTED
// ─────────────────────────────────────────────────────────────────────────────

async function cancel(transactionId: number): Promise<RevertedTransaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (!isPrepared(tx) && !isPending(tx)) {
        throw new ValidationError(
            `Cannot cancel payment request in state ${tx.status}. Expected PREPARED or PENDING.`,
            {transactionId, status: tx.status},
        )
    }

    const txData = _parseData(tx)
    txData.push({
        status: TransactionStatus.REVERTED,
        cancelledBy: 'user',
        createdAt: new Date(),
    })
    tx.update({status: TransactionStatus.REVERTED, data: JSON.stringify(txData)})

    log.info('[CashuPaymentRequestApi.cancel]', 'Cancelled', {transactionId})
    return _assertReverted(tx, transactionId)
}

// ─────────────────────────────────────────────────────────────────────────────
// reclaim() — not applicable
// ─────────────────────────────────────────────────────────────────────────────

async function reclaim(_transactionId: number): Promise<never> {
    throw new ValidationError(
        'Cashu payment requests cannot be reclaimed. Use cancel() to abandon an open request.',
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// finalize() — PENDING → COMPLETED.
//
// Called when the payment arrives via the transport (Nostr DM in today's
// world). The payload carries the proofs from the payer; we swap them with
// the mint to lock them to our wallet, then atomic-commit proofs INSERT +
// tx UPDATE.
// ─────────────────────────────────────────────────────────────────────────────

async function finalize(
    transactionId: number,
    paymentRequestPayload: PaymentRequestPayload,
): Promise<CompletedTransaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (tx.status === TransactionStatus.COMPLETED) {
        return tx as CompletedTransaction
    }
    if (!isPending(tx)) {
        throw new ValidationError(
            `Cannot finalize payment request in state ${tx.status}. Expected PENDING or COMPLETED.`,
            {transactionId, status: tx.status},
        )
    }

    const {mint: mintUrl, unit: payloadUnit, proofs: proofsToReceive, id: paymentRequestId, memo: payloadMemo} =
        paymentRequestPayload
    const unit = payloadUnit as MintUnit
    const memo = payloadMemo || `PR ${paymentRequestId}`

    if (
        !mintUrl ||
        !unit ||
        !Array.isArray(proofsToReceive) ||
        proofsToReceive.length === 0
    ) {
        throw new ValidationError('Payment request payload is invalid.', {
            paymentRequestPayload,
        })
    }

    const amountToReceive = CashuUtils.getProofsAmount(proofsToReceive)
    if (tx.unit !== unit || tx.amount !== amountToReceive) {
        throw new ValidationError(
            'Related Payment request has different amount or unit than the incoming payment.',
            {
                expectedUnit: tx.unit,
                expectedAmount: tx.amount,
                amountToReceive,
                unit,
                paymentRequestId,
            },
        )
    }

    // Re-check blocked status — could have been blocked since the PR was issued.
    if (mintsStore.isBlocked(mintUrl)) {
        const txData = _parseData(tx)
        txData.push({
            status: TransactionStatus.BLOCKED,
            message: 'Mint is blocked in your Settings, ecash has not been received.',
        })
        tx.update({status: TransactionStatus.BLOCKED, data: JSON.stringify(txData)})
        throw new ValidationError(
            `The mint ${mintUrl} is blocked. You can unblock it in Settings.`,
            {transactionId},
        )
    }

    // ── Swap proofs with mint (with outputs-error healing retry) ────────
    const {proofs: receivedProofs, swapFeePaid} = await _receiveWithHealing(
        mintUrl,
        unit,
        paymentRequestPayload,
        transactionId,
    )

    const receivedAmount = receivedProofs.reduce((acc, p) => acc + Number(p.amount), 0)
    const outputToken = getEncodedToken({
        mint: mintUrl,
        proofs: normalizeProofAmounts(receivedProofs),
        unit,
        memo,
    })

    const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
    const balanceAfter = currentSpendable + receivedAmount

    const txData = _parseData(tx)
    txData.push({
        status: TransactionStatus.COMPLETED,
        swapFeePaid,
        receivedAmount,
        unit,
        createdAt: new Date(),
    })

    // Atomic: proofs INSERT + tx UPDATE in one SQLite transaction.
    const reservation = proofsStore.reserve([], {
        transactionId,
        mintUrl,
        unit,
        operationType: 'cashu-payment-request-finalize',
        rollbackTo: 'UNSPENT',
    })

    proofsStore.commitReservation(reservation, {
        newProofs: [{proofs: receivedProofs, state: 'UNSPENT', tId: transactionId}],
        transactionUpdate: {
            id: transactionId,
            status: TransactionStatus.COMPLETED,
            data: JSON.stringify(txData),
            keysetId: receivedProofs[0].id,
            outputToken,
            balanceAfter,
            ...(receivedAmount !== amountToReceive && {amount: receivedAmount}),
            ...(swapFeePaid > 0 && {fee: swapFeePaid}),
        },
    })

    log.debug('[CashuPaymentRequestApi.finalize]', 'Payment request fulfilled', {
        transactionId,
        receivedAmount,
        swapFeePaid,
    })

    return _assertCompleted(tx, transactionId)
}

// ─────────────────────────────────────────────────────────────────────────────
// refresh() — no-op; PR payments arrive via push transport.
// ─────────────────────────────────────────────────────────────────────────────

async function refresh(transactionId: number): Promise<Transaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    return tx
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

async function _receiveWithHealing(
    mintUrl: string,
    unit: MintUnit,
    payload: PaymentRequestPayload,
    transactionId: number,
): Promise<{proofs: CashuProof[]; swapFeePaid: number}> {
    try {
        return (await walletStore.receive(
            mintUrl,
            unit,
            payload,
            transactionId,
        )) as unknown as {proofs: CashuProof[]; swapFeePaid: number}
    } catch (e: any) {
        if (WalletUtils.shouldHealOutputsError(e)) {
            log.error(
                '[CashuPaymentRequestApi] Increasing proofsCounter outdated values and repeating receive.',
            )
            return (await walletStore.receive(
                mintUrl,
                unit,
                payload,
                transactionId,
                {increaseCounterBy: 10},
            )) as unknown as {proofs: CashuProof[]; swapFeePaid: number}
        }
        throw e
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
// Public helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Format the standard "payment request fulfilled" message. */
export function cashuPaymentRequestSuccessMessage(
    paymentRequestId: string,
    receivedAmount: number,
    unit: MintUnit,
): string {
    const code = getCurrency(unit).code
    return `Payment request ${paymentRequestId} with amount of ${formatCurrency(receivedAmount, code)} ${code} has been paid.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API export
// ─────────────────────────────────────────────────────────────────────────────

export const CashuPaymentRequestApi = {
    prepare,
    execute,
    cancel,
    reclaim,
    finalize,
    refresh,
}
