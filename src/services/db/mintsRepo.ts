import {SQLBatchTuple} from './connection'
import {getInstance} from './instance'
import {dbError} from './errors'
import {log} from '../logService'

// ─────────────────────────────────────────────────────────────────────────────
// Mints and their keysets.
//
// The authority for the wallet's mints. They were the last core entity persisted
// only by serializing the whole MST tree to MMKV — and since proofs and
// transactions are stripped from that snapshot, mints (with every keyset's `keys`
// map) had become the largest thing left in it, re-serialized on EVERY MST action
// anywhere in the tree.
//
// As with proofs and transactions: SQLite is the authority, the MST model is an
// in-memory cache. Reads go through the model (MobX cannot observe a table);
// writes land here.
//
// See MINTS_COLUMNS / MINT_KEYSETS_COLUMNS for why the keyset and keys payloads are
// stored as whole JSON objects rather than exploded into columns.
// ─────────────────────────────────────────────────────────────────────────────

/** A mint row plus its keysets, shaped to drop straight into MintModel.create. */
export type MintRecord = {
  id: string
  mintUrl: string
  hostname?: string
  shortname?: string
  units: string[]
  keysets: any[]
  keys: any[]
  mintInfo?: any
  color?: string
  status?: string
  createdAt?: string
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/**
 * Build the full write for one mint: the mint row plus a row per keyset.
 *
 * Returned as batch tuples so the same write can run standalone (upsertMint) or be
 * folded into a larger transaction — which is what lets a mint-url edit commit
 * atomically with the proofs it renames.
 *
 * Keysets are upserted, never cleared-and-reinserted: a keyset is only ever added
 * (refreshKeysets does not prune, and removeKeyset is unused), and a delete/insert
 * pair would briefly leave a mint with no keys inside the transaction.
 */
export const buildMintUpsert = function (mint: MintRecord): SQLBatchTuple[] {
  const batch: SQLBatchTuple[] = [
    [
      `INSERT INTO mints (id, mintUrl, hostname, shortname, color, status, units, mintInfo, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         mintUrl = excluded.mintUrl,
         hostname = excluded.hostname,
         shortname = excluded.shortname,
         color = excluded.color,
         status = excluded.status,
         units = excluded.units,
         mintInfo = excluded.mintInfo`,
      [
        mint.id,
        mint.mintUrl,
        mint.hostname ?? null,
        mint.shortname ?? null,
        mint.color ?? null,
        mint.status ?? null,
        JSON.stringify(mint.units ?? []),
        mint.mintInfo ? JSON.stringify(mint.mintInfo) : null,
        mint.createdAt ?? new Date().toISOString(),
      ],
    ],
  ]

  const keysById = new Map<string, any>((mint.keys ?? []).map(k => [k.id, k]))

  for (const keyset of mint.keysets ?? []) {
    const keys = keysById.get(keyset.id)
    batch.push([
      `INSERT INTO mint_keysets (keysetId, mintId, unit, keyset, keys)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(keysetId) DO UPDATE SET
         mintId = excluded.mintId,
         unit = excluded.unit,
         keyset = excluded.keyset,
         -- Never overwrite stored keys with null: a keyset's keys are fetched
         -- separately from its metadata, so a metadata-only refresh must not erase
         -- them (without keys the wallet cannot verify or spend that keyset).
         keys = COALESCE(excluded.keys, mint_keysets.keys)`,
      [keyset.id, mint.id, keyset.unit ?? null, JSON.stringify(keyset), keys ? JSON.stringify(keys) : null],
    ])
  }

  return batch
}

/** Write one mint (and its keysets) atomically. */
export const upsertMint = function (mint: MintRecord): void {
  try {
    getInstance().executeBatch(buildMintUpsert(mint))
  } catch (e: any) {
    throw dbError('Mint could not be saved to the database', e)
  }
}

/** Every mint with its keysets, for the startup hydrate. */
export const getMints = function (): MintRecord[] {
  try {
    const db = getInstance()
    const {rows: mintRows} = db.execute(
      `SELECT id, mintUrl, hostname, shortname, color, status, units, mintInfo, createdAt
       FROM mints ORDER BY createdAt`,
    )
    const {rows: keysetRows} = db.execute(`SELECT keysetId, mintId, unit, keyset, keys FROM mint_keysets`)

    const keysetsByMint = new Map<string, {keysets: any[]; keys: any[]}>()
    for (const row of keysetRows?._array ?? []) {
      const entry = keysetsByMint.get(row.mintId) ?? {keysets: [], keys: []}
      entry.keysets.push(parseJson(row.keyset, null))
      // A keyset whose keys were never fetched contributes nothing to `keys`,
      // matching the model, where the two arrays are independent.
      const keys = parseJson<any>(row.keys, null)
      if (keys) entry.keys.push(keys)
      keysetsByMint.set(row.mintId, entry)
    }

    return (mintRows?._array ?? []).map((row: any) => {
      const owned = keysetsByMint.get(row.id) ?? {keysets: [], keys: []}
      return {
        id: row.id,
        mintUrl: row.mintUrl,
        hostname: row.hostname ?? undefined,
        shortname: row.shortname ?? undefined,
        units: parseJson<string[]>(row.units, []),
        keysets: owned.keysets.filter(Boolean),
        keys: owned.keys,
        mintInfo: parseJson<any>(row.mintInfo, undefined),
        color: row.color ?? undefined,
        status: row.status ?? undefined,
        createdAt: row.createdAt ?? undefined,
      }
    })
  } catch (e: any) {
    throw dbError('Mints could not be retrieved from the database', e)
  }
}

/**
 * Remove a mint and its keysets.
 *
 * Its mint_counters rows are deliberately left behind: they are keyed by keysetId
 * and retained across removal, so re-adding the mint recovers its real derivation
 * counter instead of restarting at 0 (see MINT_COUNTERS_COLUMNS).
 */
export const removeMintById = function (mintId: string): void {
  try {
    getInstance().executeBatch([
      [`DELETE FROM mint_keysets WHERE mintId = ?`, [mintId]],
      [`DELETE FROM mints WHERE id = ?`, [mintId]],
    ])
    log.debug('[removeMintById]', 'Mint removed from the database', {mintId})
  } catch (e: any) {
    throw dbError('Mint could not be removed from the database', e)
  }
}

/**
 * Point a mint at a new url, together with the proofs that reference it — in ONE
 * transaction.
 *
 * This is the whole reason mints belong in SQLite. Before, the mint's url lived in
 * the MMKV snapshot and its proofs in SQLite, so a rename spanned two engines with
 * no transaction between them. A crash in that window left the proofs pointing at a
 * url no mint owned: the money vanished from every per-mint balance while still
 * counting toward the total, and was unspendable, because send and melt select
 * proofs by mint.
 *
 * `proofs.mintUrl` stays denormalized, but it can no longer drift — it is now
 * maintained inside the same transaction as its source of truth.
 */
export const updateMintUrl = function (
  mintId: string,
  currentMintUrl: string,
  updatedMintUrl: string,
  hostname: string | null,
): void {
  try {
    getInstance().executeBatch([
      [`UPDATE mints SET mintUrl = ?, hostname = ? WHERE id = ?`, [updatedMintUrl, hostname, mintId]],
      [`UPDATE proofs SET mintUrl = ? WHERE mintUrl = ?`, [updatedMintUrl, currentMintUrl]],
    ])
    log.debug('[updateMintUrl]', 'Mint url updated with its proofs', {
      mintId,
      currentMintUrl,
      updatedMintUrl,
    })
  } catch (e: any) {
    throw dbError('Mint url could not be updated in the database', e)
  }
}

/**
 * One-time copy of the MST/MMKV-resident mints into SQLite (the v39 seed).
 *
 * Idempotent by construction: it upserts by the mint's own id, so re-running it
 * cannot duplicate a mint. Runs in a single batch.
 */
export const seedMints = function (mints: MintRecord[]): {seeded: number} {
  if (!mints || mints.length === 0) return {seeded: 0}
  try {
    const batch = mints.flatMap(buildMintUpsert)
    getInstance().executeBatch(batch)
    log.info('[seedMints]', 'Seeded mints into SQLite', {count: mints.length})
    return {seeded: mints.length}
  } catch (e: any) {
    throw dbError('Mints could not be seeded into the database', e)
  }
}
