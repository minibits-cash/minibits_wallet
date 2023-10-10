import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import {Database} from '../services'
import {MMKVStorage} from '../services'
import {log} from '../utils/logger'

export type UserSettings = {
  id?: number   
  walletId: string | null    
  isOnboarded: boolean | 0 | 1
  isStorageEncrypted: boolean | 0 | 1
  isLocalBackupOn: boolean | 0 | 1
  isTorDaemonOn: boolean | 0 | 1
}

export const UserSettingsStoreModel = types
    .model('UserSettingsStore')
    .props({                
        walletId: types.maybeNull(types.string),                
        isOnboarded: types.optional(types.boolean, false),
        isStorageEncrypted: types.optional(types.boolean, false),
        isLocalBackupOn: types.optional(types.boolean, true),
        isTorDaemonOn: types.optional(types.boolean, false),
    })
    .actions(self => ({
        loadUserSettings: () => {
            const {
                walletId,                                 
                isOnboarded, 
                isStorageEncrypted, 
                isLocalBackupOn,
                isTorDaemonOn
            } = Database.getUserSettings()
            
            const booleanIsOnboarded = isOnboarded === 1
            const booleanIsStorageEncrypted = isStorageEncrypted === 1
            const booleanIsLocalBackupOn = isLocalBackupOn === 1            
            const booleanIsTorDaemonOn = isTorDaemonOn === 1            
            
            self.walletId = walletId as string                        
            self.isOnboarded = booleanIsOnboarded as boolean
            self.isStorageEncrypted = booleanIsStorageEncrypted as boolean
            self.isLocalBackupOn = booleanIsLocalBackupOn as boolean
            self.isTorDaemonOn = booleanIsTorDaemonOn as boolean
        },
        setWalletId: (walletId: string) => {
            Database.updateUserSettings({...self, walletId})
            self.walletId = walletId

            log.info('walletId updated', {walletId}, 'setWalletId')
            return walletId
        },
        setIsOnboarded: (isOnboarded: boolean) => {
            Database.updateUserSettings({...self, isOnboarded})
            self.isOnboarded = isOnboarded

            log.info('Onboarded new device', {isOnboarded}, 'setIsOnboarded')
        },
        setIsLocalBackupOn: (isLocalBackupOn: boolean) => {
            Database.updateUserSettings({...self, isLocalBackupOn})
            self.isLocalBackupOn = isLocalBackupOn

            log.info('Local backup is turned on', {isLocalBackupOn}, 'setIsLocalBackupOn')
            return isLocalBackupOn
        },
        setIsStorageEncrypted: flow(function* setIsStorageEncryptedvalue(
            value: boolean,
        ) {
            const isEncrypted = yield MMKVStorage.recryptStorage()
            Database.updateUserSettings({...self, isStorageEncrypted: isEncrypted})
            self.isStorageEncrypted = isEncrypted

            log.info('Storage encryption changed to', {isEncrypted: value}, 'setIsStorageEncrypted')
            return isEncrypted
        }),
        setIsTorDaemonOn: (isTorDaemonOn: boolean) => {
            Database.updateUserSettings({...self, isTorDaemonOn})
            self.isTorDaemonOn = isTorDaemonOn

            log.info('Tor daemon is turned on', {isTorDaemonOn}, 'setIsTorDaemonOn')
            return isTorDaemonOn
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
