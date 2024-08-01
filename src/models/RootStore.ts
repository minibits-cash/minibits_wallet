import {Instance, SnapshotOut, types} from 'mobx-state-tree'
import {MintsStoreModel} from './MintsStore'
import {ContactsStoreModel} from './ContactsStore'
import {TransactionsStoreModel} from './TransactionsStore'
import {UserSettingsStoreModel} from './UserSettingsStore'
import {WalletProfileStoreModel} from './WalletProfileStore'
import {PaymentRequestsStoreModel} from './PaymentRequestsStore'
import {ProofsStoreModel} from './ProofsStore'
import {RelaysStoreModel} from './RelaysStore'
import {WalletStoreModel} from './WalletStore'
import { log } from '../services'

export const rootStoreModelVersion = 23 // Update this if model changes require migrations defined in setupRootStore.ts

// Ephemeral non-persisted stores
const NonPersistedStoresModel = types.model('NonPersistedStores', {
    walletStore: types.optional(WalletStoreModel, {}),    
}).postProcessSnapshot((snapshot) => {    
    return {walletStore: {
        mints: [],
        seedWallets: [],
        wallets: [],
        mnemonicPhrase: undefined,
        seedBase64: undefined}
    }    
})

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
        paymentRequestsStore: types.optional(PaymentRequestsStoreModel, {}),
        proofsStore: types.optional(ProofsStoreModel, {}),
        relaysStore: types.optional(RelaysStoreModel, {}),
        nonPersistedStores: types.optional(NonPersistedStoresModel, {}),        
        version: types.optional(types.number, rootStoreModelVersion),
    })
    .actions(self => ({
        setVersion(version: number) {
        self.version = version
    },
}))

/**
 * The RootStore instance.
 */
export interface RootStore extends Instance<typeof RootStoreModel> {}
/**
 * The data of a RootStore.
 */
export interface RootStoreSnapshot extends SnapshotOut<typeof RootStoreModel> {}
