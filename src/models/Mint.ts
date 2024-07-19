import {cast, flow, Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import type {CashuWallet, GetInfoResponse, MintKeys, MintKeyset} from '@cashu/cashu-ts'
import {colors, getRandomIconColor} from '../theme'
import { log, MintClient } from '../services'

import AppError, { Err } from '../utils/AppError'
import { MintUnit, MintUnits } from '../services/wallet/currency'
import { getRootStore } from './helpers/getRootStore'
import { generateId } from '../utils/utils'
import { Proof } from './Proof'

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
    input_fee_ppk: number
    inFlightFrom?: number // starting counter index for pending split request sent to mint (for recovery from failure to receive proofs)
    inFlightTo?: number // last counter index for pending split request sent to mint 
    inFlightTid?: number // related tx id
}

/**
 * This represents a Cashu mint
 */
export const MintModel = types
    .model('Mint', {
        id: types.optional(types.identifier, () => generateId(8)),
        mintUrl: types.string,
        hostname: types.maybe(types.string),
        shortname: types.maybe(types.string),
        units: types.array(types.frozen<MintUnit>()),        
        proofsCounters: types.array(
            types.model('MintProofsCounter', {
              keyset: types.string,
              unit: types.optional(types.frozen<MintUnit>(), 'sat'),
              counter: types.number,
              input_fee_ppk: types.optional(types.number, 0),
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
        getProofsCounter(keysetId: string) {
            const counter = self.proofsCounters.find(c => c.keyset === keysetId)            
            return counter
        },
    }))
    .actions(self => ({   
        createProofsCounter(keyset: MintKeyset) {
            // Do not add unit the wallet does not have configured
            if (!MintUnits.includes(keyset.unit as MintUnit)) {                    
                throw new AppError(Err.VALIDATION_ERROR, `Unsupported unit provided by the mint: ${keyset.unit}`)                    
            }
            
            const existing = self.getProofsCounter(keyset.id)

            if(existing) { // update fees if they can change (?)
                if (existing.unit !== keyset.unit) {                    
                    throw new AppError(Err.VALIDATION_ERROR, `Keyset unit mismatch, got ${keyset.unit}, expected ${existing.unit}`)                 
                }

                existing.input_fee_ppk = keyset.input_fee_ppk || 0
                self.proofsCounters = cast(self.proofsCounters)  
                return existing
            }

            const newCounter: MintProofsCounter = {
                keyset: keyset.id,
                unit: keyset.unit as MintUnit,                    
                input_fee_ppk: keyset.input_fee_ppk || 0,
                counter: 0,                    
            }

            self.proofsCounters.push(newCounter)                
            self.addUnit(keyset.unit as MintUnit)
            const instance = self.proofsCounters.find(c => c.keyset === keyset.id) as MintProofsCounter

            log.trace('[ceateProofsCounter]', {newCounter: instance})
            return instance            
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
            try {
                // Refresh current keys for this unit from new or existing in-memory wallet instance
                const wallet: CashuWallet = yield MintClient.getWallet(self.mintUrl, unit)
                const keyset = wallet.keyset

                // Get or create new proofs counter for this keyset            
                const counter = self.getProofsCounter(keyset.id)

                if(!counter) {
                    return self.createProofsCounter(keyset)                
                }

                return counter
            } catch(e: any) {
                log.warn('[getProofsCounterByUnit] Could not refresh keyset, using mint proofsCounter for unit', {unit})
                
                const proofsCounterInstance = self.proofsCounters.find(c => c.unit === unit)

                if(!proofsCounterInstance) {
                    throw new AppError(Err.NOTFOUND_ERROR, 'Could not get keyset to create new mint proofsCounter for unit', {unit})
                }
                
                return proofsCounterInstance  
            }
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
        setInFlight(keysetId: string, options: {inFlightFrom: number, inFlightTo: number, inFlightTid: number}) {
            const counter = self.getProofsCounter(keysetId)

            if(!counter) {
                throw new AppError(Err.NOTFOUND_ERROR, 'Count not get mint proofsCounter for keysetId', {keysetId})
            }

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
        increaseProofsCounter(keysetId: string, numberOfProofs: number) {
            const counter = self.getProofsCounter(keysetId)       
            
            if(!counter) {
                throw new AppError(Err.NOTFOUND_ERROR, 'Count not get mint proofsCounter for keysetId', {keysetId})
            }
                  
            counter.counter += numberOfProofs
            log.trace('[increaseProofsCounter]', 'Increased proofsCounter', {numberOfProofs, counter})

            // Make sure to cast the frozen array back to a mutable array
            self.proofsCounters = cast(self.proofsCounters)
        },
        decreaseProofsCounter(keysetId: string, numberOfProofs: number) {
            const counter = self.getProofsCounter(keysetId)
            
            if(!counter) {
                throw new AppError(Err.NOTFOUND_ERROR, 'Count not get mint proofsCounter for keysetId', {keysetId})
            }

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
        getFeesForProofs(proofs: Proof[]): number {
            // Find the corresponding MintProofsCounter for each proof and sum the input fees
            const totalInputFees = proofs.reduce((sum, proof) => {
              const counter = self.proofsCounters.find(pc => pc.keyset === proof.id)
              return counter ? sum + counter.input_fee_ppk : sum
            }, 0)
      
            // Calculate the fees
            const fees = Math.max(Math.floor((totalInputFees + 999) / 1000), 0)
            
            log.debug('*** [getFeesForProofs]', {fees})
            return fees
        }
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