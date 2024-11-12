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
import { debounce } from "lodash"
import * as Sentry from '@sentry/react-native'
import type {RootStore} from '../RootStore'
import {KeyChain, MinibitsClient, MMKVStorage} from '../../services'
import {Database} from '../../services'
import { log } from  '../../services/logService'
import { rootStoreModelVersion } from '../RootStore'
import AppError, { Err } from '../../utils/AppError'
import { LogLevel } from '../../services/log/logTypes'
import { MintStatus } from '../Mint'
import { CurrencyCode } from '../../services/wallet/currency'
import { ThemeCode } from '../../theme'

/**
 * The key we'll be saving our state as within storage.
 */

export const ROOT_STORAGE_KEY = 'minibits-root-storage'

/**
 * Setup the root state.
 */
let _disposer: IDisposer
export async function setupRootStore(rootStore: RootStore) {
    let restoredState: any
    // let latestSnapshot: any

    try {
        // Give an option to encrypt storage as it might slow down app start on some Android devices
        // User settings are mastered in sqlite so we can get the encryption setting before loading root store
        log.trace('[setupRootStore]', `Create Database instance and get UserSettings`)

        const userSettings = Database.getUserSettings()        
        
        // random identificator of an app installation for bugs and crash reporting
        if(userSettings.walletId) {
            Sentry.setUser({ id: userSettings.walletId })
        }    

        // load the last known state from storage
        const start = performance.now()
        restoredState = MMKVStorage.load(ROOT_STORAGE_KEY) || {}        
        const mmkvLoaded = performance.now()        
        const dataSize = Buffer.byteLength(JSON.stringify(restoredState), 'utf8')        
        
        // log.trace({restoredState})
        log.trace('[setupRootStore]', `Loading ${dataSize.toLocaleString()} bytes of state from MMKV took ${(mmkvLoaded - start).toLocaleString()} ms.`)        
        
        applySnapshot(rootStore, restoredState)        
        
        const stateHydrated = performance.now()
        log.trace(`[setupRootStore] Hydrating rooStoreModel took ${stateHydrated - mmkvLoaded} ms.`)
        
        const {proofsStore} = rootStore
        await proofsStore.loadProofsFromDatabase()
        
        const proofsLoaded = performance.now()
        log.trace(`[setupRootStore] Loading proofs from DB and hydrating took ${proofsLoaded - stateHydrated} ms.`)
        
    } catch (e: any) {        
        log.error('[setupRootStore]', Err.STORAGE_ERROR, {message: e.message, params: e.params})
    }

    // stop tracking state changes if we've already setup
    if (_disposer) {
        _disposer()
    }

    // track changes & save snapshot to the storage not more then once per second
    const saveSnapshot = debounce((snapshot) => {        
        MMKVStorage.save(ROOT_STORAGE_KEY, snapshot)
    }, 1000)

    _disposer = onSnapshot(rootStore, snapshot => {
        // log.trace('[setupRootStore] onSnapshot *** MMKV SHOULD SAVE ***')        
        saveSnapshot(snapshot)
        // log.trace('[setupRootStore] saved', {walletStore: snapshot.walletStore})
    })

    // run migrations if needed, needs to be after onSnapshot to be persisted
    try {    
        log.info('[setupRootStore]', `RootStore loaded from MMKV, version is: ${rootStore.version}`)      

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
        walletProfileStore,
        relaysStore,
        contactsStore,
        mintsStore,
        proofsStore,
        transactionsStore
    } = rootStore
    
    let currentVersion = rootStore.version

    try {       
        
        if(currentVersion < 14) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v14`)
            try {                

                await walletProfileStore.migrateToNewRelay()

                log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
                rootStore.setVersion(rootStoreModelVersion)
            } catch (e: any) {
                log.warn('[setupRootStore] Migration error', {message: e.name})
            }
        }
        
        if(currentVersion < 16) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v16`)
            try {                

                for (const mint of mintsStore.allMints) {
                    try {                    
                        mint.setId() 
                        log.trace('[_runMigrations]', {id: mint.id, mintUrl: mint.mintUrl})                       
                    } catch (e: any) {
                        log.warn('[_runMigrations]', e.message)
                        continue
                    }
                }

                log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
                rootStore.setVersion(rootStoreModelVersion)
            } catch (e: any) {
                log.warn('[setupRootStore] Migration error', {message: e.name})
            }
        }

        if(currentVersion < 23) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v23`)            
            // walletProfileStore.setIsBatchClaimOn(false)
            rootStore.setVersion(rootStoreModelVersion)
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
        }

        if(currentVersion < 24) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v24`)            
            userSettingsStore.setLogLevel(LogLevel.ERROR)
            rootStore.setVersion(rootStoreModelVersion)
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
        }
        if(currentVersion < 28) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v28`)

            userSettingsStore.setExchangeCurrency(CurrencyCode.USD)
            userSettingsStore.setTheme(ThemeCode.DEFAULT)

            if(!userSettingsStore.isLocalBackupOn) {
                const proofs = proofsStore.allProofs
                const pendingProofs = proofsStore.pendingProofs

                Database.addOrUpdateProofs(proofs, false, false)
                Database.addOrUpdateProofs(pendingProofs, true, false)
                userSettingsStore.setIsLocalBackupOn(true)
            }
            
            for (const mint of mintsStore.allMints) {
                for(const keysetId of mint.keysetIds) {
                    Database.updateProofsMintUrlMigration(keysetId, mint.mintUrl)
                }                
            }

            rootStore.setVersion(rootStoreModelVersion)
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
        }
        if(currentVersion < 29) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v29`)

            transactionsStore.addRecentByUnit()

            rootStore.setVersion(rootStoreModelVersion)
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
        }
    } catch (e: any) {
        throw new AppError(
        Err.STORAGE_ERROR,
        'Error when executing rootStore migrations',
        e.message,
        )    
    }

}
