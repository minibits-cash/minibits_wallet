import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import {Database} from '../services'
import {MMKVStorage} from '../services'
import {LogLevel} from '../services/log/logTypes'
import { MintUnit } from '../services/wallet/currency'

export type UserSettings = {
  id?: number   
  walletId: string | null
  preferredUnit: MintUnit | null 
  isOnboarded: boolean | 0 | 1
  isStorageEncrypted: boolean | 0 | 1
  isLocalBackupOn: boolean | 0 | 1
  isTorDaemonOn: boolean | 0 | 1
  isLoggerOn: boolean | 0 | 1   
  // isBatchClaimOn: boolean | 0 | 1
  logLevel: LogLevel
}

export const UserSettingsStoreModel = types
    .model('UserSettingsStore')
    .props({                
        walletId: types.maybeNull(types.string),
        preferredUnit: types.optional(types.frozen<MintUnit>(), 'sat'),
        isOnboarded: types.optional(types.boolean, false),
        isStorageEncrypted: types.optional(types.boolean, false),
        isLocalBackupOn: types.optional(types.boolean, true),
        isTorDaemonOn: types.optional(types.boolean, false),
        // isBatchClaimOn: types.optional(types.boolean, false),
        isLoggerOn: types.optional(types.boolean, true),
        logLevel: types.optional(types.frozen<LogLevel>(), LogLevel.ERROR)
    })
    .actions(self => ({
        loadUserSettings: () => {
            const {
                walletId,   
                preferredUnit,                              
                isOnboarded, 
                isStorageEncrypted, 
                isLocalBackupOn,
                isTorDaemonOn,
                isLoggerOn,                                
                // isBatchClaimOn,
                logLevel
            } = Database.getUserSettings()
            
            const booleanIsOnboarded = isOnboarded === 1
            const booleanIsStorageEncrypted = isStorageEncrypted === 1
            const booleanIsLocalBackupOn = isLocalBackupOn === 1            
            const booleanIsTorDaemonOn = isTorDaemonOn === 1
            const booleanIsLoggerOn = isLoggerOn === 1                        
            // const booleanIsBatchClaimOn = isBatchClaimOn === 1            
            
            self.walletId = walletId as string
            self.preferredUnit = preferredUnit as MintUnit                        
            self.isOnboarded = booleanIsOnboarded as boolean
            self.isStorageEncrypted = booleanIsStorageEncrypted as boolean
            self.isLocalBackupOn = booleanIsLocalBackupOn as boolean
            self.isTorDaemonOn = booleanIsTorDaemonOn as boolean
            self.isLoggerOn = booleanIsLoggerOn as boolean                        
            // self.isBatchClaimOn = booleanIsBatchClaimOn as boolean
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
        setIsOnboarded: (isOnboarded: boolean) => {
            Database.updateUserSettings({...self, isOnboarded})
            self.isOnboarded = isOnboarded            
        },
        setIsLocalBackupOn: (isLocalBackupOn: boolean) => {
            Database.updateUserSettings({...self, isLocalBackupOn})
            self.isLocalBackupOn = isLocalBackupOn            
            return isLocalBackupOn
        },
        setIsStorageEncrypted: flow(function* setIsStorageEncryptedvalue(
            isEncrypted: boolean,
        ) {
            if (isEncrypted) {
                yield MMKVStorage.encryptStorage()
            } else {
                MMKVStorage.decryptStorage()
            }
            Database.updateUserSettings({...self, isStorageEncrypted: isEncrypted})
            self.isStorageEncrypted = isEncrypted            
            return isEncrypted
        }),
        setIsTorDaemonOn: (isTorDaemonOn: boolean) => {
            Database.updateUserSettings({...self, isTorDaemonOn})
            self.isTorDaemonOn = isTorDaemonOn            
            return isTorDaemonOn
        },
        setIsLoggerOn: (isLoggerOn: boolean) => {
            Database.updateUserSettings({...self, isLoggerOn})
            self.isLoggerOn = isLoggerOn            
            return isLoggerOn
        },
        /* setIsStorageMigrated: (isStorageMigrated: boolean) => {
            Database.updateUserSettings({...self, isStorageMigrated})
            self.isStorageMigrated = isStorageMigrated            
            return isStorageMigrated
        }, */
        /* setIsBatchClaimOn: (isBatchClaimOn: boolean) => {
            Database.updateUserSettings({...self, isBatchClaimOn})
            self.isBatchClaimOn = isBatchClaimOn            
            return isBatchClaimOn
        },*/
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
        /* get isBatchClaimOn() {
            return self.isBatchClaimOn
        }, */
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
