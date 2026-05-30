import {Transaction, TransactionStatus} from '../../models/Transaction'
import AppError, {Err} from '../../utils/AppError'
import {log} from '../logService'
import {getInstance} from './instance'
import {dbError} from './errors'
import {normalizeTransactionRecord, normalizeTransactionRows} from './mappers'

export const updateTransaction = function (id: number, fields: Partial<Transaction>): Transaction {

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
    throw dbError('Could not update transaction in database', e)
  }
}


export const getTransactionsAsync = async function (limit: number, offset: number, onlyPending: boolean = false) {
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
      throw dbError('Transactions could not be retrieved from the database', e)
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

export const searchTransactionsAsync = async function (
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
    throw dbError('Transactions search failed', e)
  }
}

export const searchTransactionsCount = function (
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
    throw dbError('Transactions search count failed', e)
  }
}

export const getPendingTopups = function () {
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
      throw dbError('Transactions could not be retrieved from the database', e)
  }
}


export const getPendingTransfers = function () {
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
      throw dbError('Transactions could not be retrieved from the database', e)
  }
}


export const getPendingTopupsCount = function () {
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
      throw dbError('Transactions could not be retrieved from the database', e)
  }
}


export const getPendingTransfersCount = function () {
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
      throw dbError('Transactions could not be retrieved from the database', e)
  }
}


export const getTransactionsCount = function (status?: TransactionStatus) {
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
      throw dbError('Transaction count error', e)
  }
}


export const getRecentTransactionsByUnitAsync = async (countRecent: number) => {
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
      throw dbError('Error retrieving last 3 transactions by unit', e)
  }
}



export const getPendingAmount = function () {
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
    throw dbError('Transaction not found', e)
  }
}


export const getTransactionById = function (id: number) {
  try {
    const query = `
      SELECT * FROM transactions WHERE id = ?
    `

    const params = [id]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return normalizeTransactionRecord(rows?.item(0))
  } catch (e: any) {
    throw dbError('Transaction not found', e)
  }
}


export const getLastTransactionBy = function (
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
    // dbError passes through the deliberate NOTFOUND/validation AppErrors above
    // and wraps anything else as a DATABASE_ERROR.
    throw dbError('Failed to fetch transaction', e)
  }
}


export const addTransactionAsync = async function (tx: Partial<Transaction>): Promise<Transaction> {
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
    throw dbError('Could not store transaction in the database', e)
  }
}


// This updates status and appends data to the existing transaction data
export const updateStatusesAsync = async function (
  transactionIds: number[],
  status: TransactionStatus,
  data: string,
) {
  if (transactionIds.length === 0) {
    return
  }

  // Bind the ids as parameters rather than interpolating them into the SQL.
  const placeholders = transactionIds.map(() => '?').join(',')

  const selectQuery = `
    SELECT data
    FROM transactions
    WHERE id IN (${placeholders})
  `

  try {
    const db = getInstance()
    const result1 = await db.executeAsync(selectQuery, transactionIds)

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
      WHERE id IN (${placeholders})
    `
    // We update one by one from the array
    const params = [status, updatedDataArray.join(','), ...transactionIds]

    const result2 = await db.executeAsync(updateQuery, params)

    log.info('[updateStatusesAsync]', `Transactions statuses updated in the database`, {numUpdates: result2.rowsAffected, status})

    return result2
  } catch (e: any) {
    throw dbError('Could not update transaction statuses in the database', e)
  }
}

export const expireAllAfterRecovery = async function () {
  const updateQuery = `
      UPDATE transactions
      SET status = ?
    `
    const params = [TransactionStatus.EXPIRED]
    const db = getInstance()
    const result = await db.executeAsync(updateQuery, params)
    log.info('[expireAllAfterRecovery]', `Transactions statuses set to EXPIRED.`)
    return result
}


export const deleteTransactionsByStatus = function (status: TransactionStatus) {
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
      throw dbError('Could not delete transactions.', e)
    }
}


export const getIncomingPendingCount = function () {
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
    throw dbError('Could not get incoming pending count.', e)
  }
}


export const deleteIncomingPending = function () {
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
    throw dbError('Could not delete incoming pending transactions.', e)
  }
}


export const deleteTransactionById = function (id: number) {
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
    throw dbError('Could not delete transaction.', e)
  }
}
