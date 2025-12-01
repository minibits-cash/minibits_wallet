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
import { MMKVStorage } from '../../services'
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
    let _disposer: IDisposer
    // let latestSnapshot: any

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
        
        const stateHydrated = performance.now()
        log.trace(`Hydrating rooStoreModel took ${stateHydrated - mmkvLoaded} ms.`, {caller: 'setupRootStore'})
        
        const {proofsStore, walletProfileStore, authStore, userSettingsStore, transactionsStore} = rootStore

        if(walletProfileStore.walletId) {
            Sentry.setUser({ id: walletProfileStore.walletId })
        }

        if(userSettingsStore.isOnboarded) {
            // hydrate auth tokens to model from keychain
            await authStore.loadTokensFromKeyChain()
        }

        // hydrate unspent and pending ecash proofs to model from database
        await proofsStore.loadProofsFromDatabase()
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

    _disposer = onSnapshot(rootStore, snapshot => {       
        MMKVStorage.save(ROOT_STORAGE_KEY, snapshot)        
    })

    // run migrations if needed, needs to be after onSnapshot to be persisted
    try {    
        log.info(`RootStore loaded from MMKV, version is: ${rootStore.version}`, {caller: 'setupRootStore'})      

        if(rootStore.version < rootStoreModelVersion) {
            await _runMigrations(rootStore)
        }    
    } catch (e: any) {    
        log.error(Err.STORAGE_ERROR, e.message)
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

async function _runMigrations(rootStore: RootStore) {
    const { 
        userSettingsStore,
        mintsStore,
        transactionsStore,
    } = rootStore
    
    let currentVersion = rootStore.version

    try {
        if(currentVersion < 29) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v29`)

            transactionsStore.addRecentByUnit()

            rootStore.setVersion(rootStoreModelVersion)
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`, {caller: '_runMigrations'} )
        }
    } catch (e: any) {
        throw new AppError(
            Err.STORAGE_ERROR,
            'Error when executing rootStore migrations',
            e.message,
        )    
    }

}
