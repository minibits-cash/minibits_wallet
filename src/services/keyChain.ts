import * as _Keychain from 'react-native-keychain'
import AppError, {Err} from '../utils/AppError'
import QuickCrypto from 'react-native-quick-crypto'
import { generateMnemonic as generateNewMnemonic, mnemonicToSeedSync } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english"
import { bytesToHex } from '@noble/hashes/utils'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {btoa, fromByteArray} from 'react-native-quick-base64'
import {log} from './logService'
import { getRandomUsername } from '../utils/usernames'


export enum KeyChainServiceName {  
  NOSTR = 'app.minibits.nostr',
  SEED = 'app.minibits.seed',
  MNEMONIC = 'app.minibits.mnemonic',
  AUTH = 'app.minibits.auth',
  KEYS = 'app.minibits.keys',
}

export type NostrKeyPair = {
    publicKey: string,
    privateKey: string
}

export type WalletKeys = {
  walletId: string,
  NOSTR: {
    publicKey: string,
    privateKey: string
  },
  SEED: {
    seed: string,
    seedHash: string,
    mnemonic: string
  }  
}


const getSupportedBiometryType = async function () {
    try {
        const biometryType = await _Keychain.getSupportedBiometryType()
        log.trace('biometryType', biometryType)
        return biometryType
    } catch (e: any) {
        throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
}


const generateMnemonic = function () {
    try {
        log.trace('[generateMnemonic]', 'start')

        const mnemonic = generateNewMnemonic(wordlist)

        log.trace('[generateMnemonic]', 'New mnemonic created:', {mnemonic})

        return mnemonic
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
}


const generateNostrKeyPair = function () {
  try {
      const privateKeyBytes = generateSecretKey() // Uint8Array
      const privateKey = bytesToHex(privateKeyBytes)
      const publicKey = getPublicKey(privateKeyBytes)

      log.trace('New Nostr keypair created', {publicKey, privateKey})

      return {publicKey, privateKey} as NostrKeyPair
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}


const generateWalletKeys = function () {
  try {
      const mnemonic = generateMnemonic()
      const seedBytesArray = mnemonicToSeedSync(mnemonic)
      const seed = Buffer.from(seedBytesArray).toString('base64')
      const seedHash = QuickCrypto
      .createHash('sha256')
      .update(seedBytesArray)
      .digest('hex')
      const nostrKeys = generateNostrKeyPair()
      const walletId = getRandomUsername()

      const walletKeys: WalletKeys = {
        walletId,
        SEED: {
          seed,
          seedHash,
          mnemonic
        },
        NOSTR: {
          privateKey: nostrKeys.privateKey,
          publicKey: nostrKeys.publicKey
        }
      }

      log.trace('[generateWalletKeys] New keys', {walletKeys})

      return walletKeys
      
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}

/**
 * Save wallet keys in KeyChain/KeyStore
 *
 * @param keys WalletKeys type
 */
const saveWalletKeys = async function (
  walletKeys: WalletKeys,      
): Promise<_Keychain.Result | false> {
  try {
    if(
      !walletKeys.walletId ||
      !walletKeys.SEED ||
      !walletKeys.NOSTR
    ) {
      throw new Error('Invalid wallet keys')
    }

    const result = await _Keychain.setGenericPassword(
        KeyChainServiceName.KEYS,
        JSON.stringify(walletKeys),
        {
            service: KeyChainServiceName.KEYS,                                 
        },
    )   

    log.trace('[saveWalletKeys]', 'Saved wallet keys to the KeyChain', {walletKeys})

    return result
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}


  /**
   * Get wallet keys from the KeyChain/KeyStore
   *
   */
  const getWalletKeys = async function (): Promise<WalletKeys | undefined> {    
    try {
      log.trace('[getWalletKeys]', 'start')

      const result = await _Keychain.getGenericPassword({
          service: KeyChainServiceName.KEYS,          
      })      
  
      if (result) {        
        const keys: WalletKeys = JSON.parse(result.password)

        log.trace('[getWalletKeys]', 'Returning walletKeys from KeyChain', {keys})

        return keys
      }

      log.debug('[getWalletKeys]', 'Did not find existing wallet keys in the KeyChain')
      return undefined
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
  }


  /**
   * Has wallet keys in KeyChain/KeyStore
   *
   */
  const hasWalletKeys = async function (): Promise<boolean> {    
    try {      
      const hasWalletKeys = await _Keychain.hasGenericPassword({
          service: KeyChainServiceName.KEYS,          
      })

      log.debug('[hasWalletKeys]', hasWalletKeys)

      return hasWalletKeys

    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
  }


/**
 * Removes wallet keys from KeyChain/KeyStore
 *
 * 
 */
const removeWalletKeys = async function (): Promise<boolean> {
  try {
      const result = await _Keychain.resetGenericPassword({
          service: KeyChainServiceName.KEYS
      })
      log.trace('[removeWalletKeys]', 'Removed wallet keys.')
      return result
  } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}


  /**
   * One time migration
   *
   */
  const migrateWalletKeys = async function (walletId: string): Promise<void> {
    let mnemonic: string | undefined = undefined
    let seed: string | undefined = undefined
    let seedHash: string | undefined = undefined
    let nostrKeys: NostrKeyPair | undefined = undefined

    try {
      log.trace('[migrateWalletKeys]', 'start')
      
      const mnemonicResult = await _Keychain.getGenericPassword({
        service: KeyChainServiceName.MNEMONIC,          
      })      

      if (mnemonicResult) {
        mnemonic = mnemonicResult.password
      }

      const seedResult = await _Keychain.getGenericPassword({
        service: KeyChainServiceName.SEED          
      })      

      if (seedResult) {
        seed = seedResult.password
        const seedBytesArray: Uint8Array = new Uint8Array(Buffer.from(seed, 'base64'))
        seedHash = QuickCrypto.createHash('sha256')
        .update(seedBytesArray)
        .digest('hex')
      }

      const nostrResult = await _Keychain.getGenericPassword({
        service: KeyChainServiceName.NOSTR
      })

      if (nostrResult) {
        nostrKeys = JSON.parse(nostrResult.password)          
      }

      if(mnemonic && seed && seedHash && nostrKeys) {
        const walletKeys: WalletKeys = {
          walletId,
          SEED: {
            seed,
            seedHash,
            mnemonic
          },
          NOSTR: nostrKeys
        }

        await saveWalletKeys(walletKeys)

        log.debug('[migrateWalletKeys]', 'Migration completed.')

      } else {
        new Error(`Missing wallet keys to migrate for mnemonic: ${mnemonic}, use it to reinstall and recover the wallet.`)
      }      
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
  }


/**
 * AuthToken to trigger biometric auth on wallet start *
 * 
 */
const generateAuthToken = (): string => {
  try {
      const tokenLength = 16 // Length of the token in bytes
      const tokenBytes = QuickCrypto.randomBytes(tokenLength)
      const uint8Array = new Uint8Array(tokenBytes)
      const tokenStr = fromByteArray(uint8Array)
      const tokenBase64 = btoa(tokenStr)

      log.trace('New Base64 authToken created:', tokenBase64)

      return tokenBase64
  } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}


const getOrCreateAuthToken = async function (isAuthOn: boolean): Promise<string> {

  let token: string | null = null

  try {
    token = (await getAuthToken(isAuthOn)) as string

      if (!token) {
        token = generateAuthToken() as string
        await saveAuthToken(token, isAuthOn)

          log.info('[getOrCreateAuthToken]', 'Created and saved new authToken')
      }

      return token
  } catch (e: any) {
      throw e
  }
}


const saveAuthToken = async function (
  token: string,
  isAuthOn: boolean
): Promise<_Keychain.Result | false> {
  try {
    const result = await _Keychain.setGenericPassword(
        KeyChainServiceName.AUTH, 
        token, 
        {
            service: KeyChainServiceName.AUTH,
            accessControl: isAuthOn ? _Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE : undefined
        }
    )

    log.trace('[saveAuthToken]', 'Saved authToken to the KeyChain.')

    return result
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}

/**
* Loads keypair from KeyChain/KeyStore
*
*
*/
const getAuthToken = async function (isAuthOn: boolean): Promise<string | undefined> {
  try {    
      const result = await _Keychain.getGenericPassword({
          service: KeyChainServiceName.AUTH, 
          authenticationPrompt: isAuthOn ? {
              title: 'Please authenticate',
              subtitle: '',
              description: 'Your Minibits wallet requires authentication to get access.',
              cancel: 'Cancel',
          } : undefined
      })

      if (result) {
          const token = result.password      
          return token
      }

      log.trace('[loadAuthToken]', 'Did not find existing authToken in the KeyChain.')
      return undefined
  } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}


/**
* Removes key from KeyChain/KeyStore
*
* 
*/
const removeAuthToken = async function (): Promise<boolean> {
  try {
      const result = await _Keychain.resetGenericPassword({
          service: KeyChainServiceName.AUTH
      })

      log.trace('[removeAuthToken]', 'Removed authToken.')
      return result
  } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}



async function updateAuthSettings(isAuthOn: boolean) {
  log.trace('[updateAuthSettings] to', {isAuthOn})

  const authToken = await getOrCreateAuthToken(!isAuthOn) // current isAuthOn value 

  if (authToken) {
    try {
      await removeAuthToken()
      await saveAuthToken(authToken, isAuthOn)
    } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
    }
  }
}


export const KeyChain = {
    getSupportedBiometryType,
    
    generateMnemonic,
    generateNostrKeyPair,
    generateWalletKeys,
    saveWalletKeys,
    migrateWalletKeys,
    getWalletKeys,
    hasWalletKeys,
    removeWalletKeys,

    generateAuthToken,
    saveAuthToken,
    getAuthToken,
    getOrCreateAuthToken,
    removeAuthToken,
    updateAuthSettings,
}
