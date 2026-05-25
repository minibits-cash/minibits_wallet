/**
 * Receive (cashu-token) operation lifecycle API.
 *
 * Splits the historical `receiveTask` / `receiveOfflinePrepareTask` /
 * `receiveOfflineCompleteTask` trio into explicit lifecycle methods:
 *
 *   prepare()  →  PreparedReceiveData  (DRAFT → PREPARED for online mode, or
 *                                       DRAFT → PREPARED_OFFLINE after local
 *                                       DLEQ verification for offline mode)
 *   execute()  →  CompletedTransaction (PREPARED|PREPARED_OFFLINE → COMPLETED;
 *                                       swap proofs with mint, atomic commit)
 *   cancel()   →  RevertedTransaction  (PREPARED|PREPARED_OFFLINE → REVERTED;
 *                                       user abandons before completing)
 *   reclaim()  →  never                (not applicable — received ecash is
 *                                       already in the wallet)
 *   finalize() →  CompletedTransaction (alias for execute — no async wait
 *                                       state for receive)
 *   refresh()  →  Transaction          (no-op; receive doesn't poll)
 *
 * Mint-block check happens early in prepare(): blocked mints transition the
 * tx directly to BLOCKED and skip prepare's normal exit (PREPARED). Callers
 * see a BLOCKED transaction and handle the UI accordingly.
 *
 * Atomic commit on execute(): the proofs INSERT and the tx UPDATE land in
 * one SQLite transaction via an empty reservation (same trick as topup
 * finalize). Closes the proofs ↔ transactions atomicity window: a crash
 * mid-execute used to leave proofs added without the tx COMPLETED stamp.
 */

import {
    Token,
    getDecodedToken,
    getEncodedToken,
    normalizeProofAmounts,
} from '@cashu/cashu-ts'
import {log} from '../../logService'
import {MintError, ValidationError, WalletError} from '../../../utils/AppError'
import {rootStoreInstance} from '../../../models'
import {
    Transaction,
    TransactionData,
    TransactionStatus,
    TransactionType,
} from '../../../models/Transaction'
import {
    BlockedTransaction,
    CompletedTransaction,
    PreparedTransaction,
    RevertedTransaction,
    isBlocked,
    isCompleted,
    isPrepared,
    isReverted,
} from '../../../models/TransactionStates'
import {CashuProof, CashuUtils} from '../../cashu/cashuUtils'
import {MintUnit, formatCurrency, getCurrency} from '../currency'
import {WalletUtils} from '../utils'
import {ReceiveMethodInput} from './receiveMethods'

const {mintsStore, proofsStore, transactionsStore, walletStore} = rootStoreInstance

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareReceiveInput {
    /** Mint that issued the token (parsed from token.mint; pass here for the wrapper to skip a decode). */
    mintUrl: string
    /** Amount the user expects to receive (validated against the token total in execute). */
    amount: number
    unit: MintUnit
    memo: string
    /** Receive method discriminator (currently only `cashu-token`). */
    method: ReceiveMethodInput
}

/**
 * Returned by `prepare`. Carries the decoded token and enough metadata for
 * execute() to swap proofs without re-decoding.
 *
 * For BLOCKED outcomes, the wrapper handles the surface — `prepare` resolves
 * to a normal `PreparedReceiveData` with `blocked: true` and a tx already in
 * `BLOCKED` state. Execute on a blocked tx will refuse.
 */
export interface PreparedReceiveData {
    transactionId: number
    /**
     * Snapshot at prepare time. May be PREPARED, PREPARED_OFFLINE, or BLOCKED
     * — execute() narrows back to PreparedTransaction via the status check.
     */
    tx: Transaction
    mintUrl: string
    unit: MintUnit
    amountToReceive: number
    memo: string
    /** True if the mint was blocked at prepare time (tx is in BLOCKED state). */
    blocked: boolean
    /** True if prepare ran in offline mode (no mint contact yet). */
    isOffline: boolean
    method: ReceiveMethodInput
}

// ─────────────────────────────────────────────────────────────────────────────
// prepare()
// ─────────────────────────────────────────────────────────────────────────────

async function prepare(input: PrepareReceiveInput): Promise<PreparedReceiveData> {
    const {mintUrl, amount, unit, memo, method} = input

    if (amount <= 0) {
        throw new ValidationError('Amount to receive must be above zero.')
    }
    if (method.method !== 'cashu-token') {
        throw new ValidationError(`Unsupported receive method: ${(method as any).method}`)
    }

    const {token, encodedToken, offline} = method.options
    if (!mintUrl) {
        throw new ValidationError('Token is missing a mint param.')
    }

    const isOffline = !!offline

    // ── Create draft tx (RECEIVE_OFFLINE for offline mode, RECEIVE otherwise) ──
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            amountToReceive: amount,
            unit,
            createdAt: new Date(),
        },
    ]

    const transaction = await transactionsStore.addTransaction({
        type: isOffline ? TransactionType.RECEIVE_OFFLINE : TransactionType.RECEIVE,
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

    // Stash the encoded token now so an offline-prepared tx can be completed
    // later from disk (after restart) without the caller re-supplying it.
    transaction.update({inputToken: encodedToken})

    // ── Blocked mint short-circuit ───────────────────────────────────────
    if (mintsStore.isBlocked(mintUrl)) {
        transactionData.push({
            status: TransactionStatus.BLOCKED,
            mintToReceive: mintUrl,
            createdAt: new Date(),
        })
        transaction.update({
            status: TransactionStatus.BLOCKED,
            data: JSON.stringify(transactionData),
        })
        return {
            transactionId,
            tx: transaction,
            mintUrl,
            unit,
            amountToReceive: amount,
            memo,
            blocked: true,
            isOffline,
            method,
        }
    }

    // ── Offline DLEQ verification (no mint contact) ──────────────────────
    if (isOffline) {
        const mintInstance = mintsStore.findByUrl(mintUrl)
        if (!mintInstance) {
            throw new ValidationError(
                'This token cannot be verified offline because the mint is not saved in your wallet. Go online to add the mint or receive it online.',
                {caller: 'ReceiveOperationApi.prepare', mintUrl},
            )
        }
        if (
            !mintInstance.keysetIds ||
            mintInstance.keysetIds.length === 0 ||
            !mintInstance.keys ||
            mintInstance.keys.length === 0
        ) {
            throw new ValidationError(
                'This token cannot be verified offline because the mint keys are not saved. Sync the mint online first.',
                {caller: 'ReceiveOperationApi.prepare', mintUrl},
            )
        }
        CashuUtils.verifyProofsDleqOrThrow(token.proofs, mintInstance.keys)

        transactionData.push({
            status: TransactionStatus.PREPARED_OFFLINE,
            createdAt: new Date(),
        })
        transaction.update({
            status: TransactionStatus.PREPARED_OFFLINE,
            data: JSON.stringify(transactionData),
        })
    } else {
        transactionData.push({
            status: TransactionStatus.PREPARED,
            method: method.method,
            createdAt: new Date(),
        })
        transaction.update({
            status: TransactionStatus.PREPARED,
            data: JSON.stringify(transactionData),
        })
    }

    if (!isPrepared(transaction)) {
        throw new WalletError('Failed to transition transaction to PREPARED', {
            transactionId,
            status: transaction.status,
        })
    }

    log.debug('[ReceiveOperationApi.prepare]', 'Prepared', {
        transactionId,
        amount,
        mintUrl,
        isOffline,
    })

    return {
        transactionId,
        tx: transaction,
        mintUrl,
        unit,
        amountToReceive: amount,
        memo,
        blocked: false,
        isOffline,
        method,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// execute()
//
// PREPARED|PREPARED_OFFLINE → COMPLETED. Decodes the stored input token,
// swaps proofs with the mint, atomically commits proofs INSERT + tx UPDATE.
// ─────────────────────────────────────────────────────────────────────────────

async function execute(prepared: PreparedReceiveData): Promise<CompletedTransaction> {
    const tx = transactionsStore.findById(prepared.transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {
            transactionId: prepared.transactionId,
        })
    }
    if (isBlocked(tx)) {
        throw new ValidationError(
            `Cannot execute receive: mint ${prepared.mintUrl} is blocked.`,
            {transactionId: tx.id},
        )
    }
    if (!isPrepared(tx)) {
        throw new ValidationError(
            `Cannot execute receive in state ${tx.status}. Expected PREPARED or PREPARED_OFFLINE.`,
            {transactionId: tx.id, status: tx.status},
        )
    }

    // Re-check blocked status — a mint could have been blocked between
    // prepare (possibly long ago for offline-prepared txs) and execute.
    if (mintsStore.isBlocked(prepared.mintUrl)) {
        const txData = _parseData(tx)
        txData.push({
            status: TransactionStatus.BLOCKED,
            mintToReceive: prepared.mintUrl,
            createdAt: new Date(),
        })
        tx.update({status: TransactionStatus.BLOCKED, data: JSON.stringify(txData)})
        throw new ValidationError(
            `The mint ${prepared.mintUrl} is blocked. You can unblock it in Settings.`,
            {transactionId: tx.id},
        )
    }

    // Decode the stored token. For online flow this is the same token from
    // prepare; for offline-complete-after-restart it comes from disk.
    if (!tx.inputToken) {
        throw new ValidationError('Could not find ecash token to redeem', {
            transactionId: tx.id,
        })
    }

    // Ensure the mint exists (offline-prepared receives from new mints may have
    // not added it to the wallet yet — the original code did this too).
    if (!mintsStore.alreadyExists(prepared.mintUrl)) {
        await mintsStore.addMint(prepared.mintUrl)
    }
    const mintInstance = mintsStore.findByUrl(prepared.mintUrl)
    if (!mintInstance) {
        throw new ValidationError('Missing mint', {mintUrl: prepared.mintUrl})
    }

    const token = getDecodedToken(tx.inputToken, mintInstance.keysetIds ?? [])

    // ── Swap proofs with the mint (with outputs-error healing retry) ────
    const {proofs, swapFeePaid} = await _receiveWithHealing(
        prepared.mintUrl,
        prepared.unit,
        token,
        tx.id,
    )

    const receivedAmount = proofs.reduce((acc, p) => acc + Number(p.amount), 0)
    const outputToken = getEncodedToken({
        mint: prepared.mintUrl,
        proofs: normalizeProofAmounts(proofs),
        unit: prepared.unit,
        memo: token.memo ?? undefined,
    })

    const currentSpendable = proofsStore.getUnitBalance(prepared.unit)?.unitBalance ?? 0
    const balanceAfter = currentSpendable + receivedAmount

    const txData = _parseData(tx)
    txData.push({
        status: TransactionStatus.COMPLETED,
        swapFeePaid,
        receivedAmount,
        unit: prepared.unit,
        createdAt: new Date(),
    })

    // Atomic commit: proofs INSERT (UNSPENT) + tx UPDATE (→ COMPLETED) in
    // one SQLite transaction. Empty reservation used purely as the batch
    // primitive (no local proofs to lock for a receive).
    const reservation = proofsStore.reserve([], {
        transactionId: tx.id,
        mintUrl: prepared.mintUrl,
        unit: prepared.unit,
        operationType: 'receive-finalize',
        rollbackTo: 'UNSPENT',
    })

    proofsStore.commitReservation(reservation, {
        newProofs: [{proofs, state: 'UNSPENT', tId: tx.id}],
        transactionUpdate: {
            id: tx.id,
            status: TransactionStatus.COMPLETED,
            data: JSON.stringify(txData),
            keysetId: proofs[0].id,
            outputToken,
            balanceAfter,
            ...(swapFeePaid > 0 && {fee: swapFeePaid}),
        },
    })

    log.debug('[ReceiveOperationApi.execute]', 'Receive completed', {
        transactionId: tx.id,
        receivedAmount,
        swapFeePaid,
    })

    return _assertCompleted(tx, tx.id)
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel() — PREPARED|PREPARED_OFFLINE → REVERTED
//
// Marks an unfinalized receive as abandoned. The token isn't swapped at the
// mint, so nothing to undo on the mint side — just transitions the local tx.
// Useful for offline-prepared receives the user decides not to redeem.
// ─────────────────────────────────────────────────────────────────────────────

async function cancel(transactionId: number): Promise<RevertedTransaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (!isPrepared(tx)) {
        throw new ValidationError(
            `Cannot cancel receive in state ${tx.status}. Expected PREPARED or PREPARED_OFFLINE.`,
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

    log.info('[ReceiveOperationApi.cancel]', 'Cancelled', {transactionId})
    return _assertReverted(tx, transactionId)
}

// ─────────────────────────────────────────────────────────────────────────────
// reclaim() — not applicable to receive
//
// Once a receive completes, the ecash is in the wallet (UNSPENT). There's no
// "send it back" — that would be a SEND operation. Before completion, cancel()
// handles abandonment. Kept on the API surface for symmetry.
// ─────────────────────────────────────────────────────────────────────────────

async function reclaim(_transactionId: number): Promise<never> {
    throw new ValidationError(
        'Receive operations cannot be reclaimed. Use cancel() to abandon a PREPARED receive.',
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// finalize() — alias for execute
//
// Receive doesn't have a PENDING state (no async wait); finalize and execute
// are the same thing. Provided for API symmetry with other operations.
// ─────────────────────────────────────────────────────────────────────────────

async function finalize(transactionId: number): Promise<CompletedTransaction> {
    const prepared = _reloadPrepared(transactionId)
    return execute(prepared)
}

// ─────────────────────────────────────────────────────────────────────────────
// refresh() — no-op for receive (no async state to refresh against the mint)
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

/**
 * Wraps `walletStore.receive` with the same outputs-error healing retry the
 * legacy `receiveSync` had. Returned proofs are plain cashu-ts proofs.
 */
async function _receiveWithHealing(
    mintUrl: string,
    unit: MintUnit,
    token: Token,
    transactionId: number,
): Promise<{proofs: CashuProof[]; swapFeePaid: number}> {
    try {
        return (await walletStore.receive(
            mintUrl,
            unit,
            token,
            transactionId,
        )) as unknown as {proofs: CashuProof[]; swapFeePaid: number}
    } catch (e: any) {
        if (WalletUtils.shouldHealOutputsError(e)) {
            log.error(
                '[ReceiveOperationApi] Increasing proofsCounter outdated values and repeating receive.',
            )
            return (await walletStore.receive(
                mintUrl,
                unit,
                token,
                transactionId,
                {increaseCounterBy: 10},
            )) as unknown as {proofs: CashuProof[]; swapFeePaid: number}
        }
        throw e
    }
}

/**
 * Build a `PreparedReceiveData` from a persisted PREPARED|PREPARED_OFFLINE
 * transaction (e.g. after app restart for an offline-prepared receive).
 *
 * Caller is responsible for ensuring the tx is in a prepared state — this
 * helper just stitches together what execute() needs to proceed.
 */
function _reloadPrepared(transactionId: number): PreparedReceiveData {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (!tx.inputToken) {
        throw new ValidationError('Transaction is missing input token', {transactionId})
    }
    const mintInstance = mintsStore.findByUrl(tx.mint)
    const token = getDecodedToken(tx.inputToken, mintInstance?.keysetIds ?? [])

    const isOffline = tx.status === TransactionStatus.PREPARED_OFFLINE

    return {
        transactionId,
        tx,
        mintUrl: tx.mint,
        unit: tx.unit,
        amountToReceive: tx.amount,
        memo: tx.memo ?? '',
        blocked: false,
        isOffline,
        method: {
            method: 'cashu-token',
            options: {
                token,
                encodedToken: tx.inputToken,
                offline: isOffline,
            },
        },
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

/** Format the standard "you received X" message — exposed for the wrapper. */
export function receiveSuccessMessage(
    receivedAmount: number,
    unit: MintUnit,
    swapFeePaid: number,
): string {
    const code = getCurrency(unit).code
    const feePart =
        swapFeePaid > 0
            ? ` Swap fee paid was ${formatCurrency(swapFeePaid, code)} ${code}.`
            : ''
    return `You've received ${formatCurrency(receivedAmount, code)} ${code} to your Minibits wallet.${feePart}`
}

/** Loader for the offline-complete-from-id wrapper path. */
export function loadPreparedForOfflineComplete(
    transactionId: number,
): PreparedReceiveData {
    return _reloadPrepared(transactionId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API export
// ─────────────────────────────────────────────────────────────────────────────

export const ReceiveOperationApi = {
    prepare,
    execute,
    cancel,
    reclaim,
    finalize,
    refresh,
}
