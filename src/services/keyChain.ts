import * as _Keychain from 'react-native-keychain'
import AppError, {Err} from '../utils/AppError'
import QuickCrypto from 'react-native-quick-crypto'
import * as nostrTools from 'nostr-tools'
import {btoa, atob, fromByteArray} from 'react-native-quick-base64'
import {log} from '../utils/logger'

export enum KeyChainServiceName {
  MMKV = 'app.minibits.mmkv',
  NOSTR = 'app.minibits.nostr',
}

export type KeyPair = {
    publicKey: string,
    privateKey: string
}

/* const generateKeyPair = async function () {
  try {
    const keyPair = QuickCrypto.generateKeyPairSync('ed25519')
    log.trace('New ed25519 keyPair:', keyPair)
    return keyPair
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
} */


const generateNostrKeyPair = function () {
    try {
        const privateKey = nostrTools.generatePrivateKey() // hex string
        const publicKey = nostrTools.getPublicKey(privateKey)

        log.trace('New HEX Nostr keypair created:', publicKey, privateKey)

        return {publicKey, privateKey} as KeyPair
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
}


const generateMmkvEncryptionKey = (): string => {
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

const getSupportedBiometryType = async function () {
    try {
      const biometryType = await _Keychain.getSupportedBiometryType({})
      log.trace('biometryType', biometryType)
      return biometryType
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
  }

/**
 * Save keypair to KeyChain/KeyStore
 *
 * @param keyPair The key to fetch.
 */
const saveNostrKeyPair = async function (
  keyPair: KeyPair,  
): Promise<_Keychain.Result | false> {
  try {
    const result = await _Keychain.setGenericPassword(
        KeyChainServiceName.NOSTR,
        JSON.stringify(keyPair),
        {
            service: KeyChainServiceName.NOSTR            
        },
    )

    log.trace('Saved keypair to the KeyChain')

    return result
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}

/**
 * Loads keypair from the KeyChain/KeyStore
 *
 */
const loadNostrKeyPair = async function (): Promise<KeyPair | undefined> {
  try {
    const result = await _Keychain.getGenericPassword({
        service: KeyChainServiceName.NOSTR
    })

    if (result) {
      const keyPair = JSON.parse(result.password)
      return keyPair
    }
    log.trace('Did not find existing keyPair in the KeyChain')
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
const loadMmkvEncryptionKey = async function (): Promise<string | undefined> {
  try {    
    const result = await _Keychain.getGenericPassword({
        service: KeyChainServiceName.MMKV, 
        authenticationPrompt: {
            title: 'Authentication required',
            subtitle: '',
            description: 'Your Minibits wallet data is encrypted. Please authenticate to get access.',
            cancel: 'Cancel',
        },
    })

    if (result) {
      const key = result.password      
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
 * @param key The key to save.
 * @param service KeyChainServiceName.
 */
const saveMmkvEncryptionKey = async function (
  key: string,  
): Promise<_Keychain.Result | false> {
  try {
    const result = await _Keychain.setGenericPassword(
        KeyChainServiceName.MMKV, 
        key, 
        {
            service: KeyChainServiceName.MMKV,
            accessControl: _Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE
        }
    )

    log.trace('Saved encryptionKey to the KeyChain')

    return result
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message)
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
    generateNostrKeyPair,
    generateMmkvEncryptionKey,
    getSupportedBiometryType,
    saveNostrKeyPair,
    loadNostrKeyPair,
    loadMmkvEncryptionKey,
    saveMmkvEncryptionKey,    
}
