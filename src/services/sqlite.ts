import {
  QuickSQLiteConnection,
  open,
  SQLBatchTuple,
} from 'react-native-quick-sqlite'
import {Proof} from '../models/Proof'
import {
  Transaction,
  TransactionRecord,
  TransactionStatus,
} from '../models/Transaction'
import {UserSettings} from '../models/UserSettingsStore'
import AppError, {Err} from '../utils/AppError'
import {log} from '../utils/logger'
import {BackupProof} from '../models/Proof'

let _db: QuickSQLiteConnection

const _dbVersion = 1 // Update this if db changes require migrations

const getInstance = function () {
  if (!_db) {
    // 1. creates database
    _db = _createDatabaseInstance() as QuickSQLiteConnection

    // 2. Runs possible migrations and sets version
    _createOrUpdateSchema(_db)
  }

  return _db
}

const _createDatabaseInstance = function () {
  try {
    const instance = open({name: 'minibits.db'})
    return instance as QuickSQLiteConnection
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not create or open database',
      e.message,
    )
  }
}

const _createOrUpdateSchema = function (db: QuickSQLiteConnection) {
  const creationQueries = [
    [
      `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY NOT NULL,
      type TEXT,
      amount INTEGER,
      fee INTEGER,
      data TEXT,
      sentFrom TEXT,
      memo TEXT,
      balanceAfter INTEGER,
      noteToSelf TEXT,
      tags TEXT,
      status TEXT,
      createdAt TEXT
    )`,
    ],
    [
      `CREATE TABLE IF NOT EXISTS usersettings (
      id INTEGER PRIMARY KEY NOT NULL,
      isOnboarded BOOLEAN,
      isStorageEncrypted BOOLEAN,
      isLocalBackupOn BOOLEAN,
      createdAt TEXT      
    )`,
    ],
    [
      `CREATE TABLE IF NOT EXISTS proofs (            
      id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      secret TEXT PRIMARY KEY NOT NULL,
      C TEXT NOT NULL,     
      tId INTEGER,
      isPending BOOLEAN,
      isSpent BOOLEAN,
      updatedAt TEXT      
    )`,
    ],
    [
      `CREATE TABLE IF NOT EXISTS dbversion (
      id INTEGER PRIMARY KEY NOT NULL,
      version INTEGER,
      createdAt TEXT      
    )`,
    ],
  ] as SQLBatchTuple[]

  try {
    const {rowsAffected} = db.executeBatch(creationQueries)

    if (rowsAffected && rowsAffected > 0) {
      log.info('New database schema created')
    }

    // Returns undefined on first run
    const {version} = getDatabaseVersion()

    // Trigger migrations only if there is no version on first run  or versions mismatch
    if (!version || version < _dbVersion) {
      _runMigrations(db)
    }

    log.info('Device database version:', version)
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not create or update database schema',
      e.message,
    )
  }
}

// Run database migrations in case on device version of schema is not yet set or outdated

const _runMigrations = function (db: QuickSQLiteConnection) {
  const now = new Date()
  const {version} = getDatabaseVersion()
  let currentVersion = version

  let migrationQueries: SQLBatchTuple[] = []

  // Database migrations sequence based on local version numbers
  if (currentVersion && currentVersion < 2) {
    log.trace(
      `Preparing database migrations from version ${currentVersion} -> 2`,
    )

    /* migrationQueries.push([
      `ALTER TABLE usersettings
       ADD COLUMN isLocalBackupOn INTEGER default 1`,
    ]) */

    currentVersion = 2
    log.info(`Prepared database migrations to version ${currentVersion}`)
  }

  // On first run or after migrations, this inserts up to date version
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
    // TODO track
    log.error(
      Err.DATABASE_ERROR,
      'Error when executing rootStore migrations',
      e.message,
    )
  }
}

const cleanAll = function () {
  const dropQueries = [
    ['DROP TABLE transactions'],
    ['DROP TABLE usersettings'],
    ['DROP TABLE proofs'],
    ['DROP TABLE dbversion'],
  ] as SQLBatchTuple[]

  try {
    const db = getInstance()
    const {rowsAffected} = db.executeBatch(dropQueries)

    if (rowsAffected && rowsAffected > 0) {
      log.info('Database tables were deleted')
    }
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not delete database schema',
      e.message,
    )
  }
}

/*
 * Exported functions
 */

const getDatabaseVersion = function (): {version: number | undefined} {
  try {
    const query = `
      SELECT version FROM dbVersion
    `
    const db = getInstance()
    const {rows} = db.execute(query)

    if (rows?.length && rows.length > 0) {
      return rows?.item(0)
    }

    return {version: undefined}
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not get database version',
      e.message,
    )
  }
}

/*
 * User settings
 */

const getUserSettings = function (): UserSettings {
  try {
    const query = `
    SELECT * FROM usersettings LIMIT 1
    `
    const db = getInstance()
    const {rows} = db.execute(query)

    if (!rows?.item(0)) {
      const defaultSettings = updateUserSettings({
        isOnboarded: 0,
        isStorageEncrypted: 0,
        isLocalBackupOn: 1,
      })
      log.info('Stored default user settings in the database')
      return defaultSettings
    }

    return rows.item(0)
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not get user settings',
      e.message,
    )
  }
}

const updateUserSettings = function (settings: UserSettings): UserSettings {
  try {
    const now = new Date()
    const {isOnboarded, isStorageEncrypted, isLocalBackupOn} = settings

    const query = `
      INSERT OR REPLACE INTO usersettings (id, isOnboarded, isStorageEncrypted, isLocalBackupOn, createdAt)
      VALUES (?, ?, ?, ?, ?)      
    `
    const params = [
      1,
      isOnboarded,
      isStorageEncrypted,
      isLocalBackupOn,
      now.toISOString(),
    ]

    const db = getInstance()
    db.execute(query, params)

    log.info('User settings updated in the database')

    const updated = getUserSettings()
    return updated
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update user settings',
      e.message,
    )
  }
}

/*
 * Transactions
 */
const getTransactionById = function (id: number) {
  try {
    const query = `
      SELECT * FROM transactions WHERE id = ?
    `

    const params = [id]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return rows?.item(0) as TransactionRecord
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'Transaction not found', e.message)
  }
}

const addTransactionAsync = async function (tx: Transaction) {
  try {
    const {type, amount, data, memo, status} = tx
    const now = new Date()

    const query = `
      INSERT INTO transactions (type, amount, data, memo, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    const params = [type, amount, data, memo, status, now.toISOString()]

    const db = getInstance()
    const result = await db.executeAsync(query, params)

    log.info(
      'New transaction added to the database with id ',
      result.insertId,
      'addTransactionAsync',
    )

    const newTx = getTransactionById(result.insertId as number)

    return newTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not store transaction in the database',
      e.message,
    )
  }
}

const updateStatusAsync = async function (
  id: number,
  status: TransactionStatus,
  data: string,
) {
  try {
    const query = `
      UPDATE transactions
      SET status = ?, data = ?
      WHERE id = ?      
    `
    const params = [status, data, id]

    const db = getInstance()
    await db.executeAsync(query, params)

    log.info(
      'Transaction status and data updated in the database',
      [],
      'updateStatusAsync',
    )

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction status in database',
      e.message,
    )
  }
}

// This updates status and appends data to the existing transaction data
const updateStatusesAsync = async function (
  transactionIds: number[],
  status: TransactionStatus,
  data: string,
) {
  const transactionIdsString = transactionIds.join(',')

  const selectQuery = `
    SELECT data
    FROM transactions
    WHERE id IN (${transactionIdsString})
  `

  try {
    const db = getInstance()
    const result1 = await db.executeAsync(selectQuery)

    if (!result1.rows) {
      return
    }

    const updatedDataArray = []

    // We prepare appended transaction data for each transaction retrieved into array
    for (const row of result1.rows?._array) {
      const currentData = row.data
      const updatedData = currentData.slice(0, -1) + ', ' + data + ']'
      updatedDataArray.push(updatedData)
    }

    const updateQuery = `
      UPDATE transactions
      SET status = ?, data = ?
      WHERE id IN (${transactionIdsString})
    `
    // We update one by one from the array
    const params = [status, updatedDataArray.join(',')]

    const result2 = await _db.executeAsync(updateQuery, params)

    log.trace(
      'Transaction statuses and data updated. Number of updates:',
      result2.rowsAffected,
      'updateStatusesAsync',
    )

    return result2
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction statuses in the database',
      e.message,
    )
  }
}

const updateBalanceAfterAsync = async function (
  id: number,
  balanceAfter: number,
) {
  try {
    const query = `
      UPDATE transactions
      SET balanceAfter = ?
      WHERE id = ?      
    `
    const params = [balanceAfter, id]

    const db = getInstance()
    await db.executeAsync(query, params)

    log.info('Transaction balanceAfter updated in the database')

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction balanceAfter in database',
      e.message,
    )
  }
}

const updatFeeAsync = async function (id: number, fee: number) {
  try {
    const query = `
      UPDATE transactions
      SET fee = ?
      WHERE id = ?      
    `
    const params = [fee, id]

    const db = getInstance()
    await db.executeAsync(query, params)

    log.info('Transaction fee updated in the database')

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction fee in the database',
      e.message,
    )
  }
}

const updateReceivedAmountAsync = async function (id: number, amount: number) {
  try {
    const query = `
      UPDATE transactions
      SET amount = ?
      WHERE id = ?      
    `
    const params = [amount, id]

    const db = getInstance()
    await db.executeAsync(query, params)

    log.info('Transaction received amount updated in the database')

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction received amount in database',
      e.message,
    )
  }
}

const updateNoteAsync = async function (id: number, note: string) {
  try {
    const query = `
      UPDATE transactions
      SET noteToSelf = ?
      WHERE id = ?      
    `
    const params = [note, id]

    const db = getInstance()
    await db.executeAsync(query, params)

    log.info('Transaction note updated in the database')

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction note in database',
      e.message,
    )
  }
}

/* const cleanTransactionData = async function (transactionIds: number[]) {
  try {

    const transactionIdsString = transactionIds.join(',')

    const query = `
      UPDATE transactions
      SET data = ?
      WHERE id IN (${transactionIdsString})
    `
    const params = ['[]']

    const _db = getInstance()
    const result = await _db.executeAsync(query, params)

    log.info('cleanTransactionData executed in the database')

  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'Could not cleanTransactionData  in database', e.message)
  }
} */

const getTransactionsAsync = async function (limit: number, offset: number) {
  try {
    const query = `
      SELECT *
      FROM transactions 
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `
    const params = [limit, offset]

    const db = getInstance()
    const {rows} = await db.executeAsync(query, params)

    return rows
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Transactions could not be retrieved from the database',
      e.message,
    )
  }
}

const getPendingAmount = function () {
  try {
    const query = `
    SELECT 
    SUM(amount) 
    FROM transactions 
    WHERE status = ?
    `
    const params = [TransactionStatus.PENDING]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return rows?.item(0)['SUM(amount)']
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'Transaction not found', e.message)
  }
}

/*
 * Proofs - backup of store model
 */
const addOrUpdateProof = function (
  proof: Proof,
  isPending: boolean = false,
  isSpent: boolean = false,
) {
  try {
    const now = new Date()

    const query = `
      INSERT OR REPLACE INTO proofs (id, amount, secret, C, tId, isPending, isSpent, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    const params = [
      proof.id,
      proof.amount,
      proof.secret,
      proof.C,
      proof.tId,
      isPending,
      isSpent,
      now.toISOString(),
    ]

    const db = getInstance()
    const result = db.execute(query, params)

    log.info(
      `${
        isPending ? ' Pending' : ''
      } proof added or updated in the database with id`,
      result.insertId,
    )

    const newProof = getProofById(result.insertId as number)

    return newProof as BackupProof
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not store proof into the database',
      e.message,
    )
  }
}

const addOrUpdateProofs = function (
  proofs: Proof[],
  isPending: boolean = false,
  isSpent: boolean = false,
): number | undefined {
  try {
    const now = new Date()
    let insertQueries: SQLBatchTuple[] = []

    for (const proof of proofs) {
      insertQueries.push([
        ` INSERT OR REPLACE INTO proofs (id, amount, secret, C, tId, isPending, isSpent, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          proof.id,
          proof.amount,
          proof.secret,
          proof.C,
          proof.tId,
          isPending,
          isSpent,
          now.toISOString(),
        ],
      ])
    }

    // Execute the batch of SQL statements
    const db = getInstance()
    const {rowsAffected} = db.executeBatch(insertQueries)

    log.info(
      `${rowsAffected}${
        isPending ? ' pending' : ''
      } proofs were added or updated in the database`,
    )

    return rowsAffected
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not store proofs into the database',
      e.message,
    )
  }
}

const removeAllProofs = async function () {
  try {
    const query = `
      DELETE FROM proofs
    `
    const db = getInstance()
    db.execute(query)

    log.info('Proofs were removed from the database.')

    return true
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not remove proofs from the database',
      e.message,
    )
  }
}

const getProofById = function (id: number) {
  try {
    const query = `
      SELECT * FROM proofs WHERE id = ?
    `
    const params = [id]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return rows?.item(0) as BackupProof
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'proof not found', e.message)
  }
}

const getProofs = function (
  limit: number,
  offset: number,
  isPending: boolean = false,
  isSpent: boolean = false,
): BackupProof[] {
  let query: string = ''

  try {
    query = `
      SELECT *
      FROM proofs 
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `
    if (isPending) {
      query = `
        SELECT *
        FROM proofs
        WHERE isPending = 1
        AND isSpent = 0
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `
    }
    if (isSpent) {
      query = `
        SELECT *
        FROM proofs
        WHERE isSpent = 1
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `
    }

    const params = [limit, offset]
    const db = getInstance()
    const {rows} = db.execute(query, params)

    return rows?._array as BackupProof[]
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Proofs could not be retrieved from the database',
      e.message,
    )
  }
}

const getProofsByTransaction = function (transactionId: number): BackupProof[] {
  try {
    const query = `
      SELECT *
      FROM proofs 
      WHERE tId = ?      
    `
    const params = [transactionId]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return rows?._array as BackupProof[]
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Proofs could not be retrieved from the database',
      e.message,
    )
  }
}

export const Database = {
  getInstance,
  getDatabaseVersion,
  cleanAll,
  getUserSettings,
  updateUserSettings,
  getTransactionById,
  addTransactionAsync,
  updateStatusAsync,
  updateStatusesAsync,
  updateBalanceAfterAsync,
  updatFeeAsync,
  updateReceivedAmountAsync,
  updateNoteAsync,
  getTransactionsAsync,
  getPendingAmount,
  addOrUpdateProof,
  addOrUpdateProofs,
  removeAllProofs,
  getProofById,
  getProofs,
  getProofsByTransaction,
}
