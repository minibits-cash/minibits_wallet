import {MMKV} from 'react-native-mmkv'
import {log} from './logService'
import AppError, {Err} from '../utils/AppError'
import {KeyChain} from './keyChain'
import { ROOT_STORAGE_KEY } from '../models'

const STORAGE_KEY = 'storage-v1'
const ENCRYPTED_STORAGE_KEY = 'encrypted-storage-v1' // legacy, not used now

let _storage: MMKV | undefined
let _encryptionKey: string | undefined  // legacy, not used now

 // legacy, not used now
const initEncryption = async function (): Promise<void> {
  if (!_encryptionKey) {
    try {
        _encryptionKey = await getOrCreateEncryptionKey()
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

 // legacy, not used now
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

 // legacy, not used now
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

 // legacy, not used now
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
    const start = performance.now()
    
    storage.set(key, JSON.stringify(value))
    
    const end = performance.now()

    // const dataSize = Buffer.byteLength(JSON.stringify(value), 'utf8')
    // log.trace(`[mmkvStorage.save] Took ${end - start} ms to save ${dataSize} bytes.`)

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
