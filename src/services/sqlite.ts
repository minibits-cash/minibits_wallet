/**
 * Backwards-compatible barrel.
 *
 * The SQLite layer was split into focused modules under `./db` (connection,
 * schema, migrations, mappers, instance, and per-table repositories). This file
 * is kept so existing imports (`from '.../services/sqlite'` and, via the
 * services barrel, `from '.../services'`) continue to resolve unchanged.
 *
 * New code should import from `./db` directly.
 */
export * from './db'
