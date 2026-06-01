/**
 * op-sqlite connection adapter.
 *
 * This module is the single seam between the rest of the app and the native
 * SQLite library. It exposes a small, quick-sqlite-compatible surface so that
 * `services/sqlite.ts` (and its `Database.*` facade, consumed across 9 files)
 * keeps working with minimal changes after the migration from
 * `react-native-quick-sqlite` to `@op-engineering/op-sqlite`.
 *
 * Three op-sqlite differences are reconciled here so callers never see them:
 *
 *  1. SYNC vs ASYNC. In op-sqlite `execute()` is ASYNC and the synchronous
 *     variant is `executeSync()`. quick-sqlite was the opposite: `execute()`
 *     was sync and `executeAsync()` async. We map:
 *         our `execute`       -> op-sqlite `executeSync`   (stays synchronous)
 *         our `executeAsync`  -> op-sqlite `execute`       (stays async)
 *
 *  2. NO SYNC BATCH. op-sqlite `executeBatch()` is async-only and returns no
 *     `insertId`. Our reservation / schema / migration code calls `executeBatch`
 *     synchronously and depends on its all-or-nothing atomicity. We emulate a
 *     synchronous atomic batch with an explicit BEGIN / COMMIT / ROLLBACK over
 *     `executeSync` (see `executeBatch` below).
 *
 *  3. RESULT SHAPE. op-sqlite returns `rows` as a plain array. quick-sqlite
 *     returned a WebSQL-style object with `item(i)`, `length`, and `_array`.
 *     We wrap every result back into that shape (see `adaptResult`) so the ~600
 *     lines of query code in `sqlite.ts` are untouched.
 *
 * It is ALSO the one place where parameters are sanitized before they reach the
 * native binder (see `sanitizeParams`). This closes the silent-bind footgun that
 * motivated the migration: in quick-sqlite a non-bindable JS object (e.g. a
 * cashu-ts `Amount` instance) fell through the C++ binding silently, shifting
 * every subsequent parameter and corrupting the row. Here, such a value is
 * either coerced deliberately or rejected loudly — never silently dropped.
 */
import {Platform} from 'react-native'
import {
  open as opOpen,
  DB,
  Scalar,
  SQLBatchTuple as OpSQLBatchTuple,
  IOS_DOCUMENT_PATH,
  ANDROID_FILES_PATH,
} from '@op-engineering/op-sqlite'
import AppError, {Err} from '../../utils/AppError'
import {log} from '../logService'

export type {Scalar}

/**
 * A batch command: a SQL string, optionally with a single row of params.
 *
 * Intentionally looser than op-sqlite's `SQLBatchTuple` (whose `Scalar[][]`
 * "param sets" variant makes TS reject the ordinary single-row tuples this
 * codebase builds). Params are sanitized at bind time, so `any[]` here is safe.
 */
export type SQLBatchTuple = [string] | [string, any[]]

/** WebSQL-style row accessor, preserved for compatibility with existing code. */
export type AdaptedRows = {
  _array: any[]
  length: number
  // Returns `any` (not `T | undefined`) to match quick-sqlite's original typing;
  // callers already guard the empty-result case where it matters.
  item: (index: number) => any
}

/** quick-sqlite-compatible result shape. */
export type QueryResult = {
  insertId?: number
  rowsAffected: number
  rows: AdaptedRows
}

/**
 * The connection surface the rest of the app sees. Intentionally a subset of
 * the old `QuickSQLiteConnection` — only the members `sqlite.ts` actually uses.
 */
export type DbConnection = {
  /** Synchronous single statement (maps to op-sqlite `executeSync`). */
  execute: (query: string, params?: unknown[]) => QueryResult
  /** Asynchronous single statement (maps to op-sqlite `execute`). */
  executeAsync: (query: string, params?: unknown[]) => Promise<QueryResult>
  /**
   * Synchronous atomic batch, emulated with BEGIN/COMMIT/ROLLBACK so the
   * historical synchronous semantics and all-or-nothing guarantee are kept.
   */
  executeBatch: (commands: SQLBatchTuple[]) => {rowsAffected: number}
  /** Native async batch (op-sqlite `executeBatch`), for non-atomic-sync paths. */
  executeBatchAsync: (commands: SQLBatchTuple[]) => Promise<{rowsAffected: number}>
}

/**
 * Coerce a single JS value to a SQLite-bindable `Scalar`, or throw.
 *
 * The whole point of routing every bind through here is that an unbindable
 * value can NEVER be silently skipped (the quick-sqlite bug). The rules:
 *   - null / undefined            -> null
 *   - string / boolean / buffers  -> passed through unchanged
 *   - finite number               -> passed through (NaN / Infinity rejected)
 *   - bigint                      -> number if safe, else string
 *   - Date                        -> ISO string (every date column here is TEXT)
 *   - other object (e.g. Amount)  -> Number(v) if finite, else THROW
 *   - anything else               -> THROW
 */
const sanitizeValue = (value: unknown, index: number): Scalar => {
  if (value === null || value === undefined) return null

  const t = typeof value
  if (t === 'string' || t === 'boolean') return value as Scalar
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new AppError(Err.DATABASE_ERROR, 'Cannot bind non-finite number', {index, value})
    }
    return value as number
  }
  if (t === 'bigint') {
    const n = Number(value)
    return Number.isSafeInteger(n) ? n : String(value)
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value as Scalar
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (t === 'object') {
    // cashu-ts `Amount` and other numeric-like wrappers coerce cleanly. Plain
    // objects / arrays produce NaN and are rejected so the bug surfaces loudly.
    const n = Number(value)
    if (Number.isFinite(n)) return n
    throw new AppError(Err.DATABASE_ERROR, 'Cannot bind non-numeric object parameter', {
      index,
      constructor: (value as object)?.constructor?.name,
    })
  }

  throw new AppError(Err.DATABASE_ERROR, `Cannot bind parameter of type ${t}`, {index})
}

const sanitizeParams = (params?: unknown[]): Scalar[] | undefined => {
  if (!params || params.length === 0) return undefined
  return params.map(sanitizeValue)
}

const adaptResult = (r: {insertId?: number; rowsAffected?: number; rows?: any[]}): QueryResult => {
  const rows = r.rows ?? []
  return {
    insertId: r.insertId,
    rowsAffected: r.rowsAffected ?? 0,
    rows: {
      _array: rows,
      length: rows.length,
      item: (index: number) => rows[index],
    },
  }
}

/**
 * Is the tuple's params slot a list of param SETS (Scalar[][]) rather than a
 * single param row (Scalar[])? op-sqlite's `SQLBatchTuple` allows both; the old
 * code only ever used the single-row form, but we handle both for safety.
 */
const isParamSets = (params: unknown[]): params is unknown[][] =>
  params.length > 0 && Array.isArray(params[0])

// ─── Lightweight query performance tracing ──────────────────────────────────
// Logs the duration of every query at TRACE level so the op-sqlite migration
// can be profiled on-device. Only the SQL text (which carries `?` placeholders)
// is logged — NEVER the params, which may contain proof secrets.

const perfNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

const ms = (start: number): number => Math.round((perfNow() - start) * 100) / 100

/** Collapse whitespace and truncate so multi-line SQL logs on a single line. */
const fmtSql = (sql: string): string => {
  const s = sql.replace(/\s+/g, ' ').trim()
  return s.length > 120 ? s.slice(0, 120) + '…' : s
}

/**
 * The database directory react-native-quick-sqlite used, so existing installs
 * keep finding their data after the migration — no copy/move needed.
 *
 * quick-sqlite stored the db in the iOS Documents dir and the Android files dir.
 * op-sqlite's defaults differ (iOS Library, Android databases/), so we pass an
 * ABSOLUTE location: op-sqlite fully overrides its base path when the location
 * starts with '/' (see cpp/OPSqlite.cpp open proxy). The db file then resolves
 * to exactly <Documents|files>/<name> — the same file quick-sqlite created.
 */
const legacyLocation = (): string =>
  Platform.OS === 'ios' ? IOS_DOCUMENT_PATH : ANDROID_FILES_PATH

const open = (params: {name: string; location?: string; encryptionKey?: string}): DbConnection => {
  // Caller-supplied location (if any) still wins over the legacy default.
  const db: DB = opOpen({location: legacyLocation(), ...params})

  const execute = (query: string, p?: unknown[]): QueryResult => {
    const t = perfNow()
    const result = adaptResult(db.executeSync(query, sanitizeParams(p)))
    log.trace('[sqlite.execute]', {ms: ms(t), rows: result.rows.length, sql: fmtSql(query)})
    return result
  }

  const executeAsync = async (query: string, p?: unknown[]): Promise<QueryResult> => {
    const t = perfNow()
    const result = adaptResult(await db.execute(query, sanitizeParams(p)))
    log.trace('[sqlite.executeAsync]', {ms: ms(t), rows: result.rows.length, sql: fmtSql(query)})
    return result
  }

  const executeBatch = (commands: SQLBatchTuple[]): {rowsAffected: number} => {
    const t = perfNow()
    let rowsAffected = 0
    db.executeSync('BEGIN')
    try {
      for (const [query, p] of commands as Array<[string, unknown[]?]>) {
        if (p && isParamSets(p)) {
          for (const set of p) {
            rowsAffected += db.executeSync(query, sanitizeParams(set)).rowsAffected ?? 0
          }
        } else {
          rowsAffected += db.executeSync(query, sanitizeParams(p)).rowsAffected ?? 0
        }
      }
      db.executeSync('COMMIT')
    } catch (e) {
      // Best-effort rollback; surface the original error to the caller.
      try {
        db.executeSync('ROLLBACK')
      } catch {
        // ignore — nothing to roll back / already aborted
      }
      throw e
    }
    log.trace('[sqlite.executeBatch]', {ms: ms(t), statements: commands.length, rowsAffected})
    return {rowsAffected}
  }

  const executeBatchAsync = async (commands: SQLBatchTuple[]): Promise<{rowsAffected: number}> => {
    const t = perfNow()
    const r = await db.executeBatch(commands as OpSQLBatchTuple[])
    log.trace('[sqlite.executeBatchAsync]', {
      ms: ms(t),
      statements: commands.length,
      rowsAffected: r.rowsAffected ?? 0,
    })
    return {rowsAffected: r.rowsAffected ?? 0}
  }

  return {execute, executeAsync, executeBatch, executeBatchAsync}
}

export {open, sanitizeParams}
