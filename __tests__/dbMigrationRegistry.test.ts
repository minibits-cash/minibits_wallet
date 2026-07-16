/**
 * Invariants of the migration registry itself (services/db/migrations.ts).
 *
 * These guard the wiring rather than any one migration's SQL. The failure they
 * exist for is silent and asymmetric: a migration whose version is not below
 * `_dbVersion` never runs (the runner applies only `currentVersion <
 * migration.version`, then stores `_dbVersion`), so upgrading devices end up on a
 * schema the code does not have and fail later with a missing column — while a
 * FRESH install is perfectly fine, because it builds from schema.ts and skips
 * migrations entirely. That asymmetry is what makes it easy to ship.
 *
 * migrations.ts imports only a type from ./connection (elided at runtime), so it
 * loads without the native op-sqlite module.
 *
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {_dbVersion, MIGRATIONS} from '../src/services/db/migrations'

describe('migration registry', () => {
  test('_dbVersion equals the newest migration version', () => {
    const newest = Math.max(...MIGRATIONS.map(m => m.version))
    expect(_dbVersion).toBe(newest)
  })

  test('every migration version is unique', () => {
    const versions = MIGRATIONS.map(m => m.version)
    expect(new Set(versions).size).toBe(versions.length)
  })

  test('migrations are in ascending order', () => {
    // The runner concatenates matching migrations in array order and runs them as
    // one batch, so the array order IS the execution order — a later-versioned
    // entry placed earlier would apply out of sequence.
    const versions = MIGRATIONS.map(m => m.version)
    expect(versions).toEqual([...versions].sort((a, b) => a - b))
  })

  test('no migration is empty', () => {
    for (const m of MIGRATIONS) {
      expect(m.queries.length).toBeGreaterThan(0)
    }
  })
})
