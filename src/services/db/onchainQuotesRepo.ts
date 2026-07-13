import {getInstance} from './instance'
import {dbError} from './errors'
import {log} from '../logService'

// ─────────────────────────────────────────────────────────────────────────────
// Onchain (NUT-30) MINT quotes.
//
// A NUT-30 mint quote is a Bitcoin address, not a one-shot invoice. It can take
// several deposits, and the mint tracks `amount_paid` / `amount_issued` against
// it; the wallet mints the difference. That state cannot live on a transaction
// row — a transaction has one fixed amount — so it lives here, and transactions
// reference it through `transactions.quote` (N transactions : 1 quote, one per
// mint operation).
//
// Two properties of the spec drive everything below:
//
//  1. The mint returns `expiry: null` — the address NEVER dies. Funds sent to a
//     long-abandoned address stay creditable forever. So rows are kept forever
//     (never deleted), and `counterIndex` in particular must survive: it is the
//     NUT-20 derivation index, and the only way to re-derive the key needed to
//     sign a mint request for this quote. Delete it and the money is unspendable.
//
//  2. Because nothing expires server-side, nothing bounds polling of a quote that
//     was never paid. `watchUntil` is the wallet's own deadline for that, and
//     mirrors the 24h fallback bolt11 topup applies to an invoice with no expiry
//     tag.
//
// MELT quotes deliberately have no table: they are one-shot and terminal, so
// their durable state (quote id, outpoint, fee) fits on the transaction row.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long the wallet keeps checking a quote nobody has paid yet.
 *
 * Longer than bolt11's 24h invoice fallback: an onchain sender may reasonably pay
 * the next day, and confirmations add more on top. Expiring the WATCH does not
 * expire the FUNDS — the address still works, the row is still here, and the user
 * can re-check and mint a late deposit from the transaction detail.
 */
export const ONCHAIN_QUOTE_WATCH_DAYS = 7

export type OnchainMintQuoteRecord = {
  quote: string
  mintUrl: string
  unit: string
  address: string
  /** NUT-20 derivation index. Never lose this — see the note above. */
  counterIndex: number
  pubkey: string
  /** What the user asked for. A BIP21 hint the sender is free to ignore. */
  amountRequested: number | null
  /** Confirmed and eligible, per the mint. */
  amountPaid: number
  /** Already minted into ecash. */
  amountIssued: number
  expiry: number | null
  watchUntil: string
  createdAt: string
  updatedAt: string | null
}

const COLS = `quote, mintUrl, unit, address, counterIndex, pubkey, amountRequested,
              amountPaid, amountIssued, expiry, watchUntil, createdAt, updatedAt`

/**
 * Persist a freshly created quote.
 *
 * Called immediately after the mint returns the address, and BEFORE it is shown
 * to the user: if the app dies between the two, the row (and with it the burned
 * NUT-20 index) is already safe, so a deposit to that address remains mintable.
 */
export const addOnchainMintQuote = function (
  q: Omit<OnchainMintQuoteRecord, 'amountPaid' | 'amountIssued' | 'createdAt' | 'updatedAt' | 'watchUntil'> & {
    amountPaid?: number
    amountIssued?: number
    watchUntil?: string
  },
): void {
  try {
    const now = new Date()
    const watchUntil =
      q.watchUntil ??
      new Date(now.getTime() + ONCHAIN_QUOTE_WATCH_DAYS * 24 * 60 * 60 * 1000).toISOString()

    getInstance().execute(
      `INSERT OR REPLACE INTO onchain_mint_quotes (${COLS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        q.quote,
        q.mintUrl,
        q.unit,
        q.address,
        q.counterIndex,
        q.pubkey,
        q.amountRequested ?? null,
        q.amountPaid ?? 0,
        q.amountIssued ?? 0,
        q.expiry ?? null,
        watchUntil,
        now.toISOString(),
        now.toISOString(),
      ],
    )

    log.debug('[addOnchainMintQuote]', {quote: q.quote, mintUrl: q.mintUrl})
  } catch (e: any) {
    throw dbError('Onchain mint quote could not be saved to the database', e)
  }
}

/** One quote by id, or undefined. */
export const getOnchainMintQuote = function (quote: string): OnchainMintQuoteRecord | undefined {
  try {
    const {rows} = getInstance().execute(
      `SELECT ${COLS} FROM onchain_mint_quotes WHERE quote = ?`,
      [quote],
    )
    return rows?.item(0) as OnchainMintQuoteRecord | undefined
  } catch (e: any) {
    throw dbError('Onchain mint quote could not be retrieved from the database', e)
  }
}

/**
 * Record what the mint currently reports for a quote.
 *
 * MONOTONIC, like the derivation counters: `amount_paid` and `amount_issued` only
 * ever rise at the mint, so a stale or out-of-order response can only be a no-op,
 * never a regression. Without this, a slow reply arriving after a fresh one could
 * walk `amountIssued` backwards and make the wallet think there is unminted money
 * where there is none — and mint it twice.
 */
export const updateOnchainMintQuoteAmounts = function (
  quote: string,
  amountPaid: number,
  amountIssued: number,
): void {
  try {
    getInstance().execute(
      `UPDATE onchain_mint_quotes
       SET amountPaid = MAX(amountPaid, ?),
           amountIssued = MAX(amountIssued, ?),
           updatedAt = ?
       WHERE quote = ?`,
      [amountPaid, amountIssued, new Date().toISOString(), quote],
    )
  } catch (e: any) {
    throw dbError('Onchain mint quote amounts could not be updated in the database', e)
  }
}

/**
 * Quotes the wallet should still be checking.
 *
 *   amountPaid > amountIssued                    -> money is credited but not yet
 *                                                   minted. Watch regardless of any
 *                                                   deadline: we must never walk away
 *                                                   from funds the mint is holding.
 *   amountIssued = 0 AND watchUntil > now        -> nothing has arrived yet and the
 *                                                   window is still open.
 *
 * Everything else is archived: fully drained (the "stop after the first mint" case),
 * or never paid within the window. Archived rows are NOT deleted — a late deposit is
 * still creditable, and the user can re-check from the transaction detail.
 *
 * Note the first clause is about the unminted BALANCE, not about "has ever minted".
 * Keying on `amountIssued > 0` would abandon a partially-drained quote with real
 * money still credited to it.
 */
export const getWatchedOnchainMintQuotes = function (): OnchainMintQuoteRecord[] {
  try {
    const {rows} = getInstance().execute(
      `SELECT ${COLS} FROM onchain_mint_quotes
       WHERE amountPaid > amountIssued
          OR (amountIssued = 0 AND watchUntil > ?)
       ORDER BY createdAt DESC`,
      [new Date().toISOString()],
    )
    return (rows?._array ?? []) as OnchainMintQuoteRecord[]
  } catch (e: any) {
    throw dbError('Onchain mint quotes could not be retrieved from the database', e)
  }
}

/** Every quote for a mint, newest first. Drives the manual re-check. */
export const getOnchainMintQuotesByMint = function (mintUrl: string): OnchainMintQuoteRecord[] {
  try {
    const {rows} = getInstance().execute(
      `SELECT ${COLS} FROM onchain_mint_quotes WHERE mintUrl = ? ORDER BY createdAt DESC`,
      [mintUrl],
    )
    return (rows?._array ?? []) as OnchainMintQuoteRecord[]
  } catch (e: any) {
    throw dbError('Onchain mint quotes could not be retrieved from the database', e)
  }
}

/**
 * Reopen the watch window on a quote — the user asking "did anything else arrive?"
 * from the transaction detail, after the quote had been archived.
 */
export const extendOnchainMintQuoteWatch = function (
  quote: string,
  days: number = ONCHAIN_QUOTE_WATCH_DAYS,
): void {
  try {
    const watchUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    getInstance().execute(
      `UPDATE onchain_mint_quotes SET watchUntil = ?, updatedAt = ? WHERE quote = ?`,
      [watchUntil, new Date().toISOString(), quote],
    )
    log.debug('[extendOnchainMintQuoteWatch]', {quote, watchUntil})
  } catch (e: any) {
    throw dbError('Onchain mint quote watch could not be extended in the database', e)
  }
}
