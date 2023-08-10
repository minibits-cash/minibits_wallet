import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import {Database} from '../services'
import {MMKVStorage} from '../services'
import {log} from '../utils/logger'

export type UserSettings = {
  id?: number 
  userId?: string | null // to be removed in the next migration
  walletId: string | null
  npubKey: string | null
  avatar: string | null
  isOnboarded: boolean | 0 | 1
  isStorageEncrypted: boolean | 0 | 1
  isLocalBackupOn: boolean | 0 | 1
}

export const UserSettingsStoreModel = types
    .model('UserSettingsStore')
    .props({                
        walletId: types.maybeNull(types.string),
        npubKey: types.maybeNull(types.string),
        avatar: types.maybeNull(types.string),
        isOnboarded: types.optional(types.boolean, false),
        isStorageEncrypted: types.optional(types.boolean, false),
        isLocalBackupOn: types.optional(types.boolean, true),
    })
    .actions(self => ({
        loadUserSettings: () => {
            const {
                walletId, 
                npubKey, 
                avatar, 
                isOnboarded, 
                isStorageEncrypted, 
                isLocalBackupOn
            } = Database.getUserSettings()
            
            const booleanIsOnboarded = isOnboarded === 1
            const booleanIsStorageEncrypted = isStorageEncrypted === 1
            const booleanIsLocalBackupOn = isLocalBackupOn === 1            
            
            self.walletId = walletId as string
            self.npubKey = npubKey as string
            self.avatar = avatar as string
            self.isOnboarded = booleanIsOnboarded as boolean
            self.isStorageEncrypted = booleanIsStorageEncrypted as boolean
            self.isLocalBackupOn = booleanIsLocalBackupOn as boolean
        },
        setWalletId: (walletId: string) => {
            Database.updateUserSettings({...self, walletId})
            self.walletId = walletId

            log.info('walletId updated', walletId)
            return walletId
        },
        setNpubKey: (npubKey: string) => {
            Database.updateUserSettings({...self, npubKey})
            self.npubKey = npubKey

            log.info('npubKey updated', npubKey)
            return npubKey
        },
        setAvatar: (avatar: string) => {
            Database.updateUserSettings({...self, avatar})
            self.avatar = avatar

            log.info('avatar updated', avatar)
            return avatar
        },
        setIsOnboarded: (value: boolean) => {
            Database.updateUserSettings({...self, isOnboarded: value})
            self.isOnboarded = value

            log.info('Onboarded new device', value)
        },
        setIsLocalBackupOn: (value: boolean) => {
            Database.updateUserSettings({...self, isLocalBackupOn: value})
            self.isLocalBackupOn = value

            log.info('Local backup is turned on', value)
        return value
        },
        setIsStorageEncrypted: flow(function* setIsStorageEncryptedvalue(
            value: boolean,
        ) {
            const isEncrypted = yield MMKVStorage.recryptStorage()
            Database.updateUserSettings({...self, isStorageEncrypted: isEncrypted})
            self.isStorageEncrypted = isEncrypted

            log.info('Storage encryption changed to', value)
            return isEncrypted
        }),
    }))
    .views(self => ({
        get isUserOnboarded() {
            return self.isOnboarded
        },
        get isAppStorageEncrypted() {
            return self.isStorageEncrypted
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
