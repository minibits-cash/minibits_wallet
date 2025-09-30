import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import {JwtTokens, KeyChain, log, MinibitsClient, NostrEvent, NostrKeyPair, NostrUnsignedEvent} from '../services'
import AppError, { Err } from '../utils/AppError'
import { MINIBITS_SERVER_API_HOST } from '@env'
import { finalizeEvent, getEventHash, verifyEvent } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import { decodeJwtExpiry } from '../utils/authUtils'

export type AuthState = {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null
  deviceId: string | null
  isAuthenticated: boolean
}

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

export interface TokenPair {
  accessToken: string
  refreshToken: string  
}

export const AuthStoreModel = types
  .model('AuthStore')
  .props({
    accessToken: types.maybeNull(types.string),
    refreshToken: types.maybeNull(types.string),
    accessTokenExpiresAt: types.maybeNull(types.number),
    refreshTokenExpiresAt: types.maybeNull(types.number), 
  })
  .views(self => ({
    get isAuthenticated(): boolean {
      log.trace('[AuthStore.isAuthenticated] Checking authentication status')
      if (!self.accessToken || !self.accessTokenExpiresAt) {
        log.trace('[AuthStore.isAuthenticated] missing access token or expiry')
        return false
      }

      const now = Math.floor(Date.now() / 1000)
      log.trace('[AuthStore.isAuthenticated]', {now, atExpiresAt: self.accessTokenExpiresAt})

      if (now >= self.accessTokenExpiresAt) {
        return false
      } else {
        log.trace('[AuthStore.isAuthenticated] Access token is valid')
        return true
      }
    },
    get isAccessTokenExpired(): boolean {
      if (!self.accessTokenExpiresAt) return true
      const now = Math.floor(Date.now() / 1000)
      log.trace('[AuthStore.isAccessTokenExpired]', {now, atExpiresAt: self.accessTokenExpiresAt})

      if (now >= self.accessTokenExpiresAt) {
        log.trace('[AuthStore.isAccessTokenExpired] Access token is expired')
        return true
      } else {
        return false
      }
    },
    get isRefreshTokenExpired(): boolean {
      if (!self.refreshTokenExpiresAt) return true
      const now = Math.floor(Date.now() / 1000)
      log.trace('[AuthStore.isRefreshTokenExpired]', {now, rtExpiresAt: self.refreshTokenExpiresAt})

      if (now >= self.refreshTokenExpiresAt) {
        log.trace('[AuthStore.isRefreshokenExpired] Refresh token is expired')
        return true
      } else {
        return false
      }
    },
    get tokens(): JwtTokens | null {
      if (!self.accessToken || !self.refreshToken) return null
      return {
        accessToken: self.accessToken,
        refreshToken: self.refreshToken,
        accessTokenExpiresAt: self.accessTokenExpiresAt as number,
        refreshTokenExpiresAt: self.refreshTokenExpiresAt as number,
      }
    }
  }))
  .actions(self => ({
    setTokens: flow(function* setTokens(tokens: JwtTokens) {
      try {
        log.trace('[setTokens] Saving JWT tokens', {tokens})
        
        // Save to KeyChain
        yield KeyChain.saveJwtTokens(tokens)
        
        // Update store state
        self.accessToken = tokens.accessToken
        self.refreshToken = tokens.refreshToken
        self.accessTokenExpiresAt = tokens.accessTokenExpiresAt
        self.refreshTokenExpiresAt = tokens.refreshTokenExpiresAt
        
        log.trace('[setTokens] JWT Tokens saved successfully')
      } catch (e: any) {
        log.error(`Failed to save JWT tokens: ${e.message}`, {caller: 'setTokens'})
        throw e
      }
    }),
    clearTokens: flow(function* clearTokens() {
      try {
        log.trace('[clearTokens] Clearing tokens')
        
        // Remove from KeyChain
        yield KeyChain.removeJwtTokens()
        
        // Clear store state
        self.accessToken = null
        self.refreshToken = null
        self.accessTokenExpiresAt = null
        self.refreshTokenExpiresAt = null
        
        log.trace('[clearTokens] Tokens cleared successfully')
      } catch (e: any) {
        log.error(`Failed to clear tokens: ${e.message}`, {caller: 'clearTokens'})
        throw e
      }
    }),     
    loadTokensFromKeyChain: flow(function* loadTokensFromKeyChain() {
      try {
        log.trace('Loading tokens from the KeyChain')
        
        const tokens = yield KeyChain.getJwtTokens()
        
        if (tokens) {
          self.accessToken = tokens.accessToken
          self.refreshToken = tokens.refreshToken
          self.accessTokenExpiresAt = tokens.accessTokenExpiresAt
          self.refreshTokenExpiresAt = tokens.refreshTokenExpiresAt
          
          log.trace('Tokens loaded successfully')
        } else {
          log.warn('No tokens found in the KeyChain')
        }
      } catch (e: any) {
        log.error(`Failed to load tokens: ${e.message}`, {caller: 'loadTokensFromKeyChain'})
        // Don't throw here, just log the error as missing tokens is not critical
      }
    }),
    
  }))
  .actions(self => ({
    enrollDevice: flow(function* enrollDevice(nostrKeys: NostrKeyPair, deviceId?: string | null) {
      try {        
        log.trace('[enrollDevice] Starting device enrollment', { nostrKeys, deviceId })

        // Step 1: Get challenge from server
        const challengeResponse: AuthChallengeResponse = yield MinibitsClient.getAuthChallenge(nostrKeys.publicKey, deviceId)

        log.trace('[enrollDevice] Received challenge', { challenge: challengeResponse.challenge })

        // Step 2: Sign the challenge with Nostr private key
        let authUnsignedEvent: NostrUnsignedEvent = {
            kind: 22242,
            pubkey: nostrKeys.publicKey,
            tags: [['relay', process.env.MINIBITS_RELAY_URL as string], ['challenge', challengeResponse.challenge]],
            content: '',
            created_at: challengeResponse.createdAt
        }

        let authEvent = {...authUnsignedEvent} as unknown as NostrEvent
        
        authEvent.id = getEventHash(authUnsignedEvent)
        
        const privateKeyBytes = hexToBytes(nostrKeys.privateKey)
        const signedEvent = finalizeEvent(authEvent, privateKeyBytes)

        if (!verifyEvent(signedEvent)) {
            throw new AppError(Err.VALIDATION_ERROR, 'Failed to sign authentication challenge')
        }

        log.trace('[enrollDevice] Signed challenge event', { signedEvent })

        // Step 3: Verify the signed event and get JWT tokens
        const verifyChallengeResponse: VerifyChallengeResponse = yield MinibitsClient.verifyAuthChallenge(
          nostrKeys.publicKey,
          challengeResponse.challenge,
          signedEvent.sig,
          deviceId
        )

        log.trace('[enrollDevice] Device enrolled successfully')

        // Store tokens securely
        const jwtTokens: JwtTokens = {
            accessToken: verifyChallengeResponse.accessToken,
            refreshToken: verifyChallengeResponse.refreshToken,
            accessTokenExpiresAt: decodeJwtExpiry(verifyChallengeResponse.accessToken) || 0,
            refreshTokenExpiresAt: decodeJwtExpiry(verifyChallengeResponse.refreshToken) || 0
        }
        
        yield self.setTokens(jwtTokens)

        return jwtTokens
        
    } catch (e: any) {
        // Throw error to satisfy return type
        throw new AppError(Err.AUTH_ERROR, `Failed to enroll device and obtain tokens: ${e.message}`, {caller: 'enrollDevice'})
    }
    }),
    logout: flow(function* logout() {
      try {
        const {tokens} = self

        if (tokens && tokens.refreshToken) {
            // Call server logout endpoint to invalidate refresh token
            try {
                yield MinibitsClient.logout(tokens.refreshToken)

                log.info('[logout] Server logout successful')
            } catch (e: any) {
                // Log but don't throw - we still want to clear local tokens
                log.warn('[logout] Server logout failed, clearing local tokens anyway', e)
            }
        }

        // Always clear local tokens
        yield self.clearTokens()
        log.info('[logout] Local tokens cleared')

    } catch (e: any) {
        log.error('[logout] Logout failed', e)
        // Still try to clear local tokens even if there's an error
        yield self.clearTokens()
        throw new AppError(Err.AUTH_ERROR, `Logout failed: ${e.message}`, {caller: 'logout'})
    }
    })
  
  }))
  .actions(self => ({
    refreshTokens: flow(function* refreshTokens() {
      try {        
        const {tokens} = self

        if (!tokens || !tokens.refreshToken) {
            throw new AppError(Err.AUTH_ERROR, 'No refresh token available. Please re-authenticate.', {caller: 'refreshTokens'})
        }

        log.trace('[refreshTokens] Refreshing tokens')

        const refreshUrl = `${MINIBITS_SERVER_API_HOST}/auth/refresh`
        const refreshBody = {
            refreshToken: tokens.refreshToken
        }

        const newTokens: TokenPair = yield MinibitsClient.fetchApi(refreshUrl, {
            method: 'POST',
            body: refreshBody,
            jwtAuthRequired: false
        })

        log.info('Tokens refreshed successfully', {newTokens, caller: 'refreshTokens'})

        const atExpiry = decodeJwtExpiry(newTokens.accessToken) || 0
        const rtExpiry = decodeJwtExpiry(newTokens.refreshToken) || 0

        log.trace('[refreshTokens]', {now: Math.floor(Date.now() / 1000), atExpiry, rtExpiry})

        // Store new tokens securely
        const jwtTokens: JwtTokens = {
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken,
            accessTokenExpiresAt: atExpiry,
            refreshTokenExpiresAt: rtExpiry
        }

        self.setTokens(jwtTokens)
        return jwtTokens

    } catch (e: any) {
        // If refresh fails, clear stored tokens
        yield self.clearTokens()
        
        throw new AppError(Err.AUTH_ERROR, `Token refresh failed: ${e.message}`, {caller: 'refreshTokens'})
    }
    }),
  }))
    .actions(self => ({
      getValidAccessToken: flow(function* getValidAccessToken() {
        try {
          // If access token is valid, return it
          if (self.isAuthenticated) {
            return self.accessToken
          }
  
          // If access token is expired, refresh tokens
          log.trace('[getValidAccessToken] Access token is expired, refreshing tokens')
          const newTokens = yield self.refreshTokens()
          
          return newTokens.accessToken
  
        } catch (e: any) {
          log.error(`Failed to get valid access token: ${e.message}`, {caller: 'getValidAccessToken'})
          throw e
        }
      }),
  }))
    .postProcessSnapshot((snapshot) => {   // NOT persisted outside of KeyChain except device
    return {
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null
    }          
})

export interface AuthStore extends Instance<typeof AuthStoreModel> {}
export interface AuthStoreSnapshot extends SnapshotOut<typeof AuthStoreModel> {}