import {Instance, SnapshotOut, types} from 'mobx-state-tree'
import {MintsStoreModel} from './MintsStore'
import {ContactsStoreModel} from './ContactsStore'
import {TransactionsStoreModel} from './TransactionsStore'
import {UserSettingsStoreModel} from './UserSettingsStore'
import {WalletProfileStoreModel} from './WalletProfileStore'
import {ProofsStoreModel} from './ProofsStore'
import {RelaysStoreModel} from './RelaysStore'
import {WalletStoreModel} from './WalletStore'
import {NwcStoreModel} from './NwcStore'
import {AuthStoreModel} from './AuthStore'
import { log } from '../services'

export const rootStoreModelVersion = 31 // Update this if model changes require migrations defined in setupRootStore.ts
/**
 * A RootStore model.
 */
export const RootStoreModel = types
    .model('RootStore')
    .props({        
        mintsStore: types.optional(MintsStoreModel, {}),
        contactsStore: types.optional(ContactsStoreModel, {}),
        transactionsStore: types.optional(TransactionsStoreModel, {}),
        userSettingsStore: types.optional(UserSettingsStoreModel, {}),
        walletProfileStore: types.optional(WalletProfileStoreModel, {}),        
        proofsStore: types.optional(ProofsStoreModel, {}),
        relaysStore: types.optional(RelaysStoreModel, {}),        
        walletStore: types.optional(WalletStoreModel, {}),   // not persisted   
        nwcStore: types.optional(NwcStoreModel, {}),
        authStore: types.optional(AuthStoreModel, {}), // not persisted
        version: types.optional(types.number, rootStoreModelVersion),
    })
    .actions(self => ({
        setVersion(version: number) {
        self.version = version
        },
        reset() {
            self.mintsStore = undefined as any
            self.contactsStore = undefined as any
            self.transactionsStore = undefined as any
            self.userSettingsStore  = undefined as any
            self.walletProfileStore = undefined as any
            self.proofsStore = undefined as any
            self.relaysStore = undefined as any
            self.walletStore = undefined as any
            self.nwcStore = undefined as any
            self.authStore = undefined as any

            log.trace('[RootStore.reset]', 'RootStore reset, all stores cleared.')
        }
}))

/**
 * The RootStore instance.
 */
export interface RootStore extends Instance<typeof RootStoreModel> {}
/**
 * The data of a RootStore.
 */
export interface RootStoreSnapshot extends SnapshotOut<typeof RootStoreModel> {}
