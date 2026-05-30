import {DbConnection, SQLBatchTuple} from './connection'
import {createTable, PROOFS_COLUMNS, PROOFS_COLUMN_NAMES, RESERVATIONS_COLUMNS} from './schema'
import {dbError} from './errors'
import {log} from '../logService'

/** Bump this when a schema change requires a migration, then add an entry below. */
export const _dbVersion = 26

type Migration = {version: number; queries: SQLBatchTuple[]}

/**
 * Ordered migration registry. On startup every migration whose `version` is
 * greater than the device's current version is applied, in order, inside a
 * single batch transaction (with a final version-bump row appended).
 *
 * To add a migration: append an entry with the next version number. No runner
 * logic changes are needed.
 */
const MIGRATIONS: Migration[] = [
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
    queries: [[createTable('reservations', RESERVATIONS_COLUMNS)]],
  },
]

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
