import {LockedProofSnapshot} from '../sqlite'
import {MintUnit} from './currency'

/**
 * Public type representing an in-flight proof reservation.
 *
 * A reservation is opened via `proofsStore.reserve(...)` and must be either
 * committed (`proofsStore.commitReservation(reservation, changes)`) or rolled
 * back (`proofsStore.rollbackReservation(reservation)`) before the operation
 * completes.
 *
 * If the process dies between open and commit/rollback, the reservation row in
 * SQLite is detected at the next startup and rolled back automatically by
 * `proofsStore.recoverOrphanReservations()`.
 *
 * The shape is intentionally a plain data record (no methods) so it can be
 * captured by closures, passed across MST action boundaries, and serialised
 * for diagnostic logging without surprises.
 */
export type ProofReservation = {
    /** Opaque id (hex). Also the primary key of the reservations table. */
    id: string

    /** Wallet transaction this reservation belongs to. */
    transactionId: number

    /** Mint the reserved proofs belong to. */
    mintUrl: string

    /** Currency unit (sat, msat, usd, …) — used when committing new proofs. */
    unit: MintUnit

    /** Free-form tag of the operation that opened the reservation (e.g. 'send'). */
    operationType: string

    /**
     * Snapshot of the locked proofs at the moment of reservation: enough info
     * to restore their original state on rollback.
     */
    lockedProofs: LockedProofSnapshot[]
}
