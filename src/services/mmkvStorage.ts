import {createMMKV, type MMKV} from 'react-native-mmkv'
import {log} from './logService'
import AppError, {Err} from '../utils/AppError'

const STORAGE_KEY = 'storage-v1'
let _storage: MMKV | undefined

const getInstance = function () {
    if (!_storage) {

      _storage = createMMKV({
          id: STORAGE_KEY,
      })

      log.trace('[getInstance]', 'MMKV storage initialized')
      return _storage
    }

    return _storage
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
    // log.trace(`[mmkvStorage.save] *** MMKV REAL SAVE *** Took ${end - start} ms to save ${dataSize} bytes.`)

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
    storage.remove(key)
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
    log.trace('[clearAll] Wallet state cleared.')
  } catch (e: any) {
    throw new AppError(Err.DATABASE_ERROR, e.message)
  }
}

export const MMKVStorage = {  
  loadString,
  saveString,
  saveNumber,
  saveBoolean,
  load,
  save,
  remove,
  clearAll,
}
