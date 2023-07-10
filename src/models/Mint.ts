import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import type {MintKeys} from '@cashu/cashu-ts/dist/lib/es5/model/types'
import {colors, getRandomIconColor} from '../theme'

// used as a helper type across app
export type MintBalance = {
    mint: string
    balance: number
}

/**
 * This represents a Cashu mint
 */
export const MintModel = types
    .model('Mint', {
        mintUrl: types.identifier,
        hostname: types.maybe(types.string),
        shortname: types.maybe(types.string),
        keys: types.frozen<MintKeys>(),
        keysets: types.frozen<string[]>(),
        color: types.optional(types.string, colors.palette.iconBlue200),
        createdAt: types.optional(types.Date, new Date()),
    })
    .actions(withSetPropAction)
    .actions(self => ({
        validateURL(url: string) {
            try {
                new URL(url)
                return true
            } catch (e) {
                return false
            }
        },
        setHostname() {
            try {
                self.hostname = new URL(self.mintUrl).hostname
            } catch (e) {
                return false
            }
        },
        setShortname(shortname: string) {
            try {
                self.shortname = shortname.slice(0, 25)
            } catch (e) {
                return false
            }
        },
        setRandomColor() {
            self.color = getRandomIconColor()
        },
        setColor(color: string) {
            self.color = color
        },
        updateKeys(keyset: string, keys: MintKeys) {
            // not sure why to keep keysetIDs history and even keys, cashu-ts seems to (on first look) get current keys before each mint interaction
            self.keysets.push(keyset) 
            self.keys = keys
        },
  }))

export type Mint = {
    mintUrl: string
    keys: MintKeys
    keysets: string[]
} & Partial<Instance<typeof MintModel>>
export interface MintSnapshotOut extends SnapshotOut<typeof MintModel> {}
export interface MintSnapshotIn extends SnapshotIn<typeof MintModel> {}
