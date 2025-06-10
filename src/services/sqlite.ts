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
import AppError, {Err} from '../utils/AppError'
import {log} from './logService'
import {BackupProof} from '../models/Proof'

let _db: QuickSQLiteConnection

const _dbVersion = 20 // Update this if db changes require migrations

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
        zapRequest TEXT,
        inputToken TEXT,
        outputToken TEXT,
        proof TEXT,
        balanceAfter INTEGER,
        noteToSelf TEXT,
        tags TEXT,
        status TEXT,
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
      return rows
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
      
      return rows?._array
      
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

    return rows?.item(0) as TransactionRecord
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'Transaction not found', e.message)
  }
}


const getTransactionByPaymentId = function (id: string) {
  try {
    const query = `
      SELECT * FROM transactions WHERE paymentId = ?
    `

    const params = [id]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return rows?.item(0) as TransactionRecord
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'Transaction not found', e.message)
  }
}


const addTransactionAsync = async function (tx: Transaction): Promise<TransactionRecord> {
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

const updateStatus = function (
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
    db.execute(query, params)

    log.info('[updateStatus]', `Transaction status updated in the database`, {id, status})

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

const updateBalanceAfter = function (
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
    db.execute(query, params)    
    
    log.debug('[updateBalanceAfter]', 'Transaction balanceAfter updated', {id, balanceAfter})

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


const updatePaymentId = function (id: number, paymentId: string) {
  try {
    const query = `
      UPDATE transactions
      SET paymentId = ?
      WHERE id = ?      
    `
    const params = [paymentId, id]

    const db = getInstance()
    db.execute(query, params)

    log.debug('[updatePaymentId]', 'Transaction paymentId updated in the database', {id, paymentId})

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction paymentId in the database',
      e.message,
    )
  }
}


const updateFee = function (id: number, fee: number) {
  try {
    const query = `
      UPDATE transactions
      SET fee = ?
      WHERE id = ?      
    `
    const params = [fee, id]

    const db = getInstance()
    db.execute(query, params)

    log.debug('[updateFee]', 'Transaction fee updated in the database', {id, fee})

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


const updateReceivedAmount = function (id: number, amount: number) {
  try {
    const query = `
      UPDATE transactions
      SET amount = ?
      WHERE id = ?      
    `
    const params = [amount, id]

    const db = getInstance()
    db.execute(query, params)

    log.debug('[updateReceivedAmountAsync]', 'Transaction received amount updated in the database', {id, amount})

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

const updateNote = function (id: number, note: string) {
  try {
    const query = `
      UPDATE transactions
      SET noteToSelf = ?
      WHERE id = ?      
    `
    const params = [note, id]

    const db = getInstance()
    db.executeAsync(query, params)
    // DO NOT log to Sentry
    log.trace('[updateNote]', 'Transaction note updated in the database', {id, note})

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


const updateSentFrom = function (id: number, sentFrom: string) {
    try {
      const query = `
        UPDATE transactions
        SET sentFrom = ?
        WHERE id = ?      
      `
      const params = [sentFrom, id]
  
      const db = getInstance()
      db.executeAsync(query, params)

      log.trace('[updateSentFrom]', 'Transaction sentFrom updated in the database', {id, sentFrom})
  
      const updatedTx = getTransactionById(id as number)
  
      return updatedTx as TransactionRecord
    } catch (e: any) {
      throw new AppError(
        Err.DATABASE_ERROR,
        'Could not update transaction sentFrom in database',
        e.message,
      )
    }
}


const updateSentTo = function (id: number, sentTo: string) {
    try {
      const query = `
        UPDATE transactions
        SET sentTo = ?
        WHERE id = ?      
      `
      const params = [sentTo, id]
  
      const db = getInstance()
      db.execute(query, params)
      
      log.trace('[updateSentToAsync]', 'Transaction sentTo updated in the database', {id, sentTo})
  
      const updatedTx = getTransactionById(id as number)
  
      return updatedTx as TransactionRecord
    } catch (e: any) {
      throw new AppError(
        Err.DATABASE_ERROR,
        'Could not update transaction sentTo in database',
        e.message,
      )
    }
}


const updateProfile = function (id: number, profile: string) {
  try {
    const query = `
      UPDATE transactions
      SET profile = ?
      WHERE id = ?      
    `
    const params = [profile, id]

    const db = getInstance()
    db.execute(query, params)
    
    log.trace('[updateProfile]', 'Transaction sentTo updated in the database', {id, profile})

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction profile in database',
      e.message,
    )
  }
}


const updateInputToken = function (id: number, inputToken: string) {
  try {
    const query = `
      UPDATE transactions
      SET inputToken = ?
      WHERE id = ?      
    `
    const params = [inputToken, id]

    const db = getInstance()
    db.execute(query, params)
    
    log.debug('[updateInputToken]', 'Transaction inputToken updated in the database', {id})

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction inputToken in database',
      e.message,
    )
  }
}


const updateOutputToken = function (id: number, outputToken: string) {
  try {
    const query = `
      UPDATE transactions
      SET outputToken = ?
      WHERE id = ?      
    `
    const params = [outputToken, id]

    const db = getInstance()
    db.execute(query, params)
    
    log.debug('[updateOutputToken]', 'Transaction outputToken updated in the database', {id, outputToken})

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction outputToken in database',
      e.message,
    )
  }
}

// proof of payment, e.g. preimage
const updateProof = function (id: number, proof: string) {
  try {
    const query = `
      UPDATE transactions
      SET proof = ?
      WHERE id = ?      
    `
    const params = [proof, id]

    const db = getInstance()
    db.execute(query, params)
    
    log.debug('[updateProof]', 'Transaction proof updated in the database', {id, proof})

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction proof in database',
      e.message,
    )
  }
}


const updateZapRequest = function (id: number, zapRequest: string) {
  try {
    const query = `
      UPDATE transactions
      SET zapRequest = ?
      WHERE id = ?      
    `
    const params = [zapRequest, id]

    const db = getInstance()
    db.execute(query, params)
    
    log.trace('[updateProof]', 'Transaction zapRequest updated in the database', {id, zapRequest})

    const updatedTx = getTransactionById(id as number)

    return updatedTx as TransactionRecord
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Could not update transaction zapRequest in database',
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
        'Could not delete transactions',
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

    return rows?.item(0) as BackupProof
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, 'proof not found', e.message)
  }
}

const getProofs = async function (
  isUnspent: boolean,
  isPending: boolean,
  isSpent: boolean,
): Promise<BackupProof[]> {
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
  getTransactionByPaymentId,
  getRecentTransactionsByUnit,
  getTransactions,
  addTransactionAsync,  
  updateStatus,
  expireAllAfterRecovery,
  updateStatusesAsync,
  updateBalanceAfter,
  updateFee,
  updatePaymentId,
  updateReceivedAmount,
  updateNote,
  updateSentFrom,
  updateSentTo,
  updateProfile,
  updateZapRequest,
  updateInputToken,
  updateOutputToken,
  updateProof,  
  deleteTransactionsByStatus,
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