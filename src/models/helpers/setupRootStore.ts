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
import type { MeltRecoverySeed } from '../../services/db'
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

export async function setupRootStore(rootStore: RootStore) {
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

        if(userSettingsStore.isOnboarded) {
            // hydrate auth tokens to model from keychain
            await authStore.loadTokensFromKeyChain()
        }

        // hydrate unspent and pending ecash proofs to model from database
        await proofsStore.loadProofsFromDatabase()

        // Hydrate the in-memory derivation-counter cache from SQLite (the
        // authority) on every launch. The MMKV snapshot stores counter:0 (it is
        // stripped on save), so the real value lives only in mint_counters. The
        // one-time MMKV→SQLite copy of pre-existing counters is a migration —
        // see _runMigrations.
        mintsStore.hydrateCountersFromDatabase()

        // Roll back any orphan proof reservations from the last session.
        // An orphan is a reservation row whose owning operation died before
        // it could commit or rollback (process crash, force-quit, etc.).
        // Each orphan restores its locked proofs to their original state.
        const { recoveredCount } = proofsStore.recoverOrphanReservations()
        if (recoveredCount > 0) {
            log.warn(`[setupRootStore] Rolled back ${recoveredCount} orphan proof reservations`)
        }

        // hydrate last transactions from database
        await transactionsStore.loadRecentFromDatabase()

        const proofsLoaded = performance.now()
        log.trace(`Loading proofs and transactions from DB and hydrating took ${proofsLoaded - stateHydrated} ms.`, {
            caller: 'setupRootStore'
        })

    } catch (e: any) {
        log.error(Err.STORAGE_ERROR, {message: e.message, params: e.params, caller: 'setupRootStore'})
    }

    // stop tracking state changes if we've already setup
    if (_disposer) {
        _disposer()
    }

    if (snapshotApplied) {
        _disposer = onSnapshot(rootStore, snapshot => {
            MMKVStorage.save(ROOT_STORAGE_KEY, snapshot)
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
        mintsStore,
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
            // (the new authority for counters). Reads the LIVE MST counters,
            // which still hold the real values loaded from the pre-upgrade MMKV
            // snapshot — postProcessSnapshot strips `counter` only from saves, not
            // from the in-memory model — and persists them via a monotonic,
            // idempotent upsert (incl. counterBackups). After this, mint_counters
            // is authoritative and the every-launch hydrate in setupRootStore
            // fills the in-memory cache from it.
            mintsStore.seedCountersToDatabase()
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
