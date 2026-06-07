/**
 * Melt recovery tests (meltCounterValues → SQLite migration).
 *
 * Verifies the SQL-level semantics of meltRecoveryRepo: a per-transaction
 * serialized meltPreview is stored before a melt is submitted so a paid-but-
 * unconfirmed melt can be recovered and its change unblinded. The first stored
 * preview for a transaction wins (idempotent), and the row is removed on
 * terminal success/failure.
 *
 * Mirrors the production SQL against node:sqlite, like proofReservation.test.ts
 * and counters.test.ts (the native driver needs a device).
 *
 * @jest-environment node
 */
import {DatabaseSync} from 'node:sqlite'

const NOW = '2026-06-05T00:00:00.000Z'

const CREATE_MELT_RECOVERY = `CREATE TABLE melt_recovery (
  transactionId INTEGER PRIMARY KEY NOT NULL,
  mintUrl TEXT,
  keysetId TEXT,
  meltPreview TEXT NOT NULL,
  createdAt TEXT
)`

const MINT = 'https://mint.test'

// A representative StoredMeltPreview (shape from cashuUtils).
const previewFor = (keysetId: string, secret = 'aa') => ({
    keysetId,
    outputData: [
        {
            blindedMessage: {amount: '2', id: keysetId, B_: 'B_' + secret},
            blindingFactor: 'deadbeef',
            secret,
        },
    ],
})

// ── Mirrored repo primitives (exact production SQL) ─────────────────────────

function addMeltRecovery(
    db: DatabaseSync,
    transactionId: number,
    mintUrl: string | null,
    keysetId: string | null,
    meltPreview: object,
) {
    db.prepare(
        `INSERT INTO melt_recovery (transactionId, mintUrl, keysetId, meltPreview, createdAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(transactionId) DO NOTHING`,
    ).run(transactionId, mintUrl, keysetId, JSON.stringify(meltPreview), NOW)
}

function getMeltRecovery(db: DatabaseSync, transactionId: number) {
    const row = db
        .prepare(`SELECT transactionId, mintUrl, keysetId, meltPreview, createdAt FROM melt_recovery WHERE transactionId = ?`)
        .get(transactionId) as
        | {transactionId: number; mintUrl: string | null; keysetId: string | null; meltPreview: string; createdAt: string | null}
        | undefined
    if (!row) return undefined
    return {...row, meltPreview: JSON.parse(row.meltPreview)}
}

function removeMeltRecovery(db: DatabaseSync, transactionId: number) {
    db.prepare(`DELETE FROM melt_recovery WHERE transactionId = ?`).run(transactionId)
}

function rowCount(db: DatabaseSync): number {
    const {n} = db.prepare('SELECT COUNT(*) AS n FROM melt_recovery').get() as {n: number}
    return n
}

function freshDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:')
    db.exec(CREATE_MELT_RECOVERY)
    return db
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Melt recovery (melt_recovery)', () => {
    test('stores and reads back a meltPreview (JSON round-trip)', () => {
        const db = freshDb()
        const preview = previewFor('k1')

        addMeltRecovery(db, 101, MINT, 'k1', preview)
        const rec = getMeltRecovery(db, 101)!

        expect(rec.transactionId).toBe(101)
        expect(rec.mintUrl).toBe(MINT)
        expect(rec.keysetId).toBe('k1')
        expect(rec.meltPreview).toEqual(preview)
        db.close()
    })

    test('returns undefined when no entry exists', () => {
        const db = freshDb()
        expect(getMeltRecovery(db, 999)).toBeUndefined()
        db.close()
    })

    test('the FIRST stored preview wins (ON CONFLICT DO NOTHING)', () => {
        const db = freshDb()
        addMeltRecovery(db, 101, MINT, 'k1', previewFor('k1', 'first'))
        // A second attempt for the same tx must not overwrite.
        addMeltRecovery(db, 101, MINT, 'k1', previewFor('k1', 'second'))

        const rec = getMeltRecovery(db, 101)!
        expect(rec.meltPreview.outputData[0].secret).toBe('first')
        expect(rowCount(db)).toBe(1)
        db.close()
    })

    test('remove deletes the entry (terminal success/failure)', () => {
        const db = freshDb()
        addMeltRecovery(db, 101, MINT, 'k1', previewFor('k1'))
        expect(rowCount(db)).toBe(1)

        removeMeltRecovery(db, 101)
        expect(getMeltRecovery(db, 101)).toBeUndefined()
        expect(rowCount(db)).toBe(0)
        db.close()
    })

    test('entries for different transactions are independent', () => {
        const db = freshDb()
        addMeltRecovery(db, 101, MINT, 'k1', previewFor('k1'))
        addMeltRecovery(db, 102, MINT, 'k2', previewFor('k2'))

        expect(getMeltRecovery(db, 101)!.keysetId).toBe('k1')
        expect(getMeltRecovery(db, 102)!.keysetId).toBe('k2')

        removeMeltRecovery(db, 101)
        expect(getMeltRecovery(db, 101)).toBeUndefined()
        expect(getMeltRecovery(db, 102)!.keysetId).toBe('k2') // unaffected
        db.close()
    })

    test('seed is idempotent — does not overwrite an existing entry', () => {
        const db = freshDb()
        // Live entry already advanced/stored.
        addMeltRecovery(db, 101, MINT, 'k1', previewFor('k1', 'live'))
        // Upgrade seed re-runs with the snapshot copy.
        addMeltRecovery(db, 101, MINT, 'k1', previewFor('k1', 'snapshot'))

        expect(getMeltRecovery(db, 101)!.meltPreview.outputData[0].secret).toBe('live')
        db.close()
    })
})
