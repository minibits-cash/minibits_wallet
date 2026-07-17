/**
 * Derivation counters (mint_counters), against the REAL repo and a real database.
 *
 * The counter is the NUT-13 derivation high-water mark for a keyset. Its single
 * most important invariant is that it is MONOTONIC — a stored counter can never
 * move backward — because a regression would let the next derivation reuse a
 * blinded secret the mint has already signed.
 *
 * Rows are keyed by keysetId ALONE: NUT-13 derives from (seed, keysetId, counter)
 * with no mint component, so one keyset id means one derivation sequence no matter
 * which url served it. See MINT_COUNTERS_COLUMNS.
 *
 * This suite calls the production `Database.*` functions. It used to hand-copy both
 * the schema and each statement, and those copies drifted from production while
 * staying green — including asserting the OLD (mintUrl, keysetId) key long after it
 * was gone. The op-sqlite jest mock now backs the real driver seam with node:sqlite,
 * so there is nothing left to copy: connection.ts, instance.ts (schema + the real
 * migration runner) and the repos all run for real.
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {Database} from '../src/services/db'
import {_dbVersion} from '../src/services/db/migrations'

const MINT = 'https://mint.test'

/**
 * One in-memory database per test FILE (instance.ts caches its connection), so
 * clear the tables between tests rather than rebuilding.
 */
beforeEach(() => {
  Database.getInstance().executeBatch([
    ['DELETE FROM mint_counters'],
    ['DELETE FROM proofs'],
    ['DELETE FROM reservations'],
    ['DELETE FROM transactions'],
  ])
})

const counterOf = (keysetId: string) => Database.getCounter(keysetId)?.counter

const insertProof = (secret: string, amount: number, tId = 1, state: 'UNSPENT' | 'PENDING' = 'UNSPENT') =>
  Database.addOrUpdateProofs(
    [{id: 'keyset1', amount, secret, C: 'C' + secret, mintUrl: MINT, unit: 'sat', tId} as any],
    state,
  )

const proofStateOf = (secret: string): string | undefined =>
  Database.getInstance().execute('SELECT state FROM proofs WHERE secret = ?', [secret]).rows?.item(0)
    ?.state

describe('Derivation counters (mint_counters)', () => {
  test('the database is at the current schema version', () => {
    // Guards the whole suite: these run against instance.ts's real schema + the
    // real migration registry, so a version mismatch means the rest is testing
    // something other than production.
    expect(Database.getDatabaseVersion(Database.getInstance()).version).toBe(_dbVersion)
  })

  describe('setCounter — monotonic', () => {
    test('inserts a new row when none exists', () => {
      Database.setCounter('k1', 'sat', 42)
      expect(counterOf('k1')).toBe(42)
    })

    test('raises to a higher value', () => {
      Database.setCounter('k1', 'sat', 100)
      Database.setCounter('k1', 'sat', 150)
      expect(counterOf('k1')).toBe(150)
    })

    test('NEVER lowers — a smaller value is ignored (the core safety invariant)', () => {
      Database.setCounter('k1', 'sat', 100)
      Database.setCounter('k1', 'sat', 50) // stale / replayed writer
      expect(counterOf('k1')).toBe(100)
    })

    test('an equal value is a no-op', () => {
      Database.setCounter('k1', 'sat', 100)
      Database.setCounter('k1', 'sat', 100)
      expect(counterOf('k1')).toBe(100)
    })
  })

  describe('bumpCounter — relative advance', () => {
    test('inserts from 0 when no row exists', () => {
      Database.bumpCounter('k1', 'sat', 10)
      expect(counterOf('k1')).toBe(10)
    })

    test('adds to the existing value', () => {
      Database.setCounter('k1', 'sat', 100)
      Database.bumpCounter('k1', 'sat', 10)
      expect(counterOf('k1')).toBe(110)
    })

    test('a non-positive delta is a no-op', () => {
      Database.setCounter('k1', 'sat', 100)
      Database.bumpCounter('k1', 'sat', 0)
      Database.bumpCounter('k1', 'sat', -5)
      expect(counterOf('k1')).toBe(100)
    })
  })

  describe('primary key — one keyset, one counter', () => {
    test('different keysets are independent', () => {
      Database.setCounter('k1', 'sat', 100)
      Database.setCounter('k2', 'sat', 7)
      expect(counterOf('k1')).toBe(100)
      expect(counterOf('k2')).toBe(7)
      expect(Database.getCounters()).toHaveLength(2)
    })

    // The inverse of this used to be asserted (and implemented): a
    // (mintUrl, keysetId) key let ONE keyset carry two counters. Both drove the
    // same derivation path, so the lower one handed out indices the mint had
    // already signed against the higher.
    test('one keyset id has exactly ONE counter, whatever mint served it', () => {
      Database.setCounter('k1', 'sat', 100)
      Database.setCounter('k1', 'sat', 5) // same keyset seen via another url
      expect(counterOf('k1')).toBe(100) // monotonic, not a second row
      expect(Database.getCounters()).toHaveLength(1)
    })

    test('getCounter returns undefined for an unknown keyset', () => {
      expect(Database.getCounter('nope')).toBeUndefined()
    })
  })

  describe('seedCounters — one-time MST/MMKV copy', () => {
    test('seeds every supplied counter', () => {
      Database.seedCounters([
        {keysetId: 'k1', unit: 'sat', counter: 100},
        {keysetId: 'k2', unit: 'sat', counter: 50},
      ])
      expect(counterOf('k1')).toBe(100)
      expect(counterOf('k2')).toBe(50)
    })

    test('is idempotent — re-running never lowers an advanced counter', () => {
      Database.seedCounters([{keysetId: 'k1', unit: 'sat', counter: 100}])
      Database.setCounter('k1', 'sat', 175) // wallet advances during normal use
      Database.seedCounters([{keysetId: 'k1', unit: 'sat', counter: 100}]) // stale re-run
      expect(counterOf('k1')).toBe(175)
    })

    test('a too-high seed is kept (conservative-safe: skips indices, never reuses)', () => {
      Database.setCounter('k1', 'sat', 100)
      Database.seedCounters([{keysetId: 'k1', unit: 'sat', counter: 9999}])
      expect(counterOf('k1')).toBe(9999)
    })

    test('an empty seed is a no-op', () => {
      expect(Database.seedCounters([])).toEqual({seeded: 0})
    })
  })

  describe('atomic commit (counterUpdate folded into commitReservation)', () => {
    const openReservation = (id: string, transactionId: number) =>
      Database.openReservation(
        {id, transactionId, mintId: 'mint1', mintUrl: MINT, unit: 'sat', operationType: 'send', lockedProofs: []},
        [],
      )

    test('persists the counter in the SAME txn as the new proofs', () => {
      Database.setCounter('k1', 'sat', 100)
      openReservation('res-1', 1)

      Database.commitReservation('res-1', {
        newProofs: [
          {
            proofs: [{id: 'keyset1', amount: 50, secret: 'new1', C: 'C'} as any],
            state: 'UNSPENT',
            mintUrl: MINT,
            unit: 'sat',
            tId: 1,
          },
        ],
        counterUpdate: [{keysetId: 'k1', unit: 'sat', counter: 110}],
      })

      expect(proofStateOf('new1')).toBe('UNSPENT')
      expect(counterOf('k1')).toBe(110)
      // Committing also clears the reservation row.
      expect(Database.getOpenReservations()).toHaveLength(0)
    })

    test('counterUpdate stays monotonic inside the commit batch', () => {
      Database.setCounter('k1', 'sat', 200)
      openReservation('res-2', 2)

      // A commit carrying a stale (lower) counter must not regress it.
      Database.commitReservation('res-2', {
        newProofs: [
          {
            proofs: [{id: 'keyset1', amount: 10, secret: 'new2', C: 'C'} as any],
            state: 'UNSPENT',
            mintUrl: MINT,
            unit: 'sat',
            tId: 2,
          },
        ],
        counterUpdate: [{keysetId: 'k1', unit: 'sat', counter: 150}],
      })

      expect(proofStateOf('new2')).toBe('UNSPENT')
      expect(counterOf('k1')).toBe(200)
    })

    test('a failing commit rolls back BOTH the proofs and the counter', () => {
      Database.setCounter('k1', 'sat', 100)
      openReservation('res-3', 3)

      // A non-finite amount is rejected by connection.ts's param sanitizing, mid
      // batch — after the counter upsert has already run inside the transaction.
      expect(() =>
        Database.commitReservation('res-3', {
          newProofs: [
            {
              proofs: [{id: 'keyset1', amount: Number.NaN, secret: 'bad', C: 'C'} as any],
              state: 'UNSPENT',
              mintUrl: MINT,
              unit: 'sat',
              tId: 3,
            },
          ],
          counterUpdate: [{keysetId: 'k1', unit: 'sat', counter: 110}],
        }),
      ).toThrow()

      // All-or-nothing: no proof, no counter advance, and the reservation stands.
      expect(proofStateOf('bad')).toBeUndefined()
      expect(counterOf('k1')).toBe(100)
      expect(Database.getOpenReservations()).toHaveLength(1)
    })
  })
})
