import {Instance, SnapshotOut, types} from 'mobx-state-tree'
import {MintsStoreModel} from './MintsStore'
import {TransactionsStoreModel} from './TransactionsStore'
import {UserSettingsStoreModel} from './UserSettingsStore'
import {InvoicesStoreModel} from './InvoicesStore'
import {ProofsStoreModel} from './ProofsStore'

export const rootStoreModelVersion = 2 // Update this if model changes require migrations defined in setupRootStore.ts

/**
 * A RootStore model.
 */
export const RootStoreModel = types
    .model('RootStore')
    .props({
        userSettingsStore: types.optional(UserSettingsStoreModel, {}),
        mintsStore: types.optional(MintsStoreModel, {}),
        proofsStore: types.optional(ProofsStoreModel, {}),
        transactionsStore: types.optional(TransactionsStoreModel, {}),
        invoicesStore: types.optional(InvoicesStoreModel, {}),
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
