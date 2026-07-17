import {SQLBatchTuple} from './connection'

/**
 * Schema definitions — the source of truth for the CURRENT table shapes, used to
 * build a fresh database (see createSchemaQueries).
 *
 * These constants track the latest shape and therefore CHANGE over time. A
 * migration must never build a table from one: a migration has to create the table
 * as it existed AT ITS OWN VERSION, or a device replaying it gets today's shape and
 * the later ALTER that adds the column fails with "duplicate column name". Old
 * migrations freeze their own copy of the shape locally — see the historical
 * constants at the top of migrations.ts.
 *
 * A table rebuild in a migration may reference a live constant only when the
 * migration IS the change that produced that shape (as with the v25 proofs rebuild
 * and the v32 mint_counters re-key), and even then it stops being true the next
 * time the shape moves.
 */

/**
 * Wallet transactions.
 *
 * `mint` and `mintId` are BOTH mint references, and the split is deliberate:
 *
 *  - `mint` is the url the payment actually happened at — a historical fact, frozen
 *    once written. It is what history displays, and rewriting it would be a lie
 *    about the past.
 *  - `mintId` (Mint.id) is the identity, and the ONLY reference to resolve when
 *    doing something: reaching the mint over the network, or asking "is this
 *    transaction's mint still in the wallet?". It survives a mint-url edit.
 *
 * They used to be one column doing both jobs, switched by `status` — live pointer
 * while open, history once terminal. That conflation is why a mint-url edit had to
 * rewrite in-flight rows: the same column that recorded the past was also being
 * dialled. With mintId carrying the identity, `mint` can simply stop moving.
 *
 * `mintId` is nullable: it cannot be backfilled in SQL (mints live in the MST/MMKV
 * snapshot — see the v38 seed in setupRootStore), and history legitimately contains
 * transactions of mints since removed, which have no id to point at. A null means
 * "no mint in this wallet"; `mint` still records where it happened.
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
  mintId TEXT,
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

/**
 * Open outgoing-operation reservations (a row exists only between reserve() and
 * commit()/rollback()).
 *
 * `mintId` (Mint.id) is the owning-mint reference; `mintUrl` is a debug record of
 * where the operation started. Short-lived as these rows are, the url still cannot
 * be trusted at commit time: a mint-url edit RACING an open send would commit the
 * new proofs under the pre-edit url, stranding them at a url no mint owns —
 * an invisible balance. Resolving mintId at commit always yields the live url.
 *
 * Nullable for the same reason as onchain_mint_quotes: ALTER TABLE cannot backfill
 * from MST/MMKV. See the v38 seed in setupRootStore.
 */
export const RESERVATIONS_COLUMNS = `
  id TEXT PRIMARY KEY NOT NULL,
  transactionId INTEGER NOT NULL,
  mintId TEXT,
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
 *
 * A CHILD of the transaction — the primary key IS the parent's id — so it carries
 * no mint reference of its own: the transaction already owns that fact, and every
 * reader arrives here holding the transaction. It used to duplicate `mintUrl` and
 * `keysetId`; neither had a single reader (the keyset that IS used comes from
 * inside `meltPreview`), so they were dead denormalization of precisely the kind
 * that goes stale on a mint-url edit.
 */
export const MELT_RECOVERY_COLUMNS = `
  transactionId INTEGER PRIMARY KEY NOT NULL,
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
 *
 * A CHILD of the transaction — the primary key IS the parent's id — so it carries
 * no mint reference of its own. It used to duplicate `mintUrl` and `keysetId`;
 * `keysetId` had no reader at all, and `mintUrl` served exactly one query ("every
 * request of this mint"), which now joins through the parent's `mintId` instead.
 * That keeps ONE owner of the fact, so there is no second copy to go stale when a
 * mint moves.
 *
 * Reaching the mint through the parent is not merely equivalent, it is more
 * correct: a request whose transaction is gone cannot be applied anyway (the retry
 * settles proofs onto that transaction, and the handler branches on `tx.type`), so
 * a join finding nothing is the right answer rather than a lost row.
 */
export const INFLIGHT_REQUESTS_COLUMNS = `
  transactionId INTEGER PRIMARY KEY NOT NULL,
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
 * The owning mint is referenced by `mintId` (Mint.id), NOT by `mintUrl`. Because a
 * row here outlives everything — the address stays creditable for as long as the
 * mint exists — it has to survive the mint moving to a new url. `mintUrl` is kept
 * as the historical record of where the quote was created and is never followed;
 * following it after a url edit polls a dead host forever, silently, and the
 * deposit can never be minted.
 *
 * `mintId` is nullable only because ALTER TABLE cannot backfill it: mints live in
 * the MST/MMKV snapshot, not SQLite, so the url->id mapping is resolvable only from
 * JS (see the v38 seed in setupRootStore). A null after that seed means the owning
 * mint is no longer in the wallet, and the quote is dead regardless.
 *
 * MELT quotes get no table: they are one-shot and terminal, so their durable state
 * (quote id, outpoint, fee) fits on the transaction row.
 */
export const ONCHAIN_MINT_QUOTES_COLUMNS = `
  quote TEXT PRIMARY KEY NOT NULL,
  mintId TEXT,
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

/**
 * Mints — the wallet's mints, mastered here rather than in the MST/MMKV snapshot.
 *
 * Mints were the last core entity still persisted by serializing the whole MST tree
 * to MMKV. That cost more than it looks: postProcessSnapshot already strips proofs
 * and transactions, so mints (with every keyset's `keys` map) had become BY FAR the
 * largest thing left in the tree — and while an equality guard skips redundant
 * writes, `JSON.stringify(snapshot)` still ran on EVERY MST action anywhere,
 * including every proof mutation during a send. Moving them here takes that cost off
 * the hot path, and lets a mint-url edit commit atomically with the proofs it
 * renames (previously two engines, no transaction).
 *
 * MST keeps a full in-memory copy — reads and MobX reactivity are unchanged. SQLite
 * is the authority; the model is the cache. Same split as proofs and transactions.
 *
 * `mintInfo` and `units` are JSON: nothing queries inside them. `units` is
 * derivable from the keysets, but is stored so a load round-trips the model exactly
 * rather than reconstructing it.
 */
export const MINTS_COLUMNS = `
  id TEXT PRIMARY KEY NOT NULL,
  mintUrl TEXT NOT NULL,
  hostname TEXT,
  shortname TEXT,
  color TEXT,
  status TEXT,
  units TEXT,
  mintInfo TEXT,
  createdAt TEXT
`

/**
 * A mint's keysets, one row each, and the keys that belong to them.
 *
 * Keyed by keysetId ALONE, matching mint_counters — the two now agree on what a
 * keyset is, and a keyset id is unique wallet-wide (enforced at the door by
 * CashuUtils.isCollidingKeysetId, per NUT-02). `mintId` is what makes "which mint
 * owns this keyset" answerable in SQL for the first time, which is also what would
 * let proofs derive their mint from `proofs.id` (a proof's id IS its keyset id)
 * instead of carrying a denormalized url. That is deliberately NOT done yet.
 *
 * `keyset` and `keys` are stored as whole JSON objects rather than exploded into
 * columns: MintKeyset carries fields like `final_expiry` that feed NUT-02 v2 id
 * derivation, and enumerating columns would silently drop whatever cashu-ts adds
 * next. keysetId/mintId/unit are the queryable projection; the blobs are the payload.
 *
 * `keys` is nullable — a keyset the mint advertised but whose keys were not fetched
 * (or were skipped as an unsupported unit) has none.
 */
export const MINT_KEYSETS_COLUMNS = `
  keysetId TEXT PRIMARY KEY NOT NULL,
  mintId TEXT NOT NULL,
  unit TEXT,
  keyset TEXT NOT NULL,
  keys TEXT
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
  // The wallet's mints and their keysets, mastered here rather than in the MMKV
  // snapshot (see mintsRepo). Seeded from the pre-upgrade snapshot on first run
  // after the migration.
  [createTable('mints', MINTS_COLUMNS)],
  [createTable('mint_keysets', MINT_KEYSETS_COLUMNS)],
]
