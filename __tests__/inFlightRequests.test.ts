/**
 * In-flight request tests (inFlightRequests → SQLite migration).
 *
 * Per-transaction request params stored so an op whose mint response was lost
 * can be retried against the mint's idempotent endpoint. add() overwrites
 * (set semantics), the per-mint query drives the recovery sweep, the row is
 * deleted on success/terminal failure, and the upgrade seed is idempotent.
 *
 * Mirrors the production SQL against node:sqlite (the native driver needs a
 * device), like meltRecovery.test.ts.
 *
 * @jest-environment node
 */
import {DatabaseSync} from 'node:sqlite'

const NOW = '2026-06-05T00:00:00.000Z'

const CREATE_INFLIGHT = `CREATE TABLE inflight_requests (
  transactionId INTEGER PRIMARY KEY NOT NULL,
  request TEXT NOT NULL,
  createdAt TEXT
)`

/**
 * The parent. inflight_requests is a CHILD of a transaction (its primary key IS
 * transactionId) and holds no mint reference of its own — the mint-scoped query
 * joins through here, so the fixture needs it.
 */
const CREATE_TRANSACTIONS = `CREATE TABLE transactions (
  id INTEGER PRIMARY KEY NOT NULL,
  mintId TEXT,
  mint TEXT,
  status TEXT
)`

const MINT = 'https://mint.test'
const MINT_ID = 'mint1111'
const OTHER_MINT_ID = 'mint9999'

// ── Mirrored repo primitives (exact production SQL) ─────────────────────────

function addTransaction(db: DatabaseSync, id: number, mintId: string | null) {
    db.prepare(`INSERT OR REPLACE INTO transactions (id, mintId, mint, status) VALUES (?, ?, ?, 'PENDING')`)
        .run(id, mintId, MINT)
}

function addInFlightRequest(db: DatabaseSync, transactionId: number, request: object) {
    db.prepare(
        `INSERT OR REPLACE INTO inflight_requests (transactionId, request, createdAt)
         VALUES (?, ?, ?)`,
    ).run(transactionId, JSON.stringify(request), NOW)
}

function getInFlightRequest(db: DatabaseSync, transactionId: number) {
    const row = db
        .prepare(`SELECT transactionId, request, createdAt FROM inflight_requests WHERE transactionId = ?`)
        .get(transactionId) as {transactionId: number; request: string; createdAt: string | null} | undefined
    if (!row) return undefined
    return {...row, request: JSON.parse(row.request)}
}

/**
 * The mint-scoped sweep. Joins through the owning transaction: this table keeps no
 * mint reference of its own, so `transactions.mintId` is the single owner of that
 * fact — and being an id, it survives the mint changing url.
 */
function getInFlightRequestsByMintId(db: DatabaseSync, mintId: string) {
    const rows = db
        .prepare(
            `SELECT r.transactionId, r.request, r.createdAt
             FROM inflight_requests r
             JOIN transactions t ON t.id = r.transactionId
             WHERE t.mintId = ?`,
        )
        .all(mintId) as Array<{transactionId: number; request: string; createdAt: string | null}>
    return rows.map(r => ({...r, request: JSON.parse(r.request)}))
}

function removeInFlightRequest(db: DatabaseSync, transactionId: number) {
    db.prepare(`DELETE FROM inflight_requests WHERE transactionId = ?`).run(transactionId)
}

function seedInFlightRequest(db: DatabaseSync, transactionId: number, request: object) {
    db.prepare(
        `INSERT INTO inflight_requests (transactionId, request, createdAt)
         VALUES (?, ?, ?)
         ON CONFLICT(transactionId) DO NOTHING`,
    ).run(transactionId, JSON.stringify(request), NOW)
}

function freshDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:')
    db.exec(CREATE_INFLIGHT)
    db.exec(CREATE_TRANSACTIONS)
    return db
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('In-flight requests (inflight_requests)', () => {
    test('stores and reads back a request (JSON round-trip)', () => {
        const db = freshDb()
        const request = {token: 'cashuA...', options: {keysetId: 'k1'}}

        addTransaction(db, 101, MINT_ID)
        addInFlightRequest(db, 101, request)
        const rec = getInFlightRequest(db, 101)!

        expect(rec.transactionId).toBe(101)
        expect(rec.request).toEqual(request)
        db.close()
    })

    test('returns undefined when no entry exists', () => {
        const db = freshDb()
        expect(getInFlightRequest(db, 999)).toBeUndefined()
        db.close()
    })

    test('add OVERWRITES an existing entry (set semantics)', () => {
        const db = freshDb()
        addTransaction(db, 101, MINT_ID)
        addInFlightRequest(db, 101, {v: 'first'})
        addInFlightRequest(db, 101, {v: 'second'})

        expect(getInFlightRequest(db, 101)!.request).toEqual({v: 'second'})
        db.close()
    })

    test('getInFlightRequestsByMintId returns all rows of a mint', () => {
        const db = freshDb()
        addTransaction(db, 101, MINT_ID)
        addTransaction(db, 102, MINT_ID)
        addTransaction(db, 103, OTHER_MINT_ID)
        addInFlightRequest(db, 101, {v: 1})
        addInFlightRequest(db, 102, {v: 2})
        addInFlightRequest(db, 103, {v: 3})

        const forMint = getInFlightRequestsByMintId(db, MINT_ID)
        expect(forMint.map(r => r.transactionId).sort()).toEqual([101, 102])
        expect(getInFlightRequestsByMintId(db, OTHER_MINT_ID)).toHaveLength(1)
        db.close()
    })

    // The point of joining on mintId rather than a url copy: the mint moving must
    // not hide its own in-flight work.
    test('still finds a mint\'s requests after its url changes', () => {
        const db = freshDb()
        addTransaction(db, 101, MINT_ID)
        addInFlightRequest(db, 101, {v: 1})

        // transactions.mint is frozen history and never rewritten; only the mint's
        // live url moves. The id is unaffected, so the join is too.
        expect(getInFlightRequestsByMintId(db, MINT_ID)).toHaveLength(1)
        db.close()
    })

    // Correct, not a regression: the retry settles proofs onto its transaction and
    // the handler branches on tx.type, so without the parent there is nothing to
    // apply the result to.
    test('a request whose transaction is gone is not returned', () => {
        const db = freshDb()
        addTransaction(db, 101, MINT_ID)
        addInFlightRequest(db, 101, {v: 1})
        db.prepare('DELETE FROM transactions WHERE id = ?').run(101)

        expect(getInFlightRequestsByMintId(db, MINT_ID)).toHaveLength(0)
        db.close()
    })

    test('a transaction with no mintId is not returned', () => {
        const db = freshDb()
        addTransaction(db, 101, null)
        addInFlightRequest(db, 101, {v: 1})

        expect(getInFlightRequestsByMintId(db, MINT_ID)).toHaveLength(0)
        db.close()
    })

    test('remove deletes the entry', () => {
        const db = freshDb()
        addTransaction(db, 101, MINT_ID)
        addInFlightRequest(db, 101, {v: 1})
        removeInFlightRequest(db, 101)
        expect(getInFlightRequest(db, 101)).toBeUndefined()
        expect(getInFlightRequestsByMintId(db, MINT_ID)).toHaveLength(0)
        db.close()
    })

    test('seed is idempotent — does not overwrite an existing entry', () => {
        const db = freshDb()
        addTransaction(db, 101, MINT_ID)
        addInFlightRequest(db, 101, {v: 'live'})
        seedInFlightRequest(db, 101, {v: 'snapshot'})
        expect(getInFlightRequest(db, 101)!.request).toEqual({v: 'live'})
        db.close()
    })
})
