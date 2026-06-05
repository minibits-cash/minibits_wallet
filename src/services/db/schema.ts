import {SQLBatchTuple} from './connection'

/**
 * Schema definitions — the single source of truth for table shapes.
 *
 * The `proofs` and `reservations` column lists are referenced from more than
 * one place (first-run creation here, plus the v25 proofs rebuild and the v26
 * reservations add in migrations.ts). Defining the columns once and generating
 * every `CREATE TABLE` from them guarantees the definitions can never drift.
 */

export const TRANSACTIONS_COLUMNS = `
  id INTEGER PRIMARY KEY NOT NULL,
  paymentId TEXT,
  type TEXT,
  amount INTEGER,
  unit TEXT,
  fee INTEGER,
  data TEXT,
  keysetId TEXT,
  sentFrom TEXT,
  sentTo TEXT,
  profile TEXT,
  memo TEXT,
  mint TEXT,
  quote TEXT,
  paymentRequest TEXT,
  zapRequest TEXT,
  inputToken TEXT,
  outputToken TEXT,
  proof TEXT,
  balanceAfter INTEGER,
  noteToSelf TEXT,
  tags TEXT,
  status TEXT,
  expiresAt TEXT,
  createdAt TEXT
`

export const PROOFS_COLUMNS = `
  id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  secret TEXT PRIMARY KEY NOT NULL,
  C TEXT NOT NULL,
  dleq_r TEXT,
  dleq_s TEXT,
  dleq_e TEXT,
  unit TEXT,
  tId INTEGER,
  mintUrl TEXT,
  state TEXT NOT NULL DEFAULT 'UNSPENT',
  updatedAt TEXT
`

export const DBVERSION_COLUMNS = `
  id INTEGER PRIMARY KEY NOT NULL,
  version INTEGER,
  createdAt TEXT
`

export const RESERVATIONS_COLUMNS = `
  id TEXT PRIMARY KEY NOT NULL,
  transactionId INTEGER NOT NULL,
  mintUrl TEXT NOT NULL,
  unit TEXT NOT NULL,
  operationType TEXT NOT NULL,
  lockedProofs TEXT NOT NULL,
  createdAt TEXT NOT NULL
`

/**
 * Per-keyset deterministic-derivation counter (the BIP32 high-water mark).
 *
 * Authoritative store for the counter previously held only in the MST
 * `MintProofsCounter` model and persisted to MMKV via the whole-tree snapshot.
 * Moving it here lets a counter advance commit ATOMICALLY with the proofs it
 * derives (same SQLite transaction) and makes SQLite the single source of truth,
 * closing the cross-engine non-atomicity that risked blinded-secret reuse.
 *
 * Keyed by (mintUrl, keysetId): a keyset id is mint-scoped, and keying on the
 * url keeps the row addressable across mint-url edits.
 */
export const MINT_COUNTERS_COLUMNS = `
  mintUrl TEXT NOT NULL,
  keysetId TEXT NOT NULL,
  unit TEXT,
  counter INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT,
  PRIMARY KEY (mintUrl, keysetId)
`

/**
 * Recovery data for outgoing lightning payments (melt).
 *
 * Holds the serialized `meltPreview` (the blinded change outputData) per
 * transaction, written synchronously BEFORE the melt is submitted so a paid-
 * but-unconfirmed melt can always be recovered and its change ecash unblinded —
 * previously kept on the MST MintProofsCounter (debounced MMKV), which risked
 * losing the preview (and the change) on a crash right after submission.
 *
 * Keyed by transactionId (globally unique). A row exists only while a melt is
 * in-flight; it is deleted on terminal success/failure.
 */
export const MELT_RECOVERY_COLUMNS = `
  transactionId INTEGER PRIMARY KEY NOT NULL,
  mintUrl TEXT,
  keysetId TEXT,
  meltPreview TEXT NOT NULL,
  createdAt TEXT
`

/** Build a CREATE TABLE statement from a column block. */
export const createTable = (
  name: string,
  columns: string,
  ifNotExists = true,
): string => `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${name} (${columns})`

/** Ordered list of column names for the proofs table (drives the v25 copy). */
export const PROOFS_COLUMN_NAMES =
  'id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt'

/** First-run schema creation, run inside a single batch transaction. */
export const createSchemaQueries: SQLBatchTuple[] = [
  [createTable('transactions', TRANSACTIONS_COLUMNS)],
  [createTable('proofs', PROOFS_COLUMNS)],
  [createTable('dbversion', DBVERSION_COLUMNS)],
  // Open outgoing-operation reservations. A row exists only while a reservation
  // is in-flight (between reserve() and commit()/rollback()). Orphans (process
  // died mid-operation) are detected and rolled back at startup.
  [createTable('reservations', RESERVATIONS_COLUMNS)],
  // Per-keyset deterministic-derivation counters. Seeded from the MST/MMKV
  // counters on first run after this migration (see countersRepo).
  [createTable('mint_counters', MINT_COUNTERS_COLUMNS)],
  // Per-transaction melt recovery data (serialized meltPreview). A row exists
  // only while an outgoing lightning payment is in-flight (see meltRecoveryRepo).
  [createTable('melt_recovery', MELT_RECOVERY_COLUMNS)],
]
