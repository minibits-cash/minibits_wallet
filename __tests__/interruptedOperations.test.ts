/**
 * The interrupted-operation resolver's decision table.
 *
 * Startup holds a reservation whose process died mid-swap or mid-melt; the resolver
 * asks the mint what it did and settles by that. Real ProofsStore/MintsStore on the
 * real database (reservations, rollback and commit run for real); the mint calls,
 * TransferOperationApi.refresh and the queue are stubbed.
 *
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))
jest.mock('../src/services/nostrService', () => ({NostrClient: {getFirstTagValue: jest.fn()}}))
jest.mock('../src/services/syncQueueService', () => ({SyncQueue: {addPrioritizedTask: jest.fn()}}))
jest.mock('../src/services/wallet/operations/transferOperationApi', () => ({
  TransferOperationApi: {refresh: jest.fn()},
}))

const mockWalletStore = {
  getProofsStatesFromMint: jest.fn(),
  getCachedSeed: jest.fn(async () => new Uint8Array(64)),
  restore: jest.fn(),
}
const mockTransactionsStore = {findById: jest.fn()}
// One root for the whole file: the resolver captures its stores at import time.
let mockRoot: any

jest.mock('../src/models', () => ({
  get rootStoreInstance() {
    return mockRoot
  },
}))

import {applySnapshot, types} from 'mobx-state-tree'
import {MintsStoreModel} from '../src/models/MintsStore'
import {ProofsStoreModel} from '../src/models/ProofsStore'
import {TransactionModel, TransactionStatus} from '../src/models/Transaction'
import {Database} from '../src/services/db'
import {NetworkError} from '../src/utils/AppError'
import {TransferOperationApi} from '../src/services/wallet/operations/transferOperationApi'

const TestRoot = types
  .model('RootStore', {
    mintsStore: types.optional(MintsStoreModel, {}),
    proofsStore: types.optional(ProofsStoreModel, {}),
    // A real Transaction node: commitReservation mirrors its tx update via setProp.
    tx: types.maybe(TransactionModel),
  })
  .volatile(() => ({transactionsStore: mockTransactionsStore, walletStore: mockWalletStore}))

const MINT_URL = 'https://mint.test'
const KEYSET = 'keyset1'
const TX_ID = 30

const proof = (secret: string, amount: number) => ({
  id: KEYSET, amount, secret, C: 'C' + secret, unit: 'sat', tId: 1, mintUrl: MINT_URL, state: 'UNSPENT',
})

const txSnapshot = {
  id: TX_ID, type: 'TRANSFER', amount: 90, unit: 'sat', mint: MINT_URL,
  status: TransactionStatus.DRAFT, data: JSON.stringify([{status: 'DRAFT'}]),
}
const lastAudit = (tx: any) => JSON.parse(tx.data).at(-1)

/** The mint reports the locked inputs in `bucket`; anything else (restored outputs) UNSPENT. */
const mintSays = (bucket: 'SPENT' | 'PENDING' | 'UNSPENT') =>
  mockWalletStore.getProofsStatesFromMint.mockImplementation(async (_u: string, _unit: string, ps: any[]) => {
    const inputs = ps.filter(p => p.secret.startsWith('in'))
    const others = ps.filter(p => !p.secret.startsWith('in'))
    return {
      SPENT: bucket === 'SPENT' ? inputs : [],
      PENDING: bucket === 'PENDING' ? inputs : [],
      UNSPENT: bucket === 'UNSPENT' ? [...inputs, ...others] : others,
    }
  })

/** The state a process leaves when it dies inside the operation, after a restart. */
function interrupted(operationType: string, counters?: {start: number; count: number; next: number}) {
  Database.getInstance().executeBatch([
    ['DELETE FROM proofs'], ['DELETE FROM reservations'], ['DELETE FROM mint_counters'],
    ['DELETE FROM transactions'],
    [
      'INSERT INTO transactions (id, type, amount, fee, unit, mint, status, data, createdAt) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)',
      [TX_ID, 'TRANSFER', 90, 'sat', MINT_URL, txSnapshot.status, txSnapshot.data, new Date().toISOString()],
    ],
  ])
  const proofs = [proof('in1', 64), proof('in2', 32), proof('free', 4)]
  mockRoot.proofsStore.interruptedReservations.clear()
  applySnapshot(mockRoot, {
    mintsStore: {
      mints: [{
        id: 'mint1111', mintUrl: MINT_URL, units: ['sat'],
        keysets: [{id: KEYSET, unit: 'sat', active: true}],
        proofsCounters: [{keyset: KEYSET, unit: 'sat', counter: 40}],
      }],
    } as any,
    proofsStore: {proofs: Object.fromEntries(proofs.map(p => [p.secret, p])) as any},
    tx: txSnapshot,
  } as any)
  const {proofsStore} = mockRoot
  Database.addOrUpdateProofs([...proofsStore.proofs.values()], 'UNSPENT')

  const reservation = proofsStore.reserve([proofsStore.getBySecret('in1'), proofsStore.getBySecret('in2')], {
    transactionId: TX_ID, mintUrl: MINT_URL, unit: 'sat', operationType, rollbackTo: 'UNSPENT',
  })
  if (counters) Database.setReservationCounters(reservation.id, {keysetId: KEYSET, ...counters})
  Database.addInFlightRequest(TX_ID, {amount: 90, proofs: []})

  proofsStore.recoverOrphanReservations() // the restart
  const tx = mockRoot.tx
  mockTransactionsStore.findById.mockReturnValue(tx)
  jest.spyOn(tx, 'update')
  return {proofsStore, tx, reservation}
}

mockRoot = TestRoot.create({})
// Imported after the root exists, since it destructures the stores on load.
const {InterruptedOperationService} = require('../src/services/wallet/operations/interruptedOperations')
const run = () => InterruptedOperationService.resolveInterruptedOperationsTask()
const state = (s: string) => mockRoot.proofsStore.getBySecret(s)?.state
const openRows = () => Database.getOpenReservations().length

beforeEach(() => {
  jest.clearAllMocks()
})

test('inputs UNSPENT at the mint: nothing happened — roll back, tx REVERTED', async () => {
  const {proofsStore, tx} = interrupted('transfer-swap', {start: 40, count: 3, next: 43})
  mintSays('UNSPENT')

  await run()

  expect([state('in1'), state('in2')]).toEqual(['UNSPENT', 'UNSPENT'])
  expect(openRows()).toBe(0)
  expect(tx.status).toBe(TransactionStatus.REVERTED)
  expect(lastAudit(tx)).toMatchObject({status: 'REVERTED', interrupted: true})
  expect(Database.getInFlightRequest(TX_ID)).toBeUndefined()
  expect(proofsStore.interruptedReservations.size).toBe(0)
})

test('swap executed: outputs restored from the recorded range, tx REVERTED', async () => {
  const {proofsStore, tx} = interrupted('transfer-swap', {start: 40, count: 3, next: 43})
  mintSays('SPENT')
  // The range can also hold outputs the wallet already has (counter reuse) — skipped.
  mockWalletStore.restore.mockResolvedValue({
    proofs: [
      {id: KEYSET, amount: 64, secret: 'out1', C: 'Cout1'},
      {id: KEYSET, amount: 32, secret: 'out2', C: 'Cout2'},
      {id: KEYSET, amount: 4, secret: 'free', C: 'Cfree'},
    ],
  })

  await run()

  expect(mockWalletStore.restore).toHaveBeenCalledWith(MINT_URL, expect.any(Uint8Array), {
    indexFrom: 40, indexTo: 43, keysetId: KEYSET, unit: 'sat',
  })
  expect([state('in1'), state('in2')]).toEqual(['SPENT', 'SPENT'])
  expect([state('out1'), state('out2')]).toEqual(['UNSPENT', 'UNSPENT'])
  expect(proofsStore.getBySecret('out1').tId).toBe(TX_ID)
  expect(state('free')).toBe('UNSPENT')
  expect(proofsStore.getMintBalance(MINT_URL).balances.sat).toBe(64 + 32 + 4)
  // Never derive from that range again.
  expect(mockRoot.mintsStore.findByUrl(MINT_URL).getProofsCounter(KEYSET).counter).toBe(43)
  expect(tx.status).toBe(TransactionStatus.REVERTED)
  expect(lastAudit(tx)).toMatchObject({interrupted: true, restoredAmount: 96})
  expect(openRows()).toBe(0)
  expect(Database.getInFlightRequest(TX_ID)).toBeUndefined()
})

test('swap executed but no range recorded (pre-v36 row): inputs SPENT, tx ERROR', async () => {
  const {tx} = interrupted('send-online-swap')
  mintSays('SPENT')

  await run()

  expect(mockWalletStore.restore).not.toHaveBeenCalled()
  expect([state('in1'), state('in2')]).toEqual(['SPENT', 'SPENT'])
  expect(tx.status).toBe(TransactionStatus.ERROR)
  expect(lastAudit(tx).message).toMatch(/seed recovery/)
  expect(openRows()).toBe(0)
})

test.each(['SPENT', 'PENDING'] as const)(
  'melt with inputs %s: handed to refresh as an ordinary PENDING transfer',
  async bucket => {
    const {proofsStore, tx} = interrupted('transfer-melt')
    mintSays(bucket)

    await run()

    expect(openRows()).toBe(0)
    expect([state('in1'), state('in2')]).toEqual(['PENDING', 'PENDING'])
    expect(tx.status).toBe(TransactionStatus.PENDING)
    expect(TransferOperationApi.refresh).toHaveBeenCalledWith(TX_ID)
    // No longer held: the regular pending sweep may now see these proofs.
    expect(proofsStore.isHeldByInterruptedOperation('in1')).toBe(false)
  },
)

test('mint unreachable: stays held for the next sweep, mint marked OFFLINE', async () => {
  const {proofsStore, tx} = interrupted('transfer-swap', {start: 40, count: 3, next: 43})
  mockWalletStore.getProofsStatesFromMint.mockRejectedValue(new NetworkError('Network request failed'))

  const result = await run()

  expect(result.errors).toHaveLength(1)
  expect([state('in1'), state('in2')]).toEqual(['PENDING', 'PENDING'])
  expect(openRows()).toBe(1)
  expect(proofsStore.interruptedReservations.size).toBe(1)
  expect(tx.update).not.toHaveBeenCalled()
  expect(mockRoot.mintsStore.findByUrl(MINT_URL).status).toBe('OFFLINE')
})

test('a hold from the running process (no restart) is resolved the same way', async () => {
  const {proofsStore, reservation, tx} = interrupted('send-online-swap', {start: 40, count: 3, next: 43})
  // Re-open as if the swap had just failed in this process: drop the startup hold,
  // then hand it over the way SendOperationApi.execute does.
  proofsStore.releaseInterruptedReservation(reservation.id)
  proofsStore.holdInterruptedReservation(reservation)
  mintSays('UNSPENT')

  await run()

  expect([state('in1'), state('in2')]).toEqual(['UNSPENT', 'UNSPENT'])
  expect(openRows()).toBe(0)
  expect(tx.status).toBe(TransactionStatus.REVERTED)
  expect(proofsStore.interruptedReservations.size).toBe(0)
})
