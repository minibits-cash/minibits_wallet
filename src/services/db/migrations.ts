import {DbConnection, SQLBatchTuple} from './connection'
// RESERVATIONS_COLUMNS / ONCHAIN_MINT_QUOTES_COLUMNS are deliberately NOT imported:
// v26 and v31 build those tables from the frozen historical shapes below, not from
// the live schema. See the note there.
import {createTable, PROOFS_COLUMNS, PROOFS_COLUMN_NAMES, MINT_COUNTERS_COLUMNS, MINT_COUNTERS_COLUMN_NAMES, MELT_RECOVERY_COLUMNS, INFLIGHT_REQUESTS_COLUMNS, WALLET_COUNTERS_COLUMNS} from './schema'
import {dbError} from './errors'
import {log} from '../logService'

type Migration = {version: number; queries: SQLBatchTuple[]}

// ─────────────────────────────────────────────────────────────────────────────
// Historical column shapes — FROZEN. Do not edit to match schema.ts.
//
// A migration must create a table as it existed AT ITS OWN VERSION. These used to
// read the live constants from schema.ts, which is unsound the moment a column is
// added: a device replaying the old migration would get TODAY's shape, and the
// later ALTER that adds that column would fail with "duplicate column name" —
// breaking upgrades from exactly the older versions the migration exists to serve.
// (v33 adds mintId to both of these, so that is no longer hypothetical.)
// ─────────────────────────────────────────────────────────────────────────────

/** `reservations` as created by v26, before v33 added mintId. */
const RESERVATIONS_COLUMNS_V26 = `
  id TEXT PRIMARY KEY NOT NULL,
  transactionId INTEGER NOT NULL,
  mintUrl TEXT NOT NULL,
  unit TEXT NOT NULL,
  operationType TEXT NOT NULL,
  lockedProofs TEXT NOT NULL,
  createdAt TEXT NOT NULL
`

/** `melt_recovery` as created by v28, before v34 dropped mintUrl/keysetId. */
const MELT_RECOVERY_COLUMNS_V28 = `
  transactionId INTEGER PRIMARY KEY NOT NULL,
  mintUrl TEXT,
  keysetId TEXT,
  meltPreview TEXT NOT NULL,
  createdAt TEXT
`

/** `inflight_requests` as created by v29, before v34 dropped mintUrl/keysetId. */
const INFLIGHT_REQUESTS_COLUMNS_V29 = `
  transactionId INTEGER PRIMARY KEY NOT NULL,
  mintUrl TEXT,
  keysetId TEXT,
  request TEXT NOT NULL,
  createdAt TEXT
`

/** `onchain_mint_quotes` as created by v31, before v33 added mintId. */
const ONCHAIN_MINT_QUOTES_COLUMNS_V31 = `
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

/**
 * Ordered migration registry. On startup every migration whose `version` is
 * greater than the device's current version is applied, in order, inside a
 * single batch transaction (with a final version-bump row appended).
 *
 * To add a migration: append an entry with the next version number. No runner
 * logic changes are needed.
 */
export const MIGRATIONS: Migration[] = [
  // IF EXISTS: on devices that never had a usersettings table this DROP used to
  // error (and the error was swallowed, leaving the migration stuck). Making it
  // defensive lets these devices migrate forward cleanly and lets us treat any
  // real migration failure as fatal below.
  {version: 19, queries: [[`DROP TABLE IF EXISTS usersettings`]]},
  {version: 20, queries: [[`ALTER TABLE transactions ADD COLUMN paymentId TEXT`]]},
  {version: 21, queries: [[`ALTER TABLE transactions ADD COLUMN quote TEXT`]]},
  {
    version: 22,
    queries: [
      [`ALTER TABLE transactions ADD COLUMN paymentRequest TEXT`],
      [`ALTER TABLE transactions ADD COLUMN expiresAt TEXT`],
    ],
  },
  {
    version: 23,
    queries: [
      [`ALTER TABLE proofs ADD COLUMN dleq_r TEXT`],
      [`ALTER TABLE proofs ADD COLUMN dleq_s TEXT`],
      [`ALTER TABLE proofs ADD COLUMN dleq_e TEXT`],
    ],
  },
  {version: 24, queries: [[`ALTER TABLE transactions ADD COLUMN keysetId TEXT`]]},
  {
    // Replace isPending/isSpent boolean columns with a single state TEXT column.
    // SQLite does not support DROP COLUMN in older versions, so we recreate the
    // table from the canonical proofs column definition.
    version: 25,
    queries: [
      [createTable('proofs_v25', PROOFS_COLUMNS, false)],
      [
        `INSERT INTO proofs_v25
           (${PROOFS_COLUMN_NAMES})
         SELECT
           id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl,
           CASE
             WHEN isSpent = 1 THEN 'SPENT'
             WHEN isPending = 1 THEN 'PENDING'
             ELSE 'UNSPENT'
           END,
           updatedAt
         FROM proofs`,
      ],
      [`DROP TABLE proofs`],
      [`ALTER TABLE proofs_v25 RENAME TO proofs`],
    ],
  },
  {
    // Add reservations table for atomic proof reservations (Phase 5).
    version: 26,
    queries: [[createTable('reservations', RESERVATIONS_COLUMNS_V26)]],
  },
  {
    // Add per-keyset derivation counters table. The table is created empty here;
    // existing counter values are copied from the MST/MMKV snapshot by a one-time
    // idempotent JS seed after rootStore hydration (see countersRepo.seedCounters).
    // The seed is monotonic (never lowers a value), so running this before the
    // seed leaves the wallet correct — counters simply read as not-yet-known and
    // are populated on first hydration.
    version: 27,
    queries: [[createTable('mint_counters', MINT_COUNTERS_COLUMNS)]],
  },
  {
    // Add per-transaction melt recovery table. Empty on creation; any in-flight
    // meltCounterValues from the MST/MMKV snapshot are copied by a one-time JS
    // seed (see setupRootStore._runMigrations).
    version: 28,
    queries: [[createTable('melt_recovery', MELT_RECOVERY_COLUMNS_V28)]],
  },
  {
    // Add per-transaction in-flight request table. Empty on creation; any
    // in-flight requests from the MST/MMKV snapshot are copied by a one-time JS
    // seed (see setupRootStore._runMigrations).
    version: 29,
    queries: [[createTable('inflight_requests', INFLIGHT_REQUESTS_COLUMNS_V29)]],
  },
  {
    // Add wallet-global derivation counters (NUT-20 quote-locking keys).
    // No seed: no NUT-20 quote has ever been created, so an absent row (== 0,
    // the first free index) is correct for both new and upgrading wallets.
    version: 30,
    queries: [[createTable('wallet_counters', WALLET_COUNTERS_COLUMNS)]],
  },
  {
    // Onchain (NUT-30): the mint-quote table, plus `outpoint` on transactions for
    // the melt side's txid:vout (melt quotes are one-shot, so they need no table).
    // Both empty on creation — no onchain transaction can predate this.
    version: 31,
    queries: [
      [createTable('onchain_mint_quotes', ONCHAIN_MINT_QUOTES_COLUMNS_V31)],
      [`ALTER TABLE transactions ADD COLUMN outpoint TEXT`],
    ],
  },
  {
    // Re-key mint_counters on keysetId alone, dropping mintUrl from the primary
    // key. NUT-13 derives from (seed, keysetId, counter) with no mint component,
    // so (mintUrl, keysetId) described a key space that does not exist: it let two
    // rows track ONE derivation path independently, and left a counter
    // unaddressable after a mint-url edit (hydration matched on url, found no row,
    // and silently restarted the counter at 0 — reusing blinded secrets).
    //
    // Any such split is healed here rather than merely prevented: duplicates
    // collapse to MAX(counter), the conservative direction, which can skip indices
    // but never reuse them. SQLite's bare-column rule for a single-aggregate query
    // takes `unit`/`updatedAt` from the same row that supplied MAX(counter), so
    // the surviving row is internally consistent.
    //
    // No DROP COLUMN (unsupported on older SQLite), so the table is rebuilt from
    // the canonical column definition.
    version: 32,
    queries: [
      [createTable('mint_counters_v32', MINT_COUNTERS_COLUMNS, false)],
      [
        `INSERT INTO mint_counters_v32 (${MINT_COUNTERS_COLUMN_NAMES})
         SELECT keysetId, unit, MAX(counter), updatedAt
         FROM mint_counters
         GROUP BY keysetId`,
      ],
      [`DROP TABLE mint_counters`],
      [`ALTER TABLE mint_counters_v32 RENAME TO mint_counters`],
    ],
  },
  {
    // Reference the owning mint by its stable id rather than its url.
    //
    // A mint url is a network locator; mints move. Rows that outlive the move —
    // an onchain quote's address stays creditable for as long as the mint exists —
    // cannot be addressed by one, and following a stale url just polls a dead host
    // forever, silently. Mint.id never changes, so it survives.
    //
    // Added nullable and left NULL here: mints live in the MST/MMKV snapshot, not
    // SQLite, so nothing in SQL can map url -> id. The v38 seed in setupRootStore
    // backfills it once the store is hydrated. A row still NULL after that belongs
    // to a mint no longer in the wallet, and is dead either way.
    //
    // `mintUrl` stays on both tables as the historical record of where the row was
    // created; it is no longer followed.
    version: 33,
    queries: [
      [`ALTER TABLE onchain_mint_quotes ADD COLUMN mintId TEXT`],
      [`ALTER TABLE reservations ADD COLUMN mintId TEXT`],
    ],
  },
  {
    // Split the two jobs `transactions.mint` was doing, and stop the child tables
    // duplicating the answer.
    //
    // `transactions.mint` meant two things at once, switched by status: a
    // historical record of where a finished payment happened, AND a live pointer
    // the wallet dialled for an open one. A mint-url edit therefore had to rewrite
    // the in-flight rows — rewriting the same column that records the past. `mintId`
    // takes over the identity job, so `mint` can be frozen as pure history.
    //
    // inflight_requests and melt_recovery are CHILD rows of a transaction (their
    // primary key IS transactionId), so the parent already owns "which mint". Their
    // own mintUrl/keysetId copies had no readers at all — dead denormalization of
    // exactly the kind that goes stale. They are rebuilt without them; the one
    // mint-scoped query joins through the parent instead.
    //
    // No DROP COLUMN (unsupported on older SQLite), hence the rebuilds. Both tables
    // hold at most a handful of rows, and only while an operation is in flight.
    version: 34,
    queries: [
      [`ALTER TABLE transactions ADD COLUMN mintId TEXT`],

      [createTable('inflight_requests_v34', INFLIGHT_REQUESTS_COLUMNS, false)],
      [
        `INSERT INTO inflight_requests_v34 (transactionId, request, createdAt)
         SELECT transactionId, request, createdAt FROM inflight_requests`,
      ],
      [`DROP TABLE inflight_requests`],
      [`ALTER TABLE inflight_requests_v34 RENAME TO inflight_requests`],

      [createTable('melt_recovery_v34', MELT_RECOVERY_COLUMNS, false)],
      [
        `INSERT INTO melt_recovery_v34 (transactionId, meltPreview, createdAt)
         SELECT transactionId, meltPreview, createdAt FROM melt_recovery`,
      ],
      [`DROP TABLE melt_recovery`],
      [`ALTER TABLE melt_recovery_v34 RENAME TO melt_recovery`],
    ],
  },
]

/**
 * The schema version this build expects: whatever the newest migration produces.
 *
 * DERIVED, never hand-set. It used to be a literal that had to be bumped in step
 * with the list, and forgetting was silent in the worst way: a migration below
 * `_dbVersion` simply never runs (the runner only applies `currentVersion <
 * migration.version` and then stores `_dbVersion`), so devices upgrade to a schema
 * the code does not have, and the failure surfaces later as a missing column. A
 * fresh install would be fine, which is exactly what makes it easy to miss.
 */
export const _dbVersion = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)

/**
 * Pure read of the stored schema version. Returns null when the version row has
 * not been seeded yet (a fresh database). Never mutates.
 */
export const readDatabaseVersion = function (db: DbConnection): number | null {
  const {rows} = db.execute(`SELECT version FROM dbVersion`)
  const row = rows?.item(0)
  return row ? (row.version as number) : null
}

/** Seed (or overwrite) the single dbversion row. */
export const seedDatabaseVersion = function (
  db: DbConnection,
  version: number = _dbVersion,
): void {
  db.execute(
    `INSERT OR REPLACE INTO dbversion (id, version, createdAt) VALUES (?, ?, ?)`,
    [1, version, new Date().toISOString()],
  )
}

/**
 * Read the schema version without mutating. On a fresh, unseeded database this
 * reports the current `_dbVersion`; the actual seeding is done explicitly during
 * schema setup (see instance.ts). Kept on the Database facade for callers that
 * just want to display the version.
 */
export const getDatabaseVersion = function (db: DbConnection): {version: number} {
  try {
    return {version: readDatabaseVersion(db) ?? _dbVersion}
  } catch (e: any) {
    throw dbError('Could not get database version', e)
  }
}

/**
 * Run all migrations whose version is newer than the device's current version,
 * then bump the stored version — all in a single batch transaction.
 *
 * Fails loudly: the batch is atomic, so any failure rolls everything back
 * (including the version bump, so the next launch retries from the same point).
 * We throw rather than swallow — running on a schema that doesn't match the code
 * is the silent-corruption class we're avoiding, and a failed CREATE TABLE
 * already aborts startup in instance.ts, so this is consistent.
 */
export const runMigrations = function (db: DbConnection) {
  const now = new Date()
  const {version: currentVersion} = getDatabaseVersion(db)

  const migrationQueries: SQLBatchTuple[] = []

  for (const migration of MIGRATIONS) {
    if (currentVersion < migration.version) {
      migrationQueries.push(...migration.queries)
      log.info(`Prepared database migrations from ${currentVersion} -> ${migration.version}`)
    }
  }

  // Update db version as a part of migration sqls
  migrationQueries.push([
    `INSERT OR REPLACE INTO dbversion (id, version, createdAt)
      VALUES (?, ?, ?)`,
    [1, _dbVersion, now.toISOString()],
  ])

  try {
    const {rowsAffected} = db.executeBatch(migrationQueries)

    if (rowsAffected && rowsAffected > 0) {
      log.info(`Completed database migrations to version ${_dbVersion}`)
    }
  } catch (e: any) {
    throw dbError('Database migrations failed', e)
  }
}
