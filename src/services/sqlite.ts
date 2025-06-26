import {
  QuickSQLiteConnection,
  open,
  SQLBatchTuple,
} from 'react-native-quick-sqlite'
import {Proof} from '../models/Proof'
import {
  Transaction,
  TransactionStatus,
} from '../models/Transaction'
import AppError, {Err} from '../utils/AppError'
import {log} from './logService'
import {ProofRecord} from '../models/Proof'
import { isDate } from 'date-fns'

// Helper functions to normalize transaction records with Date objects
const normalizeTransactionRecord = function (r: any) {
  if (r.createdAt) r.createdAt = new Date(r.createdAt);
  if (r.expiresAt) r.expiresAt = r.expiresAt ? new Date(r.expiresAt) : null;
  return r as Transaction;
}

const normalizeTransactionRows = function(rows: any) {
  return rows?._array.map(normalizeTransactionRecord) as Transaction[];
}

let _db: QuickSQLiteConnection

const _dbVersion = 22 // Update this if db changes require migrations

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
        paymentId TEXT,
        type TEXT,
        amount INTEGER,
        unit TEXT,
        fee INTEGER,
        data TEXT,
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
    )`,
    ],    
    [
        `CREATE TABLE IF NOT EXISTS proofs (            
        id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        secret TEXT PRIMARY KEY NOT NULL,
        C TEXT NOT NULL,
        unit TEXT,
        tId INTEGER,
        mintUrl TEXT,
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
      log.info('[_createOrUpdateSchema] New database schema created')
    }

    const {version} = getDatabaseVersion(db)    
    log.info('[_createOrUpdateSchema]', `Device database version: ${version}`)

    // Trigger migrations if there is versions mismatch
    if (version < _dbVersion) {
      _runMigrations(db)
    }
       
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
    const {version} = getDatabaseVersion(db)    

    let currentVersion = version
    let migrationQueries: SQLBatchTuple[] = []

    // Database migrations sequence based on local version numbers
    if (currentVersion < 19) {
      migrationQueries.push([
        `DROP TABLE usersettings`,   
      ])

      log.info(`Prepared database migrations from ${currentVersion} -> 19`)
    }

    if (currentVersion < 20) {
      migrationQueries.push([
        `ALTER TABLE transactions
         ADD COLUMN paymentId TEXT`,   
      ])

      log.info(`Prepared database migrations from ${currentVersion} -> 20`)
    }

    if (currentVersion < 21) {
      migrationQueries.push([
        `ALTER TABLE transactions
         ADD COLUMN quote TEXT`,   
      ])

      log.info(`Prepared database migrations from ${currentVersion} -> 21`)
    }

    if (currentVersion < 22) {
      migrationQueries.push([
        `ALTER TABLE transactions
         ADD COLUMN paymentRequest TEXT` 
      ])

      migrationQueries.push([
        `ALTER TABLE transactions
         ADD COLUMN expiresAt TEXT` 
      ])

      log.info(`Prepared database migrations from ${currentVersion} -> 22`)
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
    // silent    
    log.info(
      Err.DATABASE_ERROR,
      'Database migrations error: ' + JSON.stringify(e),      
    )
  }
}

/*
 * Exported functions
 */

const cleanAll = function () {
  const dropQueries = [
    ['DROP TABLE transactions'],    
    ['DROP TABLE proofs'],
    ['DROP TABLE dbversion'],
  ] as SQLBatchTuple[]

  try {
    const db = getInstance()
    const {rowsAffected} = db.executeBatch(dropQueries)

    if (rowsAffected && rowsAffected > 0) {
      log.info('[cleanAll]', 'Database tables were deleted')
    }
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not delete database schema',
      e.message,
    )
  }
}


const getDatabaseVersion = function (db: QuickSQLiteConnection): {version: number} {
  try {
    const query = `
      SELECT version FROM dbVersion
    `
        
    const {rows} = db.execute(query)

    if (!rows?.item(0)) {
        // On first run, insert current version record
        const now = new Date()
        const insertQuery = `
            INSERT OR REPLACE INTO dbversion (id, version, createdAt)
            VALUES (?, ?, ?)
        `
        const params = [1, _dbVersion, now.toISOString()]
        db.execute(insertQuery, params)

        return {version: _dbVersion}      
    }

    return rows?.item(0)    
    
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not get database version',
      e.message,
    )
  }
}
/*
 * Transactions
 */


const updateTransaction = function (id: number, fields: Partial<Transaction>): Transaction {

  const allowedColumns = ['amount','fee','unit','data','sentFrom','sentTo','profile','memo','paymentId','quote','paymentRequest','zapRequest','inputToken','outputToken','proof','balanceAfter','noteToSelf','tags','status','expiresAt'];
  
  try {
    // Normalize data types for sqlite
    for (const key in fields) {
      const value = fields[key]
    
      if (value === '') {
        fields[key] = null
      }
    
      if (isDate(value)) {
        fields[key] = value.toISOString()
      }
    }

    // Filter keys against allowed columns
    const validKeys = Object.keys(fields).filter(key => allowedColumns.includes(key))        
    
    if (validKeys.length === 0) {
      // No valid keys to update, return existing transaction
      return getTransactionById(id)
    }

    // Build SET clauses and parameters
    const setClauses = validKeys.map(key => `${key} = ?`)
    const params = validKeys.map(key => fields[key])
    params.push(id) // Add id at the end for WHERE clause

    const query = `
      UPDATE transactions
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `

    const db = getInstance()
    const result = db.execute(query, params)

    const updated = getTransactionById(id) // already normalized

    log.trace('[updateTransaction] Transaction updated in the database', {id: updated.id})

    return updated as Transaction
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction in database',
      e.message,
    )
  }
}


const getTransactions = function (limit: number, offset: number, onlyPending: boolean = false) {
  let query: string = ''
  try {
      query = `
      SELECT *
      FROM transactions 
      ORDER BY id DESC
      LIMIT ? OFFSET ?
      `

      if(onlyPending) {
          query = `
          SELECT *
          FROM transactions
          WHERE status = 'PENDING'
          ORDER BY id DESC
          LIMIT ? OFFSET ?
          `
      }

      const params = [limit, offset]

      // log.trace(query, params)

      const db = getInstance()
      const {rows} = db.execute(query, params)

      log.trace(`[getTransactions], Returned ${rows?.length} rows`)

      return normalizeTransactionRows(rows)

  } catch (e: any) {
      throw new AppError(
      Err.DATABASE_ERROR,
      'Transactions could not be retrieved from the database',
      e.message,
      )
  }
}

const getPendingTopups = function () {
  try {
      const query = `
        SELECT *
        FROM transactions
        WHERE status = 'PENDING'
        AND type = 'TOPUP'
        ORDER BY id DESC        
        `      

      const db = getInstance()
      const {rows} = db.execute(query)

      log.trace(`[getPendingTopups], Returned ${rows?.length} rows`)
      
      return normalizeTransactionRows(rows)

  } catch (e: any) {
      throw new AppError(
      Err.DATABASE_ERROR,
      'Transactions could not be retrieved from the database',
      e.message,
      )
  }
}


const getPendingTransfers = function () {
  try {
      const query = `
        SELECT *
        FROM transactions
        WHERE status = 'PENDING'
        AND type = 'TRANSFER'
        ORDER BY id DESC        
        `      

      const db = getInstance()
      const {rows} = db.execute(query)

      log.trace(`[getPendingTransfers], Returned ${rows?.length} rows`)
      
      return normalizeTransactionRows(rows)

  } catch (e: any) {
      throw new AppError(
      Err.DATABASE_ERROR,
      'Transactions could not be retrieved from the database',
      e.message,
      )
  }
}


const getPendingTopupsCount = function () {
  let query: string = ''
  try {
      query = `
        SELECT COUNT(*)
        AS total
        FROM transactions
        WHERE status = 'PENDING'
        AND type = 'TOPUP'             
      `
      
      const db = getInstance()
      const {rows} = db.execute(query)

      log.trace(`[getPendingTopupsCount], Returned ${rows?.item(0)}`)
      
      return rows?.item(0)['total'] as number

  } catch (e: any) {
      throw new AppError(
      Err.DATABASE_ERROR,
      'Transactions could not be retrieved from the database',
      e.message,
      )
  }
}


const getPendingTransfersCount = function () {
  let query: string = ''
  try {
      query = `
        SELECT COUNT(*)
        AS total
        FROM transactions
        WHERE status = 'PENDING'
        AND type = 'TRANSFER'             
      `
      
      const db = getInstance()
      const {rows} = db.execute(query)

      log.trace(`[getPendingTransfersCount], Returned ${rows?.item(0)}`)
      
      return rows?.item(0)['total'] as number

  } catch (e: any) {
      throw new AppError(
      Err.DATABASE_ERROR,
      'Transactions could not be retrieved from the database',
      e.message,
      )
  }
}


const getTransactionsCount = function (status?: TransactionStatus) {
  let query: string
  let params: any[] = []

  try {
      if (status) {
          // Query to get the count for a specific status along with the total
          query = `
              WITH total_count AS (
                  SELECT COUNT(*) AS total FROM transactions
              )
              SELECT status, COUNT(*) AS count, (SELECT total FROM total_count) AS total
              FROM transactions
              WHERE status = ?
              GROUP BY status
          `
          params = [status]
      } else {
          // Query to get the count per status along with the total
          query = `
              WITH total_count AS (
                  SELECT COUNT(*) AS total FROM transactions
              )
              SELECT status, COUNT(*) AS count, (SELECT total FROM total_count) AS total
              FROM transactions
              GROUP BY status
          `
      }

      const db = getInstance()
      const { rows } = db.execute(query, params)
      
      // Convert rows to an object with status counts and a total count
      if(rows) {
        const counts: Record<string, number> = { total: 0 }
        for (let i = 0; i < rows.length; i++) {
            const row = rows.item(i)
            counts[row.status] = row.count
            counts.total = row.total
        }
        return counts
      } else {
        return {total: 0}
      }
      
  } catch (e: any) {
      throw new AppError(Err.DATABASE_ERROR, 'Transaction count error', e.message)
  }
}


const getRecentTransactionsByUnit = (countRecent: number) => {
  try {
      const query = `
          SELECT *
          FROM (
              SELECT *,
                  ROW_NUMBER() OVER (PARTITION BY unit ORDER BY createdAt DESC) as row_num
              FROM transactions
          )
          WHERE row_num <= ?
          ORDER BY unit, createdAt DESC
      `

      const params = [countRecent]
      const db = getInstance()
      const { rows } = db.execute(query, params)     
      
      return normalizeTransactionRows(rows)
      
  } catch (e: any) {
      throw new AppError(Err.DATABASE_ERROR, 'Error retrieving last 3 transactions by unit', e.message)
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


const getTransactionById = function (id: number) {
  try {
    const query = `
      SELECT * FROM transactions WHERE id = ?
    `

    const params = [id]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return normalizeTransactionRecord(rows?.item(0))
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'Transaction not found', e.message)
  }
}


const getTransactionBy = function (criteria: { paymentId?: string; quote?: string; paymentRequest?: string }) {
  try {
    // Input validation: ensure exactly one search criterion is provided
    const providedCriteria = [criteria.paymentId != null, criteria.quote != null, criteria.paymentRequest != null].filter(Boolean).length
    if (providedCriteria !== 1) {
      throw new AppError(Err.DATABASE_ERROR, 'Exactly one search criterion must be provided to getTransactionBy', 'Invalid criteria object')
    }

    // Dynamic query building based on the provided criterion
    let query: string
    let params: string[]

    if (criteria.paymentId != null) {
      query = `SELECT * FROM transactions WHERE paymentId = ?`
      params = [criteria.paymentId]
    } else if (criteria.quote != null) {
      query = `SELECT * FROM transactions WHERE quote = ?`
      params = [criteria.quote]
    } else {
      query = `SELECT * FROM transactions WHERE paymentRequest = ?`
      params = [criteria.paymentRequest!]
    }

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return normalizeTransactionRecord(rows?.item(0))
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'Transaction not found', e.message)
  }
}


const addTransactionAsync = async function (tx: Transaction): Promise<Transaction> {
  try {
    const {type, amount, fee, unit, data, memo, mint, status} = tx
    const now = new Date()

    const query = `
      INSERT INTO transactions (type, amount, fee, unit, data, memo, mint, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    const params = [type, amount, fee, unit, data, memo, mint, status, now.toISOString()]

    const db = getInstance()
    const result = await db.executeAsync(query, params)

    log.info('[addTransactionAsync]', 'New transaction added to the database', {id: result.insertId, type, mint, status})

    return getTransactionById(result.insertId as number) // already normalized

  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not store transaction in the database',
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

    log.info('[updateStatusesAsync]', `Transactions statuses updated in the database`, {numUpdates: result2.rowsAffected, status})

    return result2
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction statuses in the database',
      e.message,
    )
  }
}

const expireAllAfterRecovery = async function () {
  const updateQuery = `
      UPDATE transactions
      SET status = ?      
    `    
    const params = [TransactionStatus.EXPIRED]
    const result = await _db.executeAsync(updateQuery, params)
    log.info('[expireAllAfterRecovery]', `Transactions statuses set to EXPIRED.`)
    return result
}


const deleteTransactionsByStatus = function (status: TransactionStatus) {
    try {
      const query = `
        DELETE FROM transactions
        WHERE status = ?  
      `
      const params = [status]
  
      const db = getInstance()
      const {rows} = db.execute(query, params)

      log.debug('[deleteTransactionsByStatus]', 'Transactions were deleted', {status})

      return rows

    } catch (e: any) {
      throw new AppError(
        Err.DATABASE_ERROR,
        'Could not delete transactions.',
        e.message,
      )
    }
}


const deleteTransactionById = function (id: number) {
  try {
    const query = `
      DELETE FROM transactions
      WHERE id = ? 
      LIMIT 1 
    `
    const params = [id]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    log.debug('[deleteTransactionById]', 'Transaction has been deleted', {id})

    return rows

  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not delete transaction.',
      e.message,
    )
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
      INSERT OR REPLACE INTO proofs (id, amount, secret, C, tId, mintUrl, isPending, isSpent, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    const params = [
      proof.id,
      proof.amount,
      proof.secret,
      proof.C,
      proof.tId,
      proof.mintUrl,
      isPending,
      isSpent,
      now.toISOString(),
    ]

    const db = getInstance()
    const result = db.execute(query, params)
    // DO NOT log proof secrets to Sentry
    log.info('[addOrUpdateProof]', `${isPending ? ' Pending' : ''} proof added or updated in the database`,
      {id: result.insertId, tId: proof.tId, isPending, isSpent},
    )

    const newProof = getProofById(result.insertId as number)

    return newProof as ProofRecord
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
        ` INSERT OR REPLACE INTO proofs (id, amount, secret, C, unit, tId, mintUrl, isPending, isSpent, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          proof.id,
          proof.amount,
          proof.secret,
          proof.C,
          proof.unit,
          proof.tId,
          proof.mintUrl,
          isPending,
          isSpent,
          now.toISOString(),
        ],
      ])
    }

    // log.trace('[addOrUpdateProofs]', {insertQueries})

    // Execute the batch of SQL statements
    const db = getInstance()
    const {rowsAffected} = db.executeBatch(insertQueries)

    // const totalAmount = CashuUtils.getProofsAmount(proofs)
    
    // DO NOT log proof secrets to Sentry
    log.info('[addOrUpdateProofs]',
      `${rowsAffected}${isPending ? ' pending' : ''
      } proofs were added or updated in the database`,
      {isPending, isSpent}
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

// migration
const updateProofsMintUrlMigration = function (id: string, mintUrl: string) {
  try {
    const query = `
      UPDATE proofs
      SET mintUrl = ?
      WHERE id = ?      
    `
    const params = [mintUrl, id]

    const db = getInstance()
    db.execute(query, params)
    
    log.debug('[updateMintUrl]', 'Proof mintUrl updated', {id, mintUrl})

    
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update proof mintUrl in database',
      e.message,
    )
  }
}


const updateProofsMintUrl = function (currentMintUrl: string, updatedMintUrl: string) {
  try {
    const query = `
      UPDATE proofs
      SET mintUrl = ?
      WHERE mintUrl = ?      
    `
    const params = [updatedMintUrl, currentMintUrl]

    const db = getInstance()
    db.execute(query, params)
    
    log.debug('[updateMintUrl]', 'Proof mintUrl updated', {currentMintUrl, updatedMintUrl})

    
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update proof mintUrl in database',
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

    log.info('[removeAllProofs]', 'All proofs were removed from the database.')

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

    return rows?.item(0) as ProofRecord
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'proof not found', e.message)
  }
}

const getProofs = async function (
  isUnspent: boolean,
  isPending: boolean,
  isSpent: boolean,
): Promise<ProofRecord[]> {
  let query: string = ''

  try {
    if (isUnspent) {
        query = `
            SELECT *
            FROM proofs
            WHERE isPending = 0
            AND isSpent = 0
            ORDER BY id DESC        
        `
    }
    if (isPending) {
        query = `
            SELECT *
            FROM proofs
            WHERE isPending = 1
            AND isSpent = 0
            ORDER BY id DESC        
        `
    }
    if (isSpent) {
        query = `
            SELECT *
            FROM proofs
            WHERE isSpent = 1
            ORDER BY id DESC        
        `
    }
    if (isUnspent && isPending) {
      if (isPending) {
        query = `
            SELECT *
            FROM proofs
            WHERE isSpent = 0            
            ORDER BY id DESC        
        `
    }
  }
    
    const db = getInstance()
    const {rows} = await db.executeAsync(query)
    
    return rows?._array as ProofRecord[]

  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Proofs could not be retrieved from the database',
      e.message,
    )
  }
}

const getProofsByTransaction = function (transactionId: number): ProofRecord[] {
  try {
    const query = `
      SELECT *
      FROM proofs 
      WHERE tId = ?      
    `
    const params = [transactionId]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return rows?._array as ProofRecord[]
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Proofs could not be retrieved from the database',
      e.message,
    )
  }
}


const updateProofsToDefaultUnit = async function () {
  try {   

    const query = `
      UPDATE proofs
      SET unit = ?
      WHERE unit IS NULL OR unit = ''     
    `
    const params = ['sat']

    const _db = getInstance()
    const result = await _db.executeAsync(query, params)

    log.info('[migrateProofsToDefaultUnit] executed in the database', {result})

  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'Could not migrateProofsToDefaultUnit  in database', e.message)
  }
}

export const Database = {
  getInstance,
  getDatabaseVersion,
  cleanAll,
  getTransactionsCount,
  getTransactionById,
  getTransactionBy,
  getRecentTransactionsByUnit,
  getTransactions,
  getPendingTopups,
  getPendingTopupsCount,
  getPendingTransfers,
  getPendingTransfersCount,
  addTransactionAsync,  
  updateTransaction,
  expireAllAfterRecovery,
  updateStatusesAsync,
  deleteTransactionsByStatus,
  deleteTransactionById,
  getPendingAmount,
  addOrUpdateProof,
  addOrUpdateProofs,
  updateProofsMintUrlMigration,
  updateProofsMintUrl,
  removeAllProofs,
  getProofById,
  getProofs,
  getProofsByTransaction,
  updateProofsToDefaultUnit
}
