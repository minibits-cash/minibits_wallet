/**
 * Onchain (NUT-30) mint quotes, against the REAL repo and a real database.
 *
 * The watch rule is what these tests are really about. Two facts make it subtle:
 *
 *  - the mint returns `expiry: null`, so a deposit address never dies and nothing
 *    server-side bounds how long we poll a quote nobody paid;
 *  - a quote can be paid MORE than once, so "have we minted yet" is the wrong
 *    question — "is there money credited that we have not minted" is the right one.
 *
 * Getting this wrong loses money in one direction (abandon a quote holding funds)
 * or polls forever in the other.
 *
 * Calls the production `Database.*` functions rather than mirroring their SQL: the
 * op-sqlite jest mock backs the real driver seam with node:sqlite. Dates are
 * anchored to REAL now, because the real watch query compares against `new Date()`.
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {Database} from '../src/services/db'

const MINT = 'https://mint.test'
const MINT_ID = 'mint1111'

const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000).toISOString()

const addQuote = (q: {
  quote: string
  counterIndex: number
  amountRequested?: number | null
  amountPaid?: number
  amountIssued?: number
  watchUntil?: string
  mintId?: string
}) =>
  Database.addOnchainMintQuote({
    quote: q.quote,
    mintId: q.mintId ?? MINT_ID,
    mintUrl: MINT,
    unit: 'sat',
    address: 'bc1q' + q.quote,
    counterIndex: q.counterIndex,
    pubkey: '02' + 'a'.repeat(64),
    amountRequested: q.amountRequested ?? null,
    amountPaid: q.amountPaid,
    amountIssued: q.amountIssued,
    expiry: null, // the mint returns null — the address never dies
    watchUntil: q.watchUntil,
  })

const watchedIds = () =>
  Database.getWatchedOnchainMintQuotes()
    .map(r => r.quote)
    .sort()

beforeEach(() => {
  Database.getInstance().executeBatch([['DELETE FROM onchain_mint_quotes']])
})

describe('onchain mint quotes', () => {
  describe('the watch rule', () => {
    it('watches a fresh unpaid quote (window still open)', () => {
      addQuote({quote: 'q1', counterIndex: 0})
      expect(watchedIds()).toEqual(['q1'])
    })

    it('stops watching an unpaid quote once the window closes', () => {
      // nothing ever arrived, and the mint will never expire the address for us —
      // so the wallet has to draw the line itself
      addQuote({quote: 'q1', counterIndex: 0, watchUntil: daysFromNow(-1)})
      expect(watchedIds()).toEqual([])
    })

    it('watches a quote with credited-but-unminted funds', () => {
      addQuote({quote: 'q1', counterIndex: 0, amountPaid: 50000, amountIssued: 0})
      expect(watchedIds()).toEqual(['q1'])
    })

    it('stops watching once the quote is fully drained (the "stop after first mint" case)', () => {
      addQuote({quote: 'q1', counterIndex: 0, amountPaid: 50000, amountIssued: 50000})
      expect(watchedIds()).toEqual([])
    })

    it('KEEPS watching a PARTIALLY drained quote — money is still credited', () => {
      // The reason the rule keys on the unminted BALANCE and not on "has ever
      // minted". Keying on amountIssued > 0 would archive this and abandon 20k sat
      // the mint is holding for us.
      addQuote({quote: 'q1', counterIndex: 0, amountPaid: 70000, amountIssued: 50000})
      expect(watchedIds()).toEqual(['q1'])
    })

    it('watches credited funds even after the window has closed', () => {
      // the deadline bounds quotes nobody paid; it must never override money that
      // is actually sitting at the mint
      addQuote({
        quote: 'q1',
        counterIndex: 0,
        amountPaid: 50000,
        amountIssued: 0,
        watchUntil: daysFromNow(-30),
      })
      expect(watchedIds()).toEqual(['q1'])
    })

    it('separates watched from archived across a realistic mix', () => {
      addQuote({quote: 'fresh', counterIndex: 0})
      addQuote({quote: 'drained', counterIndex: 1, amountPaid: 10000, amountIssued: 10000})
      addQuote({quote: 'unpaid-expired', counterIndex: 2, watchUntil: daysFromNow(-1)})
      addQuote({quote: 'has-funds', counterIndex: 3, amountPaid: 30000, amountIssued: 0})
      addQuote({quote: 'partly-drained', counterIndex: 4, amountPaid: 30000, amountIssued: 10000})

      expect(watchedIds()).toEqual(['fresh', 'has-funds', 'partly-drained'])
    })
  })

  describe('amount updates are monotonic', () => {
    it('applies a normal forward update', () => {
      addQuote({quote: 'q1', counterIndex: 0})
      Database.updateOnchainMintQuoteAmounts('q1', 50000, 0)

      expect(Database.getOnchainMintQuote('q1')).toMatchObject({amountPaid: 50000, amountIssued: 0})
    })

    it('ignores a stale response that would walk amounts BACKWARDS', () => {
      // A slow reply landing after a fresh one must not resurrect an old view. If
      // amountIssued regressed, the wallet would see unminted money that is not
      // there — and mint it a second time.
      addQuote({quote: 'q1', counterIndex: 0, amountPaid: 50000, amountIssued: 50000})

      Database.updateOnchainMintQuoteAmounts('q1', 50000, 0) // stale: "nothing issued yet"

      expect(Database.getOnchainMintQuote('q1')).toMatchObject({
        amountPaid: 50000,
        amountIssued: 50000,
      })
      expect(watchedIds()).toEqual([]) // still archived, not resurrected
    })

    it('records a second deposit arriving on the same address', () => {
      addQuote({quote: 'q1', counterIndex: 0, amountPaid: 50000, amountIssued: 50000})
      expect(watchedIds()).toEqual([])

      Database.updateOnchainMintQuoteAmounts('q1', 70000, 50000) // paid again

      expect(watchedIds()).toEqual(['q1']) // unminted balance -> back in the watch set
    })
  })

  describe('archived quotes stay recoverable', () => {
    it('keeps the row, and with it the NUT-20 counterIndex', () => {
      // counterIndex is the only way to re-derive the key that signs a mint request
      // for this quote. Delete the row and a late deposit becomes permanently
      // unspendable.
      addQuote({quote: 'q1', counterIndex: 42, amountPaid: 10000, amountIssued: 10000})

      expect(watchedIds()).toEqual([]) // archived
      expect(Database.getOnchainMintQuote('q1')).toMatchObject({
        counterIndex: 42,
        address: 'bc1qq1',
      })
    })

    it('re-opens the watch window on user request', () => {
      addQuote({quote: 'q1', counterIndex: 0, watchUntil: daysFromNow(-1)})
      expect(watchedIds()).toEqual([])

      Database.extendOnchainMintQuoteWatch('q1', 7) // "check for deposits"

      expect(watchedIds()).toEqual(['q1'])
    })
  })

  describe('the requested amount is only a hint', () => {
    it('keeps amountRequested separate from what was actually paid', () => {
      // The BIP21 amount is a suggestion the sender can ignore. Under- and
      // overpayment are normal, so the two must never be conflated.
      addQuote({quote: 'q1', counterIndex: 0, amountRequested: 50000})

      Database.updateOnchainMintQuoteAmounts('q1', 42000, 0) // sender underpaid

      expect(Database.getOnchainMintQuote('q1')).toMatchObject({
        amountRequested: 50000,
        amountPaid: 42000,
      })
    })

    it('allows a null requested amount', () => {
      addQuote({quote: 'q1', counterIndex: 0, amountRequested: null})
      expect(Database.getOnchainMintQuote('q1')!.amountRequested).toBeNull()
    })
  })

  describe('the mint reference', () => {
    it('finds a mint\'s quotes by id, not by the url they were created at', () => {
      addQuote({quote: 'q1', counterIndex: 0})
      addQuote({quote: 'q2', counterIndex: 1, mintId: 'other-mint'})

      expect(Database.getOnchainMintQuotesByMintId(MINT_ID).map(r => r.quote)).toEqual(['q1'])
    })

    it('keeps mintUrl as the record of where the quote was created', () => {
      addQuote({quote: 'q1', counterIndex: 0})
      const row = Database.getOnchainMintQuote('q1')!

      expect(row.mintId).toBe(MINT_ID)
      expect(row.mintUrl).toBe(MINT)
    })
  })
})
