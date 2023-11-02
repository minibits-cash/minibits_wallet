import {MMKV} from 'react-native-mmkv'
import {log} from './logService'
import AppError, {Err} from '../utils/AppError'
import {KeyChain} from './keyChain'

let _storage: MMKV | undefined
let _encryptionKey: string | undefined

const initEncryption = async function (): Promise<void> {
  if (!_encryptionKey) {
    _encryptionKey = await getOrCreateEncryptionKey()
    getInstance() // Instantiate the MMKV instance with the encryption key
  }
}

const getInstance = function () {
  if (!_storage) {
    if (_encryptionKey) {
      _storage = new MMKV({
        id: 'storage-v1',
        encryptionKey: _encryptionKey,
      })

      log.trace('[getInstance]', 'MMKV encrypted storage initialized')
    } else {
      _storage = new MMKV({
        id: 'storage-v1',
      })

      log.trace('[getInstance]', 'MMKV storage initialized')
    }
  }

  return _storage
}

const getOrCreateEncryptionKey = async function (): Promise<string> {

    let key: string | null = null

    key = (await KeyChain.loadMmkvEncryptionKey()) as string

    if (!key) {
      key = KeyChain.generateMmkvEncryptionKey() as string
      await KeyChain.saveMmkvEncryptionKey(key)

      log.info(
        'Created and saved new encryption key',
        [],
        'getOrCreateEncryptionKey',
      )
    }

    return key
}

const recryptStorage = async function (): Promise<boolean> {

        const storage = getInstance()

        if (_encryptionKey) {
            storage.recrypt(undefined)
            _encryptionKey = undefined

            log.info('Storage encryption has been removed', [], 'recryptStorage')
            return false
        }

        const key = await getOrCreateEncryptionKey()

        storage.recrypt(key)
        _encryptionKey = key

        log.info('Storage has been encrypted', [], 'recryptStorage')
        return true

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
  log.trace('MMKV save start')
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
  recryptStorage,
  loadString,
  saveString,
  saveNumber,
  saveBoolean,
  load,
  save,
  remove,
  clearAll,
}
