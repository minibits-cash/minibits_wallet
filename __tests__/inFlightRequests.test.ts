/**
 * In-flight requests (inflight_requests), against the REAL repo and a real database.
 *
 * Per-transaction request params for an operation that has reached the mint but
 * whose response may be lost. Written before the network call so the op can be
 * retried against the mint's idempotent (NUT-19) endpoint.
 *
 * The table is a CHILD of the transaction — its primary key IS transactionId — so
 * it carries no mint reference. It once duplicated mintUrl and keysetId; keysetId
 * had no reader at all, and mintUrl served exactly one query ("every request of
 * this mint"), which now JOINs through the parent's mintId. One owner of the fact,
 * so nothing here can go stale when a mint moves.
 *
 * Calls the production `Database.*` functions rather than mirroring their SQL — the
 * op-sqlite jest mock backs the real driver seam with node:sqlite. That matters most
 * for the join: a hand-copied version proves nothing about the query the app runs.
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {Database} from '../src/services/db'

const MINT = 'https://mint.test'
const MINT_ID = 'mint1111'
const OTHER_MINT_ID = 'mint9999'

/** The parent row the join reaches through. */
const addTransaction = (id: number, mintId: string | null) =>
  Database.getInstance().execute(
    `INSERT OR REPLACE INTO transactions (id, type, amount, unit, data, mint, mintId, status, createdAt)
     VALUES (?, 'TOPUP', 100, 'sat', '{}', ?, ?, 'PENDING', '2026-01-01')`,
    [id, MINT, mintId],
  )

beforeEach(() => {
  Database.getInstance().executeBatch([['DELETE FROM inflight_requests'], ['DELETE FROM transactions']])
})

describe('In-flight requests (inflight_requests)', () => {
  test('stores and reads back a request (JSON round-trip)', () => {
    const request = {token: 'cashuA...', options: {keysetId: 'k1'}}
    addTransaction(101, MINT_ID)
    Database.addInFlightRequest(101, request)

    const rec = Database.getInFlightRequest(101)!
    expect(rec.transactionId).toBe(101)
    expect(rec.request).toEqual(request)
  })

  test('returns undefined when no entry exists', () => {
    expect(Database.getInFlightRequest(999)).toBeUndefined()
  })

  test('add OVERWRITES an existing entry (set semantics)', () => {
    addTransaction(101, MINT_ID)
    Database.addInFlightRequest(101, {v: 'first'})
    Database.addInFlightRequest(101, {v: 'second'})

    expect(Database.getInFlightRequest(101)!.request).toEqual({v: 'second'})
  })

  test('remove deletes the entry', () => {
    addTransaction(101, MINT_ID)
    Database.addInFlightRequest(101, {v: 1})
    Database.removeInFlightRequest(101)

    expect(Database.getInFlightRequest(101)).toBeUndefined()
    expect(Database.getInFlightRequestsByMintId(MINT_ID)).toHaveLength(0)
  })

  describe('getInFlightRequestsByMintId — the per-mint recovery sweep', () => {
    test('returns all rows of a mint, and only that mint', () => {
      addTransaction(101, MINT_ID)
      addTransaction(102, MINT_ID)
      addTransaction(103, OTHER_MINT_ID)
      Database.addInFlightRequest(101, {v: 1})
      Database.addInFlightRequest(102, {v: 2})
      Database.addInFlightRequest(103, {v: 3})

      expect(
        Database.getInFlightRequestsByMintId(MINT_ID)
          .map(r => r.transactionId)
          .sort(),
      ).toEqual([101, 102])
      expect(Database.getInFlightRequestsByMintId(OTHER_MINT_ID)).toHaveLength(1)
    })

    // The point of joining on mintId rather than a url copy: a mint moving must
    // never hide its own in-flight work. transactions.mint stays frozen as history;
    // only the mint's live url moves, and the id is unaffected.
    test("still finds a mint's requests regardless of the url on the transaction", () => {
      addTransaction(101, MINT_ID)
      Database.addInFlightRequest(101, {v: 1})

      Database.getInstance().execute('UPDATE transactions SET mint = ? WHERE id = ?', [
        'https://some-other.url',
        101,
      ])

      expect(Database.getInFlightRequestsByMintId(MINT_ID)).toHaveLength(1)
    })

    // Correct, not a regression: the retry settles proofs onto its transaction and
    // the handler branches on tx.type, so without the parent there is nothing to
    // apply the result to.
    test('a request whose transaction is gone is not returned', () => {
      addTransaction(101, MINT_ID)
      Database.addInFlightRequest(101, {v: 1})
      Database.getInstance().execute('DELETE FROM transactions WHERE id = ?', [101])

      expect(Database.getInFlightRequestsByMintId(MINT_ID)).toHaveLength(0)
    })

    test('a transaction with no mintId is not returned', () => {
      addTransaction(101, null)
      Database.addInFlightRequest(101, {v: 1})

      expect(Database.getInFlightRequestsByMintId(MINT_ID)).toHaveLength(0)
    })
  })

  describe('seedInFlightRequests — one-time MST/MMKV copy', () => {
    test('is idempotent — does not overwrite an existing entry', () => {
      addTransaction(101, MINT_ID)
      Database.addInFlightRequest(101, {v: 'live'})
      Database.seedInFlightRequests([{transactionId: 101, request: {v: 'snapshot'}}])

      expect(Database.getInFlightRequest(101)!.request).toEqual({v: 'live'})
    })

    test('an empty seed is a no-op', () => {
      expect(Database.seedInFlightRequests([])).toEqual({seeded: 0})
    })
  })
})
