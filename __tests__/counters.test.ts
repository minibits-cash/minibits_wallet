/**
 * Derivation-counter tests (mint_counters migration).
 *
 * Verifies the SQL-level semantics that `Database.setCounter`, `bumpCounter`,
 * `seedCounters`, and the `counterUpdate` folded into `commitReservation`
 * implement on top of `executeBatch`. The counter is the BIP32 derivation
 * high-water mark; the single most important invariant is that it is MONOTONIC
 * — a stored counter can never move backward — because a regression would let
 * the next derivation reuse a blinded secret.
 *
 * As with proofReservation.test.ts we mirror the exact production SQL using
 * node:sqlite + explicit BEGIN/COMMIT, since the native driver needs a device.
 *
 * @jest-environment node
 */
import {DatabaseSync} from 'node:sqlite'

const NOW = '2026-06-04T00:00:00.000Z'

// ── Schema (mirrors schema.ts) ──────────────────────────────────────────────

const CREATE_MINT_COUNTERS = `CREATE TABLE mint_counters (
  mintUrl TEXT NOT NULL,
  keysetId TEXT NOT NULL,
  unit TEXT,
  counter INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT,
  PRIMARY KEY (mintUrl, keysetId)
)`

const CREATE_PROOFS = `CREATE TABLE proofs (
  id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  secret TEXT PRIMARY KEY NOT NULL,
  C TEXT NOT NULL,
  unit TEXT,
  tId INTEGER,
  mintUrl TEXT,
  state TEXT NOT NULL DEFAULT 'UNSPENT',
  updatedAt TEXT
)`

const CREATE_RESERVATIONS = `CREATE TABLE reservations (
  id TEXT PRIMARY KEY NOT NULL,
  transactionId INTEGER NOT NULL,
  mintUrl TEXT NOT NULL,
  unit TEXT NOT NULL,
  operationType TEXT NOT NULL,
  lockedProofs TEXT NOT NULL,
  createdAt TEXT NOT NULL
)`

const MINT = 'https://mint.test'

// ── Mirrored Database primitives (exact production SQL) ─────────────────────

/** countersRepo.buildCounterUpsert / setCounter — monotonic absolute write. */
function setCounter(db: DatabaseSync, mintUrl: string, keysetId: string, unit: string | null, value: number) {
    db.prepare(
        `INSERT INTO mint_counters (mintUrl, keysetId, unit, counter, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(mintUrl, keysetId) DO UPDATE SET
           counter = MAX(counter, excluded.counter),
           unit = excluded.unit,
           updatedAt = excluded.updatedAt`,
    ).run(mintUrl, keysetId, unit, value, NOW)
}

/** countersRepo.bumpCounter — relative advance (no-op for delta <= 0). */
function bumpCounter(db: DatabaseSync, mintUrl: string, keysetId: string, unit: string | null, delta: number) {
    if (delta <= 0) return
    db.prepare(
        `INSERT INTO mint_counters (mintUrl, keysetId, unit, counter, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(mintUrl, keysetId) DO UPDATE SET
           counter = counter + ?,
           updatedAt = excluded.updatedAt`,
    ).run(mintUrl, keysetId, unit, delta, NOW, delta)
}

function getCounter(db: DatabaseSync, mintUrl: string, keysetId: string): number | undefined {
    const row = db
        .prepare('SELECT counter FROM mint_counters WHERE mintUrl = ? AND keysetId = ?')
        .get(mintUrl, keysetId) as {counter: number} | undefined
    return row?.counter
}

function counterRowCount(db: DatabaseSync): number {
    const {n} = db.prepare('SELECT COUNT(*) AS n FROM mint_counters').get() as {n: number}
    return n
}

/** countersRepo.seedCounters — idempotent monotonic batch. */
function seedCounters(
    db: DatabaseSync,
    seeds: Array<{mintUrl: string; keysetId: string; unit?: string; counter: number}>,
) {
    db.exec('BEGIN')
    try {
        for (const s of seeds) setCounter(db, s.mintUrl, s.keysetId, s.unit ?? null, s.counter)
        db.exec('COMMIT')
    } catch (e) {
        db.exec('ROLLBACK')
        throw e
    }
}

function insertProof(db: DatabaseSync, secret: string, amount: number, state = 'UNSPENT') {
    db.prepare(
        `INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
         VALUES ('keyset1', ?, ?, 'C', '${MINT}', 'sat', 1, ?, '2026-01-01')`,
    ).run(amount, secret, state)
}

function getProofState(db: DatabaseSync, secret: string): string {
    const row = db.prepare('SELECT state FROM proofs WHERE secret = ?').get(secret) as
        | {state: string}
        | undefined
    return row?.state ?? ''
}

/**
 * commitReservation with a folded counterUpdate (the step-4 atomic commit):
 * new proofs + a monotonic counter upsert + reservation delete, all in one txn.
 */
function commitWithCounter(
    db: DatabaseSync,
    reservationId: string,
    changes: {
        newProofs?: Array<{secret: string; amount: number; state: string}>
        counterUpdate?: Array<{mintUrl: string; keysetId: string; unit?: string; counter: number}>
    },
) {
    db.exec('BEGIN')
    try {
        const insertNew = db.prepare(
            `INSERT OR REPLACE INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
             VALUES ('keyset1', ?, ?, 'C', '${MINT}', 'sat', 1, ?, ?)`,
        )
        for (const p of changes.newProofs ?? []) insertNew.run(p.amount, p.secret, p.state, NOW)

        for (const cu of changes.counterUpdate ?? []) {
            setCounter(db, cu.mintUrl, cu.keysetId, cu.unit ?? null, cu.counter)
        }

        db.prepare('DELETE FROM reservations WHERE id = ?').run(reservationId)
        db.exec('COMMIT')
    } catch (e) {
        db.exec('ROLLBACK')
        throw e
    }
}

function freshDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:')
    db.exec(CREATE_MINT_COUNTERS)
    db.exec(CREATE_PROOFS)
    db.exec(CREATE_RESERVATIONS)
    return db
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Derivation counters (mint_counters)', () => {
    describe('setCounter — monotonic', () => {
        test('inserts a new row when none exists', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 42)
            expect(getCounter(db, MINT, 'k1')).toBe(42)
            db.close()
        })

        test('raises to a higher value', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 100)
            setCounter(db, MINT, 'k1', 'sat', 150)
            expect(getCounter(db, MINT, 'k1')).toBe(150)
            db.close()
        })

        test('NEVER lowers — a smaller value is ignored (the core safety invariant)', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 100)
            setCounter(db, MINT, 'k1', 'sat', 50) // stale / replayed writer
            expect(getCounter(db, MINT, 'k1')).toBe(100)
            db.close()
        })

        test('an equal value is a no-op', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 100)
            setCounter(db, MINT, 'k1', 'sat', 100)
            expect(getCounter(db, MINT, 'k1')).toBe(100)
            db.close()
        })
    })

    describe('bumpCounter — relative advance', () => {
        test('inserts from 0 when no row exists', () => {
            const db = freshDb()
            bumpCounter(db, MINT, 'k1', 'sat', 10)
            expect(getCounter(db, MINT, 'k1')).toBe(10)
            db.close()
        })

        test('adds to the existing value', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 100)
            bumpCounter(db, MINT, 'k1', 'sat', 10)
            expect(getCounter(db, MINT, 'k1')).toBe(110)
            db.close()
        })

        test('a non-positive delta is a no-op', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 100)
            bumpCounter(db, MINT, 'k1', 'sat', 0)
            bumpCounter(db, MINT, 'k1', 'sat', -5)
            expect(getCounter(db, MINT, 'k1')).toBe(100)
            db.close()
        })
    })

    describe('primary key isolation', () => {
        test('different keysets on the same mint are independent', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 100)
            setCounter(db, MINT, 'k2', 'sat', 7)
            expect(getCounter(db, MINT, 'k1')).toBe(100)
            expect(getCounter(db, MINT, 'k2')).toBe(7)
            expect(counterRowCount(db)).toBe(2)
            db.close()
        })

        test('the same keyset id on different mints is independent', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 100)
            setCounter(db, 'https://other.test', 'k1', 'sat', 5)
            expect(getCounter(db, MINT, 'k1')).toBe(100)
            expect(getCounter(db, 'https://other.test', 'k1')).toBe(5)
            db.close()
        })
    })

    describe('seedCounters — one-time MMKV→SQLite copy', () => {
        test('seeds every supplied counter', () => {
            const db = freshDb()
            seedCounters(db, [
                {mintUrl: MINT, keysetId: 'k1', unit: 'sat', counter: 100},
                {mintUrl: MINT, keysetId: 'k2', unit: 'sat', counter: 50},
            ])
            expect(getCounter(db, MINT, 'k1')).toBe(100)
            expect(getCounter(db, MINT, 'k2')).toBe(50)
            db.close()
        })

        test('is idempotent — re-running never lowers an advanced counter', () => {
            const db = freshDb()
            // First upgrade seed copies the (then current) MMKV values.
            seedCounters(db, [{mintUrl: MINT, keysetId: 'k1', unit: 'sat', counter: 100}])
            // Wallet advances past it during normal use.
            setCounter(db, MINT, 'k1', 'sat', 175)
            // A later launch re-runs the seed with the now-stale snapshot value.
            seedCounters(db, [{mintUrl: MINT, keysetId: 'k1', unit: 'sat', counter: 100}])
            // The advanced SQLite value wins — the seed cannot regress it.
            expect(getCounter(db, MINT, 'k1')).toBe(175)
            db.close()
        })

        test('a too-high seed is kept (conservative-safe: skips indices, never reuses)', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 100)
            seedCounters(db, [{mintUrl: MINT, keysetId: 'k1', unit: 'sat', counter: 9999}])
            expect(getCounter(db, MINT, 'k1')).toBe(9999)
            db.close()
        })
    })

    describe('atomic commit (counterUpdate folded into commitReservation)', () => {
        test('persists the counter in the SAME txn as the new proofs', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 100)

            commitWithCounter(db, 'res-1', {
                newProofs: [{secret: 'new1', amount: 50, state: 'UNSPENT'}],
                counterUpdate: [{mintUrl: MINT, keysetId: 'k1', unit: 'sat', counter: 110}],
            })

            expect(getProofState(db, 'new1')).toBe('UNSPENT')
            expect(getCounter(db, MINT, 'k1')).toBe(110)
            db.close()
        })

        test('a failed commit batch rolls back BOTH the proofs and the counter', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 100)

            // Force a failure mid-batch (NOT NULL violation on amount) AFTER the
            // proof insert and counter upsert have run in the same transaction.
            expect(() => {
                db.exec('BEGIN')
                try {
                    db.prepare(
                        `INSERT OR REPLACE INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
                         VALUES ('keyset1', 50, 'new1', 'C', '${MINT}', 'sat', 1, 'UNSPENT', '${NOW}')`,
                    ).run()
                    setCounter(db, MINT, 'k1', 'sat', 110)
                    // Violates NOT NULL on amount → aborts the whole batch.
                    db.prepare(
                        `INSERT INTO proofs (id, amount, secret, C, state) VALUES ('keyset1', NULL, 'bad', 'C', 'UNSPENT')`,
                    ).run()
                    db.exec('COMMIT')
                } catch (e) {
                    db.exec('ROLLBACK')
                    throw e
                }
            }).toThrow()

            // Neither the proof nor the counter advance survived.
            expect(getProofState(db, 'new1')).toBe('')
            expect(getCounter(db, MINT, 'k1')).toBe(100)
            db.close()
        })

        test('counterUpdate stays monotonic inside the commit batch', () => {
            const db = freshDb()
            setCounter(db, MINT, 'k1', 'sat', 200)

            // A commit carrying a stale (lower) counter must not regress it.
            commitWithCounter(db, 'res-2', {
                newProofs: [{secret: 'new2', amount: 10, state: 'UNSPENT'}],
                counterUpdate: [{mintUrl: MINT, keysetId: 'k1', unit: 'sat', counter: 150}],
            })

            expect(getProofState(db, 'new2')).toBe('UNSPENT')
            expect(getCounter(db, MINT, 'k1')).toBe(200)
            db.close()
        })
    })
})
