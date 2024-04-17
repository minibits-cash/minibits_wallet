import {Instance, types} from 'mobx-state-tree'
import {TokenEntryModel} from './TokenEntry'
import { MintUnit } from '../services'

/**
 * This represents sendable Cashu token V3
 */

export const TokenModel = types.model('Token', {
    token: types.array(TokenEntryModel),
    unit: types.maybe(types.frozen<MintUnit>()),
    memo: types.maybe(types.string),
})

export interface Token extends Instance<typeof TokenModel> {}
