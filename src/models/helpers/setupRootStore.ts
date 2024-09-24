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
import RNExitApp from 'react-native-exit-app'
import type {RootStore} from '../RootStore'
import {KeyChain, MinibitsClient, MMKVStorage, NostrClient} from '../../services'
import {Database} from '../../services'
import { log } from  '../../services/logService'
import { rootStoreModelVersion } from '../RootStore'
import AppError, { Err } from '../../utils/AppError'
import { LogLevel } from '../../services/log/logTypes'
import { MintStatus } from '../Mint'
import { WalletStoreModel } from '../WalletStore'

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

        if (userSettings.isStorageEncrypted) {
            try {
                await MMKVStorage.initEncryption()
            } catch (e: any) {
                log.error('[setupRootStore]', 'Encryption init failed', {message: e.message})

                if (e && typeof e === 'object') {
                    const errString = JSON.stringify(e)                   
            
                    const isBackPressed = errString.includes('code: 10')
                    const isCancellPressed = errString.includes('code: 13')
                    const isIOSCancel = 'code' in e && String(e.code) === '-128'                   
            
                    // In case user cancels / fails the fingerprint auth, empty app state is loaded.
                    // If a user updates the empty app state, it is stored unencrypted and returned after restart as primary one,
                    // making encrypted data inaccessible or later overwritten.
                    // Therefore this ugly app exit on unsuccessful auth.
            
                    if(isCancellPressed || isBackPressed || isIOSCancel) {                        
                        RNExitApp.exitApp()
                    }
                }  
            }      
        }

        // load the last known state from storage
        restoredState = MMKVStorage.load(ROOT_STORAGE_KEY) || {}
        const dataSize = Buffer.byteLength(JSON.stringify(restoredState), 'utf8')         
        
        log.trace('[setupRootStore]', `restored state has ${dataSize} bytes.`)
        applySnapshot(rootStore, restoredState)        
        
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

        if(currentVersion < 6) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v6`)
            userSettingsStore.setLogLevel(LogLevel.ERROR)
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
            rootStore.setVersion(rootStoreModelVersion)
        }


        if(currentVersion < 7) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v7`)
            for (const mint of mintsStore.allMints) {
                mint.setStatus(MintStatus.ONLINE)
            }
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
            rootStore.setVersion(rootStoreModelVersion)
        }


        if(currentVersion < 8) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v8`)
            const seedHash = await KeyChain.loadSeedHash()        

            if(seedHash && walletProfileStore.pubkey) {
                await MinibitsClient.migrateSeedHash(
                    walletProfileStore.pubkey, 
                    {
                        seedHash
                    }
                )

                walletProfileStore.setSeedHash(seedHash)
                log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
                rootStore.setVersion(rootStoreModelVersion)
            }
        }

        if(currentVersion < 9) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v9`)
            
            for (const mint of mintsStore.allMints) {
                try {
                    await mint.setShortname()
                } catch (e: any) {
                    continue
                }
            }

            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
            rootStore.setVersion(rootStoreModelVersion)
        }

        if(currentVersion < 10) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v10`)
            
            for (const contact of contactsStore.all) {
                if(contact.isExternalDomain === false) {
                    contact.setLud16(contact.nip05 as string)
                }
            }

            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
            rootStore.setVersion(rootStoreModelVersion)
        }

        if(currentVersion < 11) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v11`)            
            userSettingsStore.setIsStorageMigrated(true)
            rootStore.setVersion(rootStoreModelVersion)
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
        }

        if(currentVersion < 12) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v12`)            
            
            for (const mint of mintsStore.allMints) {
                try {                    
                    mint.addUnit('sat')
                    mint.resetCounters()
                } catch (e: any) {
                    continue
                }
            }

            rootStore.setVersion(rootStoreModelVersion)
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
        }
        
        if(currentVersion < 13) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v13`)

            userSettingsStore.setPreferredUnit('sat')
            
            for (const proof of proofsStore.allProofs) {
                try {
                    if(!proof.unit) {
                        proof.setUnit('sat')
                    }                                    
                } catch (e: any) {
                    continue
                }
            }

            for (const tx of transactionsStore.all) {
                try {
                    if(!tx.unit) {
                        tx.setUnit('sat')
                    }                                    
                } catch (e: any) {
                    continue
                }
            }

            rootStore.setVersion(rootStoreModelVersion)
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
        }
        
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
            walletProfileStore.setIsBatchClaimOn(false)
            rootStore.setVersion(rootStoreModelVersion)
            log.info(`Completed rootStore migrations to the version v${rootStoreModelVersion}`)
        }

        if(currentVersion < 24) {
            log.trace(`Starting rootStore migrations from version v${currentVersion} -> v24`)            
            userSettingsStore.setLogLevel(LogLevel.ERROR)
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
