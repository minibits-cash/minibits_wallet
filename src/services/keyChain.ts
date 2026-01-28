import * as _Keychain from 'react-native-keychain'
import AppError, {Err} from '../utils/AppError'
import QuickCrypto from 'react-native-quick-crypto'
import { wordlist } from "@scure/bip39/wordlists/english"

import * as bip39 from '@scure/bip39'

import { bytesToHex } from '@noble/hashes/utils'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { accountFromSeedWords } from 'nostr-tools/nip06'
import {log} from './logService'
import { getRandomUsername } from '../utils/usernames'

// Default account index for NIP-06 derivation (future multi-account support)
const DEFAULT_NOSTR_ACCOUNT_INDEX = 0


export enum KeyChainServiceName {  
  BIOMETRIC_AUTH = 'app.minibits.auth',
  KEYS = 'app.minibits.keys',
  JWT_TOKENS = 'app.minibits.jwt',
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

export type JwtTokens = {
  accessToken: string,
  refreshToken: string,
  accessTokenExpiresAt: number,
  refreshTokenExpiresAt: number
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


const generateNostrKeyPair = function () {
  try {
      const privateKeyBytes = generateSecretKey() // Uint8Array
      const privateKey = bytesToHex(privateKeyBytes)
      const publicKey = getPublicKey(privateKeyBytes)

      log.trace('New random Nostr keypair created', {publicKey, privateKey})

      return {publicKey, privateKey} as NostrKeyPair
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}


/**
 * Derive Nostr keypair from mnemonic using NIP-06
 * Uses BIP-32 derivation path: m/44'/1237'/{accountIndex}'/0/0
 *
 * @param mnemonic BIP-39 mnemonic phrase
 * @param accountIndex Account index for derivation (default 0, for future multi-account support)
 */
const deriveNostrKeyPair = function (
  mnemonic: string,
  accountIndex: number = DEFAULT_NOSTR_ACCOUNT_INDEX
): NostrKeyPair {
  try {
      const { privateKey: privateKeyBytes, publicKey } = accountFromSeedWords(
        mnemonic,
        '', // No passphrase
        accountIndex
      )
      const privateKey = bytesToHex(privateKeyBytes)

      log.trace('[deriveNostrKeyPair] Nostr keypair derived from mnemonic', {publicKey, accountIndex})

      return { publicKey, privateKey }
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}


/**
 * Check if the wallet's Nostr keys are derived from the mnemonic (NIP-06)
 * Returns true if keys match, false if they are legacy random keys
 *
 * @param walletKeys The wallet keys to check
 */
const areNostrKeysDerived = function (walletKeys: WalletKeys): boolean {
  try {
      const { NOSTR, SEED } = walletKeys

      if (!SEED?.mnemonic || !NOSTR?.publicKey) {
        return false
      }

      // Derive what the keys should be from the mnemonic
      const derivedKeys = deriveNostrKeyPair(SEED.mnemonic)

      // Compare with stored keys
      const isDerived = derivedKeys.publicKey === NOSTR.publicKey

      log.trace('[areNostrKeysDerived]', { isDerived, storedPubkey: NOSTR.publicKey, derivedPubkey: derivedKeys.publicKey })

      return isDerived
  } catch (e: any) {
      log.error('[areNostrKeysDerived] Error checking keys', e)
      return false
  }
}


const generateWalletKeys = function (accountIndex: number = DEFAULT_NOSTR_ACCOUNT_INDEX) {
  try {
      const mnemonic = bip39.generateMnemonic(wordlist)
      log.trace('[generateMnemonic]', 'New mnemonic created:', {mnemonic})

      const seedBytesArray = bip39.mnemonicToSeedSync(mnemonic)
      const seed = Buffer.from(seedBytesArray).toString('base64')
      log.trace('[generateWalletKeys] Seed generated from mnemonic (base64)', {seed})

      const seedHash = QuickCrypto
      .createHash('sha256')
      .update(seedBytesArray)
      .digest('hex')

      // Derive Nostr keys from mnemonic using NIP-06 (BIP-32 derivation path m/44'/1237'/{account}'/0/0)
      const nostrKeys = deriveNostrKeyPair(mnemonic, accountIndex)
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
 * AuthToken to trigger biometric auth on wallet start *
 * 
 */
const generateAuthToken = (): string => {
  try {
      const tokenLength = 16 // Length of the token in bytes
      const tokenBytes = QuickCrypto.randomBytes(tokenLength)
      const uint8Array = new Uint8Array(tokenBytes)
      const tokenBase64 = btoa(String.fromCharCode(...uint8Array))

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
        KeyChainServiceName.BIOMETRIC_AUTH, 
        token, 
        {
            service: KeyChainServiceName.BIOMETRIC_AUTH,
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
          service: KeyChainServiceName.BIOMETRIC_AUTH, 
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
          service: KeyChainServiceName.BIOMETRIC_AUTH
      })

      log.trace('[removeAuthToken]', 'Removed authToken.')
      return result
  } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}



export type AuthResult = {
  success: boolean
  shouldExitApp: boolean
}


/**
 * Authenticate user on app start
 * Creates auth token on first use, then requires biometric authentication
 * Returns result object with success status and whether app should exit
 */
const authenticateOnAppStart = async function (isAuthOn: boolean): Promise<AuthResult> {
  try {
    const authToken = await getOrCreateAuthToken(isAuthOn)

    if (authToken) {
      log.trace('[authenticateOnAppStart]', 'App start authentication successful')
      return { success: true, shouldExitApp: false }
    }

    log.trace('[authenticateOnAppStart]', 'No auth token found')
    return { success: false, shouldExitApp: false }
  } catch (e: any) {
    // Handle specific error codes for user actions
    if (e && typeof e === 'object') {
      const errString = JSON.stringify(e)
      const isBackPressed = errString.includes('code: 10')
      const isCancelPressed = errString.includes('code: 13')
      const isIOSCancel = 'code' in e && String(e.code) === '-128'

      if (isBackPressed) {
        log.trace('[authenticateOnAppStart]', 'User pressed back button')
        return { success: false, shouldExitApp: true }
      }

      if (isCancelPressed || isIOSCancel) {
        log.trace('[authenticateOnAppStart]', 'User cancelled authentication')
        return { success: false, shouldExitApp: true }
      }
    }

    log.warn('[authenticateOnAppStart]', 'Authentication failed', { message: e.message })
    return { success: false, shouldExitApp: false }
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


/**
 * Authenticate user when leaving POS mode
 * Returns true if authentication succeeded, false if cancelled or failed
 */
const authenticatePOSMode = async function (): Promise<boolean> {
  try {
    const result = await _Keychain.getGenericPassword({
      service: KeyChainServiceName.BIOMETRIC_AUTH,
      authenticationPrompt: {
        title: 'Authentication required',
        subtitle: '',
        description: 'Authentication is required to leave the POS mode.',
        cancel: 'Cancel',
      }
    })

    if (result) {
      log.trace('[authenticatePOSMode]', 'POS mode authentication successful')
      return true
    }

    log.trace('[authenticatePOSMode]', 'No auth token found')
    return false
  } catch (e: any) {
    // Handle specific error codes for user actions
    if (e && typeof e === 'object') {
      const errString = JSON.stringify(e)
      const isBackPressed = errString.includes('code: 10')
      const isCancelPressed = errString.includes('code: 13')
      const isIOSCancel = 'code' in e && String(e.code) === '-128'

      if (isBackPressed) {
        log.trace('[authenticatePOSMode]', 'User pressed back button')
        return false
      }

      if (isCancelPressed || isIOSCancel) {
        log.trace('[authenticatePOSMode]', 'User cancelled authentication')
        return false
      }
    }

    log.trace('[authenticatePOSMode]', 'Authentication failed', { message: e.message })
    return false
  }
}


/**
 * Save JWT tokens in KeyChain/KeyStore
 *
 * @param tokens JwtTokens type
 * @param isAuthOn boolean for biometric protection
 */
const saveJwtTokens = async function (
  tokens: JwtTokens,
  isAuthOn: boolean = false
): Promise<_Keychain.Result | false> {
  try {
    const result = await _Keychain.setGenericPassword(
        KeyChainServiceName.JWT_TOKENS,
        JSON.stringify(tokens),
        {
            service: KeyChainServiceName.JWT_TOKENS,
            accessControl: isAuthOn ? _Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE : undefined
        },
    )   

    log.trace('[saveJwtTokens]', 'Saved JWT tokens to the KeyChain')

    return result
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}


/**
 * Get JWT tokens from the KeyChain/KeyStore
 *
 * 
 */
const getJwtTokens = async function (): Promise<JwtTokens | undefined> {    
  try {
    log.trace('[getJwtTokens]', 'start')

    const result = await _Keychain.getGenericPassword({
        service: KeyChainServiceName.JWT_TOKENS,
    })      

    if (result) {        
      const tokens: JwtTokens = JSON.parse(result.password)

      log.trace('[getJwtTokens]', 'Returning JWT tokens from KeyChain')

      return tokens
    }

    log.debug('[getJwtTokens]', 'Did not find existing JWT tokens in the KeyChain')
    return undefined
  } catch (e: any) {
    throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}


/**
 * Removes JWT tokens from KeyChain/KeyStore
 *
 * 
 */
const removeJwtTokens = async function (): Promise<boolean> {
  try {
      const result = await _Keychain.resetGenericPassword({
          service: KeyChainServiceName.JWT_TOKENS
      })
      log.trace('[removeJwtTokens]', 'Removed JWT tokens.')
      return result
  } catch (e: any) {
      throw new AppError(Err.KEYCHAIN_ERROR, e.message, e)
  }
}


export const KeyChain = {
    getSupportedBiometryType,
    generateNostrKeyPair,
    deriveNostrKeyPair,
    areNostrKeysDerived,
    generateWalletKeys,
    saveWalletKeys,
    getWalletKeys,
    hasWalletKeys,
    removeWalletKeys,

    // local biometric auth token
    generateAuthToken,
    saveAuthToken,
    getAuthToken,
    getOrCreateAuthToken,
    removeAuthToken,
    updateAuthSettings,
    authenticateOnAppStart,
    authenticatePOSMode,

    // server JWT tokens
    saveJwtTokens,
    getJwtTokens,
    removeJwtTokens,
}
