import {DbConnection, open, SQLBatchTuple} from './connection'
import {createSchemaQueries} from './schema'
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

const _createOrUpdateSchema = function (db: DbConnection) {
  try {
    const {rowsAffected} = db.executeBatch(createSchemaQueries)

    if (rowsAffected && rowsAffected > 0) {
      log.info('[_createOrUpdateSchema] New database schema created')
    }

    let version = readDatabaseVersion(db)
    if (version === null) {
      // Fresh database: the schema was just created at the latest shape, so
      // seed the version row and skip migrations.
      seedDatabaseVersion(db)
      version = _dbVersion
    }

    log.info('[_createOrUpdateSchema]', `Device database version: ${version}`)

    // Trigger migrations if there is versions mismatch
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
