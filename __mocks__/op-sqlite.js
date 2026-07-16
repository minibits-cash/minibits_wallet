/**
 * Jest mock for @op-engineering/op-sqlite — a REAL database, backed by node:sqlite.
 *
 * op-sqlite is native and cannot load under jest. Rather than stub it out, this
 * implements its driver surface on top of Node's built-in SQLite, so tests run the
 * PRODUCTION code path end to end: connection.ts (its param sanitizing, result
 * adaptation and BEGIN/COMMIT batch emulation), instance.ts (schema creation and
 * the real migration runner), and every repo — all real.
 *
 * Why this matters: the db suites used to hand-copy both the DDL and each repo's
 * SQL, and those copies drifted from production repeatedly while staying green.
 * A test that asserts against its own copy of the schema proves nothing about the
 * schema. Mocking at connection.ts's documented seam — "the single seam between
 * the rest of the app and the native SQLite library" — removes the copies entirely.
 *
 * Each test FILE gets its own in-memory database (jest resets the module registry
 * per file, so instance.ts re-runs and rebuilds the schema). Tests within a file
 * share it; clear the tables you use in beforeEach, or use distinct keys.
 *
 * NOT covered here: op-sqlite is not SQLite-the-same-build. Node's SQLite may differ
 * in version and compile flags, so this proves our SQL and our logic, not the exact
 * native binary's behaviour. Device testing still owns that.
 */
const {DatabaseSync} = require('node:sqlite')

/**
 * Statements that RETURN rows. Everything else reports changes/insertId instead.
 *
 * The RETURNING clause matters: walletCountersRepo allocates an index with a single
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING`, which leads with INSERT but yields a
 * row. Routing it by leading keyword alone hands back nothing and the allocation
 * fails.
 */
const returnsRows = sql =>
  /^\s*(select|pragma|with|explain)/i.test(sql) || /\breturning\b/i.test(sql)

/** Transaction control cannot be prepared as a statement; exec it directly. */
const isTransactionControl = sql => /^\s*(begin|commit|rollback|savepoint|release)\b/i.test(sql)

/**
 * node:sqlite binds a narrower set of types than the native driver.
 *
 * connection.ts's sanitizeValue runs BEFORE this and is what the app relies on, so
 * it has already rejected anything genuinely unbindable. This only bridges the two
 * types Node will not take directly — booleans (SQLite has no boolean type; real
 * drivers coerce to 0/1) and ArrayBuffer (Node wants a view).
 */
const toBindable = value => {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return value
}

const open = () => {
  const db = new DatabaseSync(':memory:')

  const executeSync = (query, params) => {
    if (isTransactionControl(query)) {
      db.exec(query)
      return {rows: [], rowsAffected: 0}
    }

    const bound = (params ?? []).map(toBindable)
    const statement = db.prepare(query)

    if (returnsRows(query)) {
      return {rows: statement.all(...bound), rowsAffected: 0}
    }

    const result = statement.run(...bound)
    return {
      rows: [],
      rowsAffected: Number(result.changes ?? 0),
      // Only meaningful for INSERT; harmless elsewhere and matches op-sqlite.
      insertId: result.lastInsertRowid != null ? Number(result.lastInsertRowid) : undefined,
    }
  }

  return {
    executeSync,
    execute: async (query, params) => executeSync(query, params),
    // op-sqlite's own batch is async and all-or-nothing. connection.ts does not use
    // it for the synchronous path (it emulates that with BEGIN/COMMIT over
    // executeSync), so this only serves executeBatchAsync.
    executeBatch: async commands => {
      let rowsAffected = 0
      db.exec('BEGIN')
      try {
        for (const [query, params] of commands) {
          rowsAffected += executeSync(query, params).rowsAffected ?? 0
        }
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return {rowsAffected}
    },
    close: () => db.close(),
    delete: () => {},
  }
}

module.exports = {
  open,
  IOS_DOCUMENT_PATH: '/mock/ios/documents',
  ANDROID_FILES_PATH: '/mock/android/files',
}
module.exports.__esModule = true
