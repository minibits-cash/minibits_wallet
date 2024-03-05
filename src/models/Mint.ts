import {cast, flow, Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import type {GetInfoResponse, MintKeys} from '@cashu/cashu-ts'
import {colors, getRandomIconColor} from '../theme'
import { log, MintClient } from '../services'
import { deriveKeysetId } from '@cashu/cashu-ts'
import { MINIBITS_MINT_URL } from '@env'
import { delay } from '../utils/utils'
import AppError, { Err } from '../utils/AppError'

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
            
            return currentCounter as MintProofsCounter
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
        setShortname: flow(function* setShortname() {
            // get name from URL as a fallback
            const lastSlashIndex = self.mintUrl.lastIndexOf('/')
            let shortname = self.mintUrl.substring(lastSlashIndex + 1).slice(0, 25)

            try {
                const info: GetInfoResponse = yield MintClient.getMintInfo(self.mintUrl)

                if(info.name.length > 0) {
                    let identifier: string = ''

                    if(shortname.length > 6) {
                        identifier = `${shortname.slice(0, 3)}...${shortname.slice(-3)}`
                    } else {
                        identifier = shortname
                    }

                    if(identifier.length > 0) {
                        shortname = `${info.name} (${identifier})`
                    } else {
                        shortname = info.name
                    }
                }

                // temporary UX fix for minibits mint
                if(self.mintUrl === MINIBITS_MINT_URL) {
                    shortname = 'Bitcoin (sats)'
                }

                self.shortname = shortname
                
            } catch (e) {
                self.shortname = shortname
            }
        }),
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

        setInFlight(inFlightFrom: number, inFlightTo: number, inFlightTid: number) {
            const currentCounter = self.getOrCreateProofsCounter()

            currentCounter.inFlightFrom = inFlightFrom
            currentCounter.inFlightTo = inFlightTo
            currentCounter.counter = inFlightTo // temp increase of main counter value
            currentCounter.inFlightTid = inFlightTid

            log.trace('[setInFlight]', 'Lock and inflight indexes were set', currentCounter)

            self.proofsCounters = cast(self.proofsCounters)
        },
        resetInFlight(inFlightTid: number) {
            const currentCounter = self.getOrCreateProofsCounter()

            if(currentCounter.inFlightTid && currentCounter.inFlightTid !== inFlightTid) {
                // should not happen, log
                log.error(
                    Err.LOCKED_ERROR, 
                    'Trying to reset counter locked by another transaction, aborting reset', 
                    {currentCounter, inFlightTid, caller: 'resetInFlight'}
                )
                return
            }

            currentCounter.inFlightFrom = undefined
            currentCounter.inFlightTo = undefined
            currentCounter.inFlightTid = undefined
            
            log.trace('[resetInFlight]', 'Lock and inflight indexes were reset')

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
