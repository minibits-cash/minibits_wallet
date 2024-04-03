import {MMKV} from 'react-native-mmkv'
import {log} from './logService'
import AppError, {Err} from '../utils/AppError'
import {KeyChain} from './keyChain'
import { ROOT_STORAGE_KEY } from '../models'
import { Database } from './sqlite'

const STORAGE_KEY = 'storage-v1'
const ENCRYPTED_STORAGE_KEY = 'encrypted-storage-v1'

let _storage: MMKV | undefined
let _encryptionKey: string | undefined

const initEncryption = async function (): Promise<void> {
  if (!_encryptionKey) {
    try {
        _encryptionKey = await getOrCreateEncryptionKey()
        
        // init migration from previously encrypted storage-v1, needs to be this early            
        if (!Database.getUserSettings().isStorageMigrated) {
            log.error('[getInstance] Starting migration to new encrypted storage')

            const _current_storage = new MMKV({
                id: STORAGE_KEY,
                encryptionKey: _encryptionKey,
            })

            const migratedWalletState = _current_storage.getString(ROOT_STORAGE_KEY)
            
            if(migratedWalletState) {
                const _new_storage = new MMKV({
                    id: ENCRYPTED_STORAGE_KEY,
                    encryptionKey: _encryptionKey,
                })
    
                _new_storage.set(ROOT_STORAGE_KEY, migratedWalletState)
            }
            
            // remove encryption from default storage
            _current_storage.recrypt(undefined)

            const userSettings = Database.getUserSettings()
            Database.updateUserSettings({...userSettings, isStorageMigrated: true})           

        } // migration end


        getInstance() // Instantiate the MMKV instance with the encryption key
    } catch(e: any) {
        throw e
    }    
  }
}

const getInstance = function () {
    if (!_storage) {

        if (_encryptionKey) {
            _storage = new MMKV({
                id: ENCRYPTED_STORAGE_KEY,
                encryptionKey: _encryptionKey,
            })

            log.trace('[getInstance]', 'MMKV encrypted storage initialized')
        } else {

            _storage = new MMKV({
                id: STORAGE_KEY,
            })

            log.trace('[getInstance]', 'MMKV storage initialized')
        }
    }

  return _storage
}

const getOrCreateEncryptionKey = async function (): Promise<string> {

    let key: string | null = null

    try {
        key = (await KeyChain.loadMmkvEncryptionKey()) as string

        if (!key) {
            key = KeyChain.generateMmkvEncryptionKey() as string
            await KeyChain.saveMmkvEncryptionKey(key)

            log.info('[getOrCreateEncryptionKey]', 'Created and saved new encryption key')
        }

        return key
    } catch (e: any) {
        throw e
    }
}


const decryptStorage = function (): boolean {    

    if (_encryptionKey) {
        // make a copy of wallet state from encrypted storage
        const walletState = String(loadString(ROOT_STORAGE_KEY))

        log.trace('[decryptStorage]', {walletState})

        // reset encrypted storage instance
        _storage = undefined
        _encryptionKey = undefined

        // create normal storage instance and save wallet state to it
        saveString(ROOT_STORAGE_KEY, walletState as string)

        log.info('[recryptStorage]', 'Storage has been decrypted')
        return true
    }

    return false
}

const encryptStorage = async function (): Promise<boolean> {    

    if (!_encryptionKey) {
        // make a copy of wallet state from normal storage
        const walletState = String(loadString(ROOT_STORAGE_KEY))

        log.trace('[encryptStorage]', {walletState})

        // reset normal storage instance
        _storage = undefined
        // retrieve encryption key
        _encryptionKey = await getOrCreateEncryptionKey()

        // create encrypted storage instance and save wallet state to it
        saveString(ROOT_STORAGE_KEY, walletState as string)

        log.info('[encryptStorage]', 'Storage has been encrypted')
        return true
    }

    return false
}

/**
 * Loads a string from storage.
 *
 * @param key The key to fetch.
 */
const loadString = function (key: string): string | undefined {
  try {
    const storage = getInstance()
    return storage.getString(key)
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, e.message)
  }
}

/**
 * Saves a string to storage.
 *
 * @param key The key to fetch.
 * @param value The value to store.
 */
const saveString = function (key: string, value: string): boolean {
  try {
    const storage = getInstance()
    storage.set(key, value)
    return true
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, e.message)
  }
}

/**
 * Saves a number to storage.
 *
 * @param key The key to fetch.
 * @param value The value to store.
 */
const saveNumber = function (key: string, value: number): boolean {
  try {
    const storage = getInstance()
    storage.set(key, value)
    return true
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, e.message)
  }
}

/**
 * Saves a boolean to storage.
 *
 * @param key The key to fetch.
 * @param value The value to store.
 */
const saveBoolean = function (key: string, value: boolean): boolean {
  try {
    const storage = getInstance()
    storage.set(key, value)
    return true
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, e.message)
  }
}

/**
 * Loads something from storage and runs it thru JSON.parse.
 *
 * @param key The key to fetch.
 */
const load = function (key: string): any | undefined {
  try {
    const storage = getInstance()
    const serialized = storage.getString(key)

    if (serialized) {
      return JSON.parse(serialized as string)
    }

    return undefined
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, e.message)
  }
}

/**
 * Saves an object to storage.
 *
 * @param key The key to fetch.
 * @param value The value to store.
 */
const save = function (key: string, value: any): boolean {  
  try {
    const storage = getInstance()
    storage.set(key, JSON.stringify(value))
    return true
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, e.message)
  }
}

/**
 * Removes something from storage.
 *
 * @param key The key to kill.
 */
const remove = function (key: string): void {
  try {
    const storage = getInstance()
    storage.delete(key)
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, e.message)
  }
}

/**
 * Burn it all to the ground.
 */
const clearAll = function (): void {
  try {
    const storage = getInstance()
    storage.clearAll()
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, e.message)
  }
}

export const MMKVStorage = {
  initEncryption,
  getOrCreateEncryptionKey,
  encryptStorage,
  decryptStorage,
  loadString,
  saveString,
  saveNumber,
  saveBoolean,
  load,
  save,
  remove,
  clearAll,
}
