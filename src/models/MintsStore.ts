import {
    Instance,
    SnapshotOut,
    types,
    destroy,
    isStateTreeNode,
    detach,
    flow,
    onSnapshot,
    getSnapshot,
    IDisposer,
  } from 'mobx-state-tree'
  import {withSetPropAction} from './helpers/withSetPropAction'
  import {MintModel, Mint, MintProofsCounter} from './Mint'
  import {normalizeMintUrl} from '../services/cashu/mintUrl'
  import {log} from '../services/logService'
  // Direct import, not the '../services' barrel — see the note in Mint.ts.
  import {Database} from '../services/db'
  import type {MintRecord} from '../services/db'
  import AppError, { Err } from '../utils/AppError'
  import {
    Mint as CashuMint,
    GetKeysetsResponse,
    GetKeysResponse,
  } from '@cashu/cashu-ts'

import { MintUnit } from '../services/wallet/currency'


  
export type MintsByHostname = {
    hostname: string
    mints: Mint[]
}

export type MintsByUnit = {
    unit: MintUnit
    mints: Mint[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-mint persistence.
//
// SQLite is the authority for mints; this model is the in-memory cache (the same
// split as proofs and transactions). Rather than call a write-through from each of
// the ~20 Mint mutators — where forgetting one is SILENT staleness, the exact bug
// class this whole effort has been about — each mint gets one onSnapshot observer
// that persists its row whenever anything in its subtree changes. It cannot be
// forgotten, and it gives ImportBackup persistence for free (applySnapshot fires it).
//
// Derivation counters are unaffected: `counter` is volatile, so it never appears in
// a snapshot and a bump never fires these.
// ─────────────────────────────────────────────────────────────────────────────

/** Project a Mint snapshot onto the row shape SQLite stores. */
const toMintRecord = (snapshot: any): MintRecord => ({
    id: snapshot.id,
    mintUrl: snapshot.mintUrl,
    hostname: snapshot.hostname,
    shortname: snapshot.shortname,
    units: [...(snapshot.units ?? [])],
    keysets: [...(snapshot.keysets ?? [])],
    keys: [...(snapshot.keys ?? [])],
    mintInfo: snapshot.mintInfo,
    color: snapshot.color,
    status: snapshot.status,
    // types.Date snapshots as a timestamp; the column stores ISO.
    createdAt: snapshot.createdAt ? new Date(snapshot.createdAt).toISOString() : undefined,
})

export const MintsStoreModel = types
    .model('MintsStore', {
        mints: types.array(MintModel),
        blockedMintUrls: types.array(types.string),
    })
    // counterBackups removed: a removed mint's counters are retained in SQLite
    // (mint_counters rows are never deleted) and restored on re-add via
    // hydrateCountersFromDatabase. Strip the field from any old snapshot so
    // applySnapshot tolerates it; pre-upgrade backup values are migrated into
    // SQLite by a one-time seed in setupRootStore._runMigrations.
    .preProcessSnapshot((s: any) => {
        if (!s) return s
        const {counterBackups, ...rest} = s
        return rest
    })
    /**
     * Mints are loaded from SQLite on startup; only blockedMintUrls is persisted
     * here. Same treatment as proofs and transactions, and the reason for the whole
     * move: mints (with every keyset's `keys` map) were the largest thing left in
     * the tree, and `JSON.stringify(snapshot)` runs on EVERY MST action anywhere —
     * including every proof mutation during a send. Stripping them takes that cost
     * off the hot path.
     *
     * NOTE for anything that reads the snapshot: `getSnapshot(mintsStore).mints` is
     * now ALWAYS empty. Code that wants the real mints must read the live instances
     * (see ExportBackupScreen, which does exactly that for proofs already).
     */
    .postProcessSnapshot(snapshot => ({
        // `as typeof snapshot.mints` keeps the element type: a bare [] would widen
        // the snapshot type to never[], and every reader of a mints snapshot (the
        // backup format above all) would stop type-checking against a real Mint.
        mints: [] as typeof snapshot.mints,
        blockedMintUrls: snapshot.blockedMintUrls,
    }))
    /**
     * Observer bookkeeping. VOLATILE, and on the store rather than at module scope:
     * this is per-store state, and a module-level map would be shared by every store
     * in the process — which production never notices (there is one root store) and
     * a test immediately does.
     */
    .volatile(() => ({
        /** Live per-mint observers, by mint id, so they can be disposed. */
        mintObservers: new Map<string, IDisposer>(),
        /** Last payload written per mint id — the equality guard's memory. */
        lastPersistedMints: new Map<string, string>(),
    }))
    .views(self => ({
        findByUrl: (mintUrl: string | URL) => {
            const mint = self.mints.find(m => m.mintUrl === mintUrl)
            return mint ? mint : undefined
        },
        /**
         * Resolve a mint by its stable local id — the lookup for stored rows that
         * must survive a mint-url edit.
         *
         * `Mint.id` is an arbitrary local surrogate, and that is precisely why it
         * works as a foreign key: it carries no meaning that can go stale, unlike a
         * url, which is a network locator mints do change. It answers exactly one
         * question — "which mint is this row about?".
         *
         * It must NEVER answer "are these two the same mint?". It is random, with no
         * relation to the mint's keys, so it cannot recognise one mint reached by two
         * urls. That question belongs to the keysets — see
         * CashuUtils.isCollidingKeysetId.
         */
        findById: (mintId: string) => {
            return self.mints.find(m => m.id === mintId)
        },
        get allKeysetIds() {
            return self.mints.flatMap(m => m.keysetIds)
        },
    }))
    .views(self => ({
        /**
         * The mint a transaction belongs to.
         *
         * Use this rather than findByUrl(tx.mint). `tx.mint` records where the
         * payment happened and is deliberately never rewritten, so once a mint moves
         * url it stops matching — every one of that mint's transactions would look
         * like it belonged to a mint that no longer exists.
         *
         * There is deliberately NO fallback to the url. A null mintId means the mint
         * is not in this wallet, and that IS the answer; guessing from the url would
         * resolve to whichever mint now answers it, which is the precise confusion
         * mintId exists to prevent.
         */
        findByTransaction: (tx: {mintId?: string | null}) => {
            return tx.mintId ? self.findById(tx.mintId) : undefined
        },
    }))
    .actions(withSetPropAction)
    .actions(self => ({
        mintExists: (mintUrl: string | URL) => {
            const normalized = String(mintUrl).replace(/\/$/, '')
            const mint = self.mints.find(m => m.mintUrl.replace(/\/$/, '') === normalized)
            if(mint) {return true} else {return false}
        },
        /**
         * Load the authoritative counter values from SQLite into the in-memory
         * cache (startup / foreground resume). Monotonic per counter, so a value
         * already advanced in memory is never lowered.
         *
         * Matched on keysetId alone. Keyset ids are unique wallet-wide (enforced by
         * CashuUtils.isCollidingKeysetId), so the owning mint is whichever one holds
         * the keyset — and a mint-url edit no longer strands the row, which used to
         * leave the counter at its volatile 0 and risk blinded-secret reuse.
         */
        /**
         * Write one mint through, skipping writes that would change nothing.
         *
         * The guard compares the PERSISTED payload, not the raw snapshot: a mint's
         * subtree changes for reasons its row does not care about, and without this
         * every such action would re-write the mint and all its keysets.
         *
         * Errors are logged, never thrown: persistence must not break a wallet flow,
         * and the next mutation retries. A dropped write costs a stale row, which the
         * following write corrects.
         */
        persistMint(snapshot: any) {
            const record = toMintRecord(snapshot)
            const serialized = JSON.stringify(record)

            if (self.lastPersistedMints.get(record.id) === serialized) return

            try {
                Database.upsertMint(record)
                self.lastPersistedMints.set(record.id, serialized)
            } catch (e: any) {
                log.error('[persistMint]', 'Mint write-through failed', {
                    error: e?.message,
                    mintId: record.id,
                })
            }
        },

        /** Dispose one mint's observer and forget its guard entry. */
        unobserveMint(mintId: string) {
            self.mintObservers.get(mintId)?.()
            self.mintObservers.delete(mintId)
            self.lastPersistedMints.delete(mintId)
        },
    }))
    .actions(self => ({
        /** Attach (or replace) one mint's persistence observer. */
        observeMint(mint: Mint) {
            const mintId = mint.id as string
            self.unobserveMint(mintId)
            self.mintObservers.set(mintId, onSnapshot(mint as any, snapshot => self.persistMint(snapshot)))
        },
    }))
    .actions(self => ({
        /**
         * (Re)attach the per-mint persistence observers.
         *
         * Must run AFTER the mints are in place, never before: attaching first means
         * loading them from SQLite immediately writes them straight back. Disposes
         * any existing observers, so it is safe to call again after applySnapshot
         * has replaced the whole array with new nodes.
         */
        observeMints() {
            for (const mintId of [...self.mintObservers.keys()]) self.unobserveMint(mintId)
            for (const mint of self.mints) self.observeMint(mint as Mint)
        },

        /**
         * Write every mint through, unconditionally.
         *
         * For when mints arrive already-formed rather than by mutation — i.e.
         * ImportBackup's applySnapshot. Observers only fire on CHANGE, so freshly
         * applied nodes would otherwise never reach SQLite.
         */
        persistAllMints() {
            for (const mint of self.mints) self.persistMint(getSnapshot(mint as any))
        },
    }))
    .actions(self => ({

        hydrateCountersFromDatabase() {
            const rows = Database.getCounters()
            if (rows.length === 0) return

            const countersByKeyset = new Map<string, MintProofsCounter>()
            for (const mint of self.mints) {
                for (const counter of mint.proofsCounters) {
                    countersByKeyset.set(counter.keyset, counter)
                }
            }

            for (const row of rows) {
                countersByKeyset.get(row.keysetId)?.hydrateCounterFromDb(row.counter)
            }
        },

        /**
         * Reconcile the mints between SQLite (the authority) and whatever
         * applySnapshot restored, and leave the two agreeing. Startup, every launch.
         *
         * CONVERGES on the actual state; it is deliberately NOT gated on a migration
         * version. SQLite and the MMKV snapshot are different engines that fail
         * independently, so "the seed already ran" is a claim about a version number,
         * not about the data — and when the two disagree, the version loses. That is
         * not hypothetical: rootStore.version defaults to the CURRENT
         * rootStoreModelVersion, so a factory reset stamps a wallet as fully migrated
         * on the spot. Restore an older snapshot over that and the version-gated seed
         * never runs, while postProcessSnapshot strips mints from every save — the
         * mints are then in neither place, and vanish on the next launch.
         *
         * Three cases, all handled by looking rather than asking:
         *  - table has mints  → SQLite wins; the snapshot no longer carries them.
         *  - table empty, store has mints → they exist only in the snapshot (a wallet
         *    upgrading from before mints moved here). Write them through.
         *  - both empty → a fresh wallet, or one with no mints. Nothing to do.
         *
         * Observers are attached AFTER the array settles: attaching first would make
         * loading write straight back.
         */
        hydrateMintsFromDatabase() {
            const records = Database.getMints()

            if (records.length === 0) {
                // Nothing stored. Anything the snapshot restored is now the only copy
                // that exists, so it has to be persisted before the next save strips
                // it. persistAllMints is an upsert by mint id, so this is safe to hit
                // on any launch.
                if (self.mints.length > 0) {
                    log.info('[hydrateMintsFromDatabase]', 'Mints found only in the snapshot — persisting', {
                        count: self.mints.length,
                    })
                    self.observeMints()
                    self.persistAllMints()
                } else {
                    log.trace('[hydrateMintsFromDatabase]', 'No mints in the database or the snapshot')
                    self.observeMints()
                }
                return
            }

            self.mints.replace(
                records.map(r =>
                    MintModel.create({
                        ...r,
                        // The column stores ISO; types.Date takes a Date or a unix ms
                        // timestamp, never a string.
                        createdAt: r.createdAt ? new Date(r.createdAt) : undefined,
                        // Recreate the counter shells addMint would have built via
                        // initKeyset. They are NOT optional: hydrateCountersFromDatabase
                        // fills the real index into these, and with no shell to fill,
                        // the counter would be created on demand at 0 and re-derive
                        // blinded secrets the mint has already signed. The values
                        // themselves are volatile and come from mint_counters.
                        proofsCounters: (r.keysets ?? []).map((k: any) => ({
                            keyset: k.id,
                            unit: k.unit,
                        })),
                    } as any),
                ),
            )
            self.observeMints()
            log.trace('[hydrateMintsFromDatabase]', {loaded: self.mints.length})
        },
    }))
    .actions(self => ({
        addMint: flow(function* addMint(mintUrl: string) {
            // Strips trailing slashes (cashu spec) and requires https outside Tor.
            // Shared with Mint.setMintUrl so adding and renaming cannot disagree
            // about what a valid mint url is.
            mintUrl = normalizeMintUrl(mintUrl)

            if(self.mintExists(mintUrl)) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint URL already exists.', {mintUrl})
            }

            log.trace('[addMint] start')

            const newMint = new CashuMint(mintUrl)
            // get fresh keysets
            const keySetResult: GetKeysetsResponse = yield newMint.getKeySets()
            const keysResult: GetKeysResponse = yield newMint.getKeys()
            const {keysets} = keySetResult
            const {keysets: keys} = keysResult
            
            log.trace('[addMint]', {keysets})

            if(!keysets || keysets.length === 0 || !keys || keys.length === 0) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint has no keysets and is not operational.', {mintUrl})
            }

            const mintInstance = MintModel.create({mintUrl})                              

            for(const keyset of keysets) {
                if(!keyset.unit) {
                    continue
                }

                if (!mintInstance.isUnitSupported(keyset.unit as MintUnit)) {
                    log.error('Unsupported mint unit, skipping...', {caller: 'addMint', keyset})                    
                    continue                    
                }

                mintInstance.initKeyset(keyset, self.allKeysetIds)            
            }

            for(const key of keys) {
                if(!key.unit) {
                    continue
                }

                if (!mintInstance.isUnitSupported(key.unit as MintUnit)) {                    
                    continue                    
                }

                mintInstance.initKeys(key)
            }

            mintInstance.setHostname()
            yield mintInstance.setShortname()

            self.mints.push(mintInstance)

            // Write it once, then let the observer carry every later change. The
            // explicit write is needed because observers fire on CHANGE, and the
            // mint was fully built before it entered the tree.
            self.persistMint(getSnapshot(mintInstance as any))
            self.observeMint(mintInstance as Mint)

            // SQLite retains derivation counters by keysetId across mint removal
            // (rows are never deleted), so a re-added mint recovers its real
            // counter from the authority here — now also when it is re-added under
            // a DIFFERENT url, since the row is keyed by keyset, not location.
            // Monotonic, so a genuinely new mint (no row) simply stays at 0.
            self.hydrateCountersFromDatabase()

            return mintInstance
        }),
        updateMint: flow(function* updateMint(mintUrl: string) {            
            const mintInstance = self.findByUrl(mintUrl)

            if(!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Could not find mint to update', {mintUrl})
            }
            // refresh up to date mint keys
            const newMint = new CashuMint(mintUrl)
            // get fresh keysets
            const keySetResult: GetKeysetsResponse = yield newMint.getKeySets()
            const keysResult: GetKeysResponse = yield newMint.getKeys()
            const {keysets} = keySetResult
            const {keysets: keys} = keysResult       

            if(!keysets || keysets.length === 0 || !keys || keys.length === 0) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint has no keysets and is not operational', {mintUrl})
            }
            
            for(const keyset of keysets) {
                if(!keyset.unit) {
                    continue
                }

                if (!mintInstance.isUnitSupported(keyset.unit as MintUnit)) {
                    log.error('Unsupported mint usnit, skipping...', {caller: 'addMint', keyset})                    
                    continue                    
                }

                mintInstance.initKeyset(keyset, self.allKeysetIds)      
            }

            for(const key of keys) {
                if(!key.unit) {
                    continue
                }

                if (!mintInstance.isUnitSupported(key.unit as MintUnit)) {                    
                    continue                    
                }

                mintInstance.initKeys(key)                    
            }            
            
            yield mintInstance.setShortname()
            
        }),
        removeMint(mintToBeRemoved: Mint) {
            if (self.blockedMintUrls.some(m => m === mintToBeRemoved.mintUrl)) {
                self.blockedMintUrls.remove(mintToBeRemoved.mintUrl)
                log.debug('[removeMint]', 'Mint removed from blockedMintUrls')
            }

            let mintInstance: Mint | undefined

            if (isStateTreeNode(mintToBeRemoved)) {
                mintInstance = mintToBeRemoved
            } else {
                mintInstance = self.findByUrl((mintToBeRemoved as Mint).mintUrl)
            }

            if (mintInstance) {
                const mintId = mintInstance.id as string

                // Dispose BEFORE destroying: the observer would otherwise fire on the
                // teardown and try to persist a dying node.
                self.unobserveMint(mintId)

                // No counter backup needed: the mint's mint_counters rows are
                // retained in SQLite and restored on re-add via hydrate — which is
                // also why removeMintById deliberately leaves them behind.
                Database.removeMintById(mintId)

                detach(mintInstance)
                destroy(mintInstance)
                log.info('[removeMint]', 'Mint removed from MintsStore')
            }
        },
        blockMint(mintToBeBlocked: Mint) {
            if(self.blockedMintUrls.some(url => url === mintToBeBlocked.mintUrl)) {
                return
            }

            self.blockedMintUrls.push(mintToBeBlocked.mintUrl)
            log.debug('[blockMint]', 'Mint blocked in MintsStore')
        },
        unblockMint(blockedMint: Mint) {
            self.blockedMintUrls.remove(blockedMint.mintUrl)
            log.debug('[unblockMint]', 'Mint unblocked in MintsStore')
        }        
    }))
    .views(self => ({
        get mintCount() {
            return self.mints.length
        },
        get allMints() {
            return self.mints
        },

        /**
         * The mints as a backup payload.
         *
         * Built from the LIVE instances, and it must stay that way: mints are
         * mastered in SQLite and stripped in postProcessSnapshot, so
         * `getSnapshot(mintsStore).mints` is ALWAYS empty. A backup taken from the
         * store snapshot would contain zero mints, raise no error, and only reveal
         * the loss on restore. That is the single most destructive mistake available
         * in this file, which is why the export lives here — behind a test — rather
         * than inline in the screen.
         *
         * Two deliberate deviations from a plain snapshot:
         *  - `keys` are dropped: they are re-fetched from the mint on import, and
         *    they are the bulk of the payload.
         *  - `counter` is re-injected per keyset. It is volatile (mastered in
         *    mint_counters), so it is absent from the snapshot — and a backup
         *    restored with counter 0 would re-derive blinded secrets the mint has
         *    already signed.
         */
        get backupSnapshot() {
            return {
                mints: self.mints.map((liveMint: Mint) => {
                    const mint: any = JSON.parse(JSON.stringify(getSnapshot(liveMint as any)))

                    mint.keys = []

                    mint.proofsCounters?.forEach((pc: any) => {
                        const live = liveMint.proofsCounters?.find(c => c.keyset === pc.keyset)
                        if (live) pc.counter = live.counter
                    })

                    return mint
                }),
                blockedMintUrls: [...self.blockedMintUrls],
            }
        },
        get groupedByHostname() {
            const grouped: Record<string, MintsByHostname> = {}

            self.mints.forEach((mint: Mint) => {
                const hostname = mint.hostname!

                if (!grouped[hostname as string]) {
                    grouped[hostname as string] = {
                        hostname,
                        mints: [],
                    }
                }

                grouped[hostname as string].mints.push(mint)
            })

            return Object.values(grouped) as MintsByHostname[]
        },
        get groupedByUnit() {
            const groupedByUnit: Record<string, MintsByUnit> = {}

            self.mints.forEach(mint => {
                mint.units.forEach(unit => {
                    if (!groupedByUnit[unit]) {
                        groupedByUnit[unit] = { unit, mints: [] }
                    }
                    groupedByUnit[unit].mints.push(mint)
                })
            })

            return Object.values(groupedByUnit) as MintsByUnit[]
        },
        alreadyExists(mintUrl: string) {
            return self.mints.some(m => m.mintUrl === mintUrl) ? true : false
        },
        isBlocked(mintUrl: string) {
            return self.blockedMintUrls.some(m => m === mintUrl) ? true : false
        },
        getBlockedFromList(mintUrls: string[]) {
            return mintUrls.filter(mintUrl =>
                self.blockedMintUrls.some(blockedUrl => blockedUrl === mintUrl),
            )
        },
        getMissingMints: (mintUrls: string[]) => {
            const missingMints: string[] = []
            for (const url of mintUrls) {
                if (!self.mints.find(mint => mint.mintUrl === url)) {
                missingMints.push(url)
                }
            }
            return missingMints
        },
}))
  
export interface MintsStore extends Instance<typeof MintsStoreModel> {}
export interface MintsStoreSnapshot
    extends SnapshotOut<typeof MintsStoreModel> {}