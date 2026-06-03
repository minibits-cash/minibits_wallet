import {SQLBatchTuple} from './connection'
import {getInstance} from './instance'
import {dbError} from './errors'
import {log} from '../logService'

// ─────────────────────────────────────────────────────────────────────────────
// Per-keyset deterministic-derivation counters.
//
// The `counter` is the BIP32 derivation high-water mark for a (mint, keyset)
// pair. It was previously held only in the MST `MintProofsCounter` model and
// persisted to MMKV via the whole-tree snapshot — a separate persistence engine
// from the proofs the counter derives, committed at a different moment. That
// cross-engine gap meant a crash between "counter advanced" (MMKV) and "proofs
// written" (SQLite) could desync them and risk blinded-secret reuse.
//
// This repo makes SQLite the authority for the counter so the advance can later
// be folded into the SAME transaction as the proof writes. Every write here is
// MONOTONIC: a counter can never move backward. That single invariant is what
// makes the MMKV→SQLite migration safe — a stale or racing writer can only ever
// be a no-op, never a regression.
// ─────────────────────────────────────────────────────────────────────────────

export type CounterRecord = {
  mintUrl: string
  keysetId: string
  unit: string | null
  counter: number
  updatedAt: string | null
}

/** A single (mint, keyset, value) tuple for the one-time seed from MST/MMKV. */
export type CounterSeed = {
  mintUrl: string
  keysetId: string
  unit?: string
  counter: number
}

/** Read every counter row. Used to hydrate the in-memory MST cache on startup. */
export const getCounters = function (): CounterRecord[] {
  try {
    const db = getInstance()
    const {rows} = db.execute(`SELECT mintUrl, keysetId, unit, counter, updatedAt FROM mint_counters`)
    return (rows?._array ?? []) as CounterRecord[]
  } catch (e: any) {
    throw dbError('Counters could not be retrieved from the database', e)
  }
}

/** Read a single counter, or undefined when no row exists yet. */
export const getCounter = function (
  mintUrl: string,
  keysetId: string,
): CounterRecord | undefined {
  try {
    const db = getInstance()
    const {rows} = db.execute(
      `SELECT mintUrl, keysetId, unit, counter, updatedAt FROM mint_counters WHERE mintUrl = ? AND keysetId = ?`,
      [mintUrl, keysetId],
    )
    return rows?.item(0) as CounterRecord | undefined
  } catch (e: any) {
    throw dbError('Counter could not be retrieved from the database', e)
  }
}

/**
 * Set a counter to an absolute value, MONOTONICALLY: the stored value only ever
 * rises to `MAX(existing, value)`. This is the write-back used after a cashu
 * operation reports its `next` counter, and the primitive the idempotent seed is
 * built on. A lower `value` (stale cache, replayed op) is silently ignored.
 */
export const setCounter = function (
  mintUrl: string,
  keysetId: string,
  unit: string | undefined,
  value: number,
): void {
  try {
    const db = getInstance()
    db.execute(
      `INSERT INTO mint_counters (mintUrl, keysetId, unit, counter, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(mintUrl, keysetId) DO UPDATE SET
         counter = MAX(counter, excluded.counter),
         unit = excluded.unit,
         updatedAt = excluded.updatedAt`,
      [mintUrl, keysetId, unit ?? null, value, new Date().toISOString()],
    )
  } catch (e: any) {
    throw dbError('Counter could not be saved to the database', e)
  }
}

/**
 * Advance a counter by `delta` (the error-healing / increaseCounterBy path).
 * Relative, so it always moves forward by construction; an absent row starts
 * from 0 and becomes `delta`.
 */
export const bumpCounter = function (
  mintUrl: string,
  keysetId: string,
  unit: string | undefined,
  delta: number,
): void {
  if (delta <= 0) return
  try {
    const db = getInstance()
    db.execute(
      `INSERT INTO mint_counters (mintUrl, keysetId, unit, counter, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(mintUrl, keysetId) DO UPDATE SET
         counter = counter + ?,
         updatedAt = excluded.updatedAt`,
      [mintUrl, keysetId, unit ?? null, delta, new Date().toISOString(), delta],
    )
  } catch (e: any) {
    throw dbError('Counter could not be advanced in the database', e)
  }
}

/**
 * One-time, idempotent copy of the MST/MMKV counters into SQLite. Each entry is
 * applied through the same monotonic upsert as `setCounter`, so:
 *   - re-running it can never lower a value (safe to call on every startup),
 *   - a seed value lower than what SQLite already holds is ignored (the wallet
 *     has since advanced past it),
 *   - the conservative-safe direction (a too-high seed) only ever skips indices,
 *     never reuses them.
 * Done in a single batch transaction.
 */
export const seedCounters = function (seeds: CounterSeed[]): {seeded: number} {
  if (!seeds || seeds.length === 0) return {seeded: 0}
  try {
    const now = new Date().toISOString()
    const batch: SQLBatchTuple[] = seeds.map(s => [
      `INSERT INTO mint_counters (mintUrl, keysetId, unit, counter, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(mintUrl, keysetId) DO UPDATE SET
         counter = MAX(counter, excluded.counter),
         unit = excluded.unit,
         updatedAt = excluded.updatedAt`,
      [s.mintUrl, s.keysetId, s.unit ?? null, s.counter, now],
    ])

    const db = getInstance()
    db.executeBatch(batch)

    log.info('[seedCounters]', 'Seeded derivation counters into SQLite', {count: seeds.length})
    return {seeded: seeds.length}
  } catch (e: any) {
    throw dbError('Counters could not be seeded into the database', e)
  }
}
