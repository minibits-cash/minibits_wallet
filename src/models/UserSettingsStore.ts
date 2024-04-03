import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import {Database} from '../services'
import {MMKVStorage} from '../services'
import {LogLevel} from '../services/log/logTypes'

export type UserSettings = {
  id?: number   
  walletId: string | null    
  isOnboarded: boolean | 0 | 1
  isStorageEncrypted: boolean | 0 | 1
  isLocalBackupOn: boolean | 0 | 1
  isTorDaemonOn: boolean | 0 | 1
  isLoggerOn: boolean | 0 | 1  
  isStorageMigrated: boolean | 0 | 1
  logLevel: LogLevel
}

export const UserSettingsStoreModel = types
    .model('UserSettingsStore')
    .props({                
        walletId: types.maybeNull(types.string),                
        isOnboarded: types.optional(types.boolean, false),
        isStorageEncrypted: types.optional(types.boolean, false),
        isLocalBackupOn: types.optional(types.boolean, true),
        isTorDaemonOn: types.optional(types.boolean, false),
        isLoggerOn: types.optional(types.boolean, true),        
        isStorageMigrated: types.optional(types.boolean, false),
        logLevel: types.optional(types.frozen<LogLevel>(), LogLevel.ERROR)
    })
    .actions(self => ({
        loadUserSettings: () => {
            const {
                walletId,                                 
                isOnboarded, 
                isStorageEncrypted, 
                isLocalBackupOn,
                isTorDaemonOn,
                isLoggerOn,                
                isStorageMigrated,
                logLevel
            } = Database.getUserSettings()
            
            const booleanIsOnboarded = isOnboarded === 1
            const booleanIsStorageEncrypted = isStorageEncrypted === 1
            const booleanIsLocalBackupOn = isLocalBackupOn === 1            
            const booleanIsTorDaemonOn = isTorDaemonOn === 1
            const booleanIsLoggerOn = isLoggerOn === 1            
            const booleanIsStorageMigrated = isStorageMigrated === 1            
            
            self.walletId = walletId as string                        
            self.isOnboarded = booleanIsOnboarded as boolean
            self.isStorageEncrypted = booleanIsStorageEncrypted as boolean
            self.isLocalBackupOn = booleanIsLocalBackupOn as boolean
            self.isTorDaemonOn = booleanIsTorDaemonOn as boolean
            self.isLoggerOn = booleanIsLoggerOn as boolean            
            self.isStorageMigrated = booleanIsStorageMigrated as boolean
            self.logLevel = logLevel as LogLevel
        },
        setWalletId: (walletId: string) => {
            Database.updateUserSettings({...self, walletId})
            self.walletId = walletId
            
            return walletId
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
        setIsStorageMigrated: (isStorageMigrated: boolean) => {
            Database.updateUserSettings({...self, isStorageMigrated})
            self.isStorageMigrated = isStorageMigrated            
            return isStorageMigrated
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
/*.preProcessSnapshot((snapshot) => {
    // remove sensitive data from snapshot to avoid secrets
    // being stored in AsyncStorage in plain text if backing up store
    // const { authToken, authPassword, ...rest } = snapshot // eslint-disable-line @typescript-eslint/no-unused-vars

    // see the following for strategies to consider storing secrets on device
    // https://reactnative.dev/docs/security#storing-sensitive-info

    // return rest
    return snapshot
  })*/

export interface UserSettingsStore
  extends Instance<typeof UserSettingsStoreModel> {}
export interface UserSettingsStoreSnapshot
  extends SnapshotOut<typeof UserSettingsStoreModel> {}
