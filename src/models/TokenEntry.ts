import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {ProofModel} from './Proof'
// import type { Proof } from '@cashu/cashu-ts'

/**
 * This represents a Cashu token V3
 */

export const TokenEntryModel = types
    .model('TokenEntry', {
        mint: types.string,
        proofs: types.array(
            types.safeReference(ProofModel, {acceptsUndefined: false}),
        ),
        transactionId: types.maybe(types.number),
    })


export interface TokenEntry extends Instance<typeof TokenEntryModel> {}
export interface TokenEntrySnapshotOut
  extends SnapshotOut<typeof TokenEntryModel> {}
export interface TokenEntrySnapshotIn
  extends SnapshotIn<typeof TokenEntryModel> {}
