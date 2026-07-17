import {DbConnection, open, SQLBatchTuple} from './connection'
import {createSchemaQueries, createTable, DBVERSION_COLUMNS} from './schema'
import {_dbVersion, readDatabaseVersion, seedDatabaseVersion, runMigrations} from './migrations'
import {dbError} from './errors'
import {log} from '../logService'

let _db: DbConnection

export const getInstance = function () {
  if (!_db) {
    // 1. creates database
    _db = _createDatabaseInstance() as DbConnection

    // 2. Runs possible migrations and sets version
    _createOrUpdateSchema(_db)
  }

  return _db
}

const _createDatabaseInstance = function () {
  try {
    const instance = open({name: 'minibits.db'})
    return instance as DbConnection
  } catch (e: any) {
    throw dbError('Could not create or open database', e)
  }
}

/**
 * Bring the database to the current schema — by BUILDING it (fresh install) or by
 * MIGRATING it (everything else), never both.
 *
 * That either/or is load-bearing. `createSchemaQueries` describes today's shape, so
 * running it on an existing database was actively harmful: `CREATE TABLE IF NOT
 * EXISTS` skips the tables a device already has, but silently creates the ones it
 * does not — at TODAY's shape. A device old enough to predate a table therefore got
 * it fully-formed, and the migration that adds a column to that table then died on
 * `duplicate column name`, rolling back the entire batch and leaving the database
 * unmigrated. Shipped exactly that: a v29 wallet, which predates onchain_mint_quotes
 * (v31), got it built WITH the mintId that v33 exists to add, and came up with a
 * zero balance.
 *
 * So: the version row decides. Only `dbversion` itself is created unconditionally,
 * because reading the version requires it.
 */
const _createOrUpdateSchema = function (db: DbConnection) {
  try {
    // The one table that must exist before anything can be decided.
    db.execute(createTable('dbversion', DBVERSION_COLUMNS))

    const version = readDatabaseVersion(db)

    if (version === null) {
      // Fresh install: build at the latest shape and record it, so the migrations
      // that produced that shape are correctly skipped.
      db.executeBatch(createSchemaQueries)
      seedDatabaseVersion(db)
      log.info('[_createOrUpdateSchema]', `New database created at version ${_dbVersion}`)
      return
    }

    log.info('[_createOrUpdateSchema]', `Device database version: ${version}`)

    // Existing database: migrations own every shape change from here. Each table a
    // later version introduced is created by ITS migration, at the shape that
    // version had — which is what keeps the subsequent ALTERs valid.
    if (version < _dbVersion) {
      runMigrations(db)
    }
  } catch (e: any) {
    throw dbError('Could not create or update database schema', e)
  }
}

/**
 * Drop EVERY table — the factory reset (see DeveloperScreen).
 *
 * The list is read from the database itself rather than written out here. A
 * hand-maintained list drifts the moment a table is added, and this one had:
 * it named seven tables while the schema had eleven, so a factory reset silently
 * left wallet_counters, onchain_mint_quotes, mints and mint_keysets behind —
 * i.e. the user's mints and their onchain deposit addresses SURVIVED a wipe.
 *
 * It also caused real damage during development: a leftover onchain_mint_quotes
 * from a bad build outlived the reset, and because a create-migration uses
 * `IF NOT EXISTS`, the migration that should have built it fresh silently skipped
 * it — and the ALTER that follows died on "duplicate column name", taking every
 * migration down with it.
 *
 * Asking sqlite_master cannot drift, and it clears artifacts from any past bug too.
 */
export const cleanAll = function () {
  try {
    const db = getInstance()

    const {rows} = db.execute(
      // sqlite_% is SQLite's own bookkeeping (sqlite_sequence and friends) and is
      // not ours to drop.
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    const tables: string[] = (rows?._array ?? []).map((r: any) => r.name)

    if (tables.length === 0) return

    db.executeBatch(tables.map(name => [`DROP TABLE IF EXISTS "${name}"`]) as SQLBatchTuple[])

    log.info('[cleanAll]', 'Database tables were deleted', {tables})
  } catch (e: any) {
    throw dbError('Could not delete database schema', e)
  }
}
