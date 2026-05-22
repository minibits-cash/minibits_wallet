/**
 * Proof reservation tests (Phase 5).
 *
 * Verifies the SQL-level reservation semantics that `Database.openReservation`,
 * `Database.commitReservation`, `Database.rollbackReservation`, and
 * `Database.getOpenReservations` implement on top of `executeBatch`.
 *
 * We mirror the queries using node:sqlite + explicit BEGIN/COMMIT so the test
 * can run in Jest (react-native-quick-sqlite needs a real device).
 *
 * @jest-environment node
 */
import {DatabaseSync} from 'node:sqlite'

// ── Schema ────────────────────────────────────────────────────────────────────

const CREATE_PROOFS = `CREATE TABLE proofs (
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

const CREATE_RESERVATIONS = `CREATE TABLE reservations (
  id TEXT PRIMARY KEY NOT NULL,
  transactionId INTEGER NOT NULL,
  mintUrl TEXT NOT NULL,
  unit TEXT NOT NULL,
  operationType TEXT NOT NULL,
  lockedProofs TEXT NOT NULL,
  createdAt TEXT NOT NULL
)`

function createSchema(db: DatabaseSync) {
    db.exec(CREATE_PROOFS)
    db.exec(CREATE_RESERVATIONS)
}

function insertProof(
    db: DatabaseSync,
    secret: string,
    amount: number,
    state: 'UNSPENT' | 'PENDING' | 'SPENT' = 'UNSPENT',
) {
    db.prepare(
        `INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
         VALUES ('keyset1', ?, ?, 'C', 'https://mint.test', 'sat', 1, ?, '2026-01-01')`,
    ).run(amount, secret, state)
}

function getProofState(db: DatabaseSync, secret: string): string {
    const row = db.prepare('SELECT state FROM proofs WHERE secret = ?').get(secret) as
        | {state: string}
        | undefined
    return row?.state ?? ''
}

function reservationCount(db: DatabaseSync): number {
    const {n} = db.prepare('SELECT COUNT(*) AS n FROM reservations').get() as {n: number}
    return n
}

// ── Simulated Database primitives ─────────────────────────────────────────────
// Mirror the exact SQL the production code uses, wrapped in BEGIN/COMMIT to
// match `executeBatch` atomicity.

type LockedProofSnapshot = {secret: string; originalState: 'UNSPENT' | 'PENDING' | 'SPENT'}

function openReservation(
    db: DatabaseSync,
    reservation: {
        id: string
        transactionId: number
        mintUrl: string
        unit: string
        operationType: string
        lockedProofs: LockedProofSnapshot[]
    },
    proofsToLockSecrets: string[],
) {
    const now = '2026-05-22T00:00:00.000Z'
    db.exec('BEGIN')
    try {
        db.prepare(
            `INSERT INTO reservations (id, transactionId, mintUrl, unit, operationType, lockedProofs, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            reservation.id,
            reservation.transactionId,
            reservation.mintUrl,
            reservation.unit,
            reservation.operationType,
            JSON.stringify(reservation.lockedProofs),
            now,
        )
        const updateProof = db.prepare(
            `UPDATE proofs SET state = 'PENDING', updatedAt = ? WHERE secret = ?`,
        )
        for (const secret of proofsToLockSecrets) {
            updateProof.run(now, secret)
        }
        db.exec('COMMIT')
    } catch (e) {
        db.exec('ROLLBACK')
        throw e
    }
}

function commitReservation(
    db: DatabaseSync,
    reservationId: string,
    changes: {
        toSpent?: string[]
        toUnspent?: string[]
        newProofs?: Array<{
            secret: string
            amount: number
            state: 'UNSPENT' | 'PENDING' | 'SPENT'
        }>
    },
) {
    const now = '2026-05-22T00:00:00.000Z'
    db.exec('BEGIN')
    try {
        const updateSpent = db.prepare(
            `UPDATE proofs SET state = 'SPENT', updatedAt = ? WHERE secret = ?`,
        )
        for (const s of changes.toSpent ?? []) updateSpent.run(now, s)

        const updateUnspent = db.prepare(
            `UPDATE proofs SET state = 'UNSPENT', updatedAt = ? WHERE secret = ?`,
        )
        for (const s of changes.toUnspent ?? []) updateUnspent.run(now, s)

        const insertNew = db.prepare(
            `INSERT OR REPLACE INTO proofs
             (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
             VALUES ('keyset1', ?, ?, 'C', 'https://mint.test', 'sat', 1, ?, ?)`,
        )
        for (const p of changes.newProofs ?? []) {
            insertNew.run(p.amount, p.secret, p.state, now)
        }

        db.prepare('DELETE FROM reservations WHERE id = ?').run(reservationId)
        db.exec('COMMIT')
    } catch (e) {
        db.exec('ROLLBACK')
        throw e
    }
}

function rollbackReservation(
    db: DatabaseSync,
    reservationId: string,
    lockedProofs: LockedProofSnapshot[],
) {
    const now = '2026-05-22T00:00:00.000Z'
    db.exec('BEGIN')
    try {
        const restore = db.prepare(
            `UPDATE proofs SET state = ?, updatedAt = ? WHERE secret = ?`,
        )
        for (const snap of lockedProofs) {
            restore.run(snap.originalState, now, snap.secret)
        }
        db.prepare('DELETE FROM reservations WHERE id = ?').run(reservationId)
        db.exec('COMMIT')
    } catch (e) {
        db.exec('ROLLBACK')
        throw e
    }
}

function getOpenReservations(db: DatabaseSync): Array<{
    id: string
    lockedProofs: LockedProofSnapshot[]
}> {
    const rows = db
        .prepare('SELECT id, lockedProofs FROM reservations')
        .all() as Array<{id: string; lockedProofs: string}>
    return rows.map(r => ({id: r.id, lockedProofs: JSON.parse(r.lockedProofs)}))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Proof reservations', () => {
    describe('openReservation', () => {
        test('atomically inserts reservation row + locks proofs to PENDING', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'sA', 100)
            insertProof(db, 'sB', 200)

            openReservation(
                db,
                {
                    id: 'r1',
                    transactionId: 42,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-online',
                    lockedProofs: [
                        {secret: 'sA', originalState: 'UNSPENT'},
                        {secret: 'sB', originalState: 'UNSPENT'},
                    ],
                },
                ['sA', 'sB'],
            )

            expect(getProofState(db, 'sA')).toBe('PENDING')
            expect(getProofState(db, 'sB')).toBe('PENDING')
            expect(reservationCount(db)).toBe(1)

            db.close()
        })

        test('captures originalState even when some proofs were already PENDING', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'sA', 100, 'UNSPENT')
            insertProof(db, 'sB', 200, 'PENDING') // already locked by an earlier op

            openReservation(
                db,
                {
                    id: 'r2',
                    transactionId: 7,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-offline',
                    lockedProofs: [
                        {secret: 'sA', originalState: 'UNSPENT'},
                        {secret: 'sB', originalState: 'PENDING'},
                    ],
                },
                ['sA', 'sB'],
            )

            const orphans = getOpenReservations(db)
            expect(orphans).toHaveLength(1)
            expect(orphans[0].lockedProofs).toEqual([
                {secret: 'sA', originalState: 'UNSPENT'},
                {secret: 'sB', originalState: 'PENDING'},
            ])

            db.close()
        })
    })

    describe('commitReservation', () => {
        test('marks inputs SPENT, adds new proofs, deletes reservation in one txn', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'input1', 100)
            insertProof(db, 'input2', 200)

            openReservation(
                db,
                {
                    id: 'r3',
                    transactionId: 10,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-swap',
                    lockedProofs: [
                        {secret: 'input1', originalState: 'UNSPENT'},
                        {secret: 'input2', originalState: 'UNSPENT'},
                    ],
                },
                ['input1', 'input2'],
            )

            commitReservation(db, 'r3', {
                toSpent: ['input1', 'input2'],
                newProofs: [
                    {secret: 'change1', amount: 50, state: 'UNSPENT'},
                    {secret: 'send1', amount: 250, state: 'PENDING'},
                ],
            })

            expect(getProofState(db, 'input1')).toBe('SPENT')
            expect(getProofState(db, 'input2')).toBe('SPENT')
            expect(getProofState(db, 'change1')).toBe('UNSPENT')
            expect(getProofState(db, 'send1')).toBe('PENDING')
            expect(reservationCount(db)).toBe(0)

            db.close()
        })

        test('empty changes still removes the reservation row (offline-send case)', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 's1', 100)

            openReservation(
                db,
                {
                    id: 'r4',
                    transactionId: 11,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-offline',
                    lockedProofs: [{secret: 's1', originalState: 'UNSPENT'}],
                },
                ['s1'],
            )

            commitReservation(db, 'r4', {})

            // Proof stays PENDING (sent offline), reservation row gone
            expect(getProofState(db, 's1')).toBe('PENDING')
            expect(reservationCount(db)).toBe(0)

            db.close()
        })
    })

    describe('rollbackReservation', () => {
        test('restores each proof to its originalState and deletes the row', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'sA', 100, 'UNSPENT')
            insertProof(db, 'sB', 200, 'UNSPENT')

            openReservation(
                db,
                {
                    id: 'r5',
                    transactionId: 12,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-swap',
                    lockedProofs: [
                        {secret: 'sA', originalState: 'UNSPENT'},
                        {secret: 'sB', originalState: 'UNSPENT'},
                    ],
                },
                ['sA', 'sB'],
            )

            expect(getProofState(db, 'sA')).toBe('PENDING')

            rollbackReservation(db, 'r5', [
                {secret: 'sA', originalState: 'UNSPENT'},
                {secret: 'sB', originalState: 'UNSPENT'},
            ])

            expect(getProofState(db, 'sA')).toBe('UNSPENT')
            expect(getProofState(db, 'sB')).toBe('UNSPENT')
            expect(reservationCount(db)).toBe(0)

            db.close()
        })

        test('preserves PENDING originalState (multi-op overlap)', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'sA', 100, 'PENDING')

            // Reservation captures sA as already-PENDING
            openReservation(
                db,
                {
                    id: 'r6',
                    transactionId: 13,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-offline',
                    lockedProofs: [{secret: 'sA', originalState: 'PENDING'}],
                },
                ['sA'],
            )

            rollbackReservation(db, 'r6', [{secret: 'sA', originalState: 'PENDING'}])

            // Restored to PENDING (its original locked state), not to UNSPENT
            expect(getProofState(db, 'sA')).toBe('PENDING')

            db.close()
        })
    })

    describe('orphan recovery', () => {
        test('getOpenReservations returns all rows; rollback restores state', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'orphanA', 100)
            insertProof(db, 'orphanB', 200)

            // Simulate a crash mid-operation: open but never commit/rollback.
            openReservation(
                db,
                {
                    id: 'orphan-1',
                    transactionId: 99,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-swap',
                    lockedProofs: [
                        {secret: 'orphanA', originalState: 'UNSPENT'},
                        {secret: 'orphanB', originalState: 'UNSPENT'},
                    ],
                },
                ['orphanA', 'orphanB'],
            )

            // (Process dies here. Next session:)

            const orphans = getOpenReservations(db)
            expect(orphans).toHaveLength(1)
            expect(orphans[0].id).toBe('orphan-1')

            for (const o of orphans) {
                rollbackReservation(db, o.id, o.lockedProofs)
            }

            expect(getProofState(db, 'orphanA')).toBe('UNSPENT')
            expect(getProofState(db, 'orphanB')).toBe('UNSPENT')
            expect(reservationCount(db)).toBe(0)

            db.close()
        })

        test('no orphans when there are no in-flight reservations', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 's1', 100)

            expect(getOpenReservations(db)).toEqual([])
            db.close()
        })

        test('multiple concurrent reservations all roll back independently', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'a1', 100)
            insertProof(db, 'a2', 100)
            insertProof(db, 'b1', 200)

            openReservation(
                db,
                {
                    id: 'op-A',
                    transactionId: 1,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-swap',
                    lockedProofs: [
                        {secret: 'a1', originalState: 'UNSPENT'},
                        {secret: 'a2', originalState: 'UNSPENT'},
                    ],
                },
                ['a1', 'a2'],
            )
            openReservation(
                db,
                {
                    id: 'op-B',
                    transactionId: 2,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-offline',
                    lockedProofs: [{secret: 'b1', originalState: 'UNSPENT'}],
                },
                ['b1'],
            )

            const orphans = getOpenReservations(db)
            expect(orphans).toHaveLength(2)

            for (const o of orphans) {
                rollbackReservation(db, o.id, o.lockedProofs)
            }

            expect(getProofState(db, 'a1')).toBe('UNSPENT')
            expect(getProofState(db, 'a2')).toBe('UNSPENT')
            expect(getProofState(db, 'b1')).toBe('UNSPENT')
            expect(reservationCount(db)).toBe(0)

            db.close()
        })
    })

    describe('atomicity', () => {
        test('openReservation: inserting a duplicate id rolls back the whole batch', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 's1', 100, 'UNSPENT')

            // First reservation succeeds
            openReservation(
                db,
                {
                    id: 'dup',
                    transactionId: 1,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send',
                    lockedProofs: [{secret: 's1', originalState: 'UNSPENT'}],
                },
                ['s1'],
            )
            // Rollback so s1 is UNSPENT but reservations still has 'dup'? Actually
            // it's better to leave the first as PENDING with the row in place:
            // then attempt to insert a SECOND reservation with the same id —
            // PK collision must roll back the entire batch, leaving the
            // PRE-EXISTING state intact.
            expect(getProofState(db, 's1')).toBe('PENDING')

            insertProof(db, 's2', 200, 'UNSPENT')

            expect(() =>
                openReservation(
                    db,
                    {
                        id: 'dup', // collision!
                        transactionId: 2,
                        mintUrl: 'https://mint.test',
                        unit: 'sat',
                        operationType: 'send',
                        lockedProofs: [{secret: 's2', originalState: 'UNSPENT'}],
                    },
                    ['s2'],
                ),
            ).toThrow()

            // After the failed insert, s2 must still be UNSPENT (the batch was atomic)
            expect(getProofState(db, 's2')).toBe('UNSPENT')
            // s1 is unaffected
            expect(getProofState(db, 's1')).toBe('PENDING')

            db.close()
        })
    })
})
