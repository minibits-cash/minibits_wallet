import {Instance, SnapshotOut, types} from 'mobx-state-tree'
import {MintsStoreModel} from './MintsStore'
import {ContactsStoreModel} from './ContactsStore'
import {TransactionsStoreModel} from './TransactionsStore'
import {UserSettingsStoreModel} from './UserSettingsStore'
import {WalletProfileStoreModel} from './WalletProfileStore'
import {PaymentRequestsStoreModel} from './PaymentRequestsStore'
import {ProofsStoreModel} from './ProofsStore'
import {RelaysStoreModel} from './RelaysStore'

export const rootStoreModelVersion = 7 // Update this if model changes require migrations defined in setupRootStore.ts

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
