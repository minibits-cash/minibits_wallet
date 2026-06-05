import {getInstance} from './instance'
import {dbError} from './errors'
import {log} from '../logService'
import {StoredMeltPreview} from '../cashu/cashuUtils'

// ─────────────────────────────────────────────────────────────────────────────
// Melt recovery data.
//
// Per-transaction serialized `meltPreview` (the blinded change outputData) for
// outgoing lightning payments. Written SYNCHRONOUSLY before the melt is
// submitted so a paid-but-unconfirmed melt can always be recovered and its
// change ecash unblinded — previously held on the MST MintProofsCounter and
// persisted only via the debounced whole-tree MMKV snapshot, which risked
// losing the preview (and the change) on a crash right after submission.
//
// A row exists only while a melt is in-flight; it is deleted on terminal
// success/failure. Keyed by transactionId.
// ─────────────────────────────────────────────────────────────────────────────

export type MeltRecoveryRecord = {
  transactionId: number
  mintUrl: string | null
  keysetId: string | null
  meltPreview: StoredMeltPreview
  createdAt: string | null
}

/** A single melt-recovery entry for the one-time seed from the MST/MMKV snapshot. */
export type MeltRecoverySeed = {
  transactionId: number
  mintUrl?: string
  keysetId?: string
  meltPreview: StoredMeltPreview
}

/**
 * Store the meltPreview for a transaction. Idempotent: the FIRST stored preview
 * for a transaction wins (ON CONFLICT DO NOTHING), matching the previous
 * addMeltCounterValue "already tracked" guard. Synchronous.
 */
export const addMeltRecovery = function (
  transactionId: number,
  mintUrl: string | undefined,
  keysetId: string | undefined,
  meltPreview: StoredMeltPreview,
): void {
  try {
    getInstance().execute(
      `INSERT INTO melt_recovery (transactionId, mintUrl, keysetId, meltPreview, createdAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(transactionId) DO NOTHING`,
      [transactionId, mintUrl ?? null, keysetId ?? null, JSON.stringify(meltPreview), new Date().toISOString()],
    )
  } catch (e: any) {
    throw dbError('Melt recovery could not be saved to the database', e)
  }
}

/** Read the melt-recovery entry for a transaction, or undefined. */
export const getMeltRecovery = function (transactionId: number): MeltRecoveryRecord | undefined {
  try {
    const {rows} = getInstance().execute(
      `SELECT transactionId, mintUrl, keysetId, meltPreview, createdAt FROM melt_recovery WHERE transactionId = ?`,
      [transactionId],
    )
    const row = rows?.item(0)
    if (!row) return undefined
    return {
      transactionId: row.transactionId,
      mintUrl: row.mintUrl,
      keysetId: row.keysetId,
      meltPreview: JSON.parse(row.meltPreview) as StoredMeltPreview,
      createdAt: row.createdAt,
    }
  } catch (e: any) {
    throw dbError('Melt recovery could not be retrieved from the database', e)
  }
}

/** Delete the melt-recovery entry for a transaction (terminal success/failure). */
export const removeMeltRecovery = function (transactionId: number): void {
  try {
    getInstance().execute(`DELETE FROM melt_recovery WHERE transactionId = ?`, [transactionId])
  } catch (e: any) {
    throw dbError('Melt recovery could not be removed from the database', e)
  }
}

/**
 * One-time, idempotent copy of MST/MMKV-resident melt previews into SQLite. Used
 * by the upgrade migration to carry over a melt that was in-flight at upgrade.
 */
export const seedMeltRecoveries = function (seeds: MeltRecoverySeed[]): {seeded: number} {
  if (!seeds || seeds.length === 0) return {seeded: 0}
  try {
    const now = new Date().toISOString()
    const db = getInstance()
    db.executeBatch(
      seeds.map(s => [
        `INSERT INTO melt_recovery (transactionId, mintUrl, keysetId, meltPreview, createdAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(transactionId) DO NOTHING`,
        [s.transactionId, s.mintUrl ?? null, s.keysetId ?? null, JSON.stringify(s.meltPreview), now],
      ]),
    )
    log.info('[seedMeltRecoveries]', 'Seeded melt recovery entries into SQLite', {count: seeds.length})
    return {seeded: seeds.length}
  } catch (e: any) {
    throw dbError('Melt recovery entries could not be seeded into the database', e)
  }
}
