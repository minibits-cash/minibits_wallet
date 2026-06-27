/**
 * Send operation lifecycle API.
 *
 * Splits the historical monolithic `sendTask` into explicit lifecycle methods:
 *
 *   prepare()  →  PreparedSendData   (DRAFT → PREPARED, reservation OPEN)
 *   execute()  →  PendingTransaction (PREPARED → [EXECUTING →] PENDING, reservation COMMITTED)
 *   cancel()   →  RevertedTransaction (PREPARED → REVERTED, reservation ROLLED BACK)
 *   reclaim()  →  RevertedTransaction (PENDING → REVERTED via reclaim swap)
 *   finalize() →  CompletedTransaction (PENDING → COMPLETED after mint confirms SPENT)
 *   refresh()  →  Transaction         (re-check PENDING with mint, possibly transition)
 *
 * Between `prepare` and either `execute` or `cancel`, the reservation row
 * stays in SQLite — so a crash leaves an orphan that startup recovery rolls
 * back automatically. No proofs get stuck.
 *
 * The legacy `WalletTask.sendQueueAwaitable` continues to work via a thin
 * wrapper in `sendTask.ts` that calls `prepare` then `execute` in one go.
 */

import {getEncodedToken, normalizeProofAmounts, CheckStateEnum, Wallet as CashuWallet, Mint as CashuMint, ProofState as CashuProofState} from '@cashu/cashu-ts'
import {log} from '../../logService'
import {ValidationError, MintError, WalletError} from '../../../utils/AppError'
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
import {CashuProof, CashuUtils} from '../../cashu/cashuUtils'
import {MintUnit} from '../currency'
import {SendMethodInput} from './sendMethods'
import {WalletUtils} from '../utils'
import {WalletTask, MAX_SWAP_INPUT_SIZE} from '../../walletService'
import {
    getActiveKeysetIds,
    getInactiveKeysetIds,
    prioritizeFromInactiveKeysets,
} from '../sendTask'
import {Database, ReservationRow} from '../../sqlite'
import {ProofReservation} from '../proofReservation'
import {poller} from '../../../utils/poller'
import AppError, {Err} from '../../../utils/AppError'

const {mintsStore, proofsStore, transactionsStore, walletStore} = rootStoreInstance

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareSendInput {
    mintBalance: MintBalance
    amount: number
    unit: MintUnit
    memo: string
    /**
     * Offline send path: user-supplied exact proofs to send. When provided,
     * `amount` must equal their sum. Set to `undefined` (or empty) for
     * online auto-select.
     */
    selectedProofs?: Proof[]
    /**
     * Send method discriminator. Defaults to plain (`default`) send.
     * `p2pk` forces a swap so the new outputs can be locked to the recipient.
     */
    method?: SendMethodInput
    /** Resume from an existing DRAFT transaction (e.g. retry after error). */
    draftTransactionId?: number
}

/** Path the prepared op will follow when executed. */
export type SendPath = 'offline' | 'online-no-swap' | 'online-swap'

/**
 * Returned by `prepare`. Carries the transactionId for downstream lookup
 * plus enough computed metadata for execute() to proceed without recomputing.
 *
 * Hold this in memory between `prepare` and `execute` for the common
 * "prepare-then-immediately-execute" flow. For "user pauses" UX, store
 * `transactionId` and re-fetch the latest state with `transactionsStore.findById`.
 */
export interface PreparedSendData {
    transactionId: number
    /** Snapshot of the tx at prepare time. Re-fetch by id for live state. */
    tx: PreparedTransaction
    /** Amount the recipient will receive (excludes mint swap fee). */
    sendAmount: number
    /** Mint swap fee reserved at prepare time (0 for offline / no-swap). */
    swapFeeReserve: number
    /** True iff execute() will contact the mint to swap proofs. */
    needsSwap: boolean
    path: SendPath
    method: SendMethodInput
    mintUrl: string
    unit: MintUnit
    /** Proofs that were locked under the reservation (the operation's inputs). */
    lockedProofs: Proof[]
}

// ─────────────────────────────────────────────────────────────────────────────
// prepare()
// ─────────────────────────────────────────────────────────────────────────────

async function prepare(input: PrepareSendInput): Promise<PreparedSendData> {
    const {
        mintBalance,
        amount,
        unit,
        memo,
        selectedProofs,
        method = {method: 'default', options: {}} as SendMethodInput,
        draftTransactionId,
    } = input

    if (amount <= 0) {
        throw new ValidationError('Amount to send must be above zero.')
    }

    const mintUrl = mintBalance.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)
    if (!mintInstance) {
        throw new ValidationError('Could not find mint', {mintUrl})
    }

    const proofsFromMint = proofsStore.getByMint(mintUrl, {state: 'UNSPENT', unit})
    const totalAmountFromMint = CashuUtils.getProofsAmount(proofsFromMint)
    if (totalAmountFromMint < amount) {
        throw new ValidationError('There is not enough funds to send this amount.', {
            totalAmountFromMint,
            amount,
        })
    }

    // ── Create or load the draft transaction ────────────────────────────
    let transaction: Transaction | undefined
    let transactionData: TransactionData[] = []

    if (draftTransactionId && draftTransactionId > 0) {
        transaction = transactionsStore.findById(draftTransactionId)!
        try {
            transactionData = JSON.parse(transaction.data)
        } catch (e) {
            transactionData = []
        }
    } else {
        transactionData.push({
            status: TransactionStatus.DRAFT,
            mintBalanceToSendFrom: mintBalance,
            createdAt: new Date(),
        })
        transaction = await transactionsStore.addTransaction({
            type: TransactionType.SEND,
            amount,
            fee: 0,
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

    // ── Decide path + select proofs ─────────────────────────────────────
    let path: SendPath
    let proofsToLock: Proof[]
    let swapFeeReserve = 0
    const isP2PK = method.method === 'p2pk'
    const selectedAmount = selectedProofs?.length
        ? CashuUtils.getProofsAmount(selectedProofs)
        : 0

    if (selectedAmount > 0) {
        // ── Offline path ────────────────────────────────────────────────
        if (selectedAmount !== amount) {
            throw new ValidationError(
                'Requested amount to send does not equal sum of ecash denominations provided.',
                {transactionId: transaction.id},
            )
        }
        if (selectedProofs!.length > MAX_SWAP_INPUT_SIZE) {
            throw new ValidationError(
                `Number of proofs is above max of ${MAX_SWAP_INPUT_SIZE}. Visit Settings > Backup to optimize, then try again.`,
                {transactionId: transaction.id},
            )
        }
        path = 'offline'
        proofsToLock = selectedProofs!
    } else {
        // ── Auto-select path ────────────────────────────────────────────
        const inactiveKeysetIds = getInactiveKeysetIds(mintInstance)
        let candidates: Proof[] = inactiveKeysetIds.length > 0
            ? prioritizeFromInactiveKeysets(mintInstance, amount, unit, proofsFromMint)
            : CashuUtils.getProofsToSend(amount, proofsFromMint)

        const candidatesAmount = CashuUtils.getProofsAmount(candidates)
        const exactMatch = candidatesAmount === amount

        if (isP2PK || !exactMatch) {
            // Swap needed. Select proofs covering the send amount + the mint's
            // per-proof input fee on the selected proofs. The helper iterates to
            // a fixed point so the locked set always covers its own swap fee —
            // without it, the fee computed on the first selection can be too low
            // for the (larger) re-selected set, and cashu-ts (called with
            // includeFees:false) then rejects with
            // "Not enough funds available for swap".
            const walletInstance = await walletStore.getWallet(mintUrl, unit, {withSeed: true}) as CashuWallet
            try {
                ;({proofsToSend: candidates, feeReserve: swapFeeReserve} =
                    CashuUtils.selectProofsToSendWithFeeReserve(
                        amount,
                        proofsFromMint,
                        selected => walletInstance.getFeesForProofs(selected).toNumber(),
                        {caller: 'SendOperationApi.prepare'},
                    ))
            } catch (e: any) {
                throw new ValidationError('There is not enough funds to send this amount.', {
                    totalAmountFromMint,
                    transactionId: transaction.id,
                    caller: 'SendOperationApi.prepare',
                    message: e.message,
                })
            }
            path = 'online-swap'
            proofsToLock = candidates
        } else {
            // Exact match, no mint call needed at execute time
            if (candidates.length > MAX_SWAP_INPUT_SIZE) {
                throw new ValidationError(
                    `Number of proofs is above max limit of ${MAX_SWAP_INPUT_SIZE}. Visit Backup to optimize your wallet, then try again.`,
                    {transactionId: transaction.id},
                )
            }
            path = 'online-no-swap'
            proofsToLock = candidates
        }
    }

    // ── Open reservation (leaves the row OPEN — execute/cancel resolves it) ──
    proofsStore.reserve(proofsToLock, {
        transactionId: transaction.id,
        mintUrl,
        unit,
        operationType: `send-${path}`,
        rollbackTo: 'UNSPENT',
    })

    // ── Transition DRAFT → PREPARED ─────────────────────────────────────
    transactionData.push({
        status: TransactionStatus.PREPARED,
        swapFeeReserve,
        needsSwap: path === 'online-swap',
        path,
        method: method.method,
        methodOptions: method.options,
        createdAt: new Date(),
    })

    transaction.update({
        status: TransactionStatus.PREPARED,
        data: JSON.stringify(transactionData),
        keysetId: proofsToLock[0].id,
    })

    if (!isPrepared(transaction)) {
        // tx.update should have applied; defensive guard.
        throw new WalletError('Failed to transition transaction to PREPARED', {
            transactionId: transaction.id,
            status: transaction.status,
        })
    }

    log.debug('[SendOperationApi.prepare]', 'Prepared', {
        transactionId: transaction.id,
        path,
        amount,
        swapFeeReserve,
        lockedCount: proofsToLock.length,
    })

    return {
        transactionId: transaction.id,
        tx: transaction,
        sendAmount: amount,
        swapFeeReserve,
        needsSwap: path === 'online-swap',
        path,
        method,
        mintUrl,
        unit,
        lockedProofs: proofsToLock,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// execute()
//
// Commits the reservation atomically with the tx state transition.
// - offline / online-no-swap: outputToken = locked proofs; no mint call.
// - online-swap:              tx → EXECUTING, mint.send, commit with inputs
//                             → SPENT, returnedProofs → UNSPENT, proofsToSend
//                             → PENDING, tx → PENDING (one SQLite txn).
// ─────────────────────────────────────────────────────────────────────────────

async function execute(prepared: PreparedSendData): Promise<PendingTransaction> {
    const tx = transactionsStore.findById(prepared.transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId: prepared.transactionId})
    }
    if (!isPrepared(tx)) {
        throw new ValidationError(
            `Cannot execute send in state ${tx.status}. Expected PREPARED.`,
            {transactionId: tx.id, status: tx.status},
        )
    }

    // Look up the open reservation by transactionId.
    const reservation = _findReservationForTx(tx.id)
    if (!reservation) {
        throw new ValidationError(
            'No open reservation for transaction. The reservation may have been rolled back by orphan recovery.',
            {transactionId: tx.id},
        )
    }

    let transactionData: TransactionData[] = []
    try {
        transactionData = JSON.parse(tx.data)
    } catch (e) {}

    const {mintUrl, unit, sendAmount, swapFeeReserve, path, method, lockedProofs} = prepared

    if (path === 'online-swap') {
        // Mark EXECUTING (separate SQLite write — acceptable, this is the
        // pre-mint-call boundary; the atomic landing happens at the commit).
        tx.update({status: TransactionStatus.EXECUTING})

        // ── Mint call ───────────────────────────────────────────────────
        const p2pk = method.method === 'p2pk' ? method.options : undefined
        let sendResult: {returnedProofs: CashuProof[]; proofsToSend: CashuProof[]; swapFeePaid: number}
        try {
            sendResult = await walletStore.send(
                mintUrl,
                sendAmount,
                unit,
                lockedProofs,
                tx.id,
                {p2pk: p2pk && p2pk.pubkey ? p2pk : undefined},
            )
        } catch (e: any) {
            if (WalletUtils.shouldHealOutputsError(e)) {
                log.error('[SendOperationApi.execute]', 'Increasing proofsCounter outdated values and repeating send.')
                sendResult = await walletStore.send(
                    mintUrl,
                    sendAmount,
                    unit,
                    lockedProofs,
                    tx.id,
                    {p2pk: p2pk && p2pk.pubkey ? p2pk : undefined, increaseCounterBy: 10},
                )
            } else {
                // Rollback restores the reservation (proofs back to UNSPENT, tx
                // → REVERTED via the atomic reservation rollback).
                proofsStore.rollbackReservation(reservation)
                throw e
            }
        }

        const {returnedProofs, proofsToSend, swapFeePaid} = sendResult

        // cashu-ts may return some inputs unchanged; those stay UNSPENT, not SPENT.
        const returnedSecrets = new Set(returnedProofs.map(p => p.secret))
        const actuallySpentProofs = lockedProofs.filter(p => !returnedSecrets.has(p.secret))

        const outputToken = getEncodedToken({
            mint: mintUrl,
            proofs: normalizeProofAmounts(proofsToSend),
            unit,
            memo: tx.memo ?? undefined,
        })

        const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
        // proofsToSend → PENDING (not spendable). returnedProofs are mixed:
        // some are inputs that came back unchanged (already PENDING from
        // reservation → stay PENDING from spendable POV) and some are fresh
        // change. We need to count only the FRESH change as a balance gain.
        const freshChangeAmount = CashuUtils.getProofsAmount(
            returnedProofs.filter(p => !lockedProofs.some(lp => lp.secret === p.secret)),
        )
        const balanceAfter = currentSpendable + freshChangeAmount

        transactionData.push({
            status: TransactionStatus.PENDING,
            swapFeeReserve,
            swapFeePaid,
            isSwapNeeded: true,
            createdAt: new Date(),
        })

        // ATOMIC commit: inputs → SPENT, returnedProofs → UNSPENT (may
        // restore some inputs), proofsToSend → PENDING, tx → PENDING.
        proofsStore.commitReservation(reservation as any, {
            toSpent: actuallySpentProofs,
            newProofs: [
                {proofs: returnedProofs, state: 'UNSPENT', tId: tx.id},
                {proofs: proofsToSend, state: 'PENDING', tId: tx.id},
            ],
            transactionUpdate: {
                id: tx.id,
                status: TransactionStatus.PENDING,
                data: JSON.stringify(transactionData),
                outputToken,
                balanceAfter,
                ...(swapFeePaid > 0 && {fee: swapFeePaid}),
            },
        })

        // Subscribe to ws for ongoing PENDING → SPENT transitions.
        _monitorSentProofs({mintUrl, proofsToSend})
    } else {
        // ── offline / online-no-swap ────────────────────────────────────
        // No mint call. Locked proofs ARE the outputs; they stay PENDING.
        const outputToken = getEncodedToken({
            mint: mintUrl,
            proofs: normalizeProofAmounts(lockedProofs),
            unit,
            memo: tx.memo ?? undefined,
        })

        // balanceAfter unchanged: locked proofs were already PENDING (not
        // spendable). No fresh proofs added.
        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0

        transactionData.push({
            status: TransactionStatus.PENDING,
            swapFeeReserve: 0,
            swapFeePaid: 0,
            isSwapNeeded: false,
            createdAt: new Date(),
        })

        // ATOMIC commit: no proof transitions, reservation row deleted,
        // tx → PENDING with outputToken.
        proofsStore.commitReservation(reservation as any, {
            transactionUpdate: {
                id: tx.id,
                status: TransactionStatus.PENDING,
                data: JSON.stringify(transactionData),
                outputToken,
                balanceAfter,
            },
        })

        // Online no-swap also benefits from the ws monitor (recipient claim
        // detection). Offline doesn't — recipient may be offline indefinitely.
        if (path === 'online-no-swap') {
            _monitorSentProofs({mintUrl, proofsToSend: CashuUtils.exportProofs(lockedProofs)})
        }
    }

    const refreshed = transactionsStore.findById(tx.id)!
    if (!isPending(refreshed)) {
        throw new WalletError('Transaction did not transition to PENDING after execute', {
            transactionId: tx.id,
            status: refreshed.status,
        })
    }
    return refreshed
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
            `Cannot cancel send in state ${tx.status}. Expected PREPARED.`,
            {transactionId, status: tx.status},
        )
    }

    const reservation = _findReservationForTx(transactionId)
    if (!reservation) {
        // No reservation found — rare race or already rolled back. Just mark
        // the tx as REVERTED so the UI reflects user intent.
        const transactionData = _parseData(tx)
        transactionData.push({status: TransactionStatus.REVERTED, message: 'No reservation to roll back', createdAt: new Date()})
        tx.update({status: TransactionStatus.REVERTED, data: JSON.stringify(transactionData)})
        log.warn('[SendOperationApi.cancel]', 'No open reservation found; marked tx REVERTED', {transactionId})
        return _assertReverted(tx, transactionId)
    }

    const transactionData = _parseData(tx)
    transactionData.push({
        status: TransactionStatus.REVERTED,
        cancelledBy: 'user',
        createdAt: new Date(),
    })

    // The reservation rollback already atomically restores proofs to UNSPENT
    // and deletes the reservation row. We still need to mark the tx REVERTED
    // — separate SQLite write since rollback doesn't yet accept transactionUpdate.
    proofsStore.rollbackReservation(reservation)
    tx.update({
        status: TransactionStatus.REVERTED,
        data: JSON.stringify(transactionData),
    })

    log.info('[SendOperationApi.cancel]', 'Cancelled', {transactionId})
    return _assertReverted(tx, transactionId)
}

// ─────────────────────────────────────────────────────────────────────────────
// reclaim() — PENDING → REVERTED via reclaim swap (today's revertTask logic)
// ─────────────────────────────────────────────────────────────────────────────

async function reclaim(transactionId: number): Promise<RevertedTransaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (!isPending(tx)) {
        throw new ValidationError(
            `Cannot reclaim send in state ${tx.status}. Expected PENDING.`,
            {transactionId, status: tx.status},
        )
    }
    // For first cut, delegate to the existing revertTask path which already
    // does the reclaim swap correctly. The current revertTask is invoked via
    // the queue; here we want a direct call for the lifecycle API.
    const {revertTask} = await import('../revertTask')
    const result = await revertTask(tx)
    if (result.error) {
        throw new MintError(result.error.message ?? 'Reclaim failed', {transactionId})
    }
    const refreshed = transactionsStore.findById(transactionId)!
    return refreshed as RevertedTransaction
}

// ─────────────────────────────────────────────────────────────────────────────
// finalize() — PENDING → COMPLETED (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

async function finalize(transactionId: number): Promise<CompletedTransaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (tx.status === TransactionStatus.COMPLETED) {
        return tx as CompletedTransaction
    }
    // finalize() is only ever dispatched by syncStateWithMintTask, and only for a tx whose
    // outgoing proofs the mint just confirmed SPENT (sync moves them to SPENT, then this
    // re-verifies below). A send that errored locally — e.g. a network failure on a request
    // the mint nonetheless processed and the payee then claimed — must be recoverable to
    // COMPLETED rather than staying stuck ERROR. So allow ERROR through alongside PENDING;
    // the SPENT re-check below still prevents completing a genuinely-failed (unspent) send.
    if (!isPending(tx) && tx.status !== TransactionStatus.ERROR) {
        throw new ValidationError(
            `Cannot finalize send in state ${tx.status}. Expected PENDING, COMPLETED, or ERROR.`,
            {transactionId, status: tx.status},
        )
    }

    // Confirm with the mint that the outgoing proofs are actually SPENT.
    const sendProofs = proofsStore
        .getByTransactionId(tx.id)
        .filter(p => p.state === 'PENDING')

    if (sendProofs.length === 0) {
        // Already cleaned up by sync. Just flip the status.
        const transactionData = _parseData(tx)
        transactionData.push({status: TransactionStatus.COMPLETED, createdAt: new Date()})
        tx.update({status: TransactionStatus.COMPLETED, data: JSON.stringify(transactionData)})
        return _assertCompleted(tx, transactionId)
    }

    const result = await WalletTask.syncStateWithMintQueueAwaitable({
        proofsToSync: sendProofs,
        mintUrl: tx.mint,
        proofState: 'PENDING',
    })
    if (result.completedTransactionIds.includes(transactionId)) {
        return _assertCompleted(tx, transactionId)
    }

    // Mint didn't report all proofs SPENT yet — leave as PENDING.
    throw new MintError('Send is not yet claimable as finalized — proofs are not all SPENT at the mint.', {
        transactionId,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// refresh() — re-check state with the mint
// ─────────────────────────────────────────────────────────────────────────────

async function refresh(transactionId: number): Promise<Transaction> {
    const tx = transactionsStore.findById(transactionId)
    if (!tx) {
        throw new ValidationError('Transaction not found', {transactionId})
    }
    if (!isPending(tx)) {
        return tx
    }
    const sendProofs = proofsStore
        .getByTransactionId(tx.id)
        .filter(p => p.state === 'PENDING')
    if (sendProofs.length === 0) {
        return tx
    }
    await WalletTask.syncStateWithMintQueueAwaitable({
        proofsToSync: sendProofs,
        mintUrl: tx.mint,
        proofState: 'PENDING',
    })
    return transactionsStore.findById(transactionId) ?? tx
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

function _findReservationForTx(transactionId: number): ProofReservation | undefined {
    const all = Database.getOpenReservations()
    const row = all.find(r => r.transactionId === transactionId)
    return row ? _rowToReservation(row) : undefined
}

/**
 * Project a stored ReservationRow back into a ProofReservation (the shape
 * `proofsStore.commitReservation/rollbackReservation` expects). The only
 * structural difference is `unit: string` vs `unit: MintUnit` and the extra
 * `createdAt` field, both safe to narrow/drop.
 */
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

/**
 * After a status-changing `tx.update()`, the MST instance is at the new state
 * at runtime but TypeScript still has its old narrowed view. These helpers
 * re-fetch and use a type guard to refine the return type properly — failing
 * loudly if the update somehow didn't take effect.
 */
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

/**
 * Subscribe to mint websocket for proofStateUpdates on the sent token.
 * When the recipient claims (proof goes SPENT), enqueue a sync that
 * finalizes our tx → COMPLETED via the existing sync path.
 *
 * Falls back to a poller if the websocket subscription fails (mints over
 * Tor / firewalled environments).
 */
async function _monitorSentProofs(params: {mintUrl: string; proofsToSend: CashuProof[]}) {
    const {mintUrl, proofsToSend} = params
    const proofsToSync = proofsStore.getByMint(mintUrl, {state: 'PENDING'})
    const wsMint = new CashuMint(mintUrl)
    const wsWallet = new CashuWallet(wsMint)

    try {
        log.trace('[SendOperationApi]', 'Subscribing to proofStateUpdates', {secret: proofsToSend[0]?.secret})
        const unsub = await wsWallet.on.proofStateUpdates(
            normalizeProofAmounts([proofsToSend[0]]),
            async (proofState: CashuProofState) => {
                log.trace(`[SendOperationApi] Websocket: proof state updated: ${proofState.state} with secret: ${proofsToSend[0].secret}`)
                if (proofState.state === CheckStateEnum.SPENT) {
                    WalletTask.syncStateWithMintQueueAwaitable({proofsToSync, mintUrl, proofState: 'PENDING'})
                    unsub()
                }
            },
            async (error: any) => {
                throw error
            },
        )
    } catch (error: any) {
        log.error(Err.NETWORK_ERROR, 'WebSocket subscription failed. Starting poller.', error.message)
        poller(
            `syncStateWithMintPoller-${mintUrl}`,
            WalletTask.syncStateWithMintQueueAwaitable,
            {interval: 10 * 1000, maxPolls: 3, maxErrors: 1},
            {proofsToSync, mintUrl, proofState: 'PENDING' as const},
        ).then(() => log.trace('[SendOperationApi]', 'polling completed', {mintUrl}))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API export
// ─────────────────────────────────────────────────────────────────────────────

export const SendOperationApi = {
    prepare,
    execute,
    cancel,
    reclaim,
    finalize,
    refresh,
}
