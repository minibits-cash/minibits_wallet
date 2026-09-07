/**
 * Backup export -> import, at the model layer.
 *
 * The screens are thin: ExportBackupScreen serializes `mintsStore.backupSnapshot`
 * plus the live proofs, and ImportBackupScreen feeds the decoded JSON back through
 * `restoreFromBackup` / `importProofs` / `importPendingByMintSecrets`. Everything
 * that can silently destroy a wallet on restore lives on this side of that line,
 * which is why the round trip is pinned here.
 *
 * Each of these covers a way import actually broke on a user's device:
 *  - a backup taken while a payment was pending at the mint threw mid-import,
 *  - importing over an onboarded wallet left the same mint in SQLite twice, one
 *    copy stripped of its keysets.
 */
jest.mock('../src/services/nostrService', () => ({
  // cashuUtils -> nostrService -> minibitsService -> models is an import CYCLE.
  NostrClient: {getFirstTagValue: jest.fn()},
}))
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {mnemonicToSeedSync} from '@scure/bip39'
import {types, getSnapshot, applySnapshot} from 'mobx-state-tree'
import {encodeBackup, decodeBackup} from '../src/services/backup/backupCodec'
import {MintsStoreModel, MintsStoreSnapshot} from '../src/models/MintsStore'
import {ProofsStoreModel} from '../src/models/ProofsStore'
import {ContactsStoreModel} from '../src/models/ContactsStore'
import {Database, CounterSeed} from '../src/services/db'

const TestRoot = types.model('RootStore', {
  mintsStore: types.optional(MintsStoreModel, {}),
  proofsStore: types.optional(ProofsStoreModel, {}),
  contactsStore: types.optional(ContactsStoreModel, {}),
})

// The wallet's own seed: the export encrypts to it, the import types it back in.
const SEED = mnemonicToSeedSync(
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
)

const MINT_URL = 'https://mint.test'
const OTHER_MINT_URL = 'https://other.test'

// Real-shaped keyset ids ('00' + 14 hex): a placeholder like 'k1' is not hex, so
// isCollidingKeysetId reads it as a legacy base64 id.
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
  proofsCounters: [{keyset: KEYSET_1, unit: 'sat'}],
  color: '#abcdef',
  status: 'ONLINE',
  ...overrides,
})

const proofSnapshot = (secret: string, state: string = 'UNSPENT') => ({
  id: KEYSET_1,
  amount: 2,
  secret,
  C: '02bb',
  unit: 'sat',
  tId: 1,
  mintUrl: MINT_URL,
  state,
})

/**
 * What ExportBackupScreen.copyBackup hands to the share sheet — through the real
 * envelope, so these tests cover the whole path a backup actually travels rather
 * than a JSON stand-in for it.
 */
const exportBackup = (root: Instance) =>
  encodeBackup(
    {
      proofsStore: {
        // The store snapshot is emptied in postProcessSnapshot — the live map is
        // the only place the proofs exist.
        proofs: Array.from(root.proofsStore.proofs.values()),
        pendingByMintSecrets: getSnapshot(root.proofsStore.pendingByMintSecrets),
      },
      mintsStore: root.mintsStore.backupSnapshot,
      contactsStore: getSnapshot(root.contactsStore),
    },
    SEED,
  )

/**
 * What ImportBackupScreen.importWallet does with the decoded payload.
 *
 * `keysByMintUrl` stands in for the screen's per-mint `getKeys()` call: the backup
 * carries no keys, so it re-fetches them and pushes them into the decoded JSON
 * before any of it is applied. A mint missing from the map is one the screen could
 * not reach — it imports without keys rather than failing the whole restore.
 */
const importBackup = (root: Instance, encoded: string, keysByMintUrl: Record<string, any[]> = {}) => {
  const backup: any = decodeBackup(encoded, SEED)

  for (const mint of backup.mintsStore.mints ?? []) {
    for (const keys of keysByMintUrl[mint.mintUrl] ?? []) mint.keys.push(keys)
  }

  root.proofsStore.importProofs(backup.proofsStore.proofs)
  root.proofsStore.importPendingByMintSecrets(backup.proofsStore.pendingByMintSecrets)
  root.mintsStore.restoreFromBackup(backup.mintsStore as MintsStoreSnapshot)
  applySnapshot(root.contactsStore, backup.contactsStore)

  // The counters ride in the backup's raw JSON (they are volatile in the model),
  // seed the SQLite authority, and are read back from it.
  const counterSeeds: CounterSeed[] = []
  for (const mint of backup.mintsStore?.mints ?? []) {
    for (const pc of mint?.proofsCounters ?? []) {
      if (pc?.keyset && typeof pc.counter === 'number' && pc.counter > 0) {
        counterSeeds.push({keysetId: pc.keyset, unit: pc.unit, counter: pc.counter})
      }
    }
  }
  if (counterSeeds.length > 0) Database.seedCounters(counterSeeds)
  root.mintsStore.hydrateCountersFromDatabase()

  if (root.proofsStore.proofsCount > 0) {
    Database.addOrUpdateProofs(root.proofsStore.allProofs, 'UNSPENT')
  }
  if (root.proofsStore.pendingProofsCount > 0) {
    Database.addOrUpdateProofs(root.proofsStore.allPendingProofs, 'PENDING')
  }
}

// The store instances are structurally typed here; the models' own Instance types
// would drag the whole root store in for no gain.
type Instance = any

beforeEach(() => {
  Database.getInstance().executeBatch([
    ['DELETE FROM mints'],
    ['DELETE FROM mint_keysets'],
    ['DELETE FROM proofs'],
    ['DELETE FROM mint_counters'],
  ])
})

describe('backup round trip', () => {
  test('mints, proofs, counters and the pending registry all come back', () => {
    const source = TestRoot.create({
      mintsStore: {mints: [mintSnapshot()]},
      proofsStore: {
        proofs: {s1: proofSnapshot('s1'), s2: proofSnapshot('s2', 'PENDING')},
        pendingByMintSecrets: ['s2'],
      } as any,
    })
    source.mintsStore.mints[0].proofsCounters[0].increaseProofsCounter(7)

    const backup = exportBackup(source)

    // A fresh wallet on another device.
    Database.getInstance().executeBatch([['DELETE FROM mints'], ['DELETE FROM mint_keysets'], ['DELETE FROM mint_counters']])
    const target = TestRoot.create({})
    importBackup(target, backup)

    expect(target.mintsStore.mints.map((m: any) => m.mintUrl)).toEqual([MINT_URL])
    expect(target.proofsStore.proofs.size).toBe(2)
    expect(target.proofsStore.proofsCount).toBe(1)
    expect(target.proofsStore.pendingProofsCount).toBe(1)
    // The mint-pending registry used to throw here: the import pushed onto the
    // protected array from outside an action, aborting the whole restore.
    expect([...target.proofsStore.pendingByMintSecrets]).toEqual(['s2'])
  })

  // NUT-13 derives from (seed, keysetId, counter). A restore that reset the
  // counter to 0 would re-derive blinded secrets the mint has already signed.
  test('the derivation counter survives, through SQLite', () => {
    const source = TestRoot.create({mintsStore: {mints: [mintSnapshot()]}})
    source.mintsStore.mints[0].proofsCounters[0].increaseProofsCounter(42)

    const backup = exportBackup(source)
    expect((decodeBackup(backup, SEED) as any).mintsStore.mints[0].proofsCounters[0].counter).toBe(42)

    Database.getInstance().executeBatch([['DELETE FROM mint_counters']])
    const target = TestRoot.create({})
    importBackup(target, backup)

    expect(target.mintsStore.mints[0].proofsCounters[0].counter).toBe(42)
    expect(Database.getCounters().find(c => c.keysetId === KEYSET_1)?.counter).toBe(42)
  })

  // What the screen's best-effort key fetch relies on. A mint that is dead,
  // moved, or merely offline at import time used to throw out of the whole
  // restore; now it comes back with its keysets and no keys, and the wallet
  // fetches those on first use.
  test('a mint whose keys could not be fetched still restores', () => {
    const source = TestRoot.create({mintsStore: {mints: [mintSnapshot()]}})

    const target = TestRoot.create({})
    importBackup(target, exportBackup(source)) // no keys supplied for any mint

    const restarted = TestRoot.create({})
    restarted.mintsStore.hydrateMintsFromDatabase()

    expect(restarted.mintsStore.mints.map((m: any) => m.mintUrl)).toEqual([MINT_URL])
    expect(restarted.mintsStore.mints[0].keysets.map((k: any) => k.id)).toEqual([KEYSET_1])
    expect(restarted.mintsStore.mints[0].keys).toHaveLength(0)
    // The counter shells still exist, so a hydrate can fill the real indices in.
    expect(restarted.mintsStore.mints[0].proofsCounters.map((c: any) => c.keyset)).toEqual([KEYSET_1])
  })

  test('the restored proofs are in the database, under the right state', () => {
    const source = TestRoot.create({
      proofsStore: {proofs: {s1: proofSnapshot('s1'), s2: proofSnapshot('s2', 'PENDING')}} as any,
      mintsStore: {mints: [mintSnapshot()]},
    })

    const target = TestRoot.create({})
    importBackup(target, exportBackup(source))

    const stored = Database.getInstance().execute(`SELECT secret, state FROM proofs ORDER BY secret`)
    expect(stored.rows?._array).toEqual([
      {secret: 's1', state: 'UNSPENT'},
      {secret: 's2', state: 'PENDING'},
    ])
  })
})

describe('importing over an existing wallet', () => {
  // Onboarding adds the Minibits mint before the user can ever reach the import
  // screen, so the wallet ALWAYS has a mint here — and the backup's copy of that
  // same mint carries a different local id.
  const onboardedWallet = () => {
    const root = TestRoot.create({mintsStore: {mints: [mintSnapshot({id: 'onboard1'})]}})
    root.mintsStore.persistAllMints()
    root.mintsStore.observeMints()
    return root
  }

  test('the same mint does not end up in the database twice', () => {
    const source = TestRoot.create({mintsStore: {mints: [mintSnapshot({id: 'backup01'})]}})
    const backup = exportBackup(source)

    const target = onboardedWallet()
    expect(Database.getMints()).toHaveLength(1)

    importBackup(target, backup)

    expect(Database.getMints().map(m => m.id)).toEqual(['backup01'])
  })

  // The duplicate was not even the worst of it: mint_keysets is keyed by keysetId
  // and its upsert moves mintId, so the replaced mint's row was left with no
  // keysets and no keys — and rehydrated on the next launch as an unusable husk.
  test('and the next launch sees exactly one, intact', () => {
    const source = TestRoot.create({mintsStore: {mints: [mintSnapshot({id: 'backup01'})]}})

    const target = onboardedWallet()
    importBackup(target, exportBackup(source), {[MINT_URL]: [{id: KEYSET_1, unit: 'sat', keys: {'1': '02aa'}}]})

    const restarted = TestRoot.create({})
    restarted.mintsStore.hydrateMintsFromDatabase()

    expect(restarted.mintsStore.mints).toHaveLength(1)
    expect(restarted.mintsStore.mints[0].keysets.map((k: any) => k.id)).toEqual([KEYSET_1])
    expect(restarted.mintsStore.mints[0].keys.map((k: any) => k.id)).toEqual([KEYSET_1])
  })

  // The backup is the wallet being restored: a mint it does not carry is gone,
  // exactly as it was when the whole state lived in one MMKV snapshot.
  test('a mint the backup does not carry is removed from the database too', () => {
    const source = TestRoot.create({mintsStore: {mints: [mintSnapshot({id: 'backup01'})]}})

    const target = TestRoot.create({
      mintsStore: {
        mints: [
          mintSnapshot({id: 'onboard1'}),
          mintSnapshot({
            id: 'straymint',
            mintUrl: OTHER_MINT_URL,
            hostname: 'other.test',
            keysets: [{id: KEYSET_2, unit: 'sat', active: true, input_fee_ppk: 0}],
            keys: [{id: KEYSET_2, unit: 'sat', keys: {'1': '02cc'}}],
            proofsCounters: [{keyset: KEYSET_2, unit: 'sat'}],
          }),
        ],
      },
    })
    target.mintsStore.persistAllMints()
    target.mintsStore.observeMints()
    expect(Database.getMints()).toHaveLength(2)

    importBackup(target, exportBackup(source))

    expect(Database.getMints().map(m => m.mintUrl)).toEqual([MINT_URL])
  })

  // Counters are keyed by keysetId and deliberately outlive their mint, so
  // re-adding one recovers its real derivation index instead of restarting at 0.
  test('but that mint keeps its derivation counters', () => {
    const source = TestRoot.create({mintsStore: {mints: [mintSnapshot({id: 'backup01'})]}})

    const target = onboardedWallet()
    Database.seedCounters([{keysetId: KEYSET_2, unit: 'sat', counter: 99}])

    importBackup(target, exportBackup(source))

    expect(Database.getCounters().find(c => c.keysetId === KEYSET_2)?.counter).toBe(99)
  })
})
