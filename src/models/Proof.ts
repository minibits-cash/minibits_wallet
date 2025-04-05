import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import { MintUnit } from '../services/wallet/currency'

/**
 * Proof type saved in database backup
 */

export type BackupProof = Proof & {
    isPending: boolean
    isSpent: boolean
    updatedAt: Date
}

const ProofDleq = types.model('ProofDleq', {
    r: types.string,
    s: types.string,
    e: types.string,
})

/**
 * Proof model
 */

export const ProofModel = types
    .model('Proof', {
        id: types.string,
        amount: types.number,
        secret: types.identifier,
        C: types.string,
        dleq: types.maybe(ProofDleq),
        tId: types.number,
        mintUrl: types.string,
        unit: types.frozen<MintUnit>(),
    })
    .actions(withSetPropAction)
    .actions(self => ({
        setTransactionId(id: number) {
            self.tId = id
        },
        setMintUrl(url: string) {
            self.mintUrl = url
        },
        setUnit(unit: MintUnit) {
            self.unit = unit
        },
    }))


export interface Proof extends Instance<typeof ProofModel> {}
export interface ProofSnapshotOut extends SnapshotOut<typeof ProofModel> {}
export interface ProofSnapshotIn extends SnapshotIn<typeof ProofModel> {}
