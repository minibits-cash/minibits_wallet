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
    inFlightFrom?: number // starting counter index for pending split request sent to mint (for recovery from failure to receive proofs)
    inFlightTo?: number // last counter index for pending split request sent to mint 
    inFlightTid?: number // related tx id
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
              inFlightFrom: types.maybe(types.number),
              inFlightTo: types.maybe(types.number),
              inFlightTid: types.maybe(types.number)
            })
        ),
        color: types.optional(types.string, colors.palette.iconBlue200),
        status: types.optional(types.frozen<MintStatus>(), MintStatus.ONLINE),
        createdAt: types.optional(types.Date, new Date()),
    })
    .actions(withSetPropAction) // TODO start to use across app to avoid pure setter methods, e.g. mint.setProp('color', '#ccc')
    .actions(self => ({
        getOrCreateProofsCounter() {
            const currentKeyset = deriveKeysetId(self.keys)
            const currentCounter = self.proofsCounters.find(c => c.keyset === currentKeyset)

            if(!currentCounter) {            
                const newCounter = {
                    keyset: currentKeyset,
                    counter: 0,
                }

                self.proofsCounters.push(newCounter)
                const instance = self.proofsCounters.find(c => c.keyset === currentKeyset) as MintProofsCounter

                log.trace('[getOrCreateProofsCounter] new', {newCounter: instance})
                return instance
            }
            
            return currentCounter
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
        setProofsInFLightFrom(inFlightFrom: number) {
            const currentCounter = self.getOrCreateProofsCounter()
            currentCounter.inFlightFrom = inFlightFrom

            self.proofsCounters = cast(self.proofsCounters)
        },
        setProofsInFlightTo(inFlightTo: number) {
            const currentCounter = self.getOrCreateProofsCounter()
            currentCounter.inFlightTo = inFlightTo

            self.proofsCounters = cast(self.proofsCounters)
        },
        setInFlightTid(inFlightTid: number) {
            const currentCounter = self.getOrCreateProofsCounter()
            currentCounter.inFlightTid = inFlightTid

            self.proofsCounters = cast(self.proofsCounters)
        },
        resetInFlight() {
            const currentCounter = self.getOrCreateProofsCounter()
            currentCounter.inFlightFrom = undefined
            currentCounter.inFlightTo = undefined
            currentCounter.inFlightTid = undefined

            log.trace('[resetInFlight]', 'Reset proofsCounter')
            self.proofsCounters = cast(self.proofsCounters)
        },
        increaseProofsCounter(numberOfProofs: number) {
            const currentCounter = self.getOrCreateProofsCounter()             
            currentCounter.counter += numberOfProofs
            log.trace('[increaseProofsCounter]', 'Increased proofsCounter', {numberOfProofs, currentCounter})

            // Make sure to cast the frozen array back to a mutable array
            self.proofsCounters = cast(self.proofsCounters)
        },
        decreaseProofsCounter(numberOfProofs: number) {
            const currentCounter = self.getOrCreateProofsCounter()
            currentCounter.counter -= numberOfProofs
            Math.max(0, currentCounter.counter)
            log.trace('[decreaseProofsCounter]', 'Decreased proofsCounter', {numberOfProofs, currentCounter})

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
