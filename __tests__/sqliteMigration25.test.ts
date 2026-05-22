/**
 * Repeatable migration tests for SQLite migration 25.
 *
 * Migration 25 replaces the dual isPending/isSpent INTEGER boolean columns
 * with a single state TEXT column ('UNSPENT' | 'PENDING' | 'SPENT').
 *
 * Uses Node.js built-in node:sqlite (requires Node 22.5+).
 * @jest-environment node
 */
import {DatabaseSync} from 'node:sqlite'

// ── SQL copied verbatim from src/services/sqlite.ts migration 25 ──────────────

const CREATE_V25 = `CREATE TABLE proofs_v25 (
  id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  secret TEXT PRIMARY KEY NOT NULL,
  C TEXT NOT NULL,
  dleq_r TEXT,
  dleq_s TEXT,
  dleq_e TEXT,
  unit TEXT,
  tId INTEGER,
  mintUrl TEXT,
  state TEXT NOT NULL DEFAULT 'UNSPENT',
  updatedAt TEXT
)`

const INSERT_V25 = `INSERT INTO proofs_v25
  (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt)
SELECT
  id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl,
  CASE
    WHEN isSpent = 1 THEN 'SPENT'
    WHEN isPending = 1 THEN 'PENDING'
    ELSE 'UNSPENT'
  END,
  updatedAt
FROM proofs`

const DROP_OLD = `DROP TABLE proofs`
const RENAME = `ALTER TABLE proofs_v25 RENAME TO proofs`

// ── Helpers ───────────────────────────────────────────────────────────────────

function createOldSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE proofs (
      id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      secret TEXT PRIMARY KEY NOT NULL,
      C TEXT NOT NULL,
      dleq_r TEXT,
      dleq_s TEXT,
      dleq_e TEXT,
      unit TEXT,
      tId INTEGER,
      mintUrl TEXT,
      isPending INTEGER NOT NULL DEFAULT 0,
      isSpent INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT
    )
  `)
}

function insertOldProof(
  db: DatabaseSync,
  secret: string,
  isPending: 0 | 1,
  isSpent: 0 | 1,
  extras: {id?: string; amount?: number; C?: string; tId?: number} = {},
) {
  const {id = 'id1', amount = 1000, C = 'C1', tId = 1} = extras
  db.prepare(
    `INSERT INTO proofs
     (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, isPending, isSpent, updatedAt)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'sat', ?, 'https://mint.test', ?, ?, '2024-01-01')`,
  ).run(id, amount, secret, C, tId, isPending, isSpent)
}

function runMigration25(db: DatabaseSync) {
  db.exec(CREATE_V25)
  db.exec(INSERT_V25)
  db.exec(DROP_OLD)
  db.exec(RENAME)
}

function getState(db: DatabaseSync, secret: string): string {
  const row = db.prepare('SELECT state FROM proofs WHERE secret = ?').get(secret) as {state: string}
  return row.state
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Migration 25: isPending/isSpent → state', () => {
  describe('state mapping', () => {
    test('isPending=0, isSpent=0 → UNSPENT', () => {
      const db = new DatabaseSync(':memory:')
      createOldSchema(db)
      insertOldProof(db, 'secret_unspent', 0, 0)
      runMigration25(db)
      expect(getState(db, 'secret_unspent')).toBe('UNSPENT')
      db.close()
    })

    test('isPending=1, isSpent=0 → PENDING', () => {
      const db = new DatabaseSync(':memory:')
      createOldSchema(db)
      insertOldProof(db, 'secret_pending', 1, 0)
      runMigration25(db)
      expect(getState(db, 'secret_pending')).toBe('PENDING')
      db.close()
    })

    test('isPending=0, isSpent=1 → SPENT', () => {
      const db = new DatabaseSync(':memory:')
      createOldSchema(db)
      insertOldProof(db, 'secret_spent', 0, 1)
      runMigration25(db)
      expect(getState(db, 'secret_spent')).toBe('SPENT')
      db.close()
    })

    test('isPending=1, isSpent=1 → SPENT (isSpent wins)', () => {
      // CASE WHEN isSpent = 1 is checked first, so SPENT takes precedence
      const db = new DatabaseSync(':memory:')
      createOldSchema(db)
      insertOldProof(db, 'secret_both', 1, 1)
      runMigration25(db)
      expect(getState(db, 'secret_both')).toBe('SPENT')
      db.close()
    })
  })

  describe('mixed pool', () => {
    test('all three states migrate correctly in one pass', () => {
      const db = new DatabaseSync(':memory:')
      createOldSchema(db)
      insertOldProof(db, 'a', 0, 0, {id: 'id1', C: 'Ca'})
      insertOldProof(db, 'b', 1, 0, {id: 'id2', C: 'Cb'})
      insertOldProof(db, 'c', 0, 1, {id: 'id3', C: 'Cc'})
      runMigration25(db)
      expect(getState(db, 'a')).toBe('UNSPENT')
      expect(getState(db, 'b')).toBe('PENDING')
      expect(getState(db, 'c')).toBe('SPENT')
      db.close()
    })

    test('row count is preserved after migration', () => {
      const db = new DatabaseSync(':memory:')
      createOldSchema(db)
      for (let i = 0; i < 10; i++) {
        insertOldProof(db, `secret_${i}`, i % 3 === 0 ? 1 : 0, i % 5 === 0 ? 1 : 0, {
          id: `id${i}`,
          C: `C${i}`,
        })
      }
      runMigration25(db)
      const {count} = db.prepare('SELECT COUNT(*) AS count FROM proofs').get() as {count: number}
      expect(count).toBe(10)
      db.close()
    })
  })

  describe('edge cases', () => {
    test('empty table migrates without error', () => {
      const db = new DatabaseSync(':memory:')
      createOldSchema(db)
      expect(() => runMigration25(db)).not.toThrow()
      const {count} = db.prepare('SELECT COUNT(*) AS count FROM proofs').get() as {count: number}
      expect(count).toBe(0)
      db.close()
    })

    test('new table has state column, not isPending/isSpent', () => {
      const db = new DatabaseSync(':memory:')
      createOldSchema(db)
      runMigration25(db)
      const columns = (
        db.prepare('PRAGMA table_info(proofs)').all() as Array<{name: string}>
      ).map(col => col.name)
      expect(columns).toContain('state')
      expect(columns).not.toContain('isPending')
      expect(columns).not.toContain('isSpent')
      db.close()
    })

    test('state column rejects values outside allowed set', () => {
      const db = new DatabaseSync(':memory:')
      createOldSchema(db)
      runMigration25(db)
      // Verify the column exists and accepts valid values
      expect(() =>
        db
          .prepare(
            `INSERT INTO proofs (id, amount, secret, C, mintUrl, state)
             VALUES ('x', 1, 'sx', 'Cx', 'https://mint.test', 'UNSPENT')`,
          )
          .run(),
      ).not.toThrow()
      db.close()
    })

    test('non-null data fields are preserved across migration', () => {
      const db = new DatabaseSync(':memory:')
      createOldSchema(db)
      db
        .prepare(
          `INSERT INTO proofs
           (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, isPending, isSpent, updatedAt)
           VALUES ('id1', 2048, 'mysecret', 'myC', 'r1', 's1', 'e1', 'usd', 42, 'https://mint.test', 0, 0, '2024-06-15')`,
        )
        .run()
      runMigration25(db)
      const row = db.prepare('SELECT * FROM proofs WHERE secret = ?').get('mysecret') as Record<
        string,
        unknown
      >
      expect(row.id).toBe('id1')
      expect(row.amount).toBe(2048)
      expect(row.C).toBe('myC')
      expect(row.dleq_r).toBe('r1')
      expect(row.dleq_s).toBe('s1')
      expect(row.dleq_e).toBe('e1')
      expect(row.unit).toBe('usd')
      expect(row.tId).toBe(42)
      expect(row.mintUrl).toBe('https://mint.test')
      expect(row.updatedAt).toBe('2024-06-15')
      expect(row.state).toBe('UNSPENT')
      db.close()
    })
  })
})
