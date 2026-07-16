/**
 * Repeatable migration tests for SQLite migration 32.
 *
 * Migration 32 re-keys `mint_counters` from PRIMARY KEY (mintUrl, keysetId) to
 * PRIMARY KEY (keysetId).
 *
 * WHY: NUT-13 derives from (seed, keysetId, counter) — the mint url is not an
 * input to any derivation path. `00` ids derive at
 * `m/129372'/0'/{keysetIdInt}'/{counter}'`, v2 `01` ids by HMAC-SHA256 over the
 * id. So (mintUrl, keysetId) asserted a key space that does not exist, with two
 * consequences this migration closes:
 *
 *   1. Two rows could track ONE derivation path independently — the lower row
 *      would hand out indices the mint had already signed against the higher one.
 *   2. A mint-url edit orphaned the row: hydration matched on url, found nothing,
 *      and silently restarted the counter at 0 — reusing blinded secrets from the
 *      very beginning of the keyset.
 *
 * The collapse to MAX(counter) HEALS a wallet already split by (2) rather than
 * merely preventing new splits: a too-high counter skips indices (harmless), a
 * too-low one reuses them (fund loss).
 *
 * Uses Node.js built-in node:sqlite (requires Node 22.5+).
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {DatabaseSync} from 'node:sqlite'
import {MIGRATIONS} from '../src/services/db/migrations'

// ── The REAL migration, taken from the registry ─────────────────────────────
//
// Imported rather than copied: a copy of the SQL proves nothing about the SQL that
// actually runs on a device. The PRE-migration shape below stays hand-written on
// purpose — it is frozen history, and must not track today's schema.

const MIGRATION_32 = MIGRATIONS.find(m => m.version === 32)!.queries.map(([sql]) => sql)

// ── Helpers ──────────────────────────────────────────────────────────────────

const MINT_A = 'https://mint-a.test'
const MINT_B = 'https://mint-b.test'

/** The pre-32 schema: keyed by (mintUrl, keysetId). */
function createOldSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE mint_counters (
      mintUrl TEXT NOT NULL,
      keysetId TEXT NOT NULL,
      unit TEXT,
      counter INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT,
      PRIMARY KEY (mintUrl, keysetId)
    )
  `)
}

function insertOld(
  db: DatabaseSync,
  mintUrl: string,
  keysetId: string,
  unit: string | null,
  counter: number,
  updatedAt: string,
) {
  db.prepare(
    `INSERT INTO mint_counters (mintUrl, keysetId, unit, counter, updatedAt)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(mintUrl, keysetId, unit, counter, updatedAt)
}

function runMigration32(db: DatabaseSync) {
  db.exec('BEGIN')
  try {
    for (const sql of MIGRATION_32) db.exec(sql)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

type CounterRow = {keysetId: string; unit: string | null; counter: number; updatedAt: string | null}

function allRows(db: DatabaseSync): CounterRow[] {
  return db
    .prepare('SELECT keysetId, unit, counter, updatedAt FROM mint_counters ORDER BY keysetId')
    .all() as unknown as CounterRow[]
}

function getCounter(db: DatabaseSync, keysetId: string): number | undefined {
  const row = db
    .prepare('SELECT counter FROM mint_counters WHERE keysetId = ?')
    .get(keysetId) as {counter: number} | undefined
  return row?.counter
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  createOldSchema(db)
  return db
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SQLite migration 32 — re-key mint_counters on keysetId', () => {
  test('carries a single-mint wallet across unchanged', () => {
    const db = freshDb()
    insertOld(db, MINT_A, 'k1', 'sat', 342, '2026-01-01')
    insertOld(db, MINT_A, 'k2', 'sat', 7, '2026-01-02')

    runMigration32(db)

    expect(allRows(db)).toEqual([
      {keysetId: 'k1', unit: 'sat', counter: 342, updatedAt: '2026-01-01'},
      {keysetId: 'k2', unit: 'sat', counter: 7, updatedAt: '2026-01-02'},
    ])
    db.close()
  })

  test('HEALS a wallet split by a mint-url edit: collapses to MAX(counter)', () => {
    const db = freshDb()
    // The exact damage the old key allowed: mint renamed A -> B, wallet kept
    // transacting under B while A's row stayed frozen at the pre-rename value.
    insertOld(db, MINT_A, 'k1', 'sat', 342, '2026-01-01')
    insertOld(db, MINT_B, 'k1', 'sat', 400, '2026-02-01')

    runMigration32(db)

    const rows = allRows(db)
    expect(rows).toHaveLength(1)
    // 400, never 342: skipping indices is safe, reusing them is fund loss.
    expect(rows[0].counter).toBe(400)
    db.close()
  })

  test('the surviving row takes unit/updatedAt from the MAX(counter) row', () => {
    const db = freshDb()
    // Bare columns in a single-aggregate GROUP BY come from the row that matched
    // the aggregate (documented SQLite behaviour), so the row stays internally
    // consistent rather than mixing fields across rows.
    insertOld(db, MINT_A, 'k1', 'sat', 342, '2026-01-01')
    insertOld(db, MINT_B, 'k1', 'sat', 400, '2026-02-01')

    runMigration32(db)

    expect(allRows(db)[0]).toEqual({
      keysetId: 'k1',
      unit: 'sat',
      counter: 400,
      updatedAt: '2026-02-01', // the winning row's timestamp
    })
    db.close()
  })

  test('collapses a three-way split to the single highest counter', () => {
    const db = freshDb()
    insertOld(db, MINT_A, 'k1', 'sat', 10, '2026-01-01')
    insertOld(db, MINT_B, 'k1', 'sat', 900, '2026-02-01')
    insertOld(db, 'https://mint-c.test', 'k1', 'sat', 55, '2026-03-01')

    runMigration32(db)

    expect(allRows(db)).toHaveLength(1)
    expect(getCounter(db, 'k1')).toBe(900)
    db.close()
  })

  test('distinct keysets are never merged, even across mints', () => {
    const db = freshDb()
    insertOld(db, MINT_A, 'k1', 'sat', 100, '2026-01-01')
    insertOld(db, MINT_B, 'k2', 'sat', 200, '2026-01-01')

    runMigration32(db)

    expect(getCounter(db, 'k1')).toBe(100)
    expect(getCounter(db, 'k2')).toBe(200)
    expect(allRows(db)).toHaveLength(2)
    db.close()
  })

  test('an empty table migrates cleanly', () => {
    const db = freshDb()
    runMigration32(db)
    expect(allRows(db)).toEqual([])
    db.close()
  })

  test('preserves a null unit', () => {
    const db = freshDb()
    insertOld(db, MINT_A, 'k1', null, 42, '2026-01-01')

    runMigration32(db)

    expect(allRows(db)[0]).toEqual({
      keysetId: 'k1',
      unit: null,
      counter: 42,
      updatedAt: '2026-01-01',
    })
    db.close()
  })

  test('the new table rejects a duplicate keysetId (the key is enforced, not just declared)', () => {
    const db = freshDb()
    insertOld(db, MINT_A, 'k1', 'sat', 100, '2026-01-01')

    runMigration32(db)

    expect(() =>
      db
        .prepare(`INSERT INTO mint_counters (keysetId, unit, counter, updatedAt) VALUES (?, ?, ?, ?)`)
        .run('k1', 'sat', 5, '2026-04-01'),
    ).toThrow()
    // The original value is untouched by the rejected write.
    expect(getCounter(db, 'k1')).toBe(100)
    db.close()
  })

  test('post-migration upserts stay monotonic on the new key', () => {
    const db = freshDb()
    insertOld(db, MINT_A, 'k1', 'sat', 342, '2026-01-01')
    insertOld(db, MINT_B, 'k1', 'sat', 400, '2026-02-01')

    runMigration32(db)

    // countersRepo.buildCounterUpsert against the healed row.
    const upsert = (value: number) =>
      db
        .prepare(
          `INSERT INTO mint_counters (keysetId, unit, counter, updatedAt)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(keysetId) DO UPDATE SET
             counter = MAX(counter, excluded.counter),
             unit = excluded.unit,
             updatedAt = excluded.updatedAt`,
        )
        .run('k1', 'sat', value, '2026-05-01')

    // A writer still holding the pre-migration low value cannot regress it.
    upsert(342)
    expect(getCounter(db, 'k1')).toBe(400)

    upsert(410)
    expect(getCounter(db, 'k1')).toBe(410)
    db.close()
  })
})
