import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import { MintUnit } from '../services/wallet/currency'
import { CashuProof } from '../services/cashu/cashuUtils'
import { SerializedDLEQ } from '@cashu/cashu-ts'

/**
 * Proof db record
 */

export type ProofRecord = Proof & {
    dleq_r?: string
    dleq_s?: string
    dleq_e?: string
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
        dleq: types.maybe(types.frozen<SerializedDLEQ>()),
        unit: types.frozen<MintUnit>(),       
        tId: types.number,
        mintUrl: types.string,        
        isPending: types.optional(types.boolean, false),
        isSpent: types.optional(types.boolean, false),
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
