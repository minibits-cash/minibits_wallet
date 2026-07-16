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
  createdAt TEXT,
  outpoint TEXT
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
 * Per-keyset deterministic-derivation counter (the NUT-13 high-water mark).
 *
 * Authoritative store for the counter previously held only in the MST
 * `MintProofsCounter` model and persisted to MMKV via the whole-tree snapshot.
 * Moving it here lets a counter advance commit ATOMICALLY with the proofs it
 * derives (same SQLite transaction) and makes SQLite the single source of truth,
 * closing the cross-engine non-atomicity that risked blinded-secret reuse.
 *
 * Keyed by keysetId ALONE, because that is the real key space: NUT-13 derives
 * from (seed, keysetId, counter) and the mint url is not an input. A `00` id
 * derives at `m/129372'/0'/{keysetIdInt}'/{counter}'`, a v2 `01` id by HMAC-SHA256
 * over the id — neither path has a mint component, so one keyset id means exactly
 * one derivation sequence regardless of which url served it.
 *
 * This was `PRIMARY KEY (mintUrl, keysetId)`, which asserted a key space that does
 * not exist. Two rows could track one derivation path independently, and a
 * mint-url edit left the counter unaddressable — hydration found no row, silently
 * restarted the counter at 0, and risked blinded-secret reuse.
 *
 * Sound because global keyset-id uniqueness is enforced at the door by
 * CashuUtils.isCollidingKeysetId, per NUT-02's requirement that wallets reject
 * keysets colliding with any already held.
 */
export const MINT_COUNTERS_COLUMNS = `
  keysetId TEXT PRIMARY KEY NOT NULL,
  unit TEXT,
  counter INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT
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

/**
 * In-flight mint/swap request data for idempotent retry (NUT-19).
 *
 * Holds the op's request params per transaction, written before the network
 * call so a lost response can be safely retried against the mint's cached
 * (idempotent) endpoint. Previously kept on the MST MintProofsCounter; moved
 * here so retries work with no MST loaded (off-MST background).
 *
 * Keyed by transactionId. A row exists only while a request is in-flight; it is
 * deleted on success or terminal failure.
 */
export const INFLIGHT_REQUESTS_COLUMNS = `
  transactionId INTEGER PRIMARY KEY NOT NULL,
  mintUrl TEXT,
  keysetId TEXT,
  request TEXT NOT NULL,
  createdAt TEXT
`

/**
 * Wallet-global deterministic-derivation counters, keyed by purpose name.
 *
 * Distinct from `mint_counters`, which is keyed by keysetId because a NUT-13
 * counter is keyset-scoped. The counters here belong to derivation paths that
 * have NO keyset component either, so a single value serves the whole wallet. The
 * first is NUT-20 quote-locking (`m/129373'/20'/0'/0'/{counter}`); the table is
 * keyed by name so future wallet-global counters need no migration.
 *
 * `counter` is the NEXT FREE index (a high-water mark), matching the semantics of
 * `mint_counters` (which stores cashu-ts's `next`). Allocation increments and
 * returns the previous value; see walletCountersRepo.
 */
export const WALLET_COUNTERS_COLUMNS = `
  name TEXT PRIMARY KEY NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT
`

/**
 * Onchain (NUT-30) MINT quotes.
 *
 * An onchain mint quote is not a one-shot request like a bolt11 invoice — it is a
 * Bitcoin address that can receive several deposits, and the mint tracks
 * `amount_paid` / `amount_issued` against it. The wallet mints the difference.
 * That state does not fit on a transaction row (one transaction has one fixed
 * amount), so it lives here and transactions point at it via `transactions.quote`
 * — N transactions to 1 quote, one per mint operation.
 *
 * `counterIndex` is the load-bearing column: it is the NUT-20 derivation index,
 * and the ONLY way to re-derive the private key needed to sign a mint request for
 * this quote. Rows are therefore kept forever, even once archived — the mint never
 * expires the address (`expiry` comes back null), so a late deposit stays
 * creditable and the user can still mint it.
 *
 * `watchUntil` is wallet-imposed for exactly that reason: with no mint-side expiry
 * there is nothing to bound polling of a quote nobody ever paid. It mirrors the
 * 24h fallback bolt11 topup applies when an invoice carries no expiry tag.
 *
 * MELT quotes get no table: they are one-shot and terminal, so their durable state
 * (quote id, outpoint, fee) fits on the transaction row.
 */
export const ONCHAIN_MINT_QUOTES_COLUMNS = `
  quote TEXT PRIMARY KEY NOT NULL,
  mintUrl TEXT NOT NULL,
  unit TEXT NOT NULL,
  address TEXT NOT NULL,
  counterIndex INTEGER NOT NULL,
  pubkey TEXT NOT NULL,
  amountRequested INTEGER,
  amountPaid INTEGER NOT NULL DEFAULT 0,
  amountIssued INTEGER NOT NULL DEFAULT 0,
  expiry INTEGER,
  watchUntil TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT
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

/** Ordered column names for mint_counters (drives the v32 re-key rebuild). */
export const MINT_COUNTERS_COLUMN_NAMES = 'keysetId, unit, counter, updatedAt'

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
  // Per-transaction in-flight mint/swap request data for idempotent retry
  // (see inFlightRepo). A row exists only while a request is in-flight.
  [createTable('inflight_requests', INFLIGHT_REQUESTS_COLUMNS)],
  // Wallet-global derivation counters keyed by purpose (see walletCountersRepo).
  // First user: NUT-20 quote-locking keys.
  [createTable('wallet_counters', WALLET_COUNTERS_COLUMNS)],
  // Onchain (NUT-30) mint quotes — the long-lived deposit addresses transactions
  // point at via transactions.quote (see onchainQuotesRepo).
  [createTable('onchain_mint_quotes', ONCHAIN_MINT_QUOTES_COLUMNS)],
]
