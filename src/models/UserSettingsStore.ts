import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import {Database, KeyChain, log} from '../services'
import {MMKVStorage} from '../services'
import {LogLevel} from '../services/log/logTypes'
import { CurrencyCode, MintUnit } from '../services/wallet/currency'
import { ThemeCode } from '../theme'

export type UserSettings = {
  id?: number   
  walletId: string | null
  preferredUnit: MintUnit | null
  exchangeCurrency: CurrencyCode | null 
  theme: ThemeCode | null
  isOnboarded: boolean | 0 | 1
  isStorageEncrypted: boolean | 0 | 1
  isAuthOn: boolean | 0 | 1
  isLocalBackupOn: boolean | 0 | 1
  isTorDaemonOn: boolean | 0 | 1
  isLoggerOn: boolean | 0 | 1   
  isBatchClaimOn: boolean | 0 | 1
  logLevel: LogLevel
}

export const UserSettingsStoreModel = types
    .model('UserSettingsStore')
    .props({                
        walletId: types.maybeNull(types.string),
        preferredUnit: types.optional(types.frozen<MintUnit>(), 'sat'),
        exchangeCurrency: types.optional(types.frozen<CurrencyCode | null>(), CurrencyCode.USD),
        theme: types.optional(types.frozen<ThemeCode>(), ThemeCode.DEFAULT),
        isOnboarded: types.optional(types.boolean, false),
        isStorageEncrypted: types.optional(types.boolean, false), // legacy, not used now
        isAuthOn: types.optional(types.boolean, false), 
        isLocalBackupOn: types.optional(types.boolean, true),
        isTorDaemonOn: types.optional(types.boolean, false),
        isBatchClaimOn: types.optional(types.boolean, false),
        isLoggerOn: types.optional(types.boolean, true),
        logLevel: types.optional(types.frozen<LogLevel>(), LogLevel.ERROR)
    })
    .actions(self => ({
        loadUserSettings: () => {
            const {
                walletId,   
                preferredUnit,
                exchangeCurrency,
                theme,                              
                isOnboarded, 
                isStorageEncrypted,
                isAuthOn, 
                isLocalBackupOn,
                isTorDaemonOn,
                isLoggerOn,                                
                isBatchClaimOn,
                logLevel
            } = Database.getUserSettings()
            
            const booleanIsOnboarded = isOnboarded === 1
            const booleanIsStorageEncrypted = isStorageEncrypted === 1
            const booleanIsAuthOn = isAuthOn === 1
            const booleanIsLocalBackupOn = isLocalBackupOn === 1            
            const booleanIsTorDaemonOn = isTorDaemonOn === 1
            const booleanIsLoggerOn = isLoggerOn === 1                        
            const booleanIsBatchClaimOn = isBatchClaimOn === 1            
            
            self.walletId = walletId as string
            self.preferredUnit = preferredUnit as MintUnit
            self.exchangeCurrency = exchangeCurrency as CurrencyCode
            self.theme = theme as ThemeCode                        
            self.isOnboarded = booleanIsOnboarded as boolean
            self.isStorageEncrypted = booleanIsStorageEncrypted as boolean
            self.isAuthOn = booleanIsAuthOn as boolean
            self.isLocalBackupOn = booleanIsLocalBackupOn as boolean
            self.isTorDaemonOn = booleanIsTorDaemonOn as boolean
            self.isLoggerOn = booleanIsLoggerOn as boolean                        
            self.isBatchClaimOn = booleanIsBatchClaimOn as boolean
            self.logLevel = logLevel as LogLevel
        },
        setWalletId: (walletId: string) => {
            Database.updateUserSettings({...self, walletId})
            self.walletId = walletId
            
            return walletId
        },
        setPreferredUnit: (preferredUnit: MintUnit) => {
            Database.updateUserSettings({...self, preferredUnit})
            self.preferredUnit = preferredUnit
            
            return preferredUnit
        },
        setExchangeCurrency: (exchangeCurrency: CurrencyCode | null) => {
            Database.updateUserSettings({...self, exchangeCurrency})
            self.exchangeCurrency = exchangeCurrency
            
            return exchangeCurrency
        },
        setTheme: (theme: ThemeCode) => {
            Database.updateUserSettings({...self, theme})
            self.theme = theme
            
            return theme
        },
        setIsOnboarded: (isOnboarded: boolean) => {
            Database.updateUserSettings({...self, isOnboarded})
            self.isOnboarded = isOnboarded            
        },
        setIsLocalBackupOn: (isLocalBackupOn: boolean) => {
            Database.updateUserSettings({...self, isLocalBackupOn})
            self.isLocalBackupOn = isLocalBackupOn            
            return isLocalBackupOn
        },
        setIsAuthOn: flow(function* setIsAuthOn(
            isAuthOn: boolean,
        ) {
            log.trace(`[setIsAuthOn] from ${self.isAuthOn} to ${isAuthOn}`)
            if (self.isAuthOn !== isAuthOn) {
                yield KeyChain.updateAuthSettings(isAuthOn)
                Database.updateUserSettings({...self, isAuthOn})
                self.isAuthOn = isAuthOn
            }
            return isAuthOn
        }),
        setIsTorDaemonOn: (isTorDaemonOn: boolean) => { // legacy, tobe removed
            Database.updateUserSettings({...self, isTorDaemonOn})
            self.isTorDaemonOn = isTorDaemonOn            
            return isTorDaemonOn
        },
        setIsLoggerOn: (isLoggerOn: boolean) => {
            Database.updateUserSettings({...self, isLoggerOn})
            self.isLoggerOn = isLoggerOn            
            return isLoggerOn
        },        
        setIsBatchClaimOn: (isBatchClaimOn: boolean) => {
            Database.updateUserSettings({...self, isBatchClaimOn})
            self.isBatchClaimOn = isBatchClaimOn            
            return isBatchClaimOn
        },
        setLogLevel: (logLevel: LogLevel) => {
            Database.updateUserSettings({...self, logLevel})
            self.logLevel = logLevel            
            return logLevel
        },
    }))
    .views(self => ({
        get isUserOnboarded() {
            return self.isOnboarded
        },
        get isAppStorageEncrypted() { // can not have the same name as model property
            return self.isStorageEncrypted
        },
        get isTorOn() {
            return self.isTorDaemonOn
        },
        get userSettings() {
            return self
        },
    }))

export interface UserSettingsStore
  extends Instance<typeof UserSettingsStoreModel> {}
export interface UserSettingsStoreSnapshot
  extends SnapshotOut<typeof UserSettingsStoreModel> {}
