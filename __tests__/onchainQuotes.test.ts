/**
 * Onchain (NUT-30) mint quote store.
 *
 * Mirrors the production SQL from onchainQuotesRepo against node:sqlite (the
 * native driver needs a device), as meltRecovery.test.ts and inFlightRequests.test.ts
 * do.
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
 * @jest-environment node
 */
import {DatabaseSync} from 'node:sqlite'

const CREATE_ONCHAIN_MINT_QUOTES = `CREATE TABLE onchain_mint_quotes (
  quote TEXT PRIMARY KEY NOT NULL,
  mintUrl TEXT NOT NULL,
  unit TEXT NOT NULL,
  address TEXT NOT NULL,
  counterIndex INTEGER NOT NULL,
  pubkey TEXT NOT NULL,
  amountRequested INTEGER,
  amountPaid INTEGER NOT NULL DEFAULT 0,
  amountIssued INTEGER NOT NULL DEFAULT 0,
  expiry INTEGER,
  watchUntil TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT
)`

const MINT = 'https://mint.test'
const NOW = new Date('2026-07-13T12:00:00.000Z')
const iso = (d: Date) => d.toISOString()
const daysFromNow = (n: number) => iso(new Date(NOW.getTime() + n * 86400000))

// ── Mirrored repo primitives (exact production SQL) ─────────────────────────

const COLS = `quote, mintUrl, unit, address, counterIndex, pubkey, amountRequested,
              amountPaid, amountIssued, expiry, watchUntil, createdAt, updatedAt`

function addQuote(
    db: DatabaseSync,
    q: {
        quote: string
        counterIndex: number
        amountRequested?: number | null
        amountPaid?: number
        amountIssued?: number
        watchUntil?: string
    },
) {
    db.prepare(
        `INSERT OR REPLACE INTO onchain_mint_quotes (${COLS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        q.quote,
        MINT,
        'sat',
        `bc1q${q.quote}`,
        q.counterIndex,
        `02${'a'.repeat(64)}`,
        q.amountRequested ?? null,
        q.amountPaid ?? 0,
        q.amountIssued ?? 0,
        null, // expiry: the mint returns null
        q.watchUntil ?? daysFromNow(7),
        iso(NOW),
        iso(NOW),
    )
}

const getQuote = (db: DatabaseSync, quote: string): any =>
    db.prepare(`SELECT ${COLS} FROM onchain_mint_quotes WHERE quote = ?`).get(quote)

function updateAmounts(db: DatabaseSync, quote: string, paid: number, issued: number) {
    db.prepare(
        `UPDATE onchain_mint_quotes
         SET amountPaid = MAX(amountPaid, ?),
             amountIssued = MAX(amountIssued, ?),
             updatedAt = ?
         WHERE quote = ?`,
    ).run(paid, issued, iso(NOW), quote)
}

const getWatched = (db: DatabaseSync, now: Date = NOW): any[] =>
    db
        .prepare(
            `SELECT ${COLS} FROM onchain_mint_quotes
             WHERE amountPaid > amountIssued
                OR (amountIssued = 0 AND watchUntil > ?)
             ORDER BY createdAt DESC`,
        )
        .all(iso(now))

function extendWatch(db: DatabaseSync, quote: string, days: number) {
    db.prepare(`UPDATE onchain_mint_quotes SET watchUntil = ?, updatedAt = ? WHERE quote = ?`).run(
        daysFromNow(days),
        iso(NOW),
        quote,
    )
}

const watchedIds = (db: DatabaseSync, now?: Date) => getWatched(db, now).map(r => r.quote).sort()

describe('onchain mint quotes', () => {
    let db: DatabaseSync

    beforeEach(() => {
        db = new DatabaseSync(':memory:')
        db.exec(CREATE_ONCHAIN_MINT_QUOTES)
    })

    describe('the watch rule', () => {
        it('watches a fresh unpaid quote (window still open)', () => {
            addQuote(db, {quote: 'q1', counterIndex: 0})

            expect(watchedIds(db)).toEqual(['q1'])
        })

        it('stops watching an unpaid quote once the window closes', () => {
            // nothing ever arrived, and the mint will never expire the address for
            // us — so the wallet has to draw the line itself
            addQuote(db, {quote: 'q1', counterIndex: 0, watchUntil: daysFromNow(-1)})

            expect(watchedIds(db)).toEqual([])
        })

        it('watches a quote with credited-but-unminted funds', () => {
            addQuote(db, {quote: 'q1', counterIndex: 0, amountPaid: 50000, amountIssued: 0})

            expect(watchedIds(db)).toEqual(['q1'])
        })

        it('stops watching once the quote is fully drained (the "stop after first mint" case)', () => {
            addQuote(db, {quote: 'q1', counterIndex: 0, amountPaid: 50000, amountIssued: 50000})

            expect(watchedIds(db)).toEqual([])
        })

        it('KEEPS watching a PARTIALLY drained quote — money is still credited', () => {
            // The reason the rule keys on the unminted BALANCE and not on "has ever
            // minted". Keying on amountIssued > 0 would archive this and abandon
            // 20k sat the mint is holding for us.
            addQuote(db, {quote: 'q1', counterIndex: 0, amountPaid: 70000, amountIssued: 50000})

            expect(watchedIds(db)).toEqual(['q1'])
        })

        it('watches credited funds even after the window has closed', () => {
            // the deadline bounds quotes nobody paid; it must never override money
            // that is actually sitting at the mint
            addQuote(db, {
                quote: 'q1',
                counterIndex: 0,
                amountPaid: 50000,
                amountIssued: 0,
                watchUntil: daysFromNow(-30),
            })

            expect(watchedIds(db)).toEqual(['q1'])
        })

        it('separates watched from archived across a realistic mix', () => {
            addQuote(db, {quote: 'fresh', counterIndex: 0})
            addQuote(db, {quote: 'drained', counterIndex: 1, amountPaid: 10000, amountIssued: 10000})
            addQuote(db, {quote: 'unpaid-expired', counterIndex: 2, watchUntil: daysFromNow(-1)})
            addQuote(db, {quote: 'has-funds', counterIndex: 3, amountPaid: 30000, amountIssued: 0})
            addQuote(db, {
                quote: 'partly-drained',
                counterIndex: 4,
                amountPaid: 30000,
                amountIssued: 10000,
            })

            expect(watchedIds(db)).toEqual(['fresh', 'has-funds', 'partly-drained'])
        })
    })

    describe('amount updates are monotonic', () => {
        it('applies a normal forward update', () => {
            addQuote(db, {quote: 'q1', counterIndex: 0})

            updateAmounts(db, 'q1', 50000, 0)

            expect(getQuote(db, 'q1')).toMatchObject({amountPaid: 50000, amountIssued: 0})
        })

        it('ignores a stale response that would walk amounts BACKWARDS', () => {
            // A slow reply landing after a fresh one must not resurrect an old view.
            // If amountIssued regressed, the wallet would see unminted money that is
            // not there — and mint it a second time.
            addQuote(db, {quote: 'q1', counterIndex: 0, amountPaid: 50000, amountIssued: 50000})

            updateAmounts(db, 'q1', 50000, 0) // stale: "nothing issued yet"

            expect(getQuote(db, 'q1')).toMatchObject({amountPaid: 50000, amountIssued: 50000})
            expect(watchedIds(db)).toEqual([]) // still archived, not resurrected
        })

        it('records a second deposit arriving on the same address', () => {
            addQuote(db, {quote: 'q1', counterIndex: 0, amountPaid: 50000, amountIssued: 50000})
            expect(watchedIds(db)).toEqual([])

            updateAmounts(db, 'q1', 70000, 50000) // someone paid the address again

            expect(watchedIds(db)).toEqual(['q1']) // unminted balance -> back in the watch set
        })
    })

    describe('archived quotes stay recoverable', () => {
        it('keeps the row, and with it the NUT-20 counterIndex', () => {
            // counterIndex is the only way to re-derive the key that signs a mint
            // request for this quote. Delete the row and a late deposit becomes
            // permanently unspendable.
            addQuote(db, {quote: 'q1', counterIndex: 42, amountPaid: 10000, amountIssued: 10000})

            expect(watchedIds(db)).toEqual([]) // archived
            expect(getQuote(db, 'q1')).toMatchObject({counterIndex: 42, address: 'bc1qq1'})
        })

        it('re-opens the watch window on user request', () => {
            addQuote(db, {quote: 'q1', counterIndex: 0, watchUntil: daysFromNow(-1)})
            expect(watchedIds(db)).toEqual([])

            extendWatch(db, 'q1', 7) // "check for deposits" from the transaction detail

            expect(watchedIds(db)).toEqual(['q1'])
        })
    })

    describe('the requested amount is only a hint', () => {
        it('keeps amountRequested separate from what was actually paid', () => {
            // The BIP21 amount is a suggestion the sender can ignore. Under- and
            // overpayment are normal, so the two must never be conflated.
            addQuote(db, {quote: 'q1', counterIndex: 0, amountRequested: 50000})

            updateAmounts(db, 'q1', 42000, 0) // sender underpaid

            expect(getQuote(db, 'q1')).toMatchObject({amountRequested: 50000, amountPaid: 42000})
        })

        it('allows a null requested amount', () => {
            addQuote(db, {quote: 'q1', counterIndex: 0, amountRequested: null})

            expect(getQuote(db, 'q1').amountRequested).toBeNull()
        })
    })
})
