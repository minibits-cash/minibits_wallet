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
  mintUrl TEXT,
  keysetId TEXT,
  request TEXT NOT NULL,
  createdAt TEXT
)`

const MINT = 'https://mint.test'

// ── Mirrored repo primitives (exact production SQL) ─────────────────────────

function addInFlightRequest(
    db: DatabaseSync,
    transactionId: number,
    mintUrl: string | null,
    keysetId: string | null,
    request: object,
) {
    db.prepare(
        `INSERT OR REPLACE INTO inflight_requests (transactionId, mintUrl, keysetId, request, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
    ).run(transactionId, mintUrl, keysetId, JSON.stringify(request), NOW)
}

function getInFlightRequest(db: DatabaseSync, transactionId: number) {
    const row = db
        .prepare(`SELECT transactionId, mintUrl, keysetId, request, createdAt FROM inflight_requests WHERE transactionId = ?`)
        .get(transactionId) as {transactionId: number; mintUrl: string | null; keysetId: string | null; request: string; createdAt: string | null} | undefined
    if (!row) return undefined
    return {...row, request: JSON.parse(row.request)}
}

function getInFlightRequestsByMint(db: DatabaseSync, mintUrl: string) {
    const rows = db
        .prepare(`SELECT transactionId, mintUrl, keysetId, request, createdAt FROM inflight_requests WHERE mintUrl = ?`)
        .all(mintUrl) as Array<{transactionId: number; mintUrl: string | null; keysetId: string | null; request: string; createdAt: string | null}>
    return rows.map(r => ({...r, request: JSON.parse(r.request)}))
}

function removeInFlightRequest(db: DatabaseSync, transactionId: number) {
    db.prepare(`DELETE FROM inflight_requests WHERE transactionId = ?`).run(transactionId)
}

function seedInFlightRequest(
    db: DatabaseSync,
    transactionId: number,
    mintUrl: string | null,
    keysetId: string | null,
    request: object,
) {
    db.prepare(
        `INSERT INTO inflight_requests (transactionId, mintUrl, keysetId, request, createdAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(transactionId) DO NOTHING`,
    ).run(transactionId, mintUrl, keysetId, JSON.stringify(request), NOW)
}

function freshDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:')
    db.exec(CREATE_INFLIGHT)
    return db
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('In-flight requests (inflight_requests)', () => {
    test('stores and reads back a request (JSON round-trip)', () => {
        const db = freshDb()
        const request = {token: 'cashuA...', options: {keysetId: 'k1'}}

        addInFlightRequest(db, 101, MINT, 'k1', request)
        const rec = getInFlightRequest(db, 101)!

        expect(rec.transactionId).toBe(101)
        expect(rec.mintUrl).toBe(MINT)
        expect(rec.keysetId).toBe('k1')
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
        addInFlightRequest(db, 101, MINT, 'k1', {v: 'first'})
        addInFlightRequest(db, 101, MINT, 'k1', {v: 'second'})

        expect(getInFlightRequest(db, 101)!.request).toEqual({v: 'second'})
        db.close()
    })

    test('getInFlightRequestsByMint returns all rows for a mint', () => {
        const db = freshDb()
        addInFlightRequest(db, 101, MINT, 'k1', {v: 1})
        addInFlightRequest(db, 102, MINT, 'k1', {v: 2})
        addInFlightRequest(db, 103, 'https://other.test', 'k9', {v: 3})

        const forMint = getInFlightRequestsByMint(db, MINT)
        expect(forMint.map(r => r.transactionId).sort()).toEqual([101, 102])
        expect(getInFlightRequestsByMint(db, 'https://other.test')).toHaveLength(1)
        db.close()
    })

    test('remove deletes the entry', () => {
        const db = freshDb()
        addInFlightRequest(db, 101, MINT, 'k1', {v: 1})
        removeInFlightRequest(db, 101)
        expect(getInFlightRequest(db, 101)).toBeUndefined()
        expect(getInFlightRequestsByMint(db, MINT)).toHaveLength(0)
        db.close()
    })

    test('seed is idempotent — does not overwrite an existing entry', () => {
        const db = freshDb()
        addInFlightRequest(db, 101, MINT, 'k1', {v: 'live'})
        seedInFlightRequest(db, 101, MINT, 'k1', {v: 'snapshot'})
        expect(getInFlightRequest(db, 101)!.request).toEqual({v: 'live'})
        db.close()
    })
})
