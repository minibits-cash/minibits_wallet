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

// Minimal transactions table for the two-table atomicity tests (Phase 5b).
const CREATE_TRANSACTIONS = `CREATE TABLE transactions (
  id INTEGER PRIMARY KEY NOT NULL,
  status TEXT,
  data TEXT,
  amount INTEGER,
  fee INTEGER,
  balanceAfter INTEGER,
  outputToken TEXT,
  keysetId TEXT,
  proof TEXT
)`

function createSchema(db: DatabaseSync) {
    db.exec(CREATE_PROOFS)
    db.exec(CREATE_RESERVATIONS)
    db.exec(CREATE_TRANSACTIONS)
}

function insertTransaction(db: DatabaseSync, id: number, status: string) {
    db.prepare(`INSERT INTO transactions (id, status) VALUES (?, ?)`).run(id, status)
}

function getTransactionStatus(db: DatabaseSync, id: number): string {
    const row = db.prepare('SELECT status FROM transactions WHERE id = ?').get(id) as
        | {status: string}
        | undefined
    return row?.status ?? ''
}

function getTransactionRow(
    db: DatabaseSync,
    id: number,
): {status: string | null; data: string | null; balanceAfter: number | null} | undefined {
    return db
        .prepare('SELECT status, data, balanceAfter FROM transactions WHERE id = ?')
        .get(id) as any
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

type LockedProofSnapshot = {
    secret: string
    originalState: 'UNSPENT' | 'PENDING' | 'SPENT'
    originalTId: number | null
}

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
        // Reassign tId to the new operation alongside the state lock.
        const updateProof = db.prepare(
            `UPDATE proofs SET state = 'PENDING', tId = ?, updatedAt = ? WHERE secret = ?`,
        )
        for (const secret of proofsToLockSecrets) {
            updateProof.run(reservation.transactionId, now, secret)
        }
        db.exec('COMMIT')
    } catch (e) {
        db.exec('ROLLBACK')
        throw e
    }
}

type CommitTransactionUpdate = {
    id: number
    status?: string
    data?: string
    amount?: number
    fee?: number
    balanceAfter?: number
    outputToken?: string
    keysetId?: string
    proof?: string
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
        transactionUpdate?: CommitTransactionUpdate
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

        // Mirror the SQL the production code builds: dynamic UPDATE with only
        // the supplied fields.
        if (changes.transactionUpdate) {
            const tu = changes.transactionUpdate
            const setClauses: string[] = []
            const params: (string | number | null)[] = []
            const setIfDefined = (col: string, value: string | number | undefined) => {
                if (value !== undefined) {
                    setClauses.push(`${col} = ?`)
                    params.push(value)
                }
            }
            setIfDefined('status', tu.status)
            setIfDefined('data', tu.data)
            setIfDefined('amount', tu.amount)
            setIfDefined('fee', tu.fee)
            setIfDefined('balanceAfter', tu.balanceAfter)
            setIfDefined('outputToken', tu.outputToken)
            setIfDefined('keysetId', tu.keysetId)
            setIfDefined('proof', tu.proof)
            if (setClauses.length > 0) {
                params.push(tu.id)
                db.prepare(
                    `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ?`,
                ).run(...params)
            }
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
        // Restore BOTH state and tId from the pre-reserve snapshot.
        const restore = db.prepare(
            `UPDATE proofs SET state = ?, tId = ?, updatedAt = ? WHERE secret = ?`,
        )
        for (const snap of lockedProofs) {
            restore.run(snap.originalState, snap.originalTId, now, snap.secret)
        }
        db.prepare('DELETE FROM reservations WHERE id = ?').run(reservationId)
        db.exec('COMMIT')
    } catch (e) {
        db.exec('ROLLBACK')
        throw e
    }
}

function getProofTId(db: DatabaseSync, secret: string): number | null {
    const row = db.prepare('SELECT tId FROM proofs WHERE secret = ?').get(secret) as
        | {tId: number | null}
        | undefined
    return row?.tId ?? null
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
                        {secret: 'sA', originalState: 'UNSPENT', originalTId: null},
                        {secret: 'sB', originalState: 'UNSPENT', originalTId: null},
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
                        {secret: 'sA', originalState: 'UNSPENT', originalTId: null},
                        {secret: 'sB', originalState: 'PENDING', originalTId: null},
                    ],
                },
                ['sA', 'sB'],
            )

            const orphans = getOpenReservations(db)
            expect(orphans).toHaveLength(1)
            expect(orphans[0].lockedProofs).toEqual([
                {secret: 'sA', originalState: 'UNSPENT', originalTId: null},
                {secret: 'sB', originalState: 'PENDING', originalTId: null},
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
                        {secret: 'input1', originalState: 'UNSPENT', originalTId: null},
                        {secret: 'input2', originalState: 'UNSPENT', originalTId: null},
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
                    lockedProofs: [{secret: 's1', originalState: 'UNSPENT', originalTId: null}],
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
                        {secret: 'sA', originalState: 'UNSPENT', originalTId: null},
                        {secret: 'sB', originalState: 'UNSPENT', originalTId: null},
                    ],
                },
                ['sA', 'sB'],
            )

            expect(getProofState(db, 'sA')).toBe('PENDING')

            rollbackReservation(db, 'r5', [
                {secret: 'sA', originalState: 'UNSPENT', originalTId: null},
                {secret: 'sB', originalState: 'UNSPENT', originalTId: null},
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
                    lockedProofs: [{secret: 'sA', originalState: 'PENDING', originalTId: null}],
                },
                ['sA'],
            )

            rollbackReservation(db, 'r6', [{secret: 'sA', originalState: 'PENDING', originalTId: null}])

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
                        {secret: 'orphanA', originalState: 'UNSPENT', originalTId: null},
                        {secret: 'orphanB', originalState: 'UNSPENT', originalTId: null},
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
                        {secret: 'a1', originalState: 'UNSPENT', originalTId: null},
                        {secret: 'a2', originalState: 'UNSPENT', originalTId: null},
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
                    lockedProofs: [{secret: 'b1', originalState: 'UNSPENT', originalTId: null}],
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
                    lockedProofs: [{secret: 's1', originalState: 'UNSPENT', originalTId: null}],
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
                        lockedProofs: [{secret: 's2', originalState: 'UNSPENT', originalTId: null}],
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

    // ─────────────────────────────────────────────────────────────────────
    // Regression: a real bug observed in dev (2026-05-22).
    //
    // The send went through and the recipient redeemed the token, but the
    // SEND transaction in our wallet stayed PENDING forever. Root cause:
    // openReservation was writing the proof's OLD tId back to the row
    // (the original RECEIVE that minted it) instead of the new operation's
    // transactionId. So when sync later saw the proofs SPENT, it grouped
    // them under the wrong (already-completed) transaction.
    //
    // These tests pin the tId-propagation contract: reserving must
    // reassign tId to the new operation, and rollback must restore the
    // pre-reserve tId.
    // ─────────────────────────────────────────────────────────────────────
    describe('tId propagation (regression: stuck-PENDING SEND, 2026-05-22)', () => {
        test('openReservation reassigns each locked proof tId to the new transactionId', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)

            // Two proofs received originally by tx 110 and tx 123 respectively
            // (simulates the dev log).
            db.prepare(
                `INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
                 VALUES ('keyset1', 4, 'inp_a', 'C', 'https://mint.test', 'sat', 110, 'UNSPENT', '2026-01-01')`,
            ).run()
            db.prepare(
                `INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
                 VALUES ('keyset1', 2, 'inp_b', 'C', 'https://mint.test', 'sat', 123, 'UNSPENT', '2026-01-01')`,
            ).run()

            expect(getProofTId(db, 'inp_a')).toBe(110)
            expect(getProofTId(db, 'inp_b')).toBe(123)

            // New SEND operation as transaction 157
            openReservation(
                db,
                {
                    id: 'res-157',
                    transactionId: 157,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-direct',
                    lockedProofs: [
                        {secret: 'inp_a', originalState: 'UNSPENT', originalTId: 110},
                        {secret: 'inp_b', originalState: 'UNSPENT', originalTId: 123},
                    ],
                },
                ['inp_a', 'inp_b'],
            )

            // After reserve, BOTH proofs must point to the new tx so that any
            // sync that later sees them SPENT correctly groups them under 157.
            expect(getProofTId(db, 'inp_a')).toBe(157)
            expect(getProofTId(db, 'inp_b')).toBe(157)
            expect(getProofState(db, 'inp_a')).toBe('PENDING')
            expect(getProofState(db, 'inp_b')).toBe('PENDING')

            db.close()
        })

        test('rollback restores each proof to its individual originalTId', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            db.prepare(
                `INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
                 VALUES ('keyset1', 4, 'inp_a', 'C', 'https://mint.test', 'sat', 110, 'UNSPENT', '2026-01-01')`,
            ).run()
            db.prepare(
                `INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
                 VALUES ('keyset1', 2, 'inp_b', 'C', 'https://mint.test', 'sat', 123, 'UNSPENT', '2026-01-01')`,
            ).run()

            openReservation(
                db,
                {
                    id: 'res-fail',
                    transactionId: 200,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-direct',
                    lockedProofs: [
                        {secret: 'inp_a', originalState: 'UNSPENT', originalTId: 110},
                        {secret: 'inp_b', originalState: 'UNSPENT', originalTId: 123},
                    ],
                },
                ['inp_a', 'inp_b'],
            )

            // Simulate operation failure.
            rollbackReservation(db, 'res-fail', [
                {secret: 'inp_a', originalState: 'UNSPENT', originalTId: 110},
                {secret: 'inp_b', originalState: 'UNSPENT', originalTId: 123},
            ])

            // Each proof goes back to its OWN prior tId — not the failed
            // operation's, and not any uniform value.
            expect(getProofTId(db, 'inp_a')).toBe(110)
            expect(getProofTId(db, 'inp_b')).toBe(123)
            expect(getProofState(db, 'inp_a')).toBe('UNSPENT')
            expect(getProofState(db, 'inp_b')).toBe('UNSPENT')
            expect(reservationCount(db)).toBe(0)

            db.close()
        })

        test('proofs with no prior tId (null) are reassigned and restored to null', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            // Proof inserted without a tId — simulates an imported/restored
            // proof that was never tied to a wallet transaction.
            db.prepare(
                `INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, state, updatedAt)
                 VALUES ('keyset1', 1, 'orphan', 'C', 'https://mint.test', 'sat', 'UNSPENT', '2026-01-01')`,
            ).run()
            expect(getProofTId(db, 'orphan')).toBe(null)

            openReservation(
                db,
                {
                    id: 'res-null',
                    transactionId: 300,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-direct',
                    lockedProofs: [
                        {secret: 'orphan', originalState: 'UNSPENT', originalTId: null},
                    ],
                },
                ['orphan'],
            )
            expect(getProofTId(db, 'orphan')).toBe(300)

            rollbackReservation(db, 'res-null', [
                {secret: 'orphan', originalState: 'UNSPENT', originalTId: null},
            ])
            expect(getProofTId(db, 'orphan')).toBe(null)

            db.close()
        })
    })

    // ─────────────────────────────────────────────────────────────────────
    // Phase 5b: atomic two-table commit (proofs + transactions).
    //
    // A commit can optionally include a transactionUpdate that lands in the
    // SAME SQLite transaction as the proof finalize. This closes the gap
    // where a crash between proof commit and tx.update() left a transaction
    // stuck in PENDING/PREPARED with its underlying proofs already SPENT.
    // ─────────────────────────────────────────────────────────────────────
    describe('atomic two-table commit (Phase 5b)', () => {
        test('commit with transactionUpdate writes proofs AND transaction in one txn', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'input', 100)
            insertTransaction(db, 200, 'PREPARED')

            openReservation(
                db,
                {
                    id: 'res-tx',
                    transactionId: 200,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-direct',
                    lockedProofs: [{secret: 'input', originalState: 'UNSPENT', originalTId: null}],
                },
                ['input'],
            )
            expect(getTransactionStatus(db, 200)).toBe('PREPARED')

            commitReservation(db, 'res-tx', {
                toSpent: ['input'],
                transactionUpdate: {
                    id: 200,
                    status: 'COMPLETED',
                    data: '[{"status":"COMPLETED"}]',
                    balanceAfter: 50,
                },
            })

            // Both writes landed:
            expect(getProofState(db, 'input')).toBe('SPENT')
            const row = getTransactionRow(db, 200)!
            expect(row.status).toBe('COMPLETED')
            expect(row.data).toBe('[{"status":"COMPLETED"}]')
            expect(row.balanceAfter).toBe(50)
            expect(reservationCount(db)).toBe(0)

            db.close()
        })

        test('a failed commit batch rolls back BOTH proof and transaction writes', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'input', 100)
            insertTransaction(db, 201, 'PREPARED')

            openReservation(
                db,
                {
                    id: 'res-atomic',
                    transactionId: 201,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-direct',
                    lockedProofs: [{secret: 'input', originalState: 'UNSPENT', originalTId: null}],
                },
                ['input'],
            )

            // Force a failure mid-batch by attempting to insert a duplicate
            // reservation id alongside a valid tx update. SQLite rejects the
            // whole batch.
            expect(() => {
                db.exec('BEGIN')
                try {
                    db.prepare(`UPDATE proofs SET state = 'SPENT' WHERE secret = ?`).run('input')
                    db.prepare(`UPDATE transactions SET status = 'COMPLETED' WHERE id = ?`).run(201)
                    // This will conflict — reservation 'res-atomic' already exists
                    db.prepare(
                        `INSERT INTO reservations (id, transactionId, mintUrl, unit, operationType, lockedProofs, createdAt)
                         VALUES ('res-atomic', 999, '', '', '', '[]', '')`,
                    ).run()
                    db.exec('COMMIT')
                } catch (e) {
                    db.exec('ROLLBACK')
                    throw e
                }
            }).toThrow()

            // Neither write survives — proof and tx are both in their
            // pre-attempt state. This is the core safety property: if any
            // statement in the batch fails, SQLite rolls back the entire txn.
            expect(getProofState(db, 'input')).toBe('PENDING') // still locked
            expect(getTransactionStatus(db, 201)).toBe('PREPARED') // still pre-finalize

            db.close()
        })

        test('commit without transactionUpdate leaves transactions table untouched', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'p1', 100)
            insertTransaction(db, 202, 'PENDING')

            openReservation(
                db,
                {
                    id: 'res-no-tx',
                    transactionId: 202,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'send-direct',
                    lockedProofs: [{secret: 'p1', originalState: 'UNSPENT', originalTId: null}],
                },
                ['p1'],
            )

            commitReservation(db, 'res-no-tx', {toSpent: ['p1']})

            expect(getProofState(db, 'p1')).toBe('SPENT')
            // Transaction status untouched — the caller is responsible for
            // any post-commit updates that don't need atomicity.
            expect(getTransactionStatus(db, 202)).toBe('PENDING')

            db.close()
        })

        test('partial transactionUpdate only sets the provided columns', () => {
            const db = new DatabaseSync(':memory:')
            createSchema(db)
            insertProof(db, 'p2', 100)
            db.prepare(
                `INSERT INTO transactions (id, status, data, balanceAfter)
                 VALUES (203, 'PREPARED', 'old-data', 999)`,
            ).run()

            openReservation(
                db,
                {
                    id: 'res-partial',
                    transactionId: 203,
                    mintUrl: 'https://mint.test',
                    unit: 'sat',
                    operationType: 'revert',
                    lockedProofs: [{secret: 'p2', originalState: 'PENDING', originalTId: 203}],
                },
                ['p2'],
            )

            // Only update status — data and balanceAfter must remain as-is.
            commitReservation(db, 'res-partial', {
                toSpent: ['p2'],
                transactionUpdate: {id: 203, status: 'REVERTED'},
            })

            const row = getTransactionRow(db, 203)!
            expect(row.status).toBe('REVERTED')
            expect(row.data).toBe('old-data')
            expect(row.balanceAfter).toBe(999)

            db.close()
        })
    })
})
