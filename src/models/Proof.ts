import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'

/**
 * Proof type saved in database backup
 */

export type BackupProof = Proof & {
    isPending: boolean
    isSpent: boolean
    updatedAt: Date
}

/**
 * Proof model
 */

export const ProofModel = types
    .model('Proof', {
        id: types.string,
        amount: types.number,
        secret: types.identifier,
        C: types.string,
        tId: types.maybe(types.number),
        mintUrl: types.maybe(types.string),
    })
    .actions(withSetPropAction)
    .actions(self => ({
        setTransactionId(id: number) {
            self.tId = id
        },
        setMintUrl(url: string) {
            self.mintUrl = url
        },
    }))


export interface Proof extends Instance<typeof ProofModel> {}
export interface ProofSnapshotOut extends SnapshotOut<typeof ProofModel> {}
export interface ProofSnapshotIn extends SnapshotIn<typeof ProofModel> {}
