import * as _Keychain from 'react-native-keychain'
import AppError, {Err} from '../utils/AppError'
import QuickCrypto from 'react-native-quick-crypto'
import {btoa, atob, fromByteArray} from 'react-native-quick-base64'
import {log} from '../utils/logger'

export enum KeyChainServiceName {
  MMKV = 'MMKV',
  SQLITE = 'SQLITE',
}

const generateKeyPair = async function () {
  try {
    const keyPair = QuickCrypto.generateKeyPairSync('ed25519')
    log.trace('New ed25519 keyPair:', keyPair)
    return keyPair
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, [e])
  }
}

const generateEncryptionKey = (): string => {
  try {
    const keyLength = 32 // Length of the encryption key in bytes
    const encryptionKey = QuickCrypto.randomBytes(keyLength)
    const uint8Array = new Uint8Array(encryptionKey)
    const stringKey = fromByteArray(uint8Array)
    const base64Key = btoa(stringKey)

    log.trace('New Base64 encryptionKey created:', base64Key)

    return base64Key
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, [e])
  }
}

/**
 * Save keypair to KeyChain/KeyStore
 *
 * @param keyPair The key to fetch.
 */
const saveKeyPair = async function (
  keyPair: {publicKey: string; privateKey: string},
  service: KeyChainServiceName,
): Promise<_Keychain.Result | false> {
  try {
    const result = await _Keychain.setGenericPassword(
      keyPair.publicKey,
      keyPair.privateKey,
      {service},
    )

    log.trace('Saved new keypair to the KeyChain')

    return result
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, [e])
  }
}

/**
 * Loads keypair from KeyChain/KeyStore
 *
 *
 */
const loadKeyPair = async function (
  service: KeyChainServiceName,
): Promise<{publicKey: string; privateKey: string} | undefined> {
  try {
    const result = await _Keychain.getGenericPassword({service})

    if (result) {
      const keyPair = {publicKey: result.username, privateKey: result.password}
      return keyPair
    }

    return undefined
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message)
  }
}

/**
 * Loads keypair from KeyChain/KeyStore
 *
 *
 */
const loadEncryptionKey = async function (
  service: KeyChainServiceName,
): Promise<string | undefined> {
  try {
    log.trace('Load encryptionKey from KeyChain start')
    const result = await _Keychain.getGenericPassword({service})

    if (result) {
      const key = result.password
      log.trace('Loaded existing encryptionKey from the KeyChain')
      return key
    }

    log.trace('Did not find existing encryptionKey in the KeyChain')
    return undefined
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message)
  }
}

/**
 * Loads keypair from KeyChain/KeyStore
 *
 * @param keyPair The key to fetch.
 */
const saveEncryptionKey = async function (
  key: string,
  service: KeyChainServiceName,
): Promise<_Keychain.Result | false> {
  try {
    const result = await _Keychain.setGenericPassword(service, key, {service})

    log.trace('Saved encryptionKey to the KeyChain')

    return result
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, [e])
  }
}

/**
 * Removes keypair from KeyChain/KeyStore
 *
 * @param key The key to kill.
 */
const removeKey = async function (
  service: KeyChainServiceName,
): Promise<boolean> {
  try {
    const result = await _Keychain.resetGenericPassword({service})
    return result
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message)
  }
}

export const KeyChain = {
  generateKeyPair,
  generateEncryptionKey,
  saveKeyPair,
  loadKeyPair,
  loadEncryptionKey,
  saveEncryptionKey,
  removeKey,
}
