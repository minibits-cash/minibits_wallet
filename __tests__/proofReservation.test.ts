/**
 * Proof reservations, against the REAL repo and a real database.
 *
 * A reservation is the wallet's atomic-commit primitive for an outgoing operation:
 * open it to lock proofs to PENDING, then either commit (inputs SPENT, new proofs
 * in, transaction row updated, reservation deleted) or roll back (every proof
 * restored to its pre-reserve state AND tId). All of it in one SQLite transaction,
 * because a partial apply here loses or strands ecash.
 *
 * This calls the production `Database.*` functions. It used to hand-copy both the
 * schema and every statement — and a copy of the SQL proves nothing about the SQL
 * the app runs. The op-sqlite jest mock now backs the real driver seam with
 * node:sqlite, so connection.ts (param sanitizing, result adaptation, BEGIN/COMMIT
 * batch emulation), instance.ts (schema + the real migration runner) and the repo
 * all run for real.
 *
 * The helpers below keep their original shapes so the assertions read unchanged;
 * only their innards moved from mirrored SQL to the real API.
 */
jest.mock('../src/services/logService', () => ({
    log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {Database} from '../src/services/db'
import {ProofModel} from '../src/models/Proof'

const MINT = 'https://mint.test'
const MINT_ID = 'mint1111'

type Db = ReturnType<typeof Database.getInstance>

type LockedProofSnapshot = {
    secret: string
    originalState: 'UNSPENT' | 'PENDING' | 'SPENT'
    originalTId: number | null
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

/**
 * One in-memory database per test FILE (instance.ts caches its connection), so
 * "fresh" means cleared rather than rebuilt. Returns the real connection for the
 * few assertions that read raw rows.
 */
function freshDb(): Db {
    const db = Database.getInstance()
    db.executeBatch([['DELETE FROM proofs'], ['DELETE FROM reservations'], ['DELETE FROM transactions']])
    return db
}

function insertTransaction(_db: Db, id: number, status: string) {
    Database.getInstance().execute(`INSERT INTO transactions (id, status) VALUES (?, ?)`, [id, status])
}

function getTransactionStatus(_db: Db, id: number): string {
    return (
        Database.getInstance().execute('SELECT status FROM transactions WHERE id = ?', [id]).rows?.item(0)
            ?.status ?? ''
    )
}

function getTransactionRow(
    _db: Db,
    id: number,
): {status: string | null; data: string | null; balanceAfter: number | null} | undefined {
    return Database.getInstance()
        .execute('SELECT status, data, balanceAfter FROM transactions WHERE id = ?', [id])
        .rows?.item(0) as any
}

function insertProof(
    _db: Db,
    secret: string,
    amount: number,
    state: 'UNSPENT' | 'PENDING' | 'SPENT' = 'UNSPENT',
) {
    Database.addOrUpdateProofs([proofNode(secret, amount)], state)
}

/**
 * A real MST Proof node.
 *
 * The repo calls mobx-state-tree's `isAlive()` on everything it locks, which only
 * answers for an actual node — so a plain object here would not exercise the same
 * path production takes.
 */
function proofNode(secret: string, amount: number, tId = 1) {
    return ProofModel.create({
        id: 'keyset1',
        amount,
        secret,
        C: 'C',
        unit: 'sat',
        tId,
        mintUrl: MINT,
    }) as any
}

function getProofState(_db: Db, secret: string): string {
    return (
        Database.getInstance().execute('SELECT state FROM proofs WHERE secret = ?', [secret]).rows?.item(0)
            ?.state ?? ''
    )
}

function getProofTId(_db: Db, secret: string): number | null {
    const row = Database.getInstance()
        .execute('SELECT tId FROM proofs WHERE secret = ?', [secret])
        .rows?.item(0)
    return row?.tId ?? null
}

function reservationCount(_db: Db): number {
    return Database.getInstance().execute('SELECT COUNT(*) AS n FROM reservations').rows?.item(0)?.n ?? 0
}

/** Rebuild MST nodes for already-stored proofs, which is what the repo locks. */
function nodesForSecrets(secrets: string[]) {
    return secrets.map(secret => {
        const row = Database.getInstance()
            .execute('SELECT * FROM proofs WHERE secret = ?', [secret])
            .rows?.item(0)
        return proofNode(secret, row?.amount ?? 1, row?.tId ?? 1)
    })
}

function openReservation(
    _db: Db,
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
    Database.openReservation(
        {...reservation, mintId: MINT_ID},
        nodesForSecrets(proofsToLockSecrets),
    )
}

function commitReservation(
    _db: Db,
    reservationId: string,
    changes: {
        toSpent?: string[]
        toUnspent?: string[]
        newProofs?: Array<{secret: string; amount: number; state: 'UNSPENT' | 'PENDING' | 'SPENT'}>
        transactionUpdate?: CommitTransactionUpdate
    },
) {
    Database.commitReservation(reservationId, {
        toSpent: changes.toSpent ? nodesForSecrets(changes.toSpent) : undefined,
        toUnspent: changes.toUnspent ? nodesForSecrets(changes.toUnspent) : undefined,
        newProofs: changes.newProofs?.map(p => ({
            proofs: [{id: 'keyset1', amount: p.amount, secret: p.secret, C: 'C'} as any],
            state: p.state,
            mintUrl: MINT,
            unit: 'sat',
            tId: 1,
        })),
        transactionUpdate: changes.transactionUpdate as any,
    })
}

function rollbackReservation(_db: Db, reservationId: string, lockedProofs: LockedProofSnapshot[]) {
    Database.rollbackReservation(reservationId, lockedProofs as any)
}

function getOpenReservations(_db: Db): Array<{id: string; lockedProofs: LockedProofSnapshot[]}> {
    return Database.getOpenReservations().map(r => ({
        id: r.id,
        lockedProofs: r.lockedProofs as LockedProofSnapshot[],
    }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Proof reservations', () => {
    describe('openReservation', () => {
        test('atomically inserts reservation row + locks proofs to PENDING', () => {
            const db = freshDb()
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
        })

        test('captures originalState even when some proofs were already PENDING', () => {
            const db = freshDb()
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
        })
    })

    describe('commitReservation', () => {
        test('marks inputs SPENT, adds new proofs, deletes reservation in one txn', () => {
            const db = freshDb()
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
        })

        test('empty changes still removes the reservation row (offline-send case)', () => {
            const db = freshDb()
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
        })
    })

    describe('rollbackReservation', () => {
        test('restores each proof to its originalState and deletes the row', () => {
            const db = freshDb()
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
        })

        test('preserves PENDING originalState (multi-op overlap)', () => {
            const db = freshDb()
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
        })
    })

    describe('orphan recovery', () => {
        test('getOpenReservations returns all rows; rollback restores state', () => {
            const db = freshDb()
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
        })

        test('no orphans when there are no in-flight reservations', () => {
            const db = freshDb()
            insertProof(db, 's1', 100)

            expect(getOpenReservations(db)).toEqual([])
        })

        test('multiple concurrent reservations all roll back independently', () => {
            const db = freshDb()
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
        })
    })

    describe('atomicity', () => {
        test('openReservation: inserting a duplicate id rolls back the whole batch', () => {
            const db = freshDb()
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
            const db = freshDb()

            // Two proofs received originally by tx 110 and tx 123 respectively
            // (simulates the dev log).
            db.execute(`INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
                 VALUES ('keyset1', 4, 'inp_a', 'C', 'https://mint.test', 'sat', 110, 'UNSPENT', '2026-01-01')`)
            db.execute(`INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
                 VALUES ('keyset1', 2, 'inp_b', 'C', 'https://mint.test', 'sat', 123, 'UNSPENT', '2026-01-01')`)

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
        })

        test('rollback restores each proof to its individual originalTId', () => {
            const db = freshDb()
            db.execute(`INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
                 VALUES ('keyset1', 4, 'inp_a', 'C', 'https://mint.test', 'sat', 110, 'UNSPENT', '2026-01-01')`)
            db.execute(`INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, tId, state, updatedAt)
                 VALUES ('keyset1', 2, 'inp_b', 'C', 'https://mint.test', 'sat', 123, 'UNSPENT', '2026-01-01')`)

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
        })

        test('proofs with no prior tId (null) are reassigned and restored to null', () => {
            const db = freshDb()
            // Proof inserted without a tId — simulates an imported/restored
            // proof that was never tied to a wallet transaction.
            db.execute(`INSERT INTO proofs (id, amount, secret, C, mintUrl, unit, state, updatedAt)
                 VALUES ('keyset1', 1, 'orphan', 'C', 'https://mint.test', 'sat', 'UNSPENT', '2026-01-01')`)
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
            const db = freshDb()
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
        })

        test('a failed commit batch rolls back BOTH proof and transaction writes', () => {
            const db = freshDb()
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
                    db.execute(`UPDATE proofs SET state = 'SPENT' WHERE secret = ?`, ['input'])
                    db.execute(`UPDATE transactions SET status = 'COMPLETED' WHERE id = ?`, [201])
                    // This will conflict — reservation 'res-atomic' already exists
                    db.execute(`INSERT INTO reservations (id, transactionId, mintUrl, unit, operationType, lockedProofs, createdAt)
                         VALUES ('res-atomic', 999, '', '', '', '[]', '')`)
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
        })

        test('commit without transactionUpdate leaves transactions table untouched', () => {
            const db = freshDb()
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
        })

        test('partial transactionUpdate only sets the provided columns', () => {
            const db = freshDb()
            insertProof(db, 'p2', 100)
            db.execute(`INSERT INTO transactions (id, status, data, balanceAfter)
                 VALUES (203, 'PREPARED', 'old-data', 999)`)

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
        })
    })
})
