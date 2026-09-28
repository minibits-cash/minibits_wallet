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
    expect([...proofsStore.interruptedReservations.keys()]).toEqual([swap.id])
    expect(proofsStore.isHeldByInterruptedOperation('swapIn1')).toBe(true)
    expect(proofsStore.isHeldByInterruptedOperation('free')).toBe(false)
    expect(proofsStore.isTransactionInterrupted(20)).toBe(true)

    // Held proofs are not spendable.
    expect(proofsStore.getMintBalance(MINT_URL)!.balances.sat).toBe(4 + 8)
  })

  test('is idempotent and release stops tracking', () => {
    const {proofsStore, swap} = crashedMidOperations()

    proofsStore.recoverOrphanReservations()
    expect(proofsStore.recoverOrphanReservations()).toEqual({recoveredCount: 0, heldCount: 1})

    proofsStore.releaseInterruptedReservation(swap.id)
    expect(proofsStore.interruptedReservations.size).toBe(0)
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

      expect(proofsStore.interruptedReservations.has(swap.id)).toBe(true)
    },
  )
})

describe('revertAbandonedDrafts', () => {
  const insertTx = (id: number, type: string, status: string, quote: string | null = null) =>
    Database.getInstance().execute(
      `INSERT INTO transactions (id, type, amount, fee, unit, mint, status, quote, data, createdAt)
       VALUES (?, ?, 1, 0, 'sat', ?, ?, ?, ?, ?)`,
      [id, type, MINT_URL, status, quote, JSON.stringify([{status: 'DRAFT'}]), new Date().toISOString()],
    )
  const txRow = (id: number) =>
    Database.getInstance().execute('SELECT status, data FROM transactions WHERE id = ?', [id]).rows?.item(0)

  function setup() {
    const {proofsStore, swap} = crashedMidOperations()
    Database.getInstance().execute('DELETE FROM transactions')

    insertTx(40, 'TRANSFER', 'DRAFT', 'quote-40') // died after its preemptive swap committed
    insertTx(41, 'TRANSFER', 'DRAFT') // Nostr invoice waiting for the user: no quote yet
    insertTx(20, 'TRANSFER', 'DRAFT', 'quote-20') // owns the held transfer-swap reservation
    insertTx(43, 'TOPUP', 'PREPARED', 'quote-43') // invoice issued, waiting for payment
    insertTx(44, 'TRANSFER', 'EXECUTING', 'quote-44') // a mint call may have happened
    insertTx(45, 'SEND', 'PREPARED')

    // The swap's outputs, committed PENDING under tx 40 before the melt reserved them.
    const out = proofsStore.getBySecret('free')!
    out.setProp('state', 'PENDING')
    out.setProp('tId', 40)
    Database.addOrUpdateProofs([out], 'PENDING')

    proofsStore.recoverOrphanReservations()
    return {proofsStore, swap}
  }

  test('reverts abandoned transfers and sends, releasing their PENDING proofs', () => {
    const {proofsStore} = setup()

    expect(proofsStore.revertAbandonedDrafts()).toEqual({revertedCount: 2})

    for (const id of [40, 45]) {
      expect(txRow(id).status).toBe('REVERTED')
      expect(JSON.parse(txRow(id).data).at(-1)).toMatchObject({status: 'REVERTED', interrupted: true})
    }
    expect(JSON.parse(txRow(40).data).at(-1).releasedAmount).toBe(4)
    expect(proofsStore.getBySecret('free')!.state).toBe('UNSPENT')
    expect(dbState('free')).toBe('UNSPENT')
  })

  test('leaves alone what may still be live or waiting', () => {
    const {proofsStore} = setup()

    proofsStore.revertAbandonedDrafts()

    expect(txRow(41).status).toBe('DRAFT') // Nostr invoice
    expect(txRow(20).status).toBe('DRAFT') // held for the resolver
    expect(txRow(43).status).toBe('PREPARED') // topup
    expect(txRow(44).status).toBe('EXECUTING')
    expect(proofsStore.getBySecret('swapIn1')!.state).toBe('PENDING')
  })
})
