import * as _Keychain from 'react-native-keychain'
import AppError, {Err} from '../utils/AppError'
import QuickCrypto from 'react-native-quick-crypto'
import { generateNewMnemonic } from '@cashu/cashu-ts'
import { generatePrivateKey, getPublicKey } from 'nostr-tools'
import {btoa, fromByteArray} from 'react-native-quick-base64'
import {log} from './logService'


export enum KeyChainServiceName {
  MMKV = 'app.minibits.mmkv',
  NOSTR = 'app.minibits.nostr',
  SEED = 'app.minibits.seed',
  MNEMONIC = 'app.minibits.mnemonic',
}

export type KeyPair = {
    publicKey: string,
    privateKey: string
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


const generateMnemonic = function () {
    try {
        log.trace('[generateMnemonic]', 'start')

        const mnemonic = generateNewMnemonic()

        log.trace('[generateMnemonic]', 'New mnemonic created:', mnemonic)

        return mnemonic as string
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
}


const saveMnemonic = async function (
    mnemonic: string,  
  ): Promise<_Keychain.Result | false> {
    try {
      const result = await _Keychain.setGenericPassword(
          KeyChainServiceName.MNEMONIC,
          mnemonic,
          {
              service: KeyChainServiceName.MNEMONIC            
          },
      )
  
      log.trace('[saveMnemonic]', 'Saved new mnemonic to the KeyChain', mnemonic)
  
      return result
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
  }
  
  /**
   * Loads mnemonic from the KeyChain/KeyStore
   *
   */
  const loadMnemonic = async function (): Promise<string | undefined> {    
    try {
      log.trace('[loadMnemonic]', 'start')

      const result = await _Keychain.getGenericPassword({
          service: KeyChainServiceName.MNEMONIC
      })
      
  
      if (result) {
        const mnemonic = result.password
        log.trace('[loadMnemonic]', 'complete', {mnemonic})
        return mnemonic
      }

      log.trace('[loadMnemonic]', 'Did not find existing mnemonic in the KeyChain')
      return undefined
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message)
    }
}


/**
 * Removes mnemonic from KeyChain/KeyStore
 *
 * @param service The key to kill.
 */
const removeMnemonic = async function (): Promise<boolean> {
    try {
        const result = await _Keychain.resetGenericPassword({
            service: KeyChainServiceName.MNEMONIC
        })
        log.trace('[removeMnemonic]', 'Removed mnemonic.')
        return result
    } catch (e: any) {
        throw new AppError(Err.KEYCHAIN_ERROR, e.message)
    }
}


/**
 * Save seed to KeyChain/KeyStore
 *
 * @param seed The key to save.
 */
const saveSeed = async function (
    seed: Uint8Array,  
  ): Promise<_Keychain.Result | false> {
    try {
    
      const seedStr: string = Buffer.from(seed).toString('base64')

      log.trace('[saveSeed]', 'Saved seed base64', seedStr)

      const result = await _Keychain.setGenericPassword(
          KeyChainServiceName.SEED,
          seedStr,
          {
              service: KeyChainServiceName.SEED            
          },
      )
  
      log.trace('[saveSeed]', 'Saved seed to the KeyChain')
  
      return result
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
  }
  
  /**
   * Loads mnemonic from the KeyChain/KeyStore
   *
   */
  const loadSeed = async function (): Promise<Uint8Array | undefined> {    
    try {
      log.trace('[loadSeed]', 'start')
      const result = await _Keychain.getGenericPassword({
          service: KeyChainServiceName.SEED
      })      
  
      if (result) {
        const seedStr = result.password
        log.trace('[loadSeed]', 'base64', {seedStr})
        const seed: Uint8Array = new Uint8Array(Buffer.from(seedStr, 'base64'))        
        return seed
      }

      log.trace('[loadSeed]', 'Did not find existing seed in the KeyChain')
      return undefined
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message)
    }
}
  /**
   * Hash seed that is used for wallet address recovery
   *
   */

const loadSeedHash = async function (): Promise<string | undefined> {    
    try {
      log.trace('[loadSeedHash]', 'start')
      const seed = await loadSeed()

      if(!seed) {
        return undefined
      }

      const seedHash = QuickCrypto.createHash('sha256')
      .update(seed)
      .digest('hex')

      log.trace('[loadSeedHash]', {seedHash})
      return seedHash

    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message)
    }
}


/**
 * Removes mnemonic from KeyChain/KeyStore
 *
 * @param service The key to kill.
 */
const removeSeed = async function (): Promise<boolean> {
    try {
        const result = await _Keychain.resetGenericPassword({
            service: KeyChainServiceName.SEED
        })
        log.trace('[removeSeed]', 'Removed seed.')
        return result
    } catch (e: any) {
        throw new AppError(Err.KEYCHAIN_ERROR, e.message)
    }
}


const generateNostrKeyPair = function () {
    try {
        const privateKey = generatePrivateKey() // hex string
        const publicKey = getPublicKey(privateKey)

        log.trace('New HEX Nostr keypair created:', publicKey, privateKey)

        return {publicKey, privateKey} as KeyPair
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

    log.trace('[saveNostrKeyPair]', 'Saved keypair to the KeyChain')

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
        log.trace('[loadNostrKeyPair]', 'Did not find existing keyPair in the KeyChain')
        return undefined
    } catch (e: any) {
        throw new AppError(Err.KEYCHAIN_ERROR, e.message)
    }
}


/**
 * Removes keypair from KeyChain/KeyStore
 *
 * @param service The key to kill.
 */
const removeNostrKeypair = async function (): Promise<boolean> {
    try {
        const result = await _Keychain.resetGenericPassword({
            service: KeyChainServiceName.NOSTR
        })
        log.trace('[removeNostrKeypair]', 'Removed nostr keypair.')
        return result
    } catch (e: any) {
        throw new AppError(Err.KEYCHAIN_ERROR, e.message)
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
  
      log.trace('[saveMmkvEncryptionKey]', 'Saved encryptionKey to the KeyChain.')
  
      return result
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

        log.trace('[loadMmkvEncryptionKey]', 'Did not find existing encryptionKey in the KeyChain.')
        return undefined
    } catch (e: any) {
        throw new AppError(Err.KEYCHAIN_ERROR, e.message, {caller: 'loadMmkvEncryptionKey', message: e.message})
    }
}


/**
 * Removes key from KeyChain/KeyStore
 *
 * @param service The key to kill.
 */
const removeMmkvEncryptionKey = async function (): Promise<boolean> {
    try {
        const result = await _Keychain.resetGenericPassword({
            service: KeyChainServiceName.MMKV
        })

        log.trace('[removeMmkvEncryptionKey]', 'Removed mmkv key.')
        return result
    } catch (e: any) {
        throw new AppError(Err.KEYCHAIN_ERROR, e.message)
    }
}


export const KeyChain = {
    getSupportedBiometryType,
    
    generateMnemonic,
    saveMnemonic,
    loadMnemonic,
    removeMnemonic,

    saveSeed,
    loadSeed,
    loadSeedHash,
    removeSeed,

    generateNostrKeyPair,    
    saveNostrKeyPair,
    loadNostrKeyPair,
    removeNostrKeypair,

    generateMmkvEncryptionKey,    
    saveMmkvEncryptionKey,
    loadMmkvEncryptionKey,
    removeMmkvEncryptionKey,       
}
