import {isAlive} from 'mobx-state-tree'
import {Proof, ProofState} from '../../models/Proof'
import {CashuProof} from '../cashu/cashuUtils'
import {TransactionStatus} from '../../models/Transaction'
import {log} from '../logService'
import {SQLBatchTuple} from './connection'
import {getInstance} from './instance'
import {dbError} from './errors'
import {buildCounterUpsert} from './countersRepo'

// ─────────────────────────────────────────────────────────────────────────────
// Proof reservations (Phase 5 of refactoring).
//
// A reservation snapshots the pre-operation state of a set of proofs and locks
// them as PENDING in a single SQLite transaction. The reservation row stays in
// the DB for the entire lifetime of the operation so that an orphan (a row left
// behind by a process that died mid-operation) can be detected on next startup
// and rolled back deterministically.
// ─────────────────────────────────────────────────────────────────────────────

export type LockedProofSnapshot = {
  secret: string
  originalState: ProofState
  /**
   * The proof's tId AT RESERVE TIME — i.e. the transaction that previously
   * owned this proof (typically the original RECEIVE/TOPUP that minted it).
   *
   * When the reservation opens, the proof's tId is reassigned to the NEW
   * operation's transactionId so downstream sync sweeps can correctly group
   * spent proofs under the right transaction. On rollback, originalTId is
   * restored.
   *
   * `null` for proofs that had no prior transaction reference.
   */
  originalTId: number | null
}

export type ReservationRow = {
  id: string
  transactionId: number
  mintUrl: string
  unit: string
  operationType: string
  lockedProofs: LockedProofSnapshot[]
  createdAt: Date
}

/**
 * Open a reservation: insert the reservation row and move the locked proofs to
 * PENDING — all in a single SQLite transaction (via executeBatch).
 *
 * If the batch fails, SQLite rolls back automatically and no partial state
 * exists in the database.
 */
export const openReservation = function (
  reservation: {
    id: string
    transactionId: number
    mintUrl: string
    unit: string
    operationType: string
    lockedProofs: LockedProofSnapshot[]
  },
  proofsToLock: Proof[],
): void {
  try {
    const now = new Date().toISOString()
    const batch: SQLBatchTuple[] = []

    batch.push([
      `INSERT INTO reservations (id, transactionId, mintUrl, unit, operationType, lockedProofs, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        reservation.id,
        reservation.transactionId,
        reservation.mintUrl,
        reservation.unit,
        reservation.operationType,
        JSON.stringify(reservation.lockedProofs),
        now,
      ],
    ])

    for (const proof of proofsToLock) {
      if (!isAlive(proof)) continue
      batch.push([
        `INSERT OR REPLACE INTO proofs (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proof.id,
          proof.amount,
          proof.secret,
          proof.C,
          proof.dleq ? proof.dleq.r : null,
          proof.dleq ? proof.dleq.s : null,
          proof.dleq ? proof.dleq.e : null,
          proof.unit,
          // Reassign tId to the new operation. The previous tId (which may
          // point to e.g. the original RECEIVE that minted this proof) is
          // captured in lockedProofs[i].originalTId for rollback restoration.
          reservation.transactionId,
          proof.mintUrl,
          'PENDING',
          now,
        ],
      ])
    }

    const db = getInstance()
    db.executeBatch(batch)

    log.debug('[openReservation] Reservation opened', {
      id: reservation.id,
      transactionId: reservation.transactionId,
      lockedCount: proofsToLock.length,
      operationType: reservation.operationType,
    })
  } catch (e: any) {
    throw dbError('Could not open proof reservation', e)
  }
}

/**
 * Optional transaction-row update atomically batched with a reservation commit.
 *
 * Only the named columns can be set; this is intentionally narrower than the
 * full Transaction shape so the API is predictable and only covers fields that
 * legitimately need to land atomically with a proof-state finalize.
 */
export type ReservationTransactionUpdate = {
  id: number
  status?: TransactionStatus
  data?: string
  amount?: number
  fee?: number
  balanceAfter?: number
  outputToken?: string
  keysetId?: string
  proof?: string
}

/**
 * Commit a reservation: apply the supplied state transitions, optionally a
 * transaction-row update, and delete the reservation row — all in a single
 * SQLite transaction.
 *
 * Passing `transactionUpdate` closes the proofs-table vs transactions-table
 * atomicity window: a crash between proof-state finalize and tx-status update
 * would otherwise leave a transaction stuck in PENDING/PREPARED while its
 * underlying proofs are SPENT.
 */
export const commitReservation = function (
  reservationId: string,
  changes: {
    toSpent?: Proof[]
    toUnspent?: Proof[]
    newProofs?: Array<{
      proofs: Proof[] | CashuProof[]
      state: ProofState
      mintUrl: string
      unit: string
      tId: number
    }>
    transactionUpdate?: ReservationTransactionUpdate
    /**
     * Per-keyset derivation counters to persist atomically with the proof
     * writes — the "W2" backstop to the write-through in Mint.persistCounter
     * ("W1"). W1 already persists this value the instant cashu derives, BEFORE
     * this commit, so on the normal path this upsert is a monotonic no-op. Its
     * job is the failure case: if W1's write was dropped (logged, not thrown),
     * folding the counter into the SAME transaction as the proofs guarantees a
     * committed proof can never outlive its counter advance — which would let the
     * next derivation reuse a blinded secret. Each upsert is monotonic.
     */
    counterUpdate?: Array<{
      mintUrl: string
      keysetId: string
      unit?: string
      counter: number
    }>
  },
): void {
  try {
    const now = new Date().toISOString()
    const batch: SQLBatchTuple[] = []

    for (const proof of changes.toSpent ?? []) {
      if (!isAlive(proof)) continue
      batch.push([
        `UPDATE proofs SET state = ?, updatedAt = ? WHERE secret = ?`,
        ['SPENT', now, proof.secret],
      ])
    }

    for (const proof of changes.toUnspent ?? []) {
      if (!isAlive(proof)) continue
      batch.push([
        `UPDATE proofs SET state = ?, updatedAt = ? WHERE secret = ?`,
        ['UNSPENT', now, proof.secret],
      ])
    }

    for (const group of changes.newProofs ?? []) {
      for (const proof of group.proofs) {
        // proof.amount may be a cashu-ts `Amount` class instance (when the
        // group came straight from `cashuWallet.send/mint/melt` responses)
        // rather than a plain number. Coerce explicitly — SQLite's JSI
        // binding can't bind non-primitive objects to an INTEGER column and
        // would silently drop the row, leaving the proof in MST but absent
        // from the database (lost on the next restart).
        const amount = typeof proof.amount === 'number' ? proof.amount : Number(proof.amount)
        batch.push([
          `INSERT OR REPLACE INTO proofs (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            proof.id,
            amount,
            proof.secret,
            proof.C,
            proof.dleq ? proof.dleq.r : null,
            proof.dleq ? proof.dleq.s : null,
            proof.dleq ? proof.dleq.e : null,
            group.unit,
            group.tId,
            group.mintUrl,
            group.state,
            now,
          ],
        ])
      }
    }

    if (changes.transactionUpdate) {
      const tu = changes.transactionUpdate
      const setClauses: string[] = []
      const params: (string | number | null)[] = []

      // Whitelist of fields that can be set atomically. Order matters only for
      // readability — params must match clause order.
      const setIfDefined = (col: string, value: string | number | undefined) => {
        if (value !== undefined) {
          setClauses.push(`${col} = ?`)
          params.push(value)
        }
      }
      setIfDefined('status', tu.status)
      setIfDefined('data', tu.data)
      setIfDefined('amount', tu.amount)
      setIfDefined('fee', tu.fee)
      setIfDefined('balanceAfter', tu.balanceAfter)
      setIfDefined('outputToken', tu.outputToken)
      setIfDefined('keysetId', tu.keysetId)
      setIfDefined('proof', tu.proof)

      if (setClauses.length > 0) {
        params.push(tu.id)
        batch.push([
          `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ?`,
          params,
        ])
      }
    }

    for (const cu of changes.counterUpdate ?? []) {
      batch.push(buildCounterUpsert(cu.mintUrl, cu.keysetId, cu.unit, cu.counter, now))
    }

    batch.push([`DELETE FROM reservations WHERE id = ?`, [reservationId]])

    const db = getInstance()
    db.executeBatch(batch)

    log.debug('[commitReservation] Reservation committed to DB', {
      id: reservationId,
      toSpent: changes.toSpent?.length ?? 0,
      toUnspent: changes.toUnspent?.length ?? 0,
      newGroups: changes.newProofs?.length ?? 0,
      txUpdate: changes.transactionUpdate ? changes.transactionUpdate.id : undefined,
      counterUpdates: changes.counterUpdate?.length ?? 0,
    })
  } catch (e: any) {
    throw dbError('Could not commit proof reservation', e)
  }
}

/**
 * Rollback a reservation: restore each locked proof to its originalState AND
 * originalTId, then delete the reservation row — all in a single SQLite
 * transaction.
 */
export const rollbackReservation = function (
  reservationId: string,
  lockedProofs: LockedProofSnapshot[],
): void {
  try {
    const now = new Date().toISOString()
    const batch: SQLBatchTuple[] = []

    for (const snap of lockedProofs) {
      batch.push([
        `UPDATE proofs SET state = ?, tId = ?, updatedAt = ? WHERE secret = ?`,
        [snap.originalState, snap.originalTId, now, snap.secret],
      ])
    }

    batch.push([`DELETE FROM reservations WHERE id = ?`, [reservationId]])

    const db = getInstance()
    db.executeBatch(batch)

    log.info('[rollbackReservation]', 'Reservation rolled back', {
      id: reservationId,
      restoredCount: lockedProofs.length,
    })
  } catch (e: any) {
    throw dbError('Could not rollback proof reservation', e)
  }
}

/**
 * Return all reservations currently in the DB. Used at startup to roll back
 * orphans (operations whose process died before they could commit or rollback).
 */
export const getOpenReservations = function (): ReservationRow[] {
  try {
    const db = getInstance()
    const {rows} = db.execute(`SELECT * FROM reservations`)
    if (!rows) return []

    const result: ReservationRow[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows.item(i)
      let lockedProofs: LockedProofSnapshot[] = []
      try {
        lockedProofs = JSON.parse(row.lockedProofs)
      } catch (e) {
        log.warn('[getOpenReservations] Could not parse lockedProofs JSON', {id: row.id})
      }
      result.push({
        id: row.id,
        transactionId: row.transactionId,
        mintUrl: row.mintUrl,
        unit: row.unit,
        operationType: row.operationType,
        lockedProofs,
        createdAt: new Date(row.createdAt),
      })
    }
    return result
  } catch (e: any) {
    throw dbError('Could not read open reservations', e)
  }
}
