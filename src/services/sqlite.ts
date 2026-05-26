import {
  QuickSQLiteConnection,
  open,
  SQLBatchTuple,
} from 'react-native-quick-sqlite'
import {Proof, ProofState} from '../models/Proof'
import {CashuProof} from './cashu/cashuUtils'
import {
  Transaction,
  TransactionStatus,
} from '../models/Transaction'
import AppError, {Err} from '../utils/AppError'
import {log} from './logService'
import {ProofRecord} from '../models/Proof'
import { isAlive } from 'mobx-state-tree'

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

const _dbVersion = 26 // Update this if db changes require migrations

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
    )`,
    ],    
    [
        `CREATE TABLE IF NOT EXISTS proofs (
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
    )`,
    ],
    [
        `CREATE TABLE IF NOT EXISTS dbversion (
        id INTEGER PRIMARY KEY NOT NULL,
        version INTEGER,
        createdAt TEXT
    )`,
    ],
    [
        // Open outgoing-operation reservations. A row exists only while a
        // reservation is in-flight (between reserve() and commit()/rollback()).
        // Orphans (process died mid-operation) are detected and rolled back
        // at startup.
        `CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY NOT NULL,
        transactionId INTEGER NOT NULL,
        mintUrl TEXT NOT NULL,
        unit TEXT NOT NULL,
        operationType TEXT NOT NULL,
        lockedProofs TEXT NOT NULL,
        createdAt TEXT NOT NULL
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

    if (currentVersion < 23) {
      migrationQueries.push([
        `ALTER TABLE proofs
         ADD COLUMN dleq_r TEXT` 
      ])

      migrationQueries.push([
        `ALTER TABLE proofs
         ADD COLUMN dleq_s TEXT` 
      ])

      migrationQueries.push([
        `ALTER TABLE proofs
         ADD COLUMN dleq_e TEXT` 
      ])

      log.info(`Prepared database migrations from ${currentVersion} -> 23`)
    }

    if (currentVersion < 24) {
      migrationQueries.push([
        `ALTER TABLE transactions
         ADD COLUMN keysetId TEXT`
      ])
      log.info(`Prepared database migrations from ${currentVersion} -> 24`)
    }

    if (currentVersion < 25) {
      // Replace isPending/isSpent boolean columns with a single state TEXT column.
      // SQLite does not support DROP COLUMN in older versions, so we recreate the table.
      migrationQueries.push([
        `CREATE TABLE proofs_v25 (
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
        )`,
      ])
      migrationQueries.push([
        `INSERT INTO proofs_v25
           (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt)
         SELECT
           id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl,
           CASE
             WHEN isSpent = 1 THEN 'SPENT'
             WHEN isPending = 1 THEN 'PENDING'
             ELSE 'UNSPENT'
           END,
           updatedAt
         FROM proofs`,
      ])
      migrationQueries.push([`DROP TABLE proofs`])
      migrationQueries.push([`ALTER TABLE proofs_v25 RENAME TO proofs`])

      log.info(`Prepared database migrations from ${currentVersion} -> 25`)
    }

    if (currentVersion < 26) {
      // Add reservations table for atomic proof reservations (Phase 5).
      migrationQueries.push([
        `CREATE TABLE IF NOT EXISTS reservations (
          id TEXT PRIMARY KEY NOT NULL,
          transactionId INTEGER NOT NULL,
          mintUrl TEXT NOT NULL,
          unit TEXT NOT NULL,
          operationType TEXT NOT NULL,
          lockedProofs TEXT NOT NULL,
          createdAt TEXT NOT NULL
        )`,
      ])

      log.info(`Prepared database migrations from ${currentVersion} -> 26`)
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

  const allowedColumns = ['amount','fee','unit','data', 'keysetId', 'sentFrom','sentTo','profile','memo','paymentId','quote','paymentRequest','zapRequest','inputToken','outputToken','proof','balanceAfter','noteToSelf','tags','status','expiresAt'];
  
  try {
    // Filter keys against allowed columns
    const validKeys = Object.keys(fields).filter(key => allowedColumns.includes(key))        
    
    if (validKeys.length === 0) {
      // No valid keys to update, return existing transaction
      return getTransactionById(id)
    }

    // Build SET clauses and parameters
    const setClauses = validKeys.map(key => `${key} = ?`).join(', ')
    const params = validKeys.map(key => {
      const value = fields[key as keyof Transaction]
      if (key === 'expiresAt' && value instanceof Date) {
        return value.toISOString()
      }
      return value;
    })
    params.push(id) // Add id at the end for WHERE clause

    const query = `
      UPDATE transactions
      SET ${setClauses}
      WHERE id = ?
    `

    const db = getInstance()
    db.execute(query, params)

    const updated = getTransactionById(id) // already normalized

    log.trace('[updateTransaction] Transaction updated in the database', {id: updated.id, status: updated.status})

    return updated as Transaction
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction in database',
      e.message,
    )
  }
}


const getTransactionsAsync = async function (limit: number, offset: number, onlyPending: boolean = false) {
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
      const {rows} = await db.executeAsync(query, params)

      log.trace(`[getTransactionsAsync], Returned ${rows?.length} rows`)

      return normalizeTransactionRows(rows)

  } catch (e: any) {
      throw new AppError(
      Err.DATABASE_ERROR,
      'Transactions could not be retrieved from the database',
      e.message,
      )
  }
}

export type TransactionSearchFilters = {
  amount: boolean
  incoming: boolean
  outgoing: boolean
  pending: boolean
}

const INCOMING_TYPES = ['RECEIVE', 'RECEIVE_OFFLINE', 'RECEIVE_BY_PAYMENT_REQUEST', 'RECEIVE_NOSTR', 'TOPUP']
const OUTGOING_TYPES = ['SEND', 'TRANSFER']

const buildSearchWhere = (term: string, filters: TransactionSearchFilters): {clause: string; params: any[]} => {
  const conditions: string[] = []
  const params: any[] = []
  const trimmed = term.trim()

  if (trimmed.length > 0) {
    if (filters.amount) {
      const n = parseInt(trimmed, 10)
      if (!isNaN(n)) {
        conditions.push('amount = ?')
        params.push(n)
      }
    } else {
      const like = `%${trimmed}%`
      conditions.push('(memo LIKE ? OR noteToSelf LIKE ? OR sentFrom LIKE ? OR sentTo LIKE ?)')
      params.push(like, like, like, like)
    }
  }

  if (filters.incoming) {
    const placeholders = INCOMING_TYPES.map(() => '?').join(',')
    conditions.push(`type IN (${placeholders})`)
    params.push(...INCOMING_TYPES)
  }
  if (filters.outgoing) {
    const placeholders = OUTGOING_TYPES.map(() => '?').join(',')
    conditions.push(`type IN (${placeholders})`)
    params.push(...OUTGOING_TYPES)
  }
  if (filters.pending) {
    conditions.push("status = 'PENDING'")
  }

  if (conditions.length === 0) return {clause: '', params: []}
  return {clause: 'WHERE ' + conditions.join(' AND '), params}
}

const searchTransactionsAsync = async function (
  term: string,
  filters: TransactionSearchFilters,
  limit: number,
  offset: number,
) {
  try {
    const {clause, params} = buildSearchWhere(term, filters)
    const query = `
      SELECT *
      FROM transactions
      ${clause}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `
    const db = getInstance()
    const {rows} = await db.executeAsync(query, [...params, limit, offset])

    log.trace(`[searchTransactionsAsync] Returned ${rows?.length} rows`)

    return normalizeTransactionRows(rows)
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Transactions search failed',
      e.message,
    )
  }
}

const searchTransactionsCount = function (
  term: string,
  filters: TransactionSearchFilters,
): number {
  try {
    const {clause, params} = buildSearchWhere(term, filters)
    const query = `SELECT COUNT(*) AS total FROM transactions ${clause}`
    const db = getInstance()
    const {rows} = db.execute(query, params)
    return (rows?.item(0)?.total as number) || 0
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Transactions search count failed',
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


const getRecentTransactionsByUnitAsync = async (countRecent: number) => {
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
      const { rows } = await db.executeAsync(query, params)     
      
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


const getLastTransactionBy = function (
  criteria: { paymentId?: string; quote?: string; paymentRequest?: string }
): Transaction {
  try {
    // === 1. Validate exactly one search criterion ===
    const provided = Object.values(criteria).filter(v => v != null)
    if (provided.length !== 1) {
      throw new AppError(
        Err.DATABASE_ERROR,
        'Exactly one of paymentId, quote, or paymentRequest must be provided',
      )
    }

    // === 2. Build query with ORDER BY createdAt DESC + LIMIT 1 ===
    let query: string
    let params: string[]

    if (criteria.paymentId != null) {
      query = `
        SELECT * FROM transactions 
        WHERE paymentId = ? 
        ORDER BY createdAt DESC 
        LIMIT 1
      `
      params = [criteria.paymentId]
    } else if (criteria.quote != null) {
      query = `
        SELECT * FROM transactions 
        WHERE quote = ? 
        ORDER BY createdAt DESC 
        LIMIT 1
      `
      params = [criteria.quote]
    } else if (criteria.paymentRequest != null

    ) {
      query = `
        SELECT * FROM transactions 
        WHERE paymentRequest = ? 
        ORDER BY createdAt DESC 
        LIMIT 1
      `
      params = [criteria.paymentRequest]
    } else {
      // This should never happen due to validation above
      throw new AppError(Err.DATABASE_ERROR, 'No valid criterion provided')
    }

    // === 3. Execute ===
    const db = getInstance()
    const result = db.execute(query, params) // assuming this returns { rows: Row[] }

    if (!result.rows || result.rows.length === 0) {
      throw new AppError(Err.NOTFOUND_ERROR, `No transaction found for given criteria`)
    }

    const row = result.rows.item(0) // now guaranteed to be the LATEST one

    log.trace('[getLastTransactionBy]', {
      criteria,
      foundTransactionId: row.id,
      createdAt: row.createdAt,
    })

    return normalizeTransactionRecord(row)
  } catch (e: any) {
    if (e instanceof AppError) {
      throw e // rethrow known app errors
    }

    log.error('[getLastTransactionBy] Database error', e)
    throw new AppError(
      Err.DATABASE_ERROR,
      'Failed to fetch transaction',
      e.message || String(e)
    )
  }
}


const addTransactionAsync = async function (tx: Partial<Transaction>): Promise<Transaction> {
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


const getIncomingPendingCount = function () {
  try {
    const query = `
      SELECT COUNT(*) AS total
      FROM transactions
      WHERE status = 'PENDING' AND type IN ('RECEIVE', 'RECEIVE_BY_PAYMENT_REQUEST')
    `

    const db = getInstance()
    const {rows} = db.execute(query)

    return rows?.item(0)['total'] as number

  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not get incoming pending count.',
      e.message,
    )
  }
}


const deleteIncomingPending = function () {
  try {
    const query = `
      DELETE FROM transactions
      WHERE status = 'PENDING' AND type IN ('RECEIVE', 'RECEIVE_BY_PAYMENT_REQUEST')
    `

    const db = getInstance()
    const {rows} = db.execute(query)

    log.debug('[deleteIncomingPending]', 'Pending incoming transactions were deleted')

    return rows

  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not delete incoming pending transactions.',
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
 * Proofs
 */
const addOrUpdateProof = function (
  proof: Proof,
  state: ProofState = 'UNSPENT',
) {
  try {
    const now = new Date()

    const query = `
      INSERT OR REPLACE INTO proofs (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    const params = [
      proof.id,
      proof.amount,
      proof.secret,
      proof.C,
      proof.dleq ? proof.dleq.r : null,
      proof.dleq ? proof.dleq.s : null,
      proof.dleq ? proof.dleq.e : null,
      proof.unit,
      proof.tId,
      proof.mintUrl,
      state,
      now.toISOString(),
    ]

    const db = getInstance()
    const result = db.execute(query, params)
    // DO NOT log proof secrets to Sentry
    log.info('[addOrUpdateProof]', `Proof added or updated in the database`,
      {id: result.insertId, tId: proof.tId, state},
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
  state: ProofState = 'UNSPENT',
): number | undefined {
  try {
    const now = new Date()
    let insertQueries: SQLBatchTuple[] = []

    if (proofs.length === 0) {
      log.error('[addOrUpdateProofs] Empty proof array passed')
      return 0
    }

    for (const proof of proofs) {
      if (!isAlive(proof)) {
        log.error('[addOrUpdateProofs] Proof is not alive', {id: proof.id})
        continue
      }

      insertQueries.push([
        `INSERT OR REPLACE INTO proofs (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proof.id,
          proof.amount,
          proof.secret,
          proof.C,
          proof.dleq ? proof.dleq.r : null,
          proof.dleq ? proof.dleq.s : null,
          proof.dleq ? proof.dleq.e : null,
          proof.unit,
          proof.tId,
          proof.mintUrl,
          state,
          now.toISOString(),
        ],
      ])
    }

    const db = getInstance()
    const {rowsAffected} = db.executeBatch(insertQueries)

    // DO NOT log proof secrets to Sentry
    log.info('[addOrUpdateProofs]',
      `${rowsAffected} ${state} proofs were added or updated in the database`,
    )

    return rowsAffected
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not insert or update proofs into the database',
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

const getProofs = async (
  includeUnspent: boolean,
  includePending: boolean,
  includeSpent: boolean,
): Promise<ProofRecord[]> => {
  if (!includeUnspent && !includePending && !includeSpent) {
    return []
  }

  const states: string[] = []
  if (includeUnspent) states.push("'UNSPENT'")
  if (includePending) states.push("'PENDING'")
  if (includeSpent)  states.push("'SPENT'")

  const query = `
    SELECT *
    FROM proofs
    WHERE state IN (${states.join(', ')})
    ORDER BY id DESC
  `

  try {
    const db = getInstance()
    const { rows } = await db.executeAsync(query)
    return (rows?._array ?? []) as ProofRecord[]
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


// ─────────────────────────────────────────────────────────────────────────────
// Proof reservations (Phase 5 of refactoring).
//
// A reservation snapshots the pre-operation state of a set of proofs and locks
// them as PENDING in a single SQLite transaction. The reservation row stays in
// the DB for the entire lifetime of the operation so that an orphan (a row left
// behind by a process that died mid-operation) can be detected on next startup
// and rolled back deterministically.
// ─────────────────────────────────────────────────────────────────────────────

export type LockedProofSnapshot = {
  secret: string
  originalState: ProofState
  /**
   * The proof's tId AT RESERVE TIME — i.e. the transaction that previously
   * owned this proof (typically the original RECEIVE/TOPUP that minted it).
   *
   * When the reservation opens, the proof's tId is reassigned to the NEW
   * operation's transactionId so downstream sync sweeps can correctly group
   * spent proofs under the right transaction. On rollback, originalTId is
   * restored.
   *
   * `null` for proofs that had no prior transaction reference.
   */
  originalTId: number | null
}

export type ReservationRow = {
  id: string
  transactionId: number
  mintUrl: string
  unit: string
  operationType: string
  lockedProofs: LockedProofSnapshot[]
  createdAt: Date
}

/**
 * Open a reservation: insert the reservation row and move the locked proofs to
 * PENDING — all in a single SQLite transaction (via executeBatch).
 *
 * If the batch fails, SQLite rolls back automatically and no partial state
 * exists in the database.
 */
const openReservation = function (
  reservation: {
    id: string
    transactionId: number
    mintUrl: string
    unit: string
    operationType: string
    lockedProofs: LockedProofSnapshot[]
  },
  proofsToLock: Proof[],
): void {
  try {
    const now = new Date().toISOString()
    const batch: SQLBatchTuple[] = []

    batch.push([
      `INSERT INTO reservations (id, transactionId, mintUrl, unit, operationType, lockedProofs, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        reservation.id,
        reservation.transactionId,
        reservation.mintUrl,
        reservation.unit,
        reservation.operationType,
        JSON.stringify(reservation.lockedProofs),
        now,
      ],
    ])

    for (const proof of proofsToLock) {
      if (!isAlive(proof)) continue
      batch.push([
        `INSERT OR REPLACE INTO proofs (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proof.id,
          proof.amount,
          proof.secret,
          proof.C,
          proof.dleq ? proof.dleq.r : null,
          proof.dleq ? proof.dleq.s : null,
          proof.dleq ? proof.dleq.e : null,
          proof.unit,
          // Reassign tId to the new operation. The previous tId (which may
          // point to e.g. the original RECEIVE that minted this proof) is
          // captured in lockedProofs[i].originalTId for rollback restoration.
          reservation.transactionId,
          proof.mintUrl,
          'PENDING',
          now,
        ],
      ])
    }

    const db = getInstance()
    db.executeBatch(batch)

    log.info('[openReservation]', 'Reservation opened', {
      id: reservation.id,
      transactionId: reservation.transactionId,
      lockedCount: proofsToLock.length,
      operationType: reservation.operationType,
    })
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not open proof reservation',
      e.message,
    )
  }
}

/**
 * Optional transaction-row update atomically batched with a reservation commit.
 *
 * Only the named columns can be set; this is intentionally narrower than the
 * full Transaction shape so the API is predictable and only covers fields that
 * legitimately need to land atomically with a proof-state finalize.
 */
export type ReservationTransactionUpdate = {
  id: number
  status?: TransactionStatus
  data?: string
  amount?: number
  fee?: number
  balanceAfter?: number
  outputToken?: string
  keysetId?: string
  proof?: string
}

/**
 * Commit a reservation: apply the supplied state transitions, optionally a
 * transaction-row update, and delete the reservation row — all in a single
 * SQLite transaction.
 *
 * Passing `transactionUpdate` closes the proofs-table vs transactions-table
 * atomicity window: a crash between proof-state finalize and tx-status update
 * would otherwise leave a transaction stuck in PENDING/PREPARED while its
 * underlying proofs are SPENT.
 */
const commitReservation = function (
  reservationId: string,
  changes: {
    toSpent?: Proof[]
    toUnspent?: Proof[]
    newProofs?: Array<{
      proofs: Proof[] | CashuProof[]
      state: ProofState
      mintUrl: string
      unit: string
      tId: number
    }>
    transactionUpdate?: ReservationTransactionUpdate
  },
): void {
  try {
    const now = new Date().toISOString()
    const batch: SQLBatchTuple[] = []

    for (const proof of changes.toSpent ?? []) {
      if (!isAlive(proof)) continue
      batch.push([
        `UPDATE proofs SET state = ?, updatedAt = ? WHERE secret = ?`,
        ['SPENT', now, proof.secret],
      ])
    }

    for (const proof of changes.toUnspent ?? []) {
      if (!isAlive(proof)) continue
      batch.push([
        `UPDATE proofs SET state = ?, updatedAt = ? WHERE secret = ?`,
        ['UNSPENT', now, proof.secret],
      ])
    }

    for (const group of changes.newProofs ?? []) {
      for (const proof of group.proofs) {
        // proof.amount may be a cashu-ts `Amount` class instance (when the
        // group came straight from `cashuWallet.send/mint/melt` responses)
        // rather than a plain number. Coerce explicitly — SQLite's JSI
        // binding can't bind non-primitive objects to an INTEGER column and
        // would silently drop the row, leaving the proof in MST but absent
        // from the database (lost on the next restart).
        const amount = typeof proof.amount === 'number' ? proof.amount : Number(proof.amount)
        batch.push([
          `INSERT OR REPLACE INTO proofs (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            proof.id,
            amount,
            proof.secret,
            proof.C,
            proof.dleq ? proof.dleq.r : null,
            proof.dleq ? proof.dleq.s : null,
            proof.dleq ? proof.dleq.e : null,
            group.unit,
            group.tId,
            group.mintUrl,
            group.state,
            now,
          ],
        ])
      }
    }

    if (changes.transactionUpdate) {
      const tu = changes.transactionUpdate
      const setClauses: string[] = []
      const params: (string | number | null)[] = []

      // Whitelist of fields that can be set atomically. Order matters only for
      // readability — params must match clause order.
      const setIfDefined = (col: string, value: string | number | undefined) => {
        if (value !== undefined) {
          setClauses.push(`${col} = ?`)
          params.push(value)
        }
      }
      setIfDefined('status', tu.status)
      setIfDefined('data', tu.data)
      setIfDefined('amount', tu.amount)
      setIfDefined('fee', tu.fee)
      setIfDefined('balanceAfter', tu.balanceAfter)
      setIfDefined('outputToken', tu.outputToken)
      setIfDefined('keysetId', tu.keysetId)
      setIfDefined('proof', tu.proof)

      if (setClauses.length > 0) {
        params.push(tu.id)
        batch.push([
          `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ?`,
          params,
        ])
      }
    }

    batch.push([`DELETE FROM reservations WHERE id = ?`, [reservationId]])

    const db = getInstance()
    db.executeBatch(batch)

    log.info('[commitReservation] ', 'Reservation committed to DB', {
      id: reservationId,
      toSpent: changes.toSpent?.length ?? 0,
      toUnspent: changes.toUnspent?.length ?? 0,
      newGroups: changes.newProofs?.length ?? 0,
      txUpdate: changes.transactionUpdate ? changes.transactionUpdate.id : undefined,
    })
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not commit proof reservation',
      e.message,
    )
  }
}

/**
 * Rollback a reservation: restore each locked proof to its originalState AND
 * originalTId, then delete the reservation row — all in a single SQLite
 * transaction.
 */
const rollbackReservation = function (
  reservationId: string,
  lockedProofs: LockedProofSnapshot[],
): void {
  try {
    const now = new Date().toISOString()
    const batch: SQLBatchTuple[] = []

    for (const snap of lockedProofs) {
      batch.push([
        `UPDATE proofs SET state = ?, tId = ?, updatedAt = ? WHERE secret = ?`,
        [snap.originalState, snap.originalTId, now, snap.secret],
      ])
    }

    batch.push([`DELETE FROM reservations WHERE id = ?`, [reservationId]])

    const db = getInstance()
    db.executeBatch(batch)

    log.info('[rollbackReservation]', 'Reservation rolled back', {
      id: reservationId,
      restoredCount: lockedProofs.length,
    })
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not rollback proof reservation',
      e.message,
    )
  }
}

/**
 * Return all reservations currently in the DB. Used at startup to roll back
 * orphans (operations whose process died before they could commit or rollback).
 */
const getOpenReservations = function (): ReservationRow[] {
  try {
    const db = getInstance()
    const {rows} = db.execute(`SELECT * FROM reservations`)
    if (!rows) return []

    const result: ReservationRow[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows.item(i)
      let lockedProofs: LockedProofSnapshot[] = []
      try {
        lockedProofs = JSON.parse(row.lockedProofs)
      } catch (e) {
        log.warn('[getOpenReservations] Could not parse lockedProofs JSON', {id: row.id})
      }
      result.push({
        id: row.id,
        transactionId: row.transactionId,
        mintUrl: row.mintUrl,
        unit: row.unit,
        operationType: row.operationType,
        lockedProofs,
        createdAt: new Date(row.createdAt),
      })
    }
    return result
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not read open reservations',
      e.message,
    )
  }
}

export const Database = {
  getInstance,
  getDatabaseVersion,
  cleanAll,
  getTransactionsCount,
  getTransactionById,
  getLastTransactionBy,
  getRecentTransactionsByUnitAsync,
  getTransactionsAsync,
  searchTransactionsAsync,
  searchTransactionsCount,
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
  getIncomingPendingCount,
  deleteIncomingPending,
  getPendingAmount,
  addOrUpdateProof,
  addOrUpdateProofs,
  updateProofsMintUrl,
  removeAllProofs,
  getProofById,
  getProofs,
  getProofsByTransaction,
  openReservation,
  commitReservation,
  rollbackReservation,
  getOpenReservations,
}
