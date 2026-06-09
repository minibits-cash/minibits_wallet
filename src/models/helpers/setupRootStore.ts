/**
 * This file is where we do "rehydration" of your RootStore from AsyncStorage.
 * This lets you persist your state between app launches.
 *
 * Navigation state persistence is handled in navigationUtilities.tsx.
 *
 * Note that Fast Refresh doesn't play well with this file, so if you edit this,
 * do a full refresh of your app instead.
 *
 * @refresh reset
 */
import {
  applySnapshot,
  IDisposer,
  onSnapshot,
} from 'mobx-state-tree'
import * as Sentry from '@sentry/react-native'
import type { RootStore } from '../RootStore'
import { Database, MMKVStorage } from '../../services'
import type { MeltRecoverySeed, InFlightRequestSeed, CounterSeed } from '../../services/db'
import { log } from  '../../services/logService'
import { rootStoreModelVersion } from '../RootStore'
import AppError, { Err } from '../../utils/AppError'


/**
 * The key we'll be saving our state as within storage.
 */

export const ROOT_STORAGE_KEY = 'minibits-root-storage'

/**
 * Setup the root state.
 */

/**
 * Lean-hydration options for the background NWC cold wake. The foreground always
 * runs a FULL setup (App mount → useInitialRootStore), and SQLite is the
 * authority, so anything skipped here is reconciled when the app is opened.
 *
 *  - skipTokens: don't load the minibits JWT from keychain (NWC never uses it).
 *  - skipProofs: don't bulk-load proofs into MST (nor run orphan recovery).
 *    Read-only NWC commands read SQLite directly; mutating commands call
 *    proofsStore.ensureProofsLoaded() on demand before selecting proofs.
 */
export type SetupRootStoreOptions = {
    skipTokens?: boolean
    skipProofs?: boolean
}

export async function setupRootStore(rootStore: RootStore, opts: SetupRootStoreOptions = {}) {
    let restoredState: any
    let _disposer: IDisposer | undefined
    // let latestSnapshot: any

    // Guards the onSnapshot installation below. If applySnapshot throws, rootStore
    // stays at empty defaults. Installing the listener in that state would save those
    // defaults back to MMKV on the first mutation, silently overwriting valid data.
    let snapshotApplied = false

    try {
        // load the last known state from storage
        const start = performance.now()
        restoredState = MMKVStorage.load(ROOT_STORAGE_KEY) || {}
        const mmkvLoaded = performance.now()
        const dataSize = Buffer.byteLength(JSON.stringify(restoredState), 'utf8')

        // log.trace({restoredState})
        log.trace(`Loading ${dataSize.toLocaleString()} bytes of state from MMKV took ${(mmkvLoaded - start).toLocaleString()} ms.`, {caller: 'setupRootStore'})

        // temp dirty migration of proofStore from array to map
        if(restoredState?.proofsStore?.proofs && Array.isArray(restoredState.proofsStore.proofs)) {
            restoredState.proofsStore.proofs = {}
        }

        applySnapshot(rootStore, restoredState)
        snapshotApplied = true

        const stateHydrated = performance.now()
        log.trace(`Hydrating rooStoreModel took ${stateHydrated - mmkvLoaded} ms.`, {caller: 'setupRootStore'})

        const {proofsStore, walletProfileStore, authStore, userSettingsStore, transactionsStore, mintsStore} = rootStore

        if(walletProfileStore.walletId) {
            Sentry.setUser({ id: walletProfileStore.walletId })
        }

        if(userSettingsStore.isOnboarded && !opts.skipTokens) {
            // hydrate auth tokens to model from keychain
            await authStore.loadTokensFromKeyChain()
        }
        const tokensLoaded = performance.now()

        // hydrate unspent and pending ecash proofs to model from database
        if(!opts.skipProofs) {
            await proofsStore.loadProofsFromDatabase()
        }
        const proofsHydrated = performance.now()

        // Hydrate the in-memory derivation-counter cache from SQLite (the
        // authority) on every launch. The MMKV snapshot stores counter:0 (it is
        // stripped on save), so the real value lives only in mint_counters. The
        // one-time MMKV→SQLite copy of pre-existing counters is a migration —
        // see _runMigrations.
        mintsStore.hydrateCountersFromDatabase()
        const countersHydrated = performance.now()

        // Roll back any orphan proof reservations from the last session.
        // An orphan is a reservation row whose owning operation died before
        // it could commit or rollback (process crash, force-quit, etc.).
        // Each orphan restores its locked proofs to their original state.
        // Bundled with proof loading: when proofs are skipped (lean NWC wake),
        // this runs on demand via proofsStore.ensureProofsLoaded() before the
        // first mutating command, and fully on the next foreground app open.
        if(!opts.skipProofs) {
            const { recoveredCount } = proofsStore.recoverOrphanReservations()
            if (recoveredCount > 0) {
                log.warn(`[setupRootStore] Rolled back ${recoveredCount} orphan proof reservations`)
            }
        }
        const orphansRecovered = performance.now()

        // hydrate last transactions from database
        await transactionsStore.loadRecentFromDatabase()
        const txHydrated = performance.now()

        // Cold-hydration phase breakdown. Read this off a background NWC wake to
        // see where the time goes — it drives the Stage 4 lean-hydration decision
        // (hypothesis: applySnapshot + loadProofs dominate). Emitted at info so it
        // shows without trace logging.
        log.info('[setupRootStore] cold hydration phase timings (ms)', {
            mmkvLoad: Math.round(mmkvLoaded - start),
            applySnapshot: Math.round(stateHydrated - mmkvLoaded),
            loadTokens: Math.round(tokensLoaded - stateHydrated),
            loadProofs: Math.round(proofsHydrated - tokensLoaded),
            hydrateCounters: Math.round(countersHydrated - proofsHydrated),
            recoverOrphans: Math.round(orphansRecovered - countersHydrated),
            loadRecentTx: Math.round(txHydrated - orphansRecovered),
            total: Math.round(txHydrated - start),
            proofCount: proofsStore.proofs.size,
            stateBytes: dataSize,
            caller: 'setupRootStore',
        })

    } catch (e: any) {
        log.error(Err.STORAGE_ERROR, {message: e.message, params: e.params, caller: 'setupRootStore'})
    }

    // stop tracking state changes if we've already setup
    if (_disposer) {
        _disposer()
    }

    if (snapshotApplied) {
        // Skip MMKV writes whose serialized payload is identical to the last one.
        // postProcessSnapshot strips ephemeral, SQLite/KeyChain-mastered data
        // (proofs, transactions, derivation counters, tokens…) from the saved
        // snapshot, but MST still fires onSnapshot on every action that touches
        // those fields — each producing a byte-identical payload. Comparing the
        // serialized string here collapses that storm of redundant writes during
        // wallet transactions into a single write when something persisted
        // actually changes. We stringify once and persist the raw string so the
        // write path doesn't serialize a second time.
        let lastSerialized = MMKVStorage.loadString(ROOT_STORAGE_KEY)

        // Flip to true to trace snapshot-persistence profiling. When off, the
        // callback is just the lean equality-guarded write (the counters and
        // performance.now() calls below never run). Typed `boolean` so the
        // disabled profiling block isn't flagged as unreachable.
        const PROFILE_SNAPSHOT_PERSISTENCE: boolean = false

        // Cumulative session counters, flushed at most once per PROF_FLUSH_MS so
        // the trace adds no per-fire logging overhead (used only when profiling):
        // `invocations` is every onSnapshot fire (≈ one per persisted-or-stripped
        // MST action), `writes` are the MMKV writes actually performed, `skipped`
        // are the redundant byte-identical payloads the equality guard avoided,
        // and `totalMs` is the wall time spent serializing (+ writing, when not
        // skipped).
        const prof = {invocations: 0, writes: 0, skipped: 0, totalMs: 0}
        const PROF_FLUSH_MS = 5000
        let profFlushAt = performance.now()

        _disposer = onSnapshot(rootStore, snapshot => {
            const t0 = PROFILE_SNAPSHOT_PERSISTENCE ? performance.now() : 0

            const serialized = JSON.stringify(snapshot)
            const changed = serialized !== lastSerialized
            if (changed) {
                lastSerialized = serialized
                MMKVStorage.saveString(ROOT_STORAGE_KEY, serialized)
            }

            if (!PROFILE_SNAPSHOT_PERSISTENCE) return

            prof.invocations++
            prof.totalMs += performance.now() - t0
            if (changed) { prof.writes++ } else { prof.skipped++ }

            if (t0 - profFlushAt >= PROF_FLUSH_MS) {
                profFlushAt = t0
                log.trace('[setupRootStore] snapshot persistence profile (cumulative)', {
                    invocations: prof.invocations,
                    writes: prof.writes,
                    skipped: prof.skipped,
                    totalMs: Math.round(prof.totalMs),
                    avgWriteMs: prof.writes ? +(prof.totalMs / prof.writes).toFixed(3) : 0,
                    caller: 'setupRootStore',
                })
            }
        })
    } else {
        log.error('[setupRootStore]', 'State restore failed — skipping onSnapshot to preserve MMKV data', {caller: 'setupRootStore'})
    }

    // run migrations if needed, needs to be after onSnapshot to be persisted
    if (snapshotApplied) {
        try {
            log.info(`RootStore loaded from MMKV, version is: ${rootStore.version}`, {caller: 'setupRootStore'})

            if(rootStore.version < rootStoreModelVersion) {
                await _runMigrations(rootStore, restoredState)
            }
        } catch (e: any) {
            log.error(Err.STORAGE_ERROR, e.message)
        }
    }

    const unsubscribe = () => {
        _disposer()
        _disposer = undefined
    }

    return {rootStore, restoredState, unsubscribe}
}

/**
 * Migrations code to execute based on code and on device model version.
 */

async function _runMigrations(rootStore: RootStore, restoredState: any) {
    const {
        transactionsStore,
    } = rootStore

    const currentVersion = rootStore.version

    try {
        log.trace(`Starting rootStore migrations from v${currentVersion} -> v${rootStoreModelVersion}`)

        if(currentVersion < 29) {
            transactionsStore.addRecentByUnit()
        }

        if(currentVersion < 33) {
            // One-time copy of the MMKV-resident derivation counters into SQLite
            // (the new authority for counters). `counter` is VOLATILE in the
            // model, so applySnapshot no longer loads the pre-upgrade values into
            // the live tree — read them straight from the RAW pre-upgrade snapshot
            // (same pattern as the v34/35/36 seeds below). Monotonic + only > 0,
            // so a stripped/zero value is never written and an existing SQLite
            // counter is never lowered. After this, mint_counters is authoritative
            // and the every-launch hydrate fills the in-memory cache from it.
            const seeds: CounterSeed[] = []
            for (const mint of restoredState?.mintsStore?.mints ?? []) {
                for (const counter of mint?.proofsCounters ?? []) {
                    if (counter?.keyset && typeof counter.counter === 'number' && counter.counter > 0) {
                        seeds.push({mintUrl: mint.mintUrl, keysetId: counter.keyset, unit: counter.unit, counter: counter.counter})
                    }
                }
            }
            if (seeds.length > 0) {
                Database.seedCounters(seeds)
                // The earlier startup hydrate (setupRootStore) ran against an
                // empty mint_counters and left the volatile in-memory counters at
                // 0. Now that SQLite is seeded, refresh the cache so a transaction
                // in THIS first post-upgrade session reads the real index rather
                // than 0 (which would risk blinded-secret reuse). Monotonic.
                rootStore.mintsStore.hydrateCountersFromDatabase()
            }
        }

        if(currentVersion < 34) {
            // meltCounterValues moved to SQLite (melt_recovery). The model no
            // longer holds them and applySnapshot strips them, so read straight
            // from the RAW pre-upgrade snapshot to carry over any melt that was
            // in-flight at upgrade time (usually none). Idempotent.
            const seeds: MeltRecoverySeed[] = []
            for (const mint of restoredState?.mintsStore?.mints ?? []) {
                for (const counter of mint?.proofsCounters ?? []) {
                    const mcv = counter?.meltCounterValues ?? {}
                    for (const key of Object.keys(mcv)) {
                        const entry = mcv[key]
                        if (entry?.meltPreview && typeof entry.transactionId === 'number') {
                            seeds.push({
                                transactionId: entry.transactionId,
                                mintUrl: mint.mintUrl,
                                keysetId: counter.keyset,
                                meltPreview: entry.meltPreview,
                            })
                        }
                    }
                }
            }
            if (seeds.length > 0) {
                Database.seedMeltRecoveries(seeds)
            }
        }

        if(currentVersion < 35) {
            // inFlightRequests moved to SQLite (inflight_requests). Same as the
            // melt seed above: read from the RAW pre-upgrade snapshot to carry
            // over any request in-flight at upgrade time (usually none). Idempotent.
            const seeds: InFlightRequestSeed[] = []
            for (const mint of restoredState?.mintsStore?.mints ?? []) {
                for (const counter of mint?.proofsCounters ?? []) {
                    const ifr = counter?.inFlightRequests ?? {}
                    for (const key of Object.keys(ifr)) {
                        const entry = ifr[key]
                        if (entry?.request && typeof entry.transactionId === 'number') {
                            seeds.push({
                                transactionId: entry.transactionId,
                                mintUrl: mint.mintUrl,
                                keysetId: counter.keyset,
                                request: entry.request,
                            })
                        }
                    }
                }
            }
            if (seeds.length > 0) {
                Database.seedInFlightRequests(seeds)
            }
        }

        if(currentVersion < 36) {
            // counterBackups removed: counters are now retained in SQLite across
            // mint removal. Carry over any removed-mint counters that were only
            // held in the (now-removed) counterBackups of the RAW pre-upgrade
            // snapshot, so re-adding such a mint restores its counter. Monotonic.
            const seeds: CounterSeed[] = []
            for (const backup of restoredState?.mintsStore?.counterBackups ?? []) {
                for (const c of backup?.counters ?? []) {
                    if (c?.keyset && typeof c.counter === 'number' && c.counter > 0) {
                        seeds.push({mintUrl: backup.mintUrl, keysetId: c.keyset, unit: c.unit, counter: c.counter})
                    }
                }
            }
            if (seeds.length > 0) {
                Database.seedCounters(seeds)
            }
        }

        // Set once, after all steps succeed: if any step throws, the version is
        // NOT bumped and the whole migration retries on the next launch.
        rootStore.setVersion(rootStoreModelVersion)
        log.info(`Completed rootStore migrations to v${rootStoreModelVersion}`, {caller: '_runMigrations'})
    } catch (e: any) {
        throw new AppError(
            Err.STORAGE_ERROR,
            'Error when executing rootStore migrations',
            e.message,
        )
    }

}
