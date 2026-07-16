/**
 * Repeatable migration tests for SQLite migration 33.
 *
 * Migration 33 adds `mintId` to `onchain_mint_quotes` and `reservations`, so those
 * rows reference the owning mint by its stable id instead of by url.
 *
 * WHY: a mint url is a network LOCATOR and mints move. An onchain quote's address
 * stays creditable for as long as the mint exists (rows are never deleted), so the
 * reference has to outlive the move; following a stale url just polls a dead host
 * forever, and silently, because the watcher swallows errors by design.
 *
 * The column is added EMPTY and backfilled from JS (the v38 seed), because mints
 * live in the MST/MMKV snapshot rather than SQLite — no SQL statement can map
 * url -> id. These tests cover the migration shape, the backfill semantics, and the
 * replay hazard that made v26/v31 freeze their historical column lists.
 *
 * Uses Node.js built-in node:sqlite (requires Node 22.5+).
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {DatabaseSync} from 'node:sqlite'
import {MIGRATIONS} from '../src/services/db/migrations'

// ── Historical shapes, as v26/v31 create them (frozen in migrations.ts) ───────

const CREATE_ONCHAIN_V31 = `CREATE TABLE onchain_mint_quotes (
  quote TEXT PRIMARY KEY NOT NULL,
  mintUrl TEXT NOT NULL,
  unit TEXT NOT NULL,
  address TEXT NOT NULL,
  counterIndex INTEGER NOT NULL,
  pubkey TEXT NOT NULL,
  amountRequested INTEGER,
  amountPaid INTEGER NOT NULL DEFAULT 0,
  amountIssued INTEGER NOT NULL DEFAULT 0,
  expiry INTEGER,
  watchUntil TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT
)`

const CREATE_RESERVATIONS_V26 = `CREATE TABLE reservations (
  id TEXT PRIMARY KEY NOT NULL,
  transactionId INTEGER NOT NULL,
  mintUrl TEXT NOT NULL,
  unit TEXT NOT NULL,
  operationType TEXT NOT NULL,
  lockedProofs TEXT NOT NULL,
  createdAt TEXT NOT NULL
)`

// ── The REAL migration, taken from the registry ─────────────────────────────
//
// Imported rather than copied: a copy of the SQL proves nothing about the SQL that
// actually runs on a device. The PRE-migration shapes above stay hand-written on
// purpose — they are frozen history, and must not track today's schema.

const MIGRATION_33 = MIGRATIONS.find(m => m.version === 33)!.queries.map(([sql]) => sql)

// ── Backfill, mirroring onchainQuotesRepo / reservationsRepo ─────────────────

function backfillOnchainMintQuoteMintIds(
  db: DatabaseSync,
  mints: Array<{id: string; mintUrl: string}>,
): number {
  let updated = 0
  for (const mint of mints) {
    const {changes} = db
      .prepare(`UPDATE onchain_mint_quotes SET mintId = ? WHERE mintUrl = ? AND mintId IS NULL`)
      .run(mint.id, mint.mintUrl)
    updated += Number(changes)
  }
  return updated
}

function backfillReservationMintIds(
  db: DatabaseSync,
  mints: Array<{id: string; mintUrl: string}>,
): number {
  let updated = 0
  for (const mint of mints) {
    const {changes} = db
      .prepare(`UPDATE reservations SET mintId = ? WHERE mintUrl = ? AND mintId IS NULL`)
      .run(mint.id, mint.mintUrl)
    updated += Number(changes)
  }
  return updated
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MINT_A = {id: 'aaaa1111', mintUrl: 'https://a.mint.test'}
const MINT_B = {id: 'bbbb2222', mintUrl: 'https://b.mint.test'}

function runMigration33(db: DatabaseSync) {
  db.exec('BEGIN')
  try {
    for (const sql of MIGRATION_33) db.exec(sql)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

function insertQuote(db: DatabaseSync, quote: string, mintUrl: string) {
  db.prepare(
    `INSERT INTO onchain_mint_quotes
       (quote, mintUrl, unit, address, counterIndex, pubkey, amountPaid, amountIssued, watchUntil, createdAt)
     VALUES (?, ?, 'sat', 'bc1qaddr', 7, 'pub', 0, 0, '2026-12-01', '2026-01-01')`,
  ).run(quote, mintUrl)
}

function insertReservation(db: DatabaseSync, id: string, mintUrl: string) {
  db.prepare(
    `INSERT INTO reservations (id, transactionId, mintUrl, unit, operationType, lockedProofs, createdAt)
     VALUES (?, 1, ?, 'sat', 'send', '[]', '2026-01-01')`,
  ).run(id, mintUrl)
}

function quoteMintId(db: DatabaseSync, quote: string): string | null {
  const row = db.prepare('SELECT mintId FROM onchain_mint_quotes WHERE quote = ?').get(quote) as
    | {mintId: string | null}
    | undefined
  return row?.mintId ?? null
}

function reservationMintId(db: DatabaseSync, id: string): string | null {
  const row = db.prepare('SELECT mintId FROM reservations WHERE id = ?').get(id) as
    | {mintId: string | null}
    | undefined
  return row?.mintId ?? null
}

function columns(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{name: string}>
  return rows.map(r => r.name)
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(CREATE_ONCHAIN_V31)
  db.exec(CREATE_RESERVATIONS_V26)
  return db
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SQLite migration 33 — reference the mint by id', () => {
  describe('shape', () => {
    test('adds mintId to both tables', () => {
      const db = freshDb()
      expect(columns(db, 'onchain_mint_quotes')).not.toContain('mintId')
      expect(columns(db, 'reservations')).not.toContain('mintId')

      runMigration33(db)

      expect(columns(db, 'onchain_mint_quotes')).toContain('mintId')
      expect(columns(db, 'reservations')).toContain('mintId')
      db.close()
    })

    test('keeps mintUrl — it stays as the historical record', () => {
      const db = freshDb()
      runMigration33(db)
      expect(columns(db, 'onchain_mint_quotes')).toContain('mintUrl')
      expect(columns(db, 'reservations')).toContain('mintUrl')
      db.close()
    })

    test('preserves existing rows, with mintId NULL until backfilled', () => {
      const db = freshDb()
      insertQuote(db, 'q1', MINT_A.mintUrl)

      runMigration33(db)

      const row = db.prepare('SELECT * FROM onchain_mint_quotes WHERE quote = ?').get('q1') as any
      expect(row.mintId).toBeNull()
      // The load-bearing column: without counterIndex the NUT-20 key cannot be
      // re-derived and a deposit is unmintable.
      expect(row.counterIndex).toBe(7)
      expect(row.address).toBe('bc1qaddr')
      expect(row.mintUrl).toBe(MINT_A.mintUrl)
      db.close()
    })

    // The reason v26/v31 freeze their column lists instead of reading schema.ts.
    // If a replayed old migration created today's shape, this ALTER would throw
    // "duplicate column name" and the upgrade would fail outright.
    test('re-running the ALTER on an already-migrated table throws', () => {
      const db = freshDb()
      runMigration33(db)
      expect(() => db.exec(`ALTER TABLE onchain_mint_quotes ADD COLUMN mintId TEXT`)).toThrow()
      db.close()
    })
  })

  describe('backfill', () => {
    test('resolves each row to its mint id', () => {
      const db = freshDb()
      insertQuote(db, 'q1', MINT_A.mintUrl)
      insertQuote(db, 'q2', MINT_B.mintUrl)
      insertReservation(db, 'r1', MINT_A.mintUrl)
      runMigration33(db)

      expect(backfillOnchainMintQuoteMintIds(db, [MINT_A, MINT_B])).toBe(2)
      expect(backfillReservationMintIds(db, [MINT_A, MINT_B])).toBe(1)

      expect(quoteMintId(db, 'q1')).toBe(MINT_A.id)
      expect(quoteMintId(db, 'q2')).toBe(MINT_B.id)
      expect(reservationMintId(db, 'r1')).toBe(MINT_A.id)
      db.close()
    })

    test('is idempotent — a second run updates nothing', () => {
      const db = freshDb()
      insertQuote(db, 'q1', MINT_A.mintUrl)
      runMigration33(db)

      expect(backfillOnchainMintQuoteMintIds(db, [MINT_A])).toBe(1)
      expect(backfillOnchainMintQuoteMintIds(db, [MINT_A])).toBe(0)
      expect(quoteMintId(db, 'q1')).toBe(MINT_A.id)
      db.close()
    })

    // The IS NULL guard: once a row is resolved, a later url match must never
    // re-point it. After a rename the row's mintUrl is stale by design, so a
    // re-run must not "correct" it toward whichever mint now answers that url.
    test('never overwrites an id already resolved', () => {
      const db = freshDb()
      insertQuote(db, 'q1', MINT_A.mintUrl)
      runMigration33(db)
      backfillOnchainMintQuoteMintIds(db, [MINT_A])

      // A different mint has since taken over that url.
      const impostor = {id: 'cccc3333', mintUrl: MINT_A.mintUrl}
      expect(backfillOnchainMintQuoteMintIds(db, [impostor])).toBe(0)
      expect(quoteMintId(db, 'q1')).toBe(MINT_A.id)
      db.close()
    })

    test('leaves a row whose mint is gone from the wallet NULL', () => {
      const db = freshDb()
      insertQuote(db, 'orphan', 'https://removed.mint.test')
      runMigration33(db)

      expect(backfillOnchainMintQuoteMintIds(db, [MINT_A, MINT_B])).toBe(0)
      // Null means "no mint to talk to" — the quote is dead either way, and the
      // resolver throws rather than guessing from the stale url.
      expect(quoteMintId(db, 'orphan')).toBeNull()
      db.close()
    })

    test('is a no-op with no mints', () => {
      const db = freshDb()
      insertQuote(db, 'q1', MINT_A.mintUrl)
      runMigration33(db)
      expect(backfillOnchainMintQuoteMintIds(db, [])).toBe(0)
      expect(quoteMintId(db, 'q1')).toBeNull()
      db.close()
    })
  })

  describe('the point of the whole change', () => {
    test('a quote still resolves after its mint moves url', () => {
      const db = freshDb()
      insertQuote(db, 'q1', MINT_A.mintUrl)
      runMigration33(db)
      backfillOnchainMintQuoteMintIds(db, [MINT_A])

      // The mint moves. Nothing rewrites the quote row — that is the design.
      const movedMint = {id: MINT_A.id, mintUrl: 'https://moved.mint.test'}

      // Resolution is by id, so it still finds the mint and gets its LIVE url.
      expect(quoteMintId(db, 'q1')).toBe(movedMint.id)

      // Whereas the old url-keyed lookup now finds nothing — this is precisely the
      // query that stranded deposits permanently.
      const byOldUrl = db
        .prepare('SELECT quote FROM onchain_mint_quotes WHERE mintUrl = ?')
        .all(movedMint.mintUrl)
      expect(byOldUrl).toHaveLength(0)

      const byId = db.prepare('SELECT quote FROM onchain_mint_quotes WHERE mintId = ?').all(movedMint.id)
      expect(byId).toHaveLength(1)
      db.close()
    })
  })
})
