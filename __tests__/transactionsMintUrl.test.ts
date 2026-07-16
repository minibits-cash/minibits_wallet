/**
 * Mint-url rewrite scoping for transactions
 * (Database.updateInFlightTransactionsMintUrl).
 *
 * `transactions.mint` carries two meanings, switched by status:
 *
 *  - TERMINAL: a historical record of where the payment actually happened.
 *    Rewriting it would falsify history, so a mint-url edit must leave it alone.
 *  - IN-FLIGHT: a LIVE pointer the wallet still calls —
 *    checkLightningMintQuote(tx.mint, tx.quote) in topupOperationApi,
 *    checkLightningMeltQuote / checkOnchainMeltQuote in transferOperationApi,
 *    findByUrl(tx.mint) on the revert/receive paths. Left stale after an edit, an
 *    open transaction is stranded at a dead url — a paid topup whose ecash the
 *    wallet can never mint.
 *
 * Mirrors the production SQL with node:sqlite, as the native driver needs a
 * device — but takes the status list from the REAL IN_FLIGHT_STATUSES rather
 * than a copy, so the mirror cannot drift from what production actually runs.
 *
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))
jest.mock('../src/services', () => ({
  Database: {},
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {DatabaseSync} from 'node:sqlite'
import {IN_FLIGHT_STATUSES} from '../src/models/TransactionStates'
import {TransactionStatus} from '../src/models/Transaction'

const OLD_URL = 'https://old.mint.test'
const NEW_URL = 'https://new.mint.test'
const OTHER_URL = 'https://other.mint.test'

/** The exact set the production UPDATE binds. */
const IN_FLIGHT = [...IN_FLIGHT_STATUSES] as string[]

/** Everything else — by construction, so a new enum member lands here loudly. */
const TERMINAL = Object.values(TransactionStatus).filter(s => !IN_FLIGHT.includes(s)) as string[]

const CREATE_TRANSACTIONS = `CREATE TABLE transactions (
  id INTEGER PRIMARY KEY NOT NULL,
  type TEXT,
  amount INTEGER,
  unit TEXT,
  data TEXT,
  mint TEXT,
  status TEXT,
  createdAt TEXT
)`

/** Mirrors transactionsRepo.updateInFlightTransactionsMintUrl. */
function updateInFlightTransactionsMintUrl(
  db: DatabaseSync,
  currentMintUrl: string,
  updatedMintUrl: string,
): number {
  const placeholders = IN_FLIGHT.map(() => '?').join(', ')
  const {changes} = db
    .prepare(
      `UPDATE transactions
       SET mint = ?
       WHERE mint = ? AND status IN (${placeholders})`,
    )
    .run(updatedMintUrl, currentMintUrl, ...IN_FLIGHT)
  return Number(changes)
}

let nextId = 1

function insertTx(db: DatabaseSync, mint: string, status: string): number {
  const id = nextId++
  db.prepare(
    `INSERT INTO transactions (id, type, amount, unit, data, mint, status, createdAt)
     VALUES (?, 'TOPUP', 100, 'sat', '{}', ?, ?, '2026-01-01')`,
  ).run(id, mint, status)
  return id
}

function mintOf(db: DatabaseSync, id: number): string {
  const row = db.prepare('SELECT mint FROM transactions WHERE id = ?').get(id) as {mint: string}
  return row.mint
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(CREATE_TRANSACTIONS)
  nextId = 1
  return db
}

describe('updateInFlightTransactionsMintUrl', () => {
  describe('in-flight transactions are repointed', () => {
    test.each(IN_FLIGHT)('%s is repointed to the new url', status => {
      const db = freshDb()
      const id = insertTx(db, OLD_URL, status)

      expect(updateInFlightTransactionsMintUrl(db, OLD_URL, NEW_URL)).toBe(1)
      expect(mintOf(db, id)).toBe(NEW_URL)
      db.close()
    })
  })

  describe('terminal transactions keep their historical url', () => {
    test.each(TERMINAL)('%s is left untouched', status => {
      const db = freshDb()
      const id = insertTx(db, OLD_URL, status)

      expect(updateInFlightTransactionsMintUrl(db, OLD_URL, NEW_URL)).toBe(0)
      expect(mintOf(db, id)).toBe(OLD_URL)
      db.close()
    })
  })

  test('splits a mixed history: open rows move, closed rows stay', () => {
    const db = freshDb()
    const pending = insertTx(db, OLD_URL, 'PENDING')
    const executing = insertTx(db, OLD_URL, 'EXECUTING')
    const completed = insertTx(db, OLD_URL, 'COMPLETED')
    const reverted = insertTx(db, OLD_URL, 'REVERTED')

    expect(updateInFlightTransactionsMintUrl(db, OLD_URL, NEW_URL)).toBe(2)

    expect(mintOf(db, pending)).toBe(NEW_URL)
    expect(mintOf(db, executing)).toBe(NEW_URL)
    expect(mintOf(db, completed)).toBe(OLD_URL)
    expect(mintOf(db, reverted)).toBe(OLD_URL)
    db.close()
  })

  test('does not touch another mint\'s in-flight transactions', () => {
    const db = freshDb()
    const mine = insertTx(db, OLD_URL, 'PENDING')
    const theirs = insertTx(db, OTHER_URL, 'PENDING')

    expect(updateInFlightTransactionsMintUrl(db, OLD_URL, NEW_URL)).toBe(1)

    expect(mintOf(db, mine)).toBe(NEW_URL)
    expect(mintOf(db, theirs)).toBe(OTHER_URL)
    db.close()
  })

  test('is a no-op when the mint has no transactions', () => {
    const db = freshDb()
    expect(updateInFlightTransactionsMintUrl(db, OLD_URL, NEW_URL)).toBe(0)
    db.close()
  })

  test('is idempotent — re-running finds nothing left at the old url', () => {
    const db = freshDb()
    const pending = insertTx(db, OLD_URL, 'PENDING')

    expect(updateInFlightTransactionsMintUrl(db, OLD_URL, NEW_URL)).toBe(1)
    expect(updateInFlightTransactionsMintUrl(db, OLD_URL, NEW_URL)).toBe(0)
    expect(mintOf(db, pending)).toBe(NEW_URL)
    db.close()
  })

  test('a second rename chains correctly (A -> B -> C)', () => {
    const db = freshDb()
    const pending = insertTx(db, OLD_URL, 'PENDING')
    const completed = insertTx(db, OLD_URL, 'COMPLETED')

    updateInFlightTransactionsMintUrl(db, OLD_URL, NEW_URL)
    updateInFlightTransactionsMintUrl(db, NEW_URL, OTHER_URL)

    expect(mintOf(db, pending)).toBe(OTHER_URL)
    // Still frozen at the url its payment actually used, two renames later.
    expect(mintOf(db, completed)).toBe(OLD_URL)
    db.close()
  })

  test('the in-flight set matches TransactionStates exactly', () => {
    // Pins the classification itself: a status moved between the sets, or a new
    // one added to neither, changes whether a rename repoints that transaction.
    expect([...IN_FLIGHT].sort()).toEqual([
      'DRAFT',
      'EXECUTING',
      'PENDING',
      'PREPARED',
      'PREPARED_OFFLINE',
      'ROLLING_BACK',
    ])
  })

  test('every status is classified as either live or historical', () => {
    // TERMINAL is derived as the complement, so this asserts the enum has not
    // grown a member that silently falls into "historical" without anyone
    // deciding that is right for it.
    expect([...IN_FLIGHT, ...TERMINAL].sort()).toEqual(Object.values(TransactionStatus).sort())
    expect(TERMINAL.sort()).toEqual([
      'BLOCKED',
      'COMPLETED',
      'ERROR',
      'EXPIRED',
      'RECOVERED',
      'REVERTED',
    ])
  })
})
