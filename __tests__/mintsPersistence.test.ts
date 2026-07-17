/**
 * Mint persistence through the MST layer: the per-mint observer, the startup
 * hydrate, and the snapshot strip.
 *
 * SQLite is the authority for mints; the model is the in-memory cache the UI
 * observes. Rather than a write-through in each of ~20 Mint mutators — where
 * forgetting one is silent staleness — each mint carries one onSnapshot observer.
 * These tests pin the parts of that arrangement which are easy to get subtly wrong:
 * WHEN observers attach, that loading does not write back, and that a mint stripped
 * from the snapshot still survives a restart.
 */
jest.mock('../src/services/nostrService', () => ({
  // cashuUtils -> nostrService -> minibitsService -> models is an import CYCLE.
  NostrClient: {getFirstTagValue: jest.fn()},
}))
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {types, getSnapshot} from 'mobx-state-tree'
import {MintsStoreModel} from '../src/models/MintsStore'
import {ProofsStoreModel} from '../src/models/ProofsStore'
import {Database} from '../src/services/db'
import {ProofModel} from '../src/models/Proof'

// A minimal root: the real RootStore additionally pulls AuthStore/NwcStore/
// WalletProfileStore and, through them, the whole service layer. getRootStore only
// needs the root to expose the stores actually used.
const TestRoot = types.model('RootStore', {
  mintsStore: types.optional(MintsStoreModel, {}),
  proofsStore: types.optional(ProofsStoreModel, {}),
})

const MINT_URL = 'https://mint.test'

// Real-shaped keyset ids ('00' + 14 hex). Placeholders like 'k1' are not hex, so
// isCollidingKeysetId reads them as legacy base64 ids and they alias onto the same
// derivation index — the wallet would reject the second as a collision.
const KEYSET_1 = '009a1f293253e41e'
const KEYSET_2 = '00ad268c4d1f5826'

const mintSnapshot = (overrides: Record<string, any> = {}) => ({
  id: 'mint1111',
  mintUrl: MINT_URL,
  hostname: 'mint.test',
  shortname: 'Test Mint',
  units: ['sat'],
  keysets: [{id: KEYSET_1, unit: 'sat', active: true, input_fee_ppk: 0}],
  keys: [{id: KEYSET_1, unit: 'sat', keys: {'1': '02aa'}}],
  // Every keyset has a counter shell in production (initKeyset creates it, and
  // hydrateMintsFromDatabase rebuilds it). The values themselves are volatile and come
  // from mint_counters.
  proofsCounters: [{keyset: KEYSET_1, unit: 'sat'}],
  color: '#abcdef',
  status: 'ONLINE',
  ...overrides,
})

const makeRoot = (mints: any[] = []) => TestRoot.create({mintsStore: {mints}, proofsStore: {}})

const storedMintUrls = () => Database.getMints().map(m => m.mintUrl)

beforeEach(() => {
  Database.getInstance().executeBatch([
    ['DELETE FROM mints'],
    ['DELETE FROM mint_keysets'],
    ['DELETE FROM proofs'],
    ['DELETE FROM mint_counters'],
  ])
})

describe('mint persistence', () => {
  describe('the snapshot no longer carries mints', () => {
    // The reason for the whole move: mints (with every keyset's keys map) were the
    // largest thing left in the persisted tree, and JSON.stringify(snapshot) runs
    // on EVERY MST action anywhere — including every proof mutation during a send.
    test('getSnapshot reports no mints, whatever the store holds', () => {
      const root = makeRoot([mintSnapshot()])

      expect(root.mintsStore.mints).toHaveLength(1) // live
      expect(getSnapshot(root.mintsStore).mints).toEqual([]) // persisted
    })

    test('but blockedMintUrls IS still persisted there', () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.blockMint(root.mintsStore.mints[0] as any)

      expect(getSnapshot(root.mintsStore).blockedMintUrls).toEqual([MINT_URL])
    })
  })

  describe('the observer', () => {
    test('persists a mint mutation without any explicit write', () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.persistAllMints()
      root.mintsStore.observeMints()

      root.mintsStore.mints[0].setProp('shortname', 'Renamed')

      expect(Database.getMints()[0].shortname).toBe('Renamed')
    })

    test('persists a keyset added later', () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.persistAllMints()
      root.mintsStore.observeMints()

      root.mintsStore.mints[0].initKeyset({id: KEYSET_2, unit: 'sat', active: true} as any, [KEYSET_1])

      expect(Database.getMints()[0].keysets.map(k => k.id).sort()).toEqual([KEYSET_1, KEYSET_2].sort())
    })

    test('stops persisting a mint once it is removed', () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.persistAllMints()
      root.mintsStore.observeMints()

      root.mintsStore.removeMint(root.mintsStore.mints[0] as any)

      expect(Database.getMints()).toEqual([])
    })

    // A counter bump must not churn the mint row: `counter` is volatile, so it never
    // reaches a snapshot and cannot fire the observer at all.
    test('a derivation-counter bump does not touch the mint row', () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.persistAllMints()
      root.mintsStore.observeMints()

      const before = Database.getMints()[0]
      root.mintsStore.mints[0].proofsCounters[0].increaseProofsCounter(5)

      expect(Database.getMints()[0]).toEqual(before)
    })
  })

  describe('hydrateMintsFromDatabase', () => {
    test('hydrates the mints back, keysets and keys included', () => {
      const seeded = makeRoot([mintSnapshot()])
      seeded.mintsStore.persistAllMints()

      // A fresh tree, as on the next launch: the snapshot carries no mints.
      const restarted = makeRoot([])
      expect(restarted.mintsStore.mints).toHaveLength(0)

      restarted.mintsStore.hydrateMintsFromDatabase()

      const mint = restarted.mintsStore.mints[0]
      expect(mint.mintUrl).toBe(MINT_URL)
      expect(mint.shortname).toBe('Test Mint')
      expect(mint.keysets.map(k => k.id)).toEqual([KEYSET_1])
      expect(mint.keys.map(k => k.id)).toEqual([KEYSET_1])
    })

    // The launch that migrates: the table is empty and the mints still come from the
    // MMKV snapshot. Wiping them here would delete the user's mints.
    test('never wipes what the snapshot restored when the table is empty', () => {
      const root = makeRoot([mintSnapshot()])

      root.mintsStore.hydrateMintsFromDatabase()

      expect(root.mintsStore.mints).toHaveLength(1)
      expect(root.mintsStore.mints[0].mintUrl).toBe(MINT_URL)
    })

    // THE data-loss path, seen on a real device. rootStore.version defaults to the
    // CURRENT rootStoreModelVersion, so a factory reset stamps a wallet as fully
    // migrated on the spot; restore an older snapshot over that and a version-gated
    // seed never runs. Meanwhile postProcessSnapshot strips mints from every save —
    // so unless this converges on the DATA, the mints are in neither place and are
    // gone on the next launch.
    test('persists mints that exist ONLY in the snapshot, with no migration involved', () => {
      const root = makeRoot([mintSnapshot()])
      expect(Database.getMints()).toEqual([]) // table empty, as on that device

      root.mintsStore.hydrateMintsFromDatabase()

      // Written through purely because the data said so.
      expect(Database.getMints().map(m => m.mintUrl)).toEqual([MINT_URL])
    })

    test('and those mints then survive a restart', () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.hydrateMintsFromDatabase()

      // The next launch: the snapshot no longer carries mints at all.
      const restarted = makeRoot([])
      restarted.mintsStore.hydrateMintsFromDatabase()

      expect(restarted.mintsStore.mints.map(m => m.mintUrl)).toEqual([MINT_URL])
    })

    test('observes the snapshot-only mints too, so later edits persist', () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.hydrateMintsFromDatabase()

      root.mintsStore.mints[0].setProp('shortname', 'Renamed')

      expect(Database.getMints()[0].shortname).toBe('Renamed')
    })

    test('does nothing when there are no mints anywhere (a fresh wallet)', () => {
      const root = makeRoot([])
      root.mintsStore.hydrateMintsFromDatabase()

      expect(root.mintsStore.mints).toHaveLength(0)
      expect(Database.getMints()).toEqual([])
    })

    // THE fund-loss path, and the reason hydrateMintsFromDatabase rebuilds the counter
    // shells by hand. Loading bypasses initKeyset, which is what normally creates
    // them. With no shell, hydrateCountersFromDatabase has nothing to fill, the
    // counter is later created on demand at 0, and derivation re-issues blinded
    // secrets the mint has already signed.
    test('rebuilds a counter shell per keyset, so the real index can hydrate', () => {
      const seeded = makeRoot([mintSnapshot()])
      seeded.mintsStore.persistAllMints()
      Database.setCounter(KEYSET_1, 'sat', 342)

      const restarted = makeRoot([])
      restarted.mintsStore.hydrateMintsFromDatabase()

      // The shell must exist for the keyset...
      expect(restarted.mintsStore.mints[0].proofsCounters.map(c => c.keyset)).toEqual([KEYSET_1])

      // ...so that the authority's value lands on it, rather than the counter being
      // recreated at 0 on first use.
      restarted.mintsStore.hydrateCountersFromDatabase()
      expect(restarted.mintsStore.mints[0].proofsCounters[0].counter).toBe(342)
    })

    test('rebuilds a shell for EVERY keyset, not just the first', () => {
      const seeded = makeRoot([
        mintSnapshot({
          keysets: [
            {id: KEYSET_1, unit: 'sat', active: true},
            {id: KEYSET_2, unit: 'sat', active: false},
          ],
          proofsCounters: [
            {keyset: KEYSET_1, unit: 'sat'},
            {keyset: KEYSET_2, unit: 'sat'},
          ],
        }),
      ])
      seeded.mintsStore.persistAllMints()
      Database.setCounter(KEYSET_2, 'sat', 77)

      const restarted = makeRoot([])
      restarted.mintsStore.hydrateMintsFromDatabase()
      restarted.mintsStore.hydrateCountersFromDatabase()

      const counters = restarted.mintsStore.mints[0].proofsCounters
      expect(counters.map(c => c.keyset).sort()).toEqual([KEYSET_1, KEYSET_2].sort())
      expect(counters.find(c => c.keyset === KEYSET_2)!.counter).toBe(77)
    })

    test('preserves the mint id, so rows referencing it still resolve', () => {
      const seeded = makeRoot([mintSnapshot()])
      seeded.mintsStore.persistAllMints()

      const restarted = makeRoot([])
      restarted.mintsStore.hydrateMintsFromDatabase()

      // onchain quotes, reservations and transactions all point at Mint.id.
      expect(restarted.mintsStore.findById('mint1111')).toBeDefined()
    })
  })

  describe('the rename, end to end', () => {
    test('moves the mint and its proofs, in memory and on disk', async () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.persistAllMints()
      root.mintsStore.observeMints()

      Database.addOrUpdateProofs(
        [
          ProofModel.create({
            id: KEYSET_1,
            amount: 10,
            secret: 's1',
            C: 'C',
            unit: 'sat',
            tId: 1,
            mintUrl: MINT_URL,
          }) as any,
        ],
        'UNSPENT',
      )
      await root.proofsStore.loadProofsFromDatabase()

      root.mintsStore.mints[0].setMintUrl!('https://moved.test')

      // Model
      expect(root.mintsStore.mints[0].mintUrl).toBe('https://moved.test')
      expect(root.mintsStore.mints[0].hostname).toBe('moved.test')
      expect(root.proofsStore.getBySecret('s1')!.mintUrl).toBe('https://moved.test')
      // Database
      expect(storedMintUrls()).toEqual(['https://moved.test'])

      // And the balance still finds the money — the failure this whole change is
      // about is proofs left owned by no mint.
      expect(root.proofsStore.findOrphanedProofs()).toEqual([])
      expect(root.proofsStore.balances.mintBalances[0].balances.sat).toBe(10)
    })

    test('a rename survives a restart', () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.persistAllMints()
      root.mintsStore.observeMints()

      root.mintsStore.mints[0].setMintUrl!('https://moved.test')

      const restarted = makeRoot([])
      restarted.mintsStore.hydrateMintsFromDatabase()

      expect(restarted.mintsStore.mints[0].mintUrl).toBe('https://moved.test')
    })
  })

  describe('the backup payload — the trap that loses data silently', () => {
    // getSnapshot(mintsStore).mints is ALWAYS empty now. A backup built from the
    // store snapshot would contain zero mints, raise no error, and only reveal the
    // loss on restore. This is why the export lives on the store behind a test
    // rather than inline in the screen.
    test('contains the mints, unlike the store snapshot', () => {
      const root = makeRoot([mintSnapshot()])

      expect(getSnapshot(root.mintsStore).mints).toEqual([]) // the trap
      expect(root.mintsStore.backupSnapshot.mints).toHaveLength(1) // the fix
      expect(root.mintsStore.backupSnapshot.mints[0].mintUrl).toBe(MINT_URL)
    })

    test('carries the keysets, which the recovered wallet needs', () => {
      const root = makeRoot([mintSnapshot()])
      expect(root.mintsStore.backupSnapshot.mints[0].keysets.map((k: any) => k.id)).toEqual([KEYSET_1])
    })

    test('drops keys — they are re-fetched from the mint on import', () => {
      const root = makeRoot([mintSnapshot()])
      expect(root.mintsStore.backupSnapshot.mints[0].keys).toEqual([])
    })

    // A backup restored with counter 0 would re-derive blinded secrets the mint has
    // already signed. `counter` is volatile, so it is absent from the snapshot and
    // has to be put back deliberately.
    test('re-injects the live derivation counter per keyset', () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.mints[0].proofsCounters[0].setProofsCounter(342)

      const [mint] = root.mintsStore.backupSnapshot.mints
      expect(mint.proofsCounters[0].counter).toBe(342)
    })

    test('carries blockedMintUrls', () => {
      const root = makeRoot([mintSnapshot()])
      root.mintsStore.blockMint(root.mintsStore.mints[0] as any)

      expect(root.mintsStore.backupSnapshot.blockedMintUrls).toEqual([MINT_URL])
    })

    test('is a plain detached copy — mutating it cannot touch the store', () => {
      const root = makeRoot([mintSnapshot()])
      const backup = root.mintsStore.backupSnapshot

      backup.mints[0].mintUrl = 'https://tampered.test'

      expect(root.mintsStore.mints[0].mintUrl).toBe(MINT_URL)
    })
  })
})
