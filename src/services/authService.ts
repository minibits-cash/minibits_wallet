import { JS_BUNDLE_VERSION, MINIBITS_SERVER_API_HOST, MINIBITS_SERVER_API_KEY } from '@env'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { finalizeEvent, getEventHash, validateEvent } from 'nostr-tools/pure'
import { NostrClient, NostrEvent, NostrUnsignedEvent } from './nostrService'
import { KeyChain, JwtTokens, NostrKeyPair, WalletKeys } from './keyChain'
import { MinibitsClient } from './minibitsService'
import { log } from './logService'
import AppError, { Err } from '../utils/AppError'
import { rootStoreInstance } from '../models'


export interface AuthChallengeResponse {
    challenge: string
    expiresAt: number
    createdAt: number
}

export interface VerifyChallengeResponse {
    accessToken: string
    refreshToken: string,    
    pubkey: string,
    deviceId: string
}

const { walletProfileStore, walletStore, authStore } = rootStoreInstance

/**
 * Enrolls a new device by signing a challenge
 */
const enrollDevice = async function (pubkey: string, deviceId?: string | null): Promise<JwtTokens> {
    try {        
        log.trace('[enrollDevice] Starting device enrollment', { pubkey, deviceId })

        // Step 1: Get challenge from server
        const challengeUrl = `${MINIBITS_SERVER_API_HOST}/auth/challenge`
        const challengeBody = { pubkey, deviceId }
        
        const challengeResponse = await MinibitsClient.fetchApi(challengeUrl, {
            method: 'POST',
            body: challengeBody,
            jwtAuthRequired: false
        }) as AuthChallengeResponse

        log.trace('[enrollDevice] Received challenge', { challenge: challengeResponse.challenge })

        // Step 2: Sign the challenge with Nostr private key
        let authUnsignedEvent: NostrUnsignedEvent = {
            kind: 22242,
            pubkey,
            tags: [['relay', process.env.MINIBITS_RELAY_URL as string], ['challenge', challengeResponse.challenge]],
            content: '',
            created_at: challengeResponse.createdAt
        }

        let authEvent = {...authUnsignedEvent} as unknown as NostrEvent
        
        const walletKeys: WalletKeys = await walletStore.getCachedWalletKeys()
        const nostrKeys = walletKeys.NOSTR
        
        authEvent.id = getEventHash(authUnsignedEvent)
        
        const privateKeyBytes = hexToBytes(nostrKeys.privateKey)
        const signedEvent = finalizeEvent(authEvent, privateKeyBytes)

        if (!validateEvent(signedEvent)) {
            throw new AppError(Err.VALIDATION_ERROR, 'Failed to sign authentication challenge')
        }

        log.trace('[enrollDevice] Signed challenge event', { signedEvent })

        // Step 3: Verify the signed event and get JWT tokens
        const verifyUrl = `${MINIBITS_SERVER_API_HOST}/auth/verify`
        const verifyBody = {
            pubkey,
            challenge: challengeResponse.challenge,
            signature: signedEvent.sig,
            deviceId,            
        }

        const verifyChallengeResponse = await MinibitsClient.fetchApi(verifyUrl, {
            method: 'POST',
            body: verifyBody,
            jwtAuthRequired: false
        }) as VerifyChallengeResponse

        log.info('[enrollDevice] Device enrolled successfully')

        // Store tokens securely
        const jwtTokens: JwtTokens = {
            accessToken: verifyChallengeResponse.accessToken,
            refreshToken: verifyChallengeResponse.refreshToken,
            accessTokenExpiresAt: decodeJwtExpiry(verifyChallengeResponse.accessToken) || 0,
            refreshTokenExpiresAt: decodeJwtExpiry(verifyChallengeResponse.refreshToken) || 0
        }
        
        authStore.setTokens(jwtTokens)

        return jwtTokens
        
    } catch (e: any) {
        log.error('[enrollDevice] Failed to load tokens', e)
        // Throw error to satisfy return type
        throw new AppError(Err.AUTH_ERROR, 'Failed to enroll device and obtain tokens', e)
    }
}

/**
 * Returns a valid access token, automatically refreshing if expired
 */
const getValidAccessToken = async function (pubkey: string, deviceId?: string | null): Promise<string> {
    try {
        
        let tokens = authStore.tokens

        if (!tokens) {
            // try to re-enroll device if no tokens found
            tokens = await enrollDevice(pubkey, deviceId)
            log.trace('[getValidAccessToken] Re-enrolled device and obtained new tokens', { tokens })
        }

        // Check if token is expired (with 1 minute buffer)
        const now = Math.floor(Date.now() / 1000)
        const bufferTime = 1 * 60 // 1 min
        
        if (tokens && tokens.accessTokenExpiresAt <= (now + bufferTime)) {
            log.trace('[getValidAccessToken] Token expired, refreshing')
            const newTokens = await refreshTokens()
            return newTokens.accessToken
        }

        return tokens.accessToken

    } catch (e: any) {
        log.error('[getValidAccessToken] Failed to get valid access token', e)
        throw e
    }
}

/**
 * Calls /auth/refresh endpoint to get new token pair
 */
const refreshTokens = async function (): Promise<JwtTokens> {
    try {
        
        const {tokens} = authStore

        if (!tokens || !tokens.refreshToken) {
            throw new AppError(Err.AUTH_ERROR, 'No refresh token available. Please re-authenticate.')
        }

        log.trace('[refreshTokens] Refreshing tokens')

        const refreshUrl = `${MINIBITS_SERVER_API_HOST}/auth/refresh`
        const refreshBody = {
            refreshToken: tokens.refreshToken
        }

        const newTokens = await MinibitsClient.fetchApi(refreshUrl, {
            method: 'POST',
            body: refreshBody,
            jwtAuthRequired: false
        }) as JwtTokens

        log.info('[refreshTokens] Tokens refreshed successfully')

        // Store new tokens securely
        const jwtTokens: JwtTokens = {
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken,
            accessTokenExpiresAt: decodeJwtExpiry(newTokens.accessToken) || 0,
            refreshTokenExpiresAt: decodeJwtExpiry(newTokens.refreshToken) || 0
        }

        await authStore.setTokens(jwtTokens)
        return jwtTokens

    } catch (e: any) {
        log.error('[refreshTokens] Failed to refresh tokens', e)
        
        // If refresh fails, clear stored tokens
        await authStore.clearTokens()
        
        throw new AppError(Err.AUTH_ERROR, `Token refresh failed: ${e.message}`, e)
    }
}


function base64urlDecode(base64url: string) {
    // Replace base64url characters with base64 standard ones
    let base64 = base64url
      .replace(/-/g, '+') // Replace '-' with '+'
      .replace(/_/g, '/') // Replace '_' with '/'
      .replace(/[^A-Za-z0-9+/=]/g, ''); // Clean up any other characters
    
    // Pad the base64 string to make it a multiple of 4 if necessary
    while (base64.length % 4) {
      base64 += '=';
    }
  
    // Decode base64 to a string
    const decodedString = atob(base64);
    return decodedString;
}
  



export const decodeJwtExpiry = (token: string): number | null => {
    try {
      // Split the token into its parts: header, payload, and signature
      const [, payload] = token.split('.')
  
      if (!payload) {
        throw new Error('Invalid JWT token format')
      }
  
      // Decode the payload from Base64URL
      const decodedPayload = JSON.parse(base64urlDecode(payload))
  
      // Return the `exp` field (expiry time in seconds since epoch)
      return decodedPayload.exp || null
    } catch (error) {
      console.error('Failed to decode JWT token:', error)
      return null
    }
}




/**
 * Calls /auth/logout endpoint and clears local tokens
 */
const logout = async function (): Promise<void> {
    try {
        const {tokens} = authStore

        if (tokens && tokens.refreshToken) {
            // Call server logout endpoint to invalidate refresh token
            try {
                const logoutUrl = `${MINIBITS_SERVER_API_HOST}/auth/logout`
                const logoutBody = {
                    refreshToken: tokens.refreshToken
                }

                await MinibitsClient.fetchApi(logoutUrl, {
                    method: 'POST',
                    body: logoutBody,
                    jwtAuthRequired: false
                })

                log.info('[logout] Server logout successful')
            } catch (e: any) {
                // Log but don't throw - we still want to clear local tokens
                log.warn('[logout] Server logout failed, clearing local tokens anyway', e)
            }
        }

        // Always clear local tokens
        await authStore.clearTokens()
        log.info('[logout] Local tokens cleared')

    } catch (e: any) {
        log.error('[logout] Logout failed', e)
        // Still try to clear local tokens even if there's an error
        await authStore.clearTokens()
        throw new AppError(Err.AUTH_ERROR, `Logout failed: ${e.message}`, e)
    }
}


const getAuthenticatedHeaders = async (): Promise<Record<string, string>> => {

    const {pubkey, device} = walletProfileStore

    const accessToken = await AuthService.getValidAccessToken(pubkey, device)
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',  
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': `Minibits/${JS_BUNDLE_VERSION}`
    }
}

export const AuthService = {
    enrollDevice,
    getValidAccessToken,
    refreshTokens,
    logout,
    getAuthenticatedHeaders
}