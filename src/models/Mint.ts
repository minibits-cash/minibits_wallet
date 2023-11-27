import {cast, Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import type {MintKeys} from '@cashu/cashu-ts/dist/lib/es5/model/types'
import {colors, getRandomIconColor} from '../theme'
import { log } from '../services'
import { deriveKeysetId } from '@cashu/cashu-ts'

// used as a helper type across app
export type MintBalance = {
    mint: string
    balance: number
}

export enum MintStatus {
    ONLINE = 'ONLINE',
    OFFLINE = 'OFFLINE'
}

export type MintProofsCounter = {
    keyset: string
    counter: number
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
        proofsCounters: types.array(
            types.model('MintProofsCounter', {
              keyset: types.string,
              counter: types.number,
            })
        ),
        color: types.optional(types.string, colors.palette.iconBlue200),
        status: types.optional(types.frozen<MintStatus>(), MintStatus.ONLINE),
        createdAt: types.optional(types.Date, new Date()),
    })
    .actions(withSetPropAction)
    .views(self => ({
        get currentProofsCounter() {
            const currentKeyset = deriveKeysetId(self.keys)
            return self.proofsCounters.find(c => c.keyset === currentKeyset)
        },
    }))
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
        setStatus(status: MintStatus) {
            self.status = status
        },
        updateKeys(keyset: string, keys: MintKeys) {            
            self.keysets.push(keyset) 
            self.keys = keys
            self.keysets = cast(self.keysets)            
        },
        increaseProofsCounter(numberOfProofs: number) {
            const currentCounter = self.currentProofsCounter

            if (currentCounter) {        
                log.trace('[increaseProofsCounter]', 'Before update', {currentCounter})        
                currentCounter.counter += numberOfProofs
                log.trace('[increaseProofsCounter]', 'Updated proofsCounter', {numberOfProofs, currentCounter})
            } else {
                // If the counter doesn't exist, create a new one
                const currentKeyset = deriveKeysetId(self.keys)

                const newCounter = {
                    keyset: currentKeyset,
                    counter: numberOfProofs,
                }

                self.proofsCounters.push(newCounter)

                log.trace('[increaseProofsCounter]', 'Adding new proofsCounter', {newCounter})
            }
            // Make sure to cast the frozen array back to a mutable array
            self.proofsCounters = cast(self.proofsCounters)
        },
    }))
    

export type Mint = {
    mintUrl: string
    keys: MintKeys
    keysets: string[]
} & Partial<Instance<typeof MintModel>>
export interface MintSnapshotOut extends SnapshotOut<typeof MintModel> {}
export interface MintSnapshotIn extends SnapshotIn<typeof MintModel> {}
