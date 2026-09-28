/**
 * Startup orphan recovery holds interruptible reservations instead of rolling them back.
 *
 * A transfer's preemptive swap, an online send's swap and a melt all send the locked
 * proofs to the mint while the reservation is open. If the process dies there, the
 * mint may already have consumed them: rolling back to UNSPENT would show spent ecash
 * as balance and abandon a swap's outputs (the 2026-09-24 incident). Those rows must
 * stay open, proofs PENDING, for the resolver — everything else rolls back as before.
 *
 * @jest-environment node
 */
jest.mock('../src/services/nostrService', () => ({
  NostrClient: {getFirstTagValue: jest.fn()},
}))
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {types} from 'mobx-state-tree'
import {MintsStoreModel} from '../src/models/MintsStore'
import {ProofsStoreModel} from '../src/models/ProofsStore'
import {Database} from '../src/services/db'

const TestRoot = types.model('RootStore', {
  mintsStore: types.optional(MintsStoreModel, {}),
  proofsStore: types.optional(ProofsStoreModel, {}),
})

const MINT_URL = 'https://mint.test'

const proof = (secret: string, amount: number) => ({
  id: 'keyset1',
  amount,
  secret,
  C: 'C' + secret,
  unit: 'sat',
  tId: 1,
  mintUrl: MINT_URL,
  state: 'UNSPENT',
})

/** A store + database holding four UNSPENT proofs, with two reservations left open. */
function crashedMidOperations() {
  Database.getInstance().executeBatch([['DELETE FROM proofs'], ['DELETE FROM reservations']])

  const proofs = [proof('swapIn1', 64), proof('swapIn2', 32), proof('offline1', 8), proof('free', 4)]
  const root = TestRoot.create({
    mintsStore: {mints: [{id: 'mint1111', mintUrl: MINT_URL, units: ['sat']}]},
    proofsStore: {proofs: Object.fromEntries(proofs.map(p => [p.secret, p])) as any},
  })
  const {proofsStore} = root
  Database.addOrUpdateProofs([...proofsStore.proofs.values()] as any, 'UNSPENT')

  const opts = {mintUrl: MINT_URL, unit: 'sat' as const, rollbackTo: 'UNSPENT' as const}
  const swap = proofsStore.reserve(
    [proofsStore.getBySecret('swapIn1')!, proofsStore.getBySecret('swapIn2')!],
    {...opts, transactionId: 20, operationType: 'transfer-swap'},
  )
  const offline = proofsStore.reserve([proofsStore.getBySecret('offline1')!], {
    ...opts,
    transactionId: 21,
    operationType: 'send-offline',
  })

  return {proofsStore, swap, offline}
}

const dbState = (secret: string) =>
  Database.getInstance().execute('SELECT state FROM proofs WHERE secret = ?', [secret]).rows?.item(0)?.state

describe('recoverOrphanReservations', () => {
  test('rolls back a non-interruptible orphan as before', () => {
    const {proofsStore, offline} = crashedMidOperations()

    proofsStore.recoverOrphanReservations()

    expect(proofsStore.getBySecret('offline1')!.state).toBe('UNSPENT')
    expect(dbState('offline1')).toBe('UNSPENT')
    expect(Database.getOpenReservations().map(r => r.id)).not.toContain(offline.id)
  })

  test('holds an interruptible orphan open with its proofs PENDING', () => {
    const {proofsStore, swap} = crashedMidOperations()

    const result = proofsStore.recoverOrphanReservations()

    expect(result).toEqual({recoveredCount: 1, heldCount: 1})
    for (const secret of ['swapIn1', 'swapIn2']) {
      expect(proofsStore.getBySecret(secret)!.state).toBe('PENDING')
      expect(dbState(secret)).toBe('PENDING')
    }
    expect(Database.getOpenReservations().map(r => r.id)).toEqual([swap.id])
    expect([...proofsStore.interruptedReservationIds]).toEqual([swap.id])

    // Held proofs are not spendable.
    expect(proofsStore.getMintBalance(MINT_URL)!.balances.sat).toBe(4 + 8)
  })

  test('is idempotent and release stops tracking', () => {
    const {proofsStore, swap} = crashedMidOperations()

    proofsStore.recoverOrphanReservations()
    expect(proofsStore.recoverOrphanReservations()).toEqual({recoveredCount: 0, heldCount: 1})

    proofsStore.releaseInterruptedReservation(swap.id)
    expect(proofsStore.interruptedReservationIds.size).toBe(0)
  })

  test.each(['transfer-swap', 'transfer-melt', 'transfer-melt-after-swap', 'send-online-swap'])(
    '%s is held',
    operationType => {
      const {proofsStore, swap} = crashedMidOperations()
      Database.getInstance().execute('UPDATE reservations SET operationType = ? WHERE id = ?', [
        operationType,
        swap.id,
      ])

      proofsStore.recoverOrphanReservations()

      expect(proofsStore.interruptedReservationIds.has(swap.id)).toBe(true)
    },
  )
})
