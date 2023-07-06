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
  IModelType,
  ModelInstanceType,
  onSnapshot,
} from 'mobx-state-tree'
import type {RootStore} from '../RootStore'
import {MMKVStorage} from '../../services'
import {Database} from '../../services'
import { log } from  '../../utils/logger'
import { rootStoreModelVersion } from '../RootStore'
import AppError, { Err } from '../../utils/AppError'
// import { AsyncStorage } from "../../services"

/**
 * The key we'll be saving our state as within storage.
 */

const ROOT_STORAGE_KEY = 'minibits-root-storage'

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
    const userSettings = Database.getUserSettings()

    if (userSettings.isStorageEncrypted) {
      await MMKVStorage.initEncryption() // key retrieval on Android is sometimes very slow
    }

    // load the last known state from storage
    restoredState = MMKVStorage.load(ROOT_STORAGE_KEY) || {}
    applySnapshot(rootStore, restoredState)
  
  } catch (e: any) {    
    log.error(Err.DATABASE_ERROR, e.message)
  }

  // stop tracking state changes if we've already setup
  if (_disposer) {
    _disposer()
  }

  // track changes & save to storage // TODO defering and batching of writes to storage
  _disposer = onSnapshot(rootStore, snapshot =>
    MMKVStorage.save(ROOT_STORAGE_KEY, snapshot),
  )

  // run migrations if needed, needs to be after onSnapshot to be persisted
  try {
    log.info('Device rootStorage version', rootStore.version, 'setupRootStore')

    if(rootStore.version < rootStoreModelVersion) {
      await _runMigrations(rootStore)
    }    
  } catch (e: any) {    
    log.error(Err.DATABASE_ERROR, e.message)
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
    mintsStore,         
  } = rootStore

  let currentVersion = rootStore.version
  try {
    // v1 -> v2 migration
    if(currentVersion < 2) {
      log.trace(`Starting rootStore migrations from version ${currentVersion} -> v2`)
      
      currentVersion = 2
      log.info(`Completed rootStore migrations to version ${currentVersion}`)
    }

    // v2 -> v3 migration
    if(currentVersion < 3) {
      log.trace(`Starting rootStore migrations from ${currentVersion} -> v3`)

      currentVersion = 3
      log.trace(`Completed rootStore migrations to version ${currentVersion}`)
    }

    rootStore.setVersion(rootStoreModelVersion)
  } catch (e: any) {
    throw new AppError(
      Err.DATABASE_ERROR,
      'Error when executing rootStore migrations',
      e.message,
    )    
  }
}

/* interface StoreConfig { storageKey: string, store: any }

let _disposers: IDisposer[] = []
export async function setupRootStore(rootStore: RootStore) {


  const storeConfigs: StoreConfig[] = [
    { storageKey: "mintsStore", store: rootStore.mintsStore },
    
    { storageKey: "transactionsStore", store: rootStore.transactionsStore },
  ]

  const restoredStates: { [key: string]: any } = {}

  try {
    // retrieve key asynchronously
    const encryptionKey = await MMKVStorage.getOrCreateMMKVEncryptionKey()

    // initialize or reuse storage with encryption key so we can work in synchronous mode
    MMKVStorage.getInstance(encryptionKey)

    for (const { storageKey, store } of storeConfigs) {
      const restoredState = (MMKVStorage.load(storageKey)) || {}
      applySnapshot(store, restoredState)
      restoredStates[storageKey] = restoredState
    }
  } catch (e: any) {
    // if there's any problems loading, then inform the dev what happened
    if (__DEV__) {
      console.error(e.message, null)
    }
  }

  // stop tracking state changes if we've already setup
  _disposers.forEach(disposer => disposer)
  _disposers = []

  // track changes & save to AsyncStorage for each store
  for (const { storageKey, store } of storeConfigs) {
    const disposer = onSnapshot(store, (snapshot) => MMKVStorage.save(storageKey, snapshot))
    _disposers.push(disposer)
  }

  const unsubscribe = () => {
    _disposers.forEach(disposer => disposer())
    _disposers = []
  }

  return { rootStore, restoredStates, unsubscribe }
} */
