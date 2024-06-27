import {cast, flow, Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import type {GetInfoResponse, MintKeys, MintKeyset} from '@cashu/cashu-ts'
import {colors, getRandomIconColor} from '../theme'
import { log, MintClient } from '../services'

import AppError, { Err } from '../utils/AppError'
import { MintUnit } from '../services/wallet/currency'
import { getRootStore } from './helpers/getRootStore'
import { generateId } from '../utils/utils'

// used as a helper type across app
/* export type Balance = {
    balance: number
    unit: MintUnit
}*/

export type MintBalance = {
    mintUrl: string
    balances: {
        [key in MintUnit]?: number
    }   
}  

export type UnitBalance = {    
    unitBalance: number
    unit: MintUnit
}

export type Balances = {
    mintBalances: MintBalance[]
    unitBalances: UnitBalance[]
}



export enum MintStatus {
    ONLINE = 'ONLINE',
    OFFLINE = 'OFFLINE'
}

export type MintProofsCounter = {
    keyset: string
    counter: number
    unit: MintUnit
    inFlightFrom?: number // starting counter index for pending split request sent to mint (for recovery from failure to receive proofs)
    inFlightTo?: number // last counter index for pending split request sent to mint 
    inFlightTid?: number // related tx id
}

/**
 * This represents a Cashu mint
 */
export const MintModel = types
    .model('Mint', {
        id: types.optional(types.string, () => generateId(8)),
        mintUrl: types.string,
        hostname: types.maybe(types.string),
        shortname: types.maybe(types.string),
        units: types.array(types.frozen<MintUnit>()),        
        proofsCounters: types.array(
            types.model('MintProofsCounter', {
              keyset: types.string,
              unit: types.optional(types.frozen<MintUnit>(), 'sat'),
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
    .actions(withSetPropAction) // TODO? start to use across app to avoid pure setter methods, e.g. mint.setProp('color', '#ccc')
    .actions(self => ({
        addUnit(unit: MintUnit) {
            const alreadyExists = self.units.some(u => u === unit)

            if(!alreadyExists) {
                self.units.push(unit)
            }

            self.units = cast(self.units)
        },
        removeUnit(unit: MintUnit) {
            const index = self.units.findIndex(u => u === unit)

            if(index) {
                self.units.splice(index, 0)
            }

            self.units = cast(self.units)
        },
    }))
    .actions(self => ({          
        getOrCreateProofsCounter(keysetId: string, unit?: MintUnit) {
            log.trace('[getOrCreateProofsCounter]', keysetId, unit)           
            const counter = self.proofsCounters.find(c => c.keyset === keysetId)

            if(!counter) {  
                if (!unit) {
                    throw new AppError(Err.VALIDATION_ERROR, 'Can not create proofs counter: missing unit')
                }

                const newCounter = {
                    keyset: keysetId,
                    unit,                    
                    counter: 0,
                }

                self.proofsCounters.push(newCounter)                
                self.addUnit(unit)
                const instance = self.proofsCounters.find(c => c.keyset === keysetId) as MintProofsCounter

                log.trace('[getOrCreateProofsCounter] new', {newCounter: instance})
                return instance
            }

            if(unit && counter.unit !== unit) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mismatch of proofsCounter keyset and passed unit', {counter, unit})
            }
            
            return counter as MintProofsCounter
        },
        findInFlightProofsCounter() {            
            const counter = self.proofsCounters.find(c => c.inFlightFrom && c.inFlightTo && c.inFlightTid)                       
            return counter as MintProofsCounter | undefined
        },
        findInFlightProofsCounterByTId(tId: number) {            
            const counter = self.proofsCounters.find(c => c.inFlightTid === tId)                       
            return counter as MintProofsCounter | undefined
        },
        validateURL(url: string) {
            try {
                new URL(url)
                return true
            } catch (e) {
                return false
            }
        },
    }))
    .actions(self => ({
        getProofsCounterByUnit: flow(function* getProofsCounterByUnit(unit: MintUnit) {
            // Retrieve current keys for this unit from new or existing cashu-ts wallet instance
            const keys: MintKeys = (yield MintClient.getWallet(self.mintUrl, unit)).keys

            // Get or create new proofs counter for this keyset            
            const counter = self.getOrCreateProofsCounter(keys.id, unit)
            return counter
        }),
        setHostname() {
            try {
                self.hostname = new URL(self.mintUrl).hostname
            } catch (e) {
                return false
            }
        },
        setMintUrl(url: string) {
            if(self.validateURL(url)) {
                const mintsStore = getRootStore(self).mintsStore

                if(!mintsStore.alreadyExists(url)) {

                    const proofsStore = getRootStore(self).proofsStore
                    proofsStore.updateMintUrl(self.mintUrl, url) // update mintUrl on mint's proofs                    
                    self.mintUrl = url
                    
                    return true
                }

                throw new AppError(Err.VALIDATION_ERROR, 'Mint URL already exists.', {url})
            } else {
                throw new AppError(Err.VALIDATION_ERROR, 'Invalid Mint URL.', {url})
            }
        },
        setId() { // migration
            self.id = generateId(8)
        },
        setShortname: flow(function* setShortname() {
            // get name from URL as a fallback
            const lastSlashIndex = self.mintUrl.lastIndexOf('/')
            let shortname = self.mintUrl.substring(lastSlashIndex + 1).slice(0, 25)

            try {
                const info: GetInfoResponse = yield MintClient.getMintInfo(self.mintUrl)

                if(info.name.length > 0) {
                    shortname = info.name                    
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
        setInFlight(keyset: string, options: {inFlightFrom: number, inFlightTo: number, inFlightTid: number}) {
            const counter = self.getOrCreateProofsCounter(keyset)

            counter.inFlightFrom = options.inFlightFrom
            counter.inFlightTo = options.inFlightTo
            counter.counter = options.inFlightTo // temp increase of main counter value
            counter.inFlightTid = options.inFlightTid

            log.trace('[setInFlight]', 'Lock and inflight indexes were set', counter)

            self.proofsCounters = cast(self.proofsCounters)
        },
        resetInFlight(inFlightTid: number) {
            const counter = self.findInFlightProofsCounterByTId(inFlightTid)

            if(!counter) {
                log.warn('[resetInFlight]', 'Could not find counter locked by inFlightTid', {inFlightTid})
                return
            }

            counter.inFlightFrom = undefined
            counter.inFlightTo = undefined
            counter.inFlightTid = undefined
            
            log.trace('[resetInFlight]', 'Lock and inflight indexes were reset', {inFlightTid})

            self.proofsCounters = cast(self.proofsCounters)
        },
        increaseProofsCounter(keyset: string, numberOfProofs: number) {
            const counter = self.getOrCreateProofsCounter(keyset)             
            counter.counter += numberOfProofs
            log.trace('[increaseProofsCounter]', 'Increased proofsCounter', {numberOfProofs, counter})

            // Make sure to cast the frozen array back to a mutable array
            self.proofsCounters = cast(self.proofsCounters)
        },
        decreaseProofsCounter(keyset: string, numberOfProofs: number) {
            const counter = self.getOrCreateProofsCounter(keyset)
            counter.counter -= numberOfProofs
            Math.max(0, counter.counter)
            log.trace('[decreaseProofsCounter]', 'Decreased proofsCounter', {numberOfProofs, counter})

            self.proofsCounters = cast(self.proofsCounters)                        
        },
        resetCounters() {
            for(const counter of self.proofsCounters) {
                log.warn('Resetting counter', counter.keyset)
                counter.counter = 0
            }
            
            self.proofsCounters = cast(self.proofsCounters)
        },
    }))
    .views(self => ({
        get balances(): MintBalance | undefined {
            const mintBalance: MintBalance | undefined = getRootStore(self).proofsStore.getMintBalance(self.mintUrl)
            return mintBalance
        },
        get keysets(): string[] {
            return self.proofsCounters.map(c => c.keyset)
        }
     }))
    
    

export type Mint = {
    mintUrl: string    
} & Partial<Instance<typeof MintModel>>
export interface MintSnapshotOut extends SnapshotOut<typeof MintModel> {}
export interface MintSnapshotIn extends SnapshotIn<typeof MintModel> {}