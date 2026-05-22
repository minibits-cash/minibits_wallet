import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import { MintUnit } from '../services/wallet/currency'
import { CashuProof } from '../services/cashu/cashuUtils'
import { SerializedDLEQ } from '@cashu/cashu-ts'

export type ProofState = 'UNSPENT' | 'PENDING' | 'SPENT'

/**
 * Proof db record — raw shape returned from SQLite queries.
 * The state column is always present after migration 25.
 */
export type ProofRecord = Omit<Proof, 'state'> & {
    state: ProofState
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
        state: types.optional(
            types.enumeration<ProofState>('ProofState', ['UNSPENT', 'PENDING', 'SPENT']),
            'UNSPENT'
        ),
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
