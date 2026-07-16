import {getInstance} from './instance'
import {dbError} from './errors'

// ─────────────────────────────────────────────────────────────────────────────
// Wallet-global deterministic-derivation counters, keyed by purpose name.
//
// Sibling of countersRepo, which owns the per-keyset NUT-13 counters. The
// counters here belong to derivation paths with NO keyset component, so one value
// serves the whole wallet. First user: NUT-20 quote-locking keys
// (`m/129373'/20'/0'/0'/{counter}`).
//
// The stored `counter` is the NEXT FREE index. Allocation is BURN-FORWARD: the
// increment is committed BEFORE the caller uses the index, so a failed mint call
// or a crash can only ever SKIP an index, never hand the same one out twice.
// That direction matters — two NUT-20 quotes sharing a pubkey would let the mint
// link them (defeating the point of a per-quote key) and make signatures
// ambiguous. Gaps are harmless; a future recovery scan handles them with a gap
// limit.
// ─────────────────────────────────────────────────────────────────────────────

/** Purpose name for the NUT-20 quote-locking counter. */
export const NUT20_COUNTER = 'nut20'

/**
 * Allocate the next free index for `name` and COMMIT it before returning.
 *
 * One atomic statement, so concurrent allocators (foreground and the NWC
 * background task) can never receive the same index. `RETURNING` needs SQLite
 * >= 3.35; op-sqlite 16.x bundles 3.51.
 *
 * The row starts at counter=1 on first insert and the statement returns
 * `counter - 1`, so the first index handed out is 0 and the stored value is
 * always the next free one.
 */
export const allocateNextCounter = function (name: string): number {
  try {
    const db = getInstance()
    const {rows} = db.execute(
      `INSERT INTO wallet_counters (name, counter, updatedAt)
       VALUES (?, 1, ?)
       ON CONFLICT(name) DO UPDATE SET
         counter = counter + 1,
         updatedAt = excluded.updatedAt
       RETURNING counter - 1 AS allocated`,
      [name, new Date().toISOString()],
    )

    const allocated = (rows?.item(0) as {allocated: number} | undefined)?.allocated

    if (typeof allocated !== 'number') {
      throw new Error('Allocation returned no index')
    }

    return allocated
  } catch (e: any) {
    throw dbError('Derivation counter could not be allocated in the database', e)
  }
}

/** Next free index for `name`; 0 when no row exists yet. */
export const getWalletCounter = function (name: string): number {
  try {
    const db = getInstance()
    const {rows} = db.execute(`SELECT counter FROM wallet_counters WHERE name = ?`, [name])
    return (rows?.item(0) as {counter: number} | undefined)?.counter ?? 0
  } catch (e: any) {
    throw dbError('Derivation counter could not be retrieved from the database', e)
  }
}

/**
 * Set a counter to an absolute value, MONOTONICALLY: the stored value only ever
 * rises to `MAX(existing, value)`, mirroring countersRepo.setCounter. A lower
 * value (stale writer, replayed op) is silently ignored, so this can never walk
 * the wallet back onto an index it has already handed out.
 *
 * For healing and for a future recovery scan that discovers used indices beyond
 * the local high-water mark.
 */
export const setWalletCounter = function (name: string, value: number): void {
  try {
    const db = getInstance()
    db.execute(
      `INSERT INTO wallet_counters (name, counter, updatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         counter = MAX(counter, excluded.counter),
         updatedAt = excluded.updatedAt`,
      [name, value, new Date().toISOString()],
    )
  } catch (e: any) {
    throw dbError('Derivation counter could not be saved to the database', e)
  }
}
