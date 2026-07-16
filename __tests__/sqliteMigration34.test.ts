/**
 * Repeatable migration tests for SQLite migration 34.
 *
 * Migration 34 finishes the mint-identity work:
 *
 *  1. `transactions.mintId` — splitting the two jobs `transactions.mint` was doing
 *     at once, switched by status: a historical record of where a finished payment
 *     happened, AND a live pointer the wallet dialled for an open one. That is why
 *     a mint-url edit used to rewrite in-flight rows — rewriting the very column
 *     that records the past. With mintId carrying identity, `mint` is frozen.
 *
 *  2. inflight_requests / melt_recovery rebuilt WITHOUT mintUrl and keysetId. Both
 *     are CHILD rows of a transaction (their primary key IS transactionId), so the
 *     parent already owns "which mint"; their copies had no readers at all. The one
 *     mint-scoped query joins through the parent instead.
 *
 * Uses Node.js built-in node:sqlite (requires Node 22.5+).
 * @jest-environment node
 */
import {DatabaseSync} from 'node:sqlite'

// ── Pre-34 shapes (as v28/v29 create them; frozen in migrations.ts) ──────────

const CREATE_TRANSACTIONS_PRE34 = `CREATE TABLE transactions (
  id INTEGER PRIMARY KEY NOT NULL,
  type TEXT,
  amount INTEGER,
  unit TEXT,
  data TEXT,
  mint TEXT,
  status TEXT,
  createdAt TEXT
)`

const CREATE_INFLIGHT_V29 = `CREATE TABLE inflight_requests (
  transactionId INTEGER PRIMARY KEY NOT NULL,
  mintUrl TEXT,
  keysetId TEXT,
  request TEXT NOT NULL,
  createdAt TEXT
)`

const CREATE_MELT_RECOVERY_V28 = `CREATE TABLE melt_recovery (
  transactionId INTEGER PRIMARY KEY NOT NULL,
  mintUrl TEXT,
  keysetId TEXT,
  meltPreview TEXT NOT NULL,
  createdAt TEXT
)`

// ── SQL copied verbatim from migrations.ts migration 34 ─────────────────────

const MIGRATION_34 = [
  `ALTER TABLE transactions ADD COLUMN mintId TEXT`,

  `CREATE TABLE inflight_requests_v34 (
  transactionId INTEGER PRIMARY KEY NOT NULL,
  request TEXT NOT NULL,
  createdAt TEXT
)`,
  `INSERT INTO inflight_requests_v34 (transactionId, request, createdAt)
   SELECT transactionId, request, createdAt FROM inflight_requests`,
  `DROP TABLE inflight_requests`,
  `ALTER TABLE inflight_requests_v34 RENAME TO inflight_requests`,

  `CREATE TABLE melt_recovery_v34 (
  transactionId INTEGER PRIMARY KEY NOT NULL,
  meltPreview TEXT NOT NULL,
  createdAt TEXT
)`,
  `INSERT INTO melt_recovery_v34 (transactionId, meltPreview, createdAt)
   SELECT transactionId, meltPreview, createdAt FROM melt_recovery`,
  `DROP TABLE melt_recovery`,
  `ALTER TABLE melt_recovery_v34 RENAME TO melt_recovery`,
]

/** Mirrors transactionsRepo.backfillTransactionMintIds (the v38 seed). */
function backfillTransactionMintIds(
  db: DatabaseSync,
  mints: Array<{id: string; mintUrl: string}>,
): number {
  let updated = 0
  for (const mint of mints) {
    const {changes} = db
      .prepare(`UPDATE transactions SET mintId = ? WHERE mint = ? AND mintId IS NULL`)
      .run(mint.id, mint.mintUrl)
    updated += Number(changes)
  }
  return updated
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MINT_A = {id: 'aaaa1111', mintUrl: 'https://a.mint.test'}
const MINT_B = {id: 'bbbb2222', mintUrl: 'https://b.mint.test'}

function runMigration34(db: DatabaseSync) {
  db.exec('BEGIN')
  try {
    for (const sql of MIGRATION_34) db.exec(sql)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

function insertTx(db: DatabaseSync, id: number, mint: string, status = 'COMPLETED') {
  db.prepare(
    `INSERT INTO transactions (id, type, amount, unit, data, mint, status, createdAt)
     VALUES (?, 'TOPUP', 100, 'sat', '{}', ?, ?, '2026-01-01')`,
  ).run(id, mint, status)
}

function columns(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{name: string}>
  return rows.map(r => r.name)
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(CREATE_TRANSACTIONS_PRE34)
  db.exec(CREATE_INFLIGHT_V29)
  db.exec(CREATE_MELT_RECOVERY_V28)
  return db
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SQLite migration 34 — transactions.mintId, and child tables normalized', () => {
  describe('transactions.mintId', () => {
    test('adds mintId while keeping mint', () => {
      const db = freshDb()
      runMigration34(db)
      expect(columns(db, 'transactions')).toContain('mintId')
      // `mint` stays: it is where the payment happened, and history needs it.
      expect(columns(db, 'transactions')).toContain('mint')
      db.close()
    })

    test('backfills mintId from the url, leaving mint untouched', () => {
      const db = freshDb()
      insertTx(db, 1, MINT_A.mintUrl)
      insertTx(db, 2, MINT_B.mintUrl)
      runMigration34(db)

      expect(backfillTransactionMintIds(db, [MINT_A, MINT_B])).toBe(2)

      const rows = db.prepare('SELECT id, mint, mintId FROM transactions ORDER BY id').all() as any[]
      expect(rows[0]).toMatchObject({mint: MINT_A.mintUrl, mintId: MINT_A.id})
      expect(rows[1]).toMatchObject({mint: MINT_B.mintUrl, mintId: MINT_B.id})
      db.close()
    })

    test('leaves history of a removed mint with a null mintId', () => {
      const db = freshDb()
      insertTx(db, 1, 'https://removed.mint.test')
      runMigration34(db)

      expect(backfillTransactionMintIds(db, [MINT_A])).toBe(0)
      const row = db.prepare('SELECT mint, mintId FROM transactions WHERE id = 1').get() as any
      // Legitimate history: no mint to act on, but the url still records where it
      // happened.
      expect(row.mintId).toBeNull()
      expect(row.mint).toBe('https://removed.mint.test')
      db.close()
    })

    test('backfill is idempotent and never re-points a resolved row', () => {
      const db = freshDb()
      insertTx(db, 1, MINT_A.mintUrl)
      runMigration34(db)
      backfillTransactionMintIds(db, [MINT_A])

      // A different mint has since taken over that url.
      const impostor = {id: 'cccc3333', mintUrl: MINT_A.mintUrl}
      expect(backfillTransactionMintIds(db, [impostor])).toBe(0)

      const row = db.prepare('SELECT mintId FROM transactions WHERE id = 1').get() as any
      expect(row.mintId).toBe(MINT_A.id)
      db.close()
    })

    test('backfills in-flight and terminal rows alike', () => {
      const db = freshDb()
      insertTx(db, 1, MINT_A.mintUrl, 'PENDING')
      insertTx(db, 2, MINT_A.mintUrl, 'COMPLETED')
      runMigration34(db)

      // Unlike the rewrite this replaces, the backfill is status-blind: mintId is
      // identity, which a finished transaction has just as much as an open one.
      expect(backfillTransactionMintIds(db, [MINT_A])).toBe(2)
      db.close()
    })
  })

  describe('child tables lose their duplicated mint reference', () => {
    test('inflight_requests keeps only transactionId, request, createdAt', () => {
      const db = freshDb()
      runMigration34(db)
      expect(columns(db, 'inflight_requests').sort()).toEqual(['createdAt', 'request', 'transactionId'])
      db.close()
    })

    test('melt_recovery keeps only transactionId, meltPreview, createdAt', () => {
      const db = freshDb()
      runMigration34(db)
      expect(columns(db, 'melt_recovery').sort()).toEqual(['createdAt', 'meltPreview', 'transactionId'])
      db.close()
    })

    test('carries the surviving data across the rebuild', () => {
      const db = freshDb()
      db.prepare(
        `INSERT INTO inflight_requests (transactionId, mintUrl, keysetId, request, createdAt)
         VALUES (1, 'https://a.mint.test', 'k1', '{"v":1}', '2026-01-01')`,
      ).run()
      db.prepare(
        `INSERT INTO melt_recovery (transactionId, mintUrl, keysetId, meltPreview, createdAt)
         VALUES (2, 'https://a.mint.test', 'k1', '{"keysetId":"k1"}', '2026-01-02')`,
      ).run()

      runMigration34(db)

      const ifr = db.prepare('SELECT * FROM inflight_requests WHERE transactionId = 1').get() as any
      expect(ifr.request).toBe('{"v":1}')
      expect(ifr.createdAt).toBe('2026-01-01')

      const melt = db.prepare('SELECT * FROM melt_recovery WHERE transactionId = 2').get() as any
      // The keyset was never lost — it lives inside the preview, which is why the
      // column duplicating it had no readers.
      expect(JSON.parse(melt.meltPreview).keysetId).toBe('k1')
      expect(melt.createdAt).toBe('2026-01-02')
      db.close()
    })

    test('an empty child table rebuilds cleanly', () => {
      const db = freshDb()
      runMigration34(db)
      expect(db.prepare('SELECT * FROM inflight_requests').all()).toEqual([])
      expect(db.prepare('SELECT * FROM melt_recovery').all()).toEqual([])
      db.close()
    })
  })

  describe('the mint-scoped sweep, after the change', () => {
    test('finds a mint\'s in-flight requests through the parent transaction', () => {
      const db = freshDb()
      insertTx(db, 1, MINT_A.mintUrl, 'PENDING')
      insertTx(db, 2, MINT_B.mintUrl, 'PENDING')
      db.prepare(
        `INSERT INTO inflight_requests (transactionId, mintUrl, keysetId, request, createdAt)
         VALUES (1, 'https://a.mint.test', 'k1', '{"v":1}', '2026-01-01'),
                (2, 'https://b.mint.test', 'k2', '{"v":2}', '2026-01-01')`,
      ).run()

      runMigration34(db)
      backfillTransactionMintIds(db, [MINT_A, MINT_B])

      const rows = db
        .prepare(
          `SELECT r.transactionId FROM inflight_requests r
           JOIN transactions t ON t.id = r.transactionId
           WHERE t.mintId = ?`,
        )
        .all(MINT_A.id) as any[]

      expect(rows).toHaveLength(1)
      expect(rows[0].transactionId).toBe(1)
      db.close()
    })
  })
})
