/**
 * Mints and their keysets in SQLite (mintsRepo), against the REAL repo and a real
 * database.
 *
 * Mints were the last core entity persisted only by serializing the whole MST tree
 * to MMKV. Moving them here takes that cost off the hot path (every MST action
 * anywhere re-serialized every mint's keys) and puts them in the same engine as the
 * proofs, so a mint-url edit can finally commit atomically with the proofs it
 * renames.
 *
 * What these pin, in order of how much they would hurt to get wrong:
 *  - a mint round-trips exactly, keys included — losing keysets or keys means the
 *    wallet cannot verify or spend that mint's ecash;
 *  - the rename moves the mint AND its proofs or neither;
 *  - removal keeps the derivation counters.
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {Database} from '../src/services/db'
import type {MintRecord} from '../src/services/db'

const MINT_URL = 'https://mint.test'

const keyset = (id: string, overrides: Record<string, any> = {}) => ({
  id,
  unit: 'sat',
  active: true,
  input_fee_ppk: 0,
  ...overrides,
})

const keysFor = (id: string) => ({id, unit: 'sat', keys: {'1': '02aa', '2': '02bb'}})

const mintRecord = (overrides: Partial<MintRecord> = {}): MintRecord => ({
  id: 'mint1111',
  mintUrl: MINT_URL,
  hostname: 'mint.test',
  shortname: 'Test Mint',
  units: ['sat'],
  keysets: [keyset('k1')],
  keys: [keysFor('k1')],
  mintInfo: {name: 'Test Mint', time: 1234},
  color: '#abcdef',
  status: 'ONLINE',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const proofRow = (secret: string, mintUrl: string) =>
  Database.getInstance().execute(
    `INSERT OR REPLACE INTO proofs (id, amount, secret, C, unit, tId, mintUrl, state, updatedAt)
     VALUES ('k1', 10, ?, 'C', 'sat', 1, ?, 'UNSPENT', '2026-01-01')`,
    [secret, mintUrl],
  )

const proofMintUrl = (secret: string): string | undefined =>
  Database.getInstance().execute('SELECT mintUrl FROM proofs WHERE secret = ?', [secret]).rows?.item(0)
    ?.mintUrl

beforeEach(() => {
  Database.getInstance().executeBatch([
    ['DELETE FROM mints'],
    ['DELETE FROM mint_keysets'],
    ['DELETE FROM proofs'],
    ['DELETE FROM mint_counters'],
  ])
})

describe('mints in SQLite', () => {
  describe('round-trip', () => {
    test('a mint survives a write/read cycle intact', () => {
      const mint = mintRecord()
      Database.upsertMint(mint)

      const [loaded] = Database.getMints()
      expect(loaded).toEqual(mint)
    })

    test('preserves keyset fields the wallet does not name', () => {
      // MintKeyset carries final_expiry, which feeds NUT-02 v2 id derivation. The
      // keyset is stored as a whole JSON object precisely so fields like this are
      // not silently dropped by an enumerated column list.
      Database.upsertMint(mintRecord({keysets: [keyset('k1', {final_expiry: 1799999999})]}))

      expect(Database.getMints()[0].keysets[0]).toMatchObject({final_expiry: 1799999999})
    })

    test('carries multiple keysets and their keys', () => {
      Database.upsertMint(
        mintRecord({
          keysets: [keyset('k1'), keyset('k2', {active: false})],
          keys: [keysFor('k1'), keysFor('k2')],
        }),
      )

      const [loaded] = Database.getMints()
      expect(loaded.keysets.map(k => k.id).sort()).toEqual(['k1', 'k2'])
      expect(loaded.keys.map(k => k.id).sort()).toEqual(['k1', 'k2'])
    })

    test('a keyset whose keys were never fetched loads with no keys entry', () => {
      // keysets and keys are independent arrays in the model: the mint advertises a
      // keyset before (or without) the wallet fetching its keys.
      Database.upsertMint(mintRecord({keysets: [keyset('k1'), keyset('k2')], keys: [keysFor('k1')]}))

      const [loaded] = Database.getMints()
      expect(loaded.keysets).toHaveLength(2)
      expect(loaded.keys.map(k => k.id)).toEqual(['k1'])
    })

    test('an absent mintInfo stays absent', () => {
      Database.upsertMint(mintRecord({mintInfo: undefined}))
      expect(Database.getMints()[0].mintInfo).toBeUndefined()
    })

    test('two mints are independent', () => {
      Database.upsertMint(mintRecord())
      Database.upsertMint(
        mintRecord({id: 'mint2222', mintUrl: 'https://other.test', keysets: [keyset('k9')], keys: []}),
      )

      const loaded = Database.getMints()
      expect(loaded).toHaveLength(2)
      expect(loaded.find(m => m.id === 'mint2222')!.keysets.map(k => k.id)).toEqual(['k9'])
    })
  })

  describe('upsert', () => {
    test('is idempotent — re-writing the same mint changes nothing', () => {
      const mint = mintRecord()
      Database.upsertMint(mint)
      Database.upsertMint(mint)

      expect(Database.getMints()).toHaveLength(1)
      expect(Database.getMints()[0]).toEqual(mint)
    })

    test('updates changed fields in place', () => {
      Database.upsertMint(mintRecord())
      Database.upsertMint(mintRecord({shortname: 'Renamed', status: 'OFFLINE'}))

      const [loaded] = Database.getMints()
      expect(loaded.shortname).toBe('Renamed')
      expect(loaded.status).toBe('OFFLINE')
    })

    test('adds a newly advertised keyset without disturbing the existing ones', () => {
      Database.upsertMint(mintRecord())
      Database.upsertMint(
        mintRecord({keysets: [keyset('k1'), keyset('k2')], keys: [keysFor('k1'), keysFor('k2')]}),
      )

      expect(Database.getMints()[0].keysets.map(k => k.id).sort()).toEqual(['k1', 'k2'])
    })

    // Keys and keyset metadata are fetched from the mint separately, so a
    // metadata-only refresh must never erase keys already stored — without them the
    // wallet cannot verify or spend that keyset.
    test('a keyset refresh with no keys does NOT erase stored keys', () => {
      Database.upsertMint(mintRecord())
      expect(Database.getMints()[0].keys).toHaveLength(1)

      Database.upsertMint(mintRecord({keys: []})) // metadata-only refresh

      expect(Database.getMints()[0].keys.map(k => k.id)).toEqual(['k1'])
    })
  })

  describe('the atomic rename', () => {
    test('moves the mint AND its proofs together', () => {
      Database.upsertMint(mintRecord())
      proofRow('p1', MINT_URL)
      proofRow('p2', MINT_URL)

      Database.updateMintUrlWithProofs('mint1111', MINT_URL, 'https://moved.test', 'moved.test')

      expect(Database.getMints()[0].mintUrl).toBe('https://moved.test')
      expect(Database.getMints()[0].hostname).toBe('moved.test')
      expect(proofMintUrl('p1')).toBe('https://moved.test')
      expect(proofMintUrl('p2')).toBe('https://moved.test')
    })

    test('leaves another mint\'s proofs alone', () => {
      Database.upsertMint(mintRecord())
      proofRow('mine', MINT_URL)
      proofRow('theirs', 'https://other.test')

      Database.updateMintUrlWithProofs('mint1111', MINT_URL, 'https://moved.test', 'moved.test')

      expect(proofMintUrl('mine')).toBe('https://moved.test')
      expect(proofMintUrl('theirs')).toBe('https://other.test')
    })

    // The whole point of putting mints in the same engine as proofs. When the url
    // lived in MMKV and the proofs in SQLite, a crash between the two writes left
    // the proofs owned by no mint: the money vanished from every per-mint balance
    // while still counting in the total, and could not be spent.
    test('is all-or-nothing: a failure leaves BOTH untouched', () => {
      Database.upsertMint(mintRecord())
      proofRow('p1', MINT_URL)

      // A non-finite param is rejected by connection.ts's sanitizing, mid batch.
      expect(() =>
        Database.updateMintUrlWithProofs('mint1111', MINT_URL, Number.NaN as any, 'moved.test'),
      ).toThrow()

      expect(Database.getMints()[0].mintUrl).toBe(MINT_URL)
      expect(proofMintUrl('p1')).toBe(MINT_URL)
    })
  })

  describe('removal', () => {
    test('deletes the mint and its keysets', () => {
      Database.upsertMint(mintRecord())
      Database.removeMintById('mint1111')

      expect(Database.getMints()).toEqual([])
      const keysetCount = Database.getInstance()
        .execute('SELECT COUNT(*) AS n FROM mint_keysets')
        .rows?.item(0)?.n
      expect(keysetCount).toBe(0)
    })

    test('KEEPS the derivation counters', () => {
      // mint_counters rows are keyed by keysetId and retained across removal, so a
      // re-added mint recovers its real index instead of restarting at 0 — which
      // would reuse blinded secrets the mint has already signed.
      Database.upsertMint(mintRecord())
      Database.setCounter('k1', 'sat', 342)

      Database.removeMintById('mint1111')

      expect(Database.getCounter('k1')?.counter).toBe(342)
    })

    test('leaves other mints alone', () => {
      Database.upsertMint(mintRecord())
      Database.upsertMint(mintRecord({id: 'mint2222', mintUrl: 'https://other.test'}))

      Database.removeMintById('mint1111')

      expect(Database.getMints().map(m => m.id)).toEqual(['mint2222'])
    })
  })

  describe('seedMints — the one-time MMKV copy', () => {
    test('copies mints across', () => {
      Database.seedMints([mintRecord(), mintRecord({id: 'mint2222', mintUrl: 'https://other.test'})])
      expect(Database.getMints()).toHaveLength(2)
    })

    test('is idempotent — upserts by id, so a re-run cannot duplicate a mint', () => {
      Database.seedMints([mintRecord()])
      Database.seedMints([mintRecord()])

      expect(Database.getMints()).toHaveLength(1)
    })

    test('an empty seed is a no-op', () => {
      expect(Database.seedMints([])).toEqual({seeded: 0})
    })
  })
})
