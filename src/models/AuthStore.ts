import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import {JwtTokens, KeyChain, log} from '../services'
import AppError, { Err } from '../utils/AppError'

export type AuthState = {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null
  deviceId: string | null
  isAuthenticated: boolean
}

export const AuthStoreModel = types
  .model('AuthStore')
  .props({
    accessToken: types.maybeNull(types.string),
    refreshToken: types.maybeNull(types.string),
    accessTokenExpiresAt: types.maybeNull(types.number),
    refreshTokenExpiresAt: types.maybeNull(types.number),
    deviceId: types.maybeNull(types.string),
  })
  .views(self => ({
    get isAuthenticated(): boolean {
      if (!self.accessToken || !self.accessTokenExpiresAt) {
        return false
      }

      return Math.floor(Date.now() / 1000) >= self.accessTokenExpiresAt
    },
    get isAccessTokenExpired(): boolean {
      if (!self.accessTokenExpiresAt) return true
      return Math.floor(Date.now() / 1000) >= self.accessTokenExpiresAt
    },
    get isRefreshokenExpired(): boolean {
      if (!self.refreshTokenExpiresAt) return true
      return Math.floor(Date.now() / 1000) >= self.refreshTokenExpiresAt
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
    setTokens: flow(function* setTokens(
      tokens: JwtTokens
    ) {
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
        log.error('[setTokens] Failed to save JWT tokens', e)
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
        log.error('[clearTokens] Failed to clear tokens', e)
        throw e
      }
    }),
    
    setDeviceId: (deviceId: string) => {
      log.trace('[AuthStore.setDeviceId]', {deviceId})
      self.deviceId = deviceId
      return deviceId
    },
    
    loadTokensFromKeyChain: flow(function* loadTokensFromKeyChain() {
      try {
        log.trace('[AuthStore.loadTokensFromKeyChain] Loading tokens from the KeyChain')
        
        const tokens = yield KeyChain.getJwtTokens()
        
        if (tokens) {
          self.accessToken = tokens.accessToken
          self.refreshToken = tokens.refreshToken
          self.accessTokenExpiresAt = tokens.accessTokenExpiresAt
          self.refreshTokenExpiresAt = tokens.refreshTokenExpiresAt
          
          log.trace('[AuthStore.loadTokensFromKeyChain] Tokens loaded successfully')
        } else {
          log.trace('[AuthStore.loadTokensFromKeyChain] No tokens found in the KeyChain')
        }
      } catch (e: any) {
        log.error('[AuthStore.loadTokensFromKeyChain] Failed to load tokens', e)
        // Don't throw here, just log the error as missing tokens is not critical
      }
    })
  })).postProcessSnapshot((snapshot) => {   // NOT persisted outside of KeyChain 
    return {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      deviceId: null,
    }          
})

export interface AuthStore extends Instance<typeof AuthStoreModel> {}
export interface AuthStoreSnapshot extends SnapshotOut<typeof AuthStoreModel> {}