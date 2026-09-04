/**
 * NIP-47 `list_transactions` over NWC, against the REAL repo and a real database.
 *
 * The bug these pin: the reply was built by filtering transactionsStore.history for
 * TOPUP and TRANSFER. Both halves were wrong.
 *
 *  - The type filter dropped every RECEIVE — which is how ecash arrives when
 *    someone pays the wallet's lightning address. A client watched the balance go
 *    up with nothing in the transaction list to account for it, which reads as
 *    money gone missing.
 *  - `history` holds only the last handful of rows and is not hydrated at all on a
 *    lean background NWC wake, so even a matching transaction could be missing.
 *
 * So the query lives in SQL now, and these run it against a real database rather
 * than restating its WHERE clause.
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {Database} from '../src/services/db'
import {TransactionStatus, TransactionType} from '../src/models/Transaction'
import {
  DEFAULT_LIST_TRANSACTIONS,
  MAX_LIST_TRANSACTIONS,
  toNwcTransaction,
  toNwcTransactionQuery,
} from '../src/models/NwcTransaction'

const MINT = 'https://mint.test'

let nextId = 1

const addTx = (tx: {
  type: TransactionType
  status?: TransactionStatus
  amount?: number
  fee?: number
  unit?: string
  createdAt?: string
  memo?: string
  paymentRequest?: string
  paymentId?: string
  proof?: string
  expiresAt?: string
}) => {
  const id = nextId++
  Database.getInstance().execute(
    `INSERT INTO transactions
       (id, type, amount, fee, unit, data, memo, mint, mintId, status, paymentRequest, paymentId, proof, expiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?, 'mint1111', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      tx.type,
      tx.amount ?? 100,
      tx.fee ?? 0,
      tx.unit ?? 'sat',
      tx.memo ?? null,
      MINT,
      tx.status ?? TransactionStatus.COMPLETED,
      tx.paymentRequest ?? null,
      tx.paymentId ?? null,
      tx.proof ?? null,
      tx.expiresAt ?? null,
      tx.createdAt ?? new Date().toISOString(),
    ],
  )
  return id
}

/** What the handler does: NIP-47 params in, wire transactions out. */
const listTransactions = (params: any = {}) =>
  Database.getTransactionsForNwc(toNwcTransactionQuery(params)).map(toNwcTransaction)

beforeEach(() => {
  Database.getInstance().executeBatch([['DELETE FROM transactions']])
  nextId = 1
})

describe('list_transactions', () => {
  describe('which transactions are listed', () => {
    it('lists ecash received over a lightning address (the reported bug)', () => {
      addTx({type: TransactionType.RECEIVE, amount: 21, memo: 'zap'})

      const [tx] = listTransactions()

      expect(tx).toMatchObject({type: 'incoming', amount: 21000, description: 'zap'})
    })

    it('lists every settled type, in both directions', () => {
      addTx({type: TransactionType.RECEIVE})
      addTx({type: TransactionType.RECEIVE_OFFLINE})
      addTx({type: TransactionType.RECEIVE_BY_PAYMENT_REQUEST})
      addTx({type: TransactionType.TOPUP})
      addTx({type: TransactionType.TOPUP_ONCHAIN})
      addTx({type: TransactionType.SEND})
      addTx({type: TransactionType.TRANSFER})
      addTx({type: TransactionType.TRANSFER_ONCHAIN})

      const listed = listTransactions()

      expect(listed).toHaveLength(8)
      expect(listed.filter(t => t.type === 'incoming')).toHaveLength(5)
      expect(listed.filter(t => t.type === 'outgoing')).toHaveLength(3)
    })

    it('counts RECOVERED as settled — the money moved', () => {
      addTx({type: TransactionType.TOPUP, status: TransactionStatus.RECOVERED})

      const [tx] = listTransactions()

      expect(tx.settled_at).not.toBeNull()
    })

    it('omits unsettled transactions unless the client asks for them', () => {
      addTx({type: TransactionType.TOPUP, status: TransactionStatus.COMPLETED})
      addTx({type: TransactionType.TOPUP, status: TransactionStatus.PENDING})

      expect(listTransactions()).toHaveLength(1)
      expect(listTransactions({unpaid: true})).toHaveLength(2)
    })

    it('never lists a failed, expired or draft transaction', () => {
      addTx({type: TransactionType.TRANSFER, status: TransactionStatus.ERROR})
      addTx({type: TransactionType.TOPUP, status: TransactionStatus.EXPIRED})
      addTx({type: TransactionType.SEND, status: TransactionStatus.DRAFT})
      addTx({type: TransactionType.SEND, status: TransactionStatus.REVERTED})

      expect(listTransactions({unpaid: true})).toEqual([])
    })

    it('lists only sats — NWC has no way to say the amount is euros', () => {
      addTx({type: TransactionType.RECEIVE, unit: 'sat', amount: 100})
      addTx({type: TransactionType.RECEIVE, unit: 'eur', amount: 100})

      expect(listTransactions()).toHaveLength(1)
    })
  })

  describe('filtering and paging', () => {
    it('filters by direction', () => {
      addTx({type: TransactionType.RECEIVE})
      addTx({type: TransactionType.TRANSFER})

      expect(listTransactions({type: 'incoming'}).map(t => t.type)).toEqual(['incoming'])
      expect(listTransactions({type: 'outgoing'}).map(t => t.type)).toEqual(['outgoing'])
    })

    it('treats an unrecognised type as both directions rather than matching nothing', () => {
      addTx({type: TransactionType.RECEIVE})
      addTx({type: TransactionType.TRANSFER})

      expect(listTransactions({type: 'sideways'})).toHaveLength(2)
    })

    it('bounds the range by from/until, in unix seconds', () => {
      addTx({type: TransactionType.RECEIVE, amount: 1, createdAt: '2026-01-01T00:00:00.000Z'})
      addTx({type: TransactionType.RECEIVE, amount: 2, createdAt: '2026-06-01T00:00:00.000Z'})
      addTx({type: TransactionType.RECEIVE, amount: 3, createdAt: '2026-12-01T00:00:00.000Z'})

      const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

      const listed = listTransactions({
        from: unix('2026-03-01T00:00:00.000Z'),
        until: unix('2026-09-01T00:00:00.000Z'),
      })

      expect(listed.map(t => t.amount)).toEqual([2000])
    })

    it('pages newest first', () => {
      addTx({type: TransactionType.RECEIVE, amount: 1, createdAt: '2026-01-01T00:00:00.000Z'})
      addTx({type: TransactionType.RECEIVE, amount: 2, createdAt: '2026-01-02T00:00:00.000Z'})
      addTx({type: TransactionType.RECEIVE, amount: 3, createdAt: '2026-01-03T00:00:00.000Z'})

      expect(listTransactions({limit: 2}).map(t => t.amount)).toEqual([3000, 2000])
      expect(listTransactions({limit: 2, offset: 2}).map(t => t.amount)).toEqual([1000])
    })

    it('reaches past the few rows the in-memory history would have held', () => {
      // The old implementation read transactionsStore.history, capped at 10 rows and
      // empty on a background wake. 25 settled receives have to be reachable.
      for (let i = 0; i < 25; i++) {
        addTx({type: TransactionType.RECEIVE, createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`})
      }

      expect(listTransactions()).toHaveLength(25)
    })
  })

  describe('request params off the wire', () => {
    it('defaults the page size when the client asks for none', () => {
      expect(toNwcTransactionQuery({})).toMatchObject({
        limit: DEFAULT_LIST_TRANSACTIONS,
        offset: 0,
        unit: 'sat',
        direction: undefined,
      })
    })

    it('caps an outsized limit and rejects nonsense', () => {
      expect(toNwcTransactionQuery({limit: 100000}).limit).toBe(MAX_LIST_TRANSACTIONS)
      expect(toNwcTransactionQuery({limit: 0}).limit).toBe(1)
      expect(toNwcTransactionQuery({limit: 'lots'}).limit).toBe(DEFAULT_LIST_TRANSACTIONS)
      expect(toNwcTransactionQuery({offset: -5}).offset).toBe(0)
    })

    it('survives a request with no params at all', () => {
      expect(() => toNwcTransactionQuery(undefined)).not.toThrow()
    })
  })

  describe('the NIP-47 transaction object', () => {
    it('reports amount AND fee in msats', () => {
      addTx({type: TransactionType.TRANSFER, amount: 1000, fee: 3})

      const [tx] = listTransactions()

      // fees_paid used to go out in sats while amount went out in msats, making a
      // 3 sat fee look like 3 msat.
      expect(tx).toMatchObject({amount: 1000000, fees_paid: 3000})
    })

    it('leaves settled_at null while a transaction is unsettled', () => {
      addTx({type: TransactionType.TOPUP, status: TransactionStatus.PENDING})

      const [tx] = listTransactions({unpaid: true})

      expect(tx.settled_at).toBeNull()
      expect(tx.created_at).toEqual(expect.any(Number))
    })

    it('reports nulls, not an expiry at the unix epoch, for ecash with no invoice', () => {
      addTx({type: TransactionType.RECEIVE})

      const [tx] = listTransactions()

      expect(tx).toMatchObject({
        invoice: null,
        payment_hash: null,
        preimage: null,
        expires_at: null,
      })
    })

    it('carries the invoice, payment hash and preimage of a lightning payment', () => {
      addTx({
        type: TransactionType.TRANSFER,
        paymentRequest: 'lnbc1...',
        paymentId: 'hash1',
        proof: 'preimage1',
        expiresAt: '2026-01-01T00:00:00.000Z',
      })

      const [tx] = listTransactions()

      expect(tx).toMatchObject({
        type: 'outgoing',
        invoice: 'lnbc1...',
        payment_hash: 'hash1',
        preimage: 'preimage1',
        expires_at: Math.floor(new Date('2026-01-01T00:00:00.000Z').getTime() / 1000),
      })
    })
  })
})
