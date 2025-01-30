import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import {KeyChain, log} from '../services'
import {LogLevel} from '../services/log/logTypes'
import { CurrencyCode, MintUnit } from '../services/wallet/currency'
import { ThemeCode } from '../theme'

export type UserSettings = {    
  preferredUnit: MintUnit
  exchangeCurrency: CurrencyCode 
  theme: ThemeCode
  isOnboarded: boolean
  isAuthOn: boolean
  isLocalBackupOn: boolean
  isBatchClaimOn: boolean
  isLoggerOn: boolean  
  logLevel: LogLevel
}

export const UserSettingsStoreModel = types
    .model('UserSettingsStore')
    .props({        
        preferredUnit: types.optional(types.frozen<MintUnit>(), 'sat'),
        exchangeCurrency: types.optional(types.frozen<CurrencyCode | null>(), CurrencyCode.USD),
        theme: types.optional(types.frozen<ThemeCode>(), ThemeCode.DEFAULT),
        isOnboarded: types.optional(types.boolean, false),        
        isAuthOn: types.optional(types.boolean, false), 
        isLocalBackupOn: types.optional(types.boolean, true),        
        isBatchClaimOn: types.optional(types.boolean, false),
        isLoggerOn: types.optional(types.boolean, true),
        logLevel: types.optional(types.frozen<LogLevel>(), LogLevel.ERROR)
    })
    .actions(self => ({
        setPreferredUnit: (preferredUnit: MintUnit) => {            
            self.preferredUnit = preferredUnit            
            return preferredUnit
        },
        setExchangeCurrency: (exchangeCurrency: CurrencyCode | null) => {            
            self.exchangeCurrency = exchangeCurrency            
            return exchangeCurrency
        },
        setTheme: (theme: ThemeCode) => {            
            self.theme = theme            
            return theme
        },
        setIsOnboarded: (isOnboarded: boolean) => {            
            self.isOnboarded = isOnboarded
            return isOnboarded   
        },
        setIsLocalBackupOn: (isLocalBackupOn: boolean) => {            
            self.isLocalBackupOn = isLocalBackupOn            
            return isLocalBackupOn
        },
        setIsAuthOn: flow(function* setIsAuthOn(
            isAuthOn: boolean,
        ) {
            log.trace(`[setIsAuthOn] from ${self.isAuthOn} to ${isAuthOn}`)
            if (self.isAuthOn !== isAuthOn) {
                yield KeyChain.updateAuthSettings(isAuthOn)                
                self.isAuthOn = isAuthOn
            }
            return isAuthOn
        }),
        setIsBatchClaimOn: (isBatchClaimOn: boolean) => {            
            self.isBatchClaimOn = isBatchClaimOn            
            return isBatchClaimOn
        },
        setIsLoggerOn: (isLoggerOn: boolean) => {            
            self.isLoggerOn = isLoggerOn            
            return isLoggerOn
        },
        setLogLevel: (logLevel: LogLevel) => {            
            self.logLevel = logLevel            
            return logLevel
        },
    }))

export interface UserSettingsStore
  extends Instance<typeof UserSettingsStoreModel> {}
export interface UserSettingsStoreSnapshot
  extends SnapshotOut<typeof UserSettingsStoreModel> {}
