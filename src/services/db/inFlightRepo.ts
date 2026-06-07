import {getInstance} from './instance'
import {dbError} from './errors'
import {log} from '../logService'

// ─────────────────────────────────────────────────────────────────────────────
// In-flight mint/swap requests.
//
// Per-transaction request params for an operation that has hit the mint but
// whose response may be lost (network failure). Written before the network call
// so the op can be safely retried against the mint's idempotent (NUT-19 cached)
// endpoint. Previously held on the MST MintProofsCounter; moved here so retries
// work with no MST loaded (off-MST background).
//
// A row exists only while a request is in-flight; it is deleted on success or
// terminal failure. Keyed by transactionId.
// ─────────────────────────────────────────────────────────────────────────────

export type InFlightRequestRecord = {
  transactionId: number
  mintUrl: string | null
  keysetId: string | null
  request: any
  createdAt: string | null
}

/** A single in-flight entry for the one-time seed from the MST/MMKV snapshot. */
export type InFlightRequestSeed = {
  transactionId: number
  mintUrl?: string
  keysetId?: string
  request: any
}

const rowToRecord = (row: any): InFlightRequestRecord => ({
  transactionId: row.transactionId,
  mintUrl: row.mintUrl,
  keysetId: row.keysetId,
  request: JSON.parse(row.request),
  createdAt: row.createdAt,
})

/**
 * Store (or replace) the in-flight request for a transaction. Overwrites an
 * existing row — matching the previous addInFlightRequest set() semantics.
 */
export const addInFlightRequest = function (
  transactionId: number,
  mintUrl: string | undefined,
  keysetId: string | undefined,
  request: any,
): void {
  try {
    getInstance().execute(
      `INSERT OR REPLACE INTO inflight_requests (transactionId, mintUrl, keysetId, request, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [transactionId, mintUrl ?? null, keysetId ?? null, JSON.stringify(request), new Date().toISOString()],
    )
  } catch (e: any) {
    throw dbError('In-flight request could not be saved to the database', e)
  }
}

/** Read the in-flight request for a transaction, or undefined. */
export const getInFlightRequest = function (transactionId: number): InFlightRequestRecord | undefined {
  try {
    const {rows} = getInstance().execute(
      `SELECT transactionId, mintUrl, keysetId, request, createdAt FROM inflight_requests WHERE transactionId = ?`,
      [transactionId],
    )
    const row = rows?.item(0)
    return row ? rowToRecord(row) : undefined
  } catch (e: any) {
    throw dbError('In-flight request could not be retrieved from the database', e)
  }
}

/** All in-flight requests for a mint (drives the per-mint recovery sweep). */
export const getInFlightRequestsByMint = function (mintUrl: string): InFlightRequestRecord[] {
  try {
    const {rows} = getInstance().execute(
      `SELECT transactionId, mintUrl, keysetId, request, createdAt FROM inflight_requests WHERE mintUrl = ?`,
      [mintUrl],
    )
    return (rows?._array ?? []).map(rowToRecord)
  } catch (e: any) {
    throw dbError('In-flight requests could not be retrieved from the database', e)
  }
}

/** Delete the in-flight request for a transaction (success/terminal failure). */
export const removeInFlightRequest = function (transactionId: number): void {
  try {
    getInstance().execute(`DELETE FROM inflight_requests WHERE transactionId = ?`, [transactionId])
  } catch (e: any) {
    throw dbError('In-flight request could not be removed from the database', e)
  }
}

/**
 * One-time, idempotent copy of MST/MMKV-resident in-flight requests into SQLite.
 * Used by the upgrade migration to carry over a request in-flight at upgrade.
 */
export const seedInFlightRequests = function (seeds: InFlightRequestSeed[]): {seeded: number} {
  if (!seeds || seeds.length === 0) return {seeded: 0}
  try {
    const now = new Date().toISOString()
    getInstance().executeBatch(
      seeds.map(s => [
        `INSERT INTO inflight_requests (transactionId, mintUrl, keysetId, request, createdAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(transactionId) DO NOTHING`,
        [s.transactionId, s.mintUrl ?? null, s.keysetId ?? null, JSON.stringify(s.request), now],
      ]),
    )
    log.info('[seedInFlightRequests]', 'Seeded in-flight requests into SQLite', {count: seeds.length})
    return {seeded: seeds.length}
  } catch (e: any) {
    throw dbError('In-flight requests could not be seeded into the database', e)
  }
}
