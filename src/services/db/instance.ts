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

export const cleanAll = function () {
  const dropQueries = [
    ['DROP TABLE transactions'],
    ['DROP TABLE proofs'],
    ['DROP TABLE dbversion'],
    // IF EXISTS: these tables were added by later migrations, so a very old DB
    // may lack them; without the guard a missing table aborts the atomic batch.
    ['DROP TABLE IF EXISTS reservations'],
    ['DROP TABLE IF EXISTS mint_counters'],
    ['DROP TABLE IF EXISTS melt_recovery'],
    ['DROP TABLE IF EXISTS inflight_requests'],
  ] as SQLBatchTuple[]

  try {
    const db = getInstance()
    const {rowsAffected} = db.executeBatch(dropQueries)

    if (rowsAffected && rowsAffected > 0) {
      log.info('[cleanAll]', 'Database tables were deleted')
    }
  } catch (e: any) {
    throw dbError('Could not delete database schema', e)
  }
}
