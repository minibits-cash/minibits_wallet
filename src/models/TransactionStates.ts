/**
 * Typed transaction states (Phase: operation lifecycle).
 *
 * The Transaction model has a single `status` field whose value is one of
 * `TransactionStatus`. This file layers a TypeScript-level state machine on
 * top of the loose enum: a discriminated union by `status`, type guards that
 * narrow at use sites, and categorical groupings (terminal, in-flight, etc.).
 *
 * No runtime change — these types refine TypeScript's view of existing
 * Transaction instances. MST instances remain loose; narrowing happens at
 * call sites that opt in.
 *
 * ```typescript
 * const tx = transactionsStore.findById(id)
 * if (!tx) return
 *
 * if (isPrepared(tx)) {
 *   // tx is PreparedTransaction here — TypeScript knows tx.status is one
 *   // of the PREPARED variants, and any prepare-phase-specific code can
 *   // assume the invariants documented on PreparedTransaction.
 * }
 * ```
 *
 * Field tightening per state is intentionally minimal in this base module.
 * Operation-specific stronger guarantees (e.g. SEND's PendingTransaction has
 * an outputToken) live closer to the operation API, layered on top.
 */
import {Transaction, TransactionStatus} from './Transaction'

// ─────────────────────────────────────────────────────────────────────────────
// Per-state intersection types
//
// Each is `Transaction & { status: <specific status value> }`. At runtime
// they're plain Transaction instances; the types differ only at compile
// time so guards can narrow.
// ─────────────────────────────────────────────────────────────────────────────

/** Just-created transaction; nothing reserved yet, no mint contact. */
export type DraftTransaction = Transaction & {
    status: TransactionStatus.DRAFT
}

/**
 * Proofs (for outgoing ops) or expectations (for incoming ops) reserved.
 * Mint not yet contacted in the synchronous path. Safe to `cancel`.
 *
 * Covers both `PREPARED` and `PREPARED_OFFLINE` — the latter is used by
 * offline-receive flows where preparation completes without the mint.
 */
export type PreparedTransaction = Transaction & {
    status: TransactionStatus.PREPARED | TransactionStatus.PREPARED_OFFLINE
}

/**
 * Mint call in flight. Cannot safely cancel from this state (the mint may
 * have already processed the call). Crash recovery should reconcile by
 * checking the mint, not by rolling back blindly.
 */
export type ExecutingTransaction = Transaction & {
    status: TransactionStatus.EXECUTING
}

/**
 * Operation accepted by the mint; awaiting settlement (claim by recipient,
 * lightning settlement, future onchain confirmations). May still be
 * rolled back via `reclaim` for SEND ops with method support.
 */
export type PendingTransaction = Transaction & {
    status: TransactionStatus.PENDING
}

/**
 * Transient state during rollback of a PENDING op (reclaim swap in flight).
 * Crash here requires manual intervention or seed-based recovery.
 */
export type RollingBackTransaction = Transaction & {
    status: TransactionStatus.ROLLING_BACK
}

/** Terminal — operation reversed by user/system; ecash back to spendable. */
export type RevertedTransaction = Transaction & {
    status: TransactionStatus.REVERTED
}

/** Terminal — ecash settled / received successfully. */
export type CompletedTransaction = Transaction & {
    status: TransactionStatus.COMPLETED
}

/** Terminal — failed; user action may be required. */
export type ErrorTransaction = Transaction & {
    status: TransactionStatus.ERROR
}

/** Terminal — invoice/quote expired (lightning-specific). */
export type ExpiredTransaction = Transaction & {
    status: TransactionStatus.EXPIRED
}

/** Terminal — input rejected (e.g. duplicate token, untrusted mint). */
export type BlockedTransaction = Transaction & {
    status: TransactionStatus.BLOCKED
}

/** Terminal — operation recovered from a stuck state (e.g. mint quote PAID after expiry). */
export type RecoveredTransaction = Transaction & {
    status: TransactionStatus.RECOVERED
}

// ─────────────────────────────────────────────────────────────────────────────
// Categorical unions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Operation has reached a final state — no further automatic transitions.
 * Sweeps and recovery should ignore these.
 */
export type TerminalTransaction =
    | CompletedTransaction
    | RevertedTransaction
    | ErrorTransaction
    | ExpiredTransaction
    | BlockedTransaction
    | RecoveredTransaction

/**
 * Operation is in flight — needs continued attention from sweeps,
 * websockets, or user action.
 */
export type InFlightTransaction =
    | DraftTransaction
    | PreparedTransaction
    | ExecutingTransaction
    | PendingTransaction
    | RollingBackTransaction

/**
 * Operation can transition to `REVERTED`:
 *  - `PREPARED`: via `cancel` (no mint call yet, just release reservation)
 *  - `PENDING`: via `reclaim` (swap the locked proofs for fresh ones)
 */
export type RollbackableTransaction = PreparedTransaction | PendingTransaction

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
//
// Each guard returns true when the transaction's status matches and refines
// the caller's view to the corresponding typed variant.
// ─────────────────────────────────────────────────────────────────────────────

export function isDraft(tx: Transaction): tx is DraftTransaction {
    return tx.status === TransactionStatus.DRAFT
}

export function isPrepared(tx: Transaction): tx is PreparedTransaction {
    return (
        tx.status === TransactionStatus.PREPARED ||
        tx.status === TransactionStatus.PREPARED_OFFLINE
    )
}

export function isExecuting(tx: Transaction): tx is ExecutingTransaction {
    return tx.status === TransactionStatus.EXECUTING
}

export function isPending(tx: Transaction): tx is PendingTransaction {
    return tx.status === TransactionStatus.PENDING
}

export function isRollingBack(tx: Transaction): tx is RollingBackTransaction {
    return tx.status === TransactionStatus.ROLLING_BACK
}

export function isReverted(tx: Transaction): tx is RevertedTransaction {
    return tx.status === TransactionStatus.REVERTED
}

export function isCompleted(tx: Transaction): tx is CompletedTransaction {
    return tx.status === TransactionStatus.COMPLETED
}

export function isErrored(tx: Transaction): tx is ErrorTransaction {
    return tx.status === TransactionStatus.ERROR
}

export function isExpired(tx: Transaction): tx is ExpiredTransaction {
    return tx.status === TransactionStatus.EXPIRED
}

export function isBlocked(tx: Transaction): tx is BlockedTransaction {
    return tx.status === TransactionStatus.BLOCKED
}

export function isRecovered(tx: Transaction): tx is RecoveredTransaction {
    return tx.status === TransactionStatus.RECOVERED
}

const TERMINAL_STATUSES: ReadonlySet<TransactionStatus> = new Set([
    TransactionStatus.COMPLETED,
    TransactionStatus.REVERTED,
    TransactionStatus.ERROR,
    TransactionStatus.EXPIRED,
    TransactionStatus.BLOCKED,
    TransactionStatus.RECOVERED,
])

const IN_FLIGHT_STATUSES: ReadonlySet<TransactionStatus> = new Set([
    TransactionStatus.DRAFT,
    TransactionStatus.PREPARED,
    TransactionStatus.PREPARED_OFFLINE,
    TransactionStatus.EXECUTING,
    TransactionStatus.PENDING,
    TransactionStatus.ROLLING_BACK,
])

const ROLLBACKABLE_STATUSES: ReadonlySet<TransactionStatus> = new Set([
    TransactionStatus.PREPARED,
    TransactionStatus.PREPARED_OFFLINE,
    TransactionStatus.PENDING,
])

export function isTerminal(tx: Transaction): tx is TerminalTransaction {
    return TERMINAL_STATUSES.has(tx.status)
}

export function isInFlight(tx: Transaction): tx is InFlightTransaction {
    return IN_FLIGHT_STATUSES.has(tx.status)
}

export function isRollbackable(tx: Transaction): tx is RollbackableTransaction {
    return ROLLBACKABLE_STATUSES.has(tx.status)
}
