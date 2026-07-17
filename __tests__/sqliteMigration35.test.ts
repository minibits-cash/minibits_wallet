/**
 * Repeatable migration tests for SQLite migration 35.
 *
 * Migration 35 creates the `mints` and `mint_keysets` tables, moving the mints out
 * of the MST/MMKV snapshot and into SQLite.
 *
 * WHY: postProcessSnapshot already strips proofs and transactions, so mints — with
 * every keyset's `keys` map — had become the largest thing left in the persisted
 * tree, and `JSON.stringify(snapshot)` runs on EVERY MST action anywhere, including
 * every proof mutation during a send. It also puts mints in the same engine as the
 * proofs, so a mint-url edit can commit atomically with the proofs it renames.
 *
 * The tables are created EMPTY: mints live in the snapshot, so nothing in SQL can
 * read them. The v39 seed copies them once the store is hydrated.
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
// actually runs on a device.

const MIGRATION_35 = MIGRATIONS.find(m => m.version === 35)!.queries.map(([sql]) => sql)

function runMigration35(db: DatabaseSync) {
  db.exec('BEGIN')
  try {
    for (const sql of MIGRATION_35) db.exec(sql)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

function columns(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{name: string}>
  return rows.map(r => r.name)
}

function tables(db: DatabaseSync): string[] {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as unknown as Array<{
      name: string
    }>
  ).map(r => r.name)
}

/** A pre-35 database: no mints tables at all. */
const freshDb = () => new DatabaseSync(':memory:')

describe('SQLite migration 35 — mints move into SQLite', () => {
  test('creates both tables', () => {
    const db = freshDb()
    expect(tables(db)).not.toContain('mints')

    runMigration35(db)

    expect(tables(db)).toContain('mints')
    expect(tables(db)).toContain('mint_keysets')
    db.close()
  })

  test('mints carries the identity, the url and the JSON payloads', () => {
    const db = freshDb()
    runMigration35(db)

    expect(columns(db, 'mints').sort()).toEqual(
      ['color', 'createdAt', 'hostname', 'id', 'mintInfo', 'mintUrl', 'shortname', 'status', 'units'].sort(),
    )
    db.close()
  })

  test('mint_keysets is keyed by keysetId and owned by mintId', () => {
    const db = freshDb()
    runMigration35(db)

    expect(columns(db, 'mint_keysets').sort()).toEqual(['keys', 'keyset', 'keysetId', 'mintId', 'unit'].sort())
    db.close()
  })

  test('starts empty — the v39 seed fills it, because SQL cannot read the MMKV snapshot', () => {
    const db = freshDb()
    runMigration35(db)

    expect(db.prepare('SELECT * FROM mints').all()).toEqual([])
    expect(db.prepare('SELECT * FROM mint_keysets').all()).toEqual([])
    db.close()
  })

  describe('keys', () => {
    test('a mint id is unique', () => {
      const db = freshDb()
      runMigration35(db)
      const insert = () =>
        db
          .prepare(`INSERT INTO mints (id, mintUrl) VALUES (?, ?)`)
          .run('mint1', 'https://a.test')

      insert()
      expect(insert).toThrow()
      db.close()
    })

    // Matches mint_counters, which is also keyed by keysetId alone: the two agree on
    // what a keyset is, and a keyset id is unique wallet-wide (isCollidingKeysetId).
    test('a keyset id is unique across mints, not just within one', () => {
      const db = freshDb()
      runMigration35(db)

      db.prepare(`INSERT INTO mint_keysets (keysetId, mintId, keyset) VALUES (?, ?, ?)`).run(
        'k1',
        'mint1',
        '{}',
      )

      expect(() =>
        db
          .prepare(`INSERT INTO mint_keysets (keysetId, mintId, keyset) VALUES (?, ?, ?)`)
          .run('k1', 'mint2', '{}'),
      ).toThrow()
      db.close()
    })

    test('mints.mintUrl is NOT unique — the schema does not decide mint identity', () => {
      // Identity is Mint.id. Two rows could legitimately share a url mid-rename, and
      // the constraint that matters (one real mint, one Mint node) is enforced by
      // keyset collision detection, not by a url index.
      const db = freshDb()
      runMigration35(db)

      db.prepare(`INSERT INTO mints (id, mintUrl) VALUES (?, ?)`).run('mint1', 'https://a.test')
      expect(() =>
        db.prepare(`INSERT INTO mints (id, mintUrl) VALUES (?, ?)`).run('mint2', 'https://a.test'),
      ).not.toThrow()
      db.close()
    })
  })
})
