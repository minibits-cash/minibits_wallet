/**
 * Settles operations a previous process left open mid-way (INTERRUPTIBLE_OPERATION_TYPES).
 *
 * Startup holds these reservations instead of rolling them back, because the mint may
 * already have consumed the locked proofs. Here the mint is asked, and each is settled
 * by what it actually did:
 *
 *   inputs UNSPENT            → nothing reached the mint: roll back, tx REVERTED
 *   melt, inputs PENDING/SPENT → recreate the state execute() leaves for an async melt
 *                                (tx PENDING, inputs PENDING, row committed) and let
 *                                TransferOperationApi.refresh settle it on quote state
 *   swap, inputs SPENT        → restore the outputs (NUT-09) from the counter range
 *                                recorded before the request; inputs SPENT, outputs
 *                                UNSPENT, tx REVERTED. Without a range (row opened
 *                                before v36): tx ERROR, the user must run seed recovery
 *
 * A mint that cannot be reached leaves the reservation held for the next sweep.
 */
import {isAlive} from 'mobx-state-tree'
import {rootStoreInstance} from '../../../models'
import {MintStatus} from '../../../models/Mint'
import {Proof} from '../../../models/Proof'
import {Transaction, TransactionData, TransactionStatus} from '../../../models/Transaction'
import {NetworkError} from '../../../utils/AppError'
import {log, logMilestone} from '../../logService'
import {Database, ReservationRow, ReservationTransactionUpdate} from '../../sqlite'
import {SyncQueue} from '../../syncQueueService'
import {CashuUtils} from '../../cashu/cashuUtils'
import {ProofReservation} from '../proofReservation'
import {WalletTaskResult} from '../types'
import {TransferOperationApi} from './transferOperationApi'

const {mintsStore, proofsStore, transactionsStore, walletStore} = rootStoreInstance

export const RESOLVE_INTERRUPTED_TASK = 'resolveInterruptedOperationsTask'

const MELT_OPERATION_TYPES = new Set(['transfer-melt', 'transfer-melt-after-swap'])

type Outcome = 'nothing-reached-mint' | 'melt-handed-over' | 'swap-restored' | 'swap-lost' | 'unresolved'

const resolveInterruptedOperationsTask = async function (): Promise<WalletTaskResult> {
    const held = proofsStore.interruptedReservations
    const rows = Database.getOpenReservations().filter(r => held.has(r.id))

    // A held row that is gone was settled some other way; nothing left to do.
    for (const id of [...held.keys()]) {
        if (!rows.some(r => r.id === id)) proofsStore.releaseInterruptedReservation(id)
    }

    const errors: string[] = []
    for (const row of rows) {
        try {
            const outcome = await _resolve(row)
            if (outcome !== 'unresolved') proofsStore.releaseInterruptedReservation(row.id)
            log.warn('[resolveInterruptedOperationsTask] Interrupted operation', {
                reservationId: row.id,
                transactionId: row.transactionId,
                operationType: row.operationType,
                outcome,
            })
            // Production monitoring signal. Operation type and outcome only — no ids or
            // amounts. A lost swap needs the user to act, so that one is a real error.
            if (outcome === 'swap-lost') {
                log.error('[resolveInterruptedOperationsTask] Recovery incomplete, seed recovery needed', {
                    operationType: row.operationType,
                    outcome,
                })
            } else if (outcome !== 'unresolved') {
                logMilestone('[resolveInterruptedOperationsTask] Recovery succeeded', {
                    operationType: row.operationType,
                    outcome,
                })
            }
        } catch (e: any) {
            // Held until the next sweep — most often the mint is unreachable.
            errors.push(`tId=${row.transactionId}: ${e.message}`)
            // warn: repeats on every sweep while the mint is unreachable; the failing
            // mint call has already reported the error.
            log.warn('[resolveInterruptedOperationsTask] Could not resolve, will retry', {
                transactionId: row.transactionId,
                operationType: row.operationType,
                error: e.message,
            })
        }
    }

    return {
        taskFunction: RESOLVE_INTERRUPTED_TASK,
        message: `Resolved ${rows.length - errors.length} of ${rows.length} interrupted operations`,
        errors,
    }
}

async function _resolve(row: ReservationRow): Promise<Outcome> {
    const mint = (row.mintId ? mintsStore.findById(row.mintId) : undefined) ?? mintsStore.findByUrl(row.mintUrl)
    if (!mint) {
        log.error('[resolveInterruptedOperationsTask] Mint no longer in wallet', {transactionId: row.transactionId})
        return 'unresolved'
    }

    const reservation: ProofReservation = {
        id: row.id,
        transactionId: row.transactionId,
        mintId: row.mintId,
        mintUrl: row.mintUrl,
        unit: row.unit as ProofReservation['unit'],
        operationType: row.operationType,
        lockedProofs: row.lockedProofs,
    }
    const tx = transactionsStore.findById(row.transactionId)
    const locked = row.lockedProofs
        .map(snap => proofsStore.getBySecret(snap.secret))
        .filter((p): p is Proof => !!p && isAlive(p))

    const states = await _checkStates(mint, row.unit, locked)
    const spent = _nodes(locked, states.SPENT)
    const pendingAtMint = _nodes(locked, states.PENDING)
    const unspent = _nodes(locked, states.UNSPENT)

    // ── The mint never took the inputs ──────────────────────────────────
    if (spent.length === 0 && pendingAtMint.length === 0) {
        proofsStore.rollbackReservation(reservation)
        // Before the tx write: a stale in-flight record must never outlive this,
        // or the in-flight sweep would replay a request the mint never saw.
        Database.removeInFlightRequest(row.transactionId)
        if (MELT_OPERATION_TYPES.has(row.operationType)) Database.removeMeltRecovery(row.transactionId)
        if (tx) {
            const {status, data} = _audit(
                tx,
                TransactionStatus.REVERTED,
                'Interrupted before the mint processed it. Nothing was paid.',
            )
            tx.update({status, data})
        }
        return 'nothing-reached-mint'
    }

    // ── Melt: hand over to the async-melt machinery ─────────────────────
    if (MELT_OPERATION_TYPES.has(row.operationType)) {
        proofsStore.commitReservation(reservation, {
            ...(tx && {
                transactionUpdate: _audit(
                    tx,
                    TransactionStatus.PENDING,
                    'Interrupted while paying. Checking the payment with the mint.',
                ),
            }),
        })
        try {
            await TransferOperationApi.refresh(row.transactionId)
        } catch (e: any) {
            // Now an ordinary PENDING transfer: the pending sweep keeps refreshing it.
            log.warn('[resolveInterruptedOperationsTask] Melt refresh failed, left PENDING', {error: e.message})
        }
        return 'melt-handed-over'
    }

    // ── Swap ────────────────────────────────────────────────────────────
    if (pendingAtMint.length > 0) return 'unresolved'

    const counters = row.counters
    if (!counters) {
        proofsStore.commitReservation(reservation, {
            toSpent: spent,
            toUnspent: unspent,
            ...(tx && {
                transactionUpdate: _audit(
                    tx,
                    TransactionStatus.ERROR,
                    'Interrupted after the mint executed the swap. Its ecash could not be restored automatically: run seed recovery for this mint.',
                ),
            }),
        })
        Database.removeInFlightRequest(row.transactionId)
        return 'swap-lost'
    }

    const seed: Uint8Array = await walletStore.getCachedSeed()
    const {proofs: restored} = await walletStore.restore(mint.mintUrl, seed, {
        indexFrom: counters.start,
        indexTo: counters.start + counters.count,
        keysetId: counters.keysetId,
        unit: row.unit as ProofReservation['unit'],
    })

    // Skip anything already in the wallet: after a counter reuse the range can hold
    // outputs of another, completed operation.
    const fresh = restored.filter((p: any) => !proofsStore.getBySecret(p.secret))
    const restoredUnspent = fresh.length > 0 ? (await _checkStates(mint, row.unit, fresh as any)).UNSPENT : []
    const restoredAmount = CashuUtils.getProofsAmount(restoredUnspent)

    // Never derive from this range again.
    const counter = mint.getProofsCounterByKeysetId(counters.keysetId)
    if (counter.counter < counters.next) counter.setProofsCounter(counters.next)

    proofsStore.commitReservation(reservation, {
        toSpent: spent,
        toUnspent: unspent,
        newProofs: restoredUnspent.length > 0 ? [{proofs: restoredUnspent, state: 'UNSPENT', tId: row.transactionId}] : [],
        ...(tx && {
            transactionUpdate: _audit(
                tx,
                TransactionStatus.REVERTED,
                'Interrupted after the mint executed the swap. Its ecash was restored. Nothing was paid.',
                {restoredAmount},
            ),
        }),
    })
    Database.removeInFlightRequest(row.transactionId)
    return 'swap-restored'
}

async function _checkStates(mint: {mintUrl: string; setStatus: (s: MintStatus) => void}, unit: string, proofs: Proof[]) {
    try {
        const states = await walletStore.getProofsStatesFromMint(mint.mintUrl, unit as ProofReservation['unit'], proofs)
        mint.setStatus(MintStatus.ONLINE)
        return states
    } catch (e: any) {
        if (e instanceof NetworkError) mint.setStatus(MintStatus.OFFLINE)
        throw e
    }
}

/** The locked MST nodes whose secrets the mint reported in `bucket`. */
function _nodes(locked: Proof[], bucket: Array<{secret: string}>): Proof[] {
    const secrets = new Set(bucket.map(p => p.secret))
    return locked.filter(p => secrets.has(p.secret))
}

/** Final status plus an audit-trail entry marked `interrupted`, as one tx update. */
function _audit(
    tx: Transaction,
    status: TransactionStatus,
    message: string,
    extra: Record<string, unknown> = {},
): ReservationTransactionUpdate & {status: TransactionStatus; data: string} {
    let data: TransactionData[] = []
    try {
        data = JSON.parse(tx.data)
    } catch {}
    data.push({status, interrupted: true, message, ...extra, createdAt: new Date()})
    return {id: tx.id, status, data: JSON.stringify(data)}
}

const resolveInterruptedQueue = function (): void {
    if (proofsStore.interruptedReservations.size === 0) return
    // Order against the other sweeps does not matter: sync and the in-flight sweep
    // skip anything a held reservation owns.
    SyncQueue.addPrioritizedTask(`${RESOLVE_INTERRUPTED_TASK}-${Date.now()}`, resolveInterruptedOperationsTask)
}

export const InterruptedOperationService = {
    resolveInterruptedQueue,
    resolveInterruptedOperationsTask,
}
