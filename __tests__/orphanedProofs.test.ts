/**
 * Balance behaviour when a proof's mintUrl matches no mint (ProofsStore).
 *
 * `proofs.mintUrl` is a denormalized copy of a mint's LOCATOR, joined to
 * `mint.mintUrl` by string equality across two persistence engines — proofs in
 * SQLite, mint.mintUrl in the MMKV snapshot. A crash between those writes during a
 * mint-url edit desyncs them.
 *
 * What must hold when that happens:
 *  - the sats stay VISIBLE in the unit total (they are real and the user's), and
 *  - the wallet reports it, rather than silently swallowing it.
 *
 * Hiding the money, refusing to start, or forcing a recovery would all be worse
 * outcomes than a total that reads a little high, and the state self-heals once a
 * mint is (re-)added at that url.
 *
 * This is the first suite to instantiate MST stores. It uses a MINIMAL root
 * (mintsStore + proofsStore) rather than the real RootStore, which additionally
 * pulls AuthStore/NwcStore/WalletProfileStore and, through them, the whole service
 * layer. getRootStore only needs the root to expose the stores actually used.
 */
jest.mock('../src/services/nostrService', () => ({
  // cashuUtils -> nostrService -> minibitsService -> models is an import CYCLE;
  // mocking nostrService cuts it, as every other suite here does.
  NostrClient: {getFirstTagValue: jest.fn()},
}))

// The real logger would work here (jest maps Sentry to a mock), but react-native-logs
// dispatches to its transport on a timer, so it logs after teardown — and a real
// `log.error` is not a spy to assert on.
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {types} from 'mobx-state-tree'
import {MintsStoreModel} from '../src/models/MintsStore'
import {ProofsStoreModel} from '../src/models/ProofsStore'
import {log} from '../src/services/logService'

// Named 'RootStore' so getRootStore's typing lines up with the real tree.
const TestRoot = types.model('RootStore', {
  mintsStore: types.optional(MintsStoreModel, {}),
  proofsStore: types.optional(ProofsStoreModel, {}),
})

const MINT_URL = 'https://mint.test'
const MOVED_URL = 'https://moved.mint.test'

const mintSnapshot = (mintUrl: string) => ({
  id: 'mint1111',
  mintUrl,
  units: ['sat'],
})

const proofSnapshot = (secret: string, amount: number, mintUrl: string, state = 'UNSPENT') => ({
  id: 'keyset1',
  amount,
  secret,
  C: 'C' + secret,
  unit: 'sat',
  tId: 1,
  mintUrl,
  state,
})

const makeStore = (mintUrl: string, proofs: Array<ReturnType<typeof proofSnapshot>>) =>
  TestRoot.create({
    mintsStore: {mints: [mintSnapshot(mintUrl)]},
    proofsStore: {proofs: Object.fromEntries(proofs.map(p => [p.secret, p]))},
  })

describe('proofs whose mint is not in the wallet', () => {
  describe('balances — the money stays visible', () => {
    test('an attached proof counts toward BOTH its mint and the unit total', () => {
      const root = makeStore(MINT_URL, [proofSnapshot('a', 100, MINT_URL)])
      const {balances} = root.proofsStore

      expect(balances.mintBalances[0].balances.sat).toBe(100)
      expect(balances.unitBalances.find(u => u.unit === 'sat')!.unitBalance).toBe(100)
    })

    // The core promise: a desync must never hide the user's sats.
    test('an orphaned proof still counts toward the unit total', () => {
      const root = makeStore(MOVED_URL, [proofSnapshot('a', 100, MINT_URL)])
      const {balances} = root.proofsStore

      expect(balances.unitBalances.find(u => u.unit === 'sat')!.unitBalance).toBe(100)
    })

    test('but is attributed to no mint, so the total can exceed the sum of mints', () => {
      const root = makeStore(MOVED_URL, [
        proofSnapshot('a', 100, MOVED_URL), // attached
        proofSnapshot('b', 40, MINT_URL), // orphaned by a url edit
      ])
      const {balances} = root.proofsStore

      expect(balances.mintBalances[0].balances.sat).toBe(100)
      expect(balances.unitBalances.find(u => u.unit === 'sat')!.unitBalance).toBe(140)
    })

    test('reading balances does not throw', () => {
      const root = makeStore(MOVED_URL, [proofSnapshot('a', 100, MINT_URL)])
      expect(() => root.proofsStore.balances).not.toThrow()
    })
  })

  describe('findOrphanedProofs', () => {
    test('is empty in the normal case', () => {
      const root = makeStore(MINT_URL, [proofSnapshot('a', 100, MINT_URL)])
      expect(root.proofsStore.findOrphanedProofs()).toEqual([])
    })

    test('groups by url, with count and amount', () => {
      const root = makeStore(MOVED_URL, [
        proofSnapshot('a', 100, MINT_URL),
        proofSnapshot('b', 40, MINT_URL),
        proofSnapshot('c', 7, MOVED_URL), // attached, not reported
      ])

      expect(root.proofsStore.findOrphanedProofs()).toEqual([
        {mintUrl: MINT_URL, count: 2, amount: 140},
      ])
    })

    // Removing a mint leaves its proofs SPENT behind. Reporting those would fire on
    // every legitimate removal.
    test('ignores SPENT proofs', () => {
      const root = makeStore(MOVED_URL, [proofSnapshot('a', 100, MINT_URL, 'SPENT')])
      expect(root.proofsStore.findOrphanedProofs()).toEqual([])
    })

    test('includes PENDING proofs — they are still the user\'s money', () => {
      const root = makeStore(MOVED_URL, [proofSnapshot('a', 100, MINT_URL, 'PENDING')])
      expect(root.proofsStore.findOrphanedProofs()).toEqual([
        {mintUrl: MINT_URL, count: 1, amount: 100},
      ])
    })
  })

  describe('reportOrphanedProofs — observe, never act', () => {
    beforeEach(() => jest.clearAllMocks())

    test('stays silent when everything is attached', () => {
      const root = makeStore(MINT_URL, [proofSnapshot('a', 100, MINT_URL)])
      expect(root.proofsStore.reportOrphanedProofs()).toEqual([])
      expect(log.error).not.toHaveBeenCalled()
    })

    test('logs at error (→ Sentry) with the url and stranded amount', () => {
      const root = makeStore(MOVED_URL, [proofSnapshot('a', 100, MINT_URL)])
      const reported = root.proofsStore.reportOrphanedProofs()

      expect(reported).toEqual([{mintUrl: MINT_URL, count: 1, amount: 100}])
      expect(log.error).toHaveBeenCalledTimes(1)

      const params = (log.error as jest.Mock).mock.calls[0][2]
      expect(params.totalAmount).toBe(100)
      expect(params.orphaned).toEqual([{mintUrl: MINT_URL, count: 1, amount: 100}])
    })

    test('changes nothing — the proofs and the balance are untouched', () => {
      const root = makeStore(MOVED_URL, [proofSnapshot('a', 100, MINT_URL)])

      root.proofsStore.reportOrphanedProofs()

      // Still present, still counted: reporting must never quarantine the money.
      expect(root.proofsStore.proofs.size).toBe(1)
      expect(root.proofsStore.getBySecret('a')!.mintUrl).toBe(MINT_URL)
      const {balances} = root.proofsStore
      expect(balances.unitBalances.find(u => u.unit === 'sat')!.unitBalance).toBe(100)
    })

    test('self-heals once a mint exists at that url again', () => {
      const root = makeStore(MOVED_URL, [proofSnapshot('a', 100, MINT_URL)])
      expect(root.proofsStore.findOrphanedProofs()).toHaveLength(1)

      // The rename is completed (or reverted) and the mint answers there again.
      root.mintsStore.mints[0].setProp('mintUrl', MINT_URL)

      expect(root.proofsStore.findOrphanedProofs()).toEqual([])
      expect(root.proofsStore.balances.mintBalances[0].balances.sat).toBe(100)
    })
  })
})
