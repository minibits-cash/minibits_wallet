import {cast, flow, getSnapshot, Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import type {
    CashuWallet, 
    GetInfoResponse, 
    MintKeys as CashuMintKeys, 
    MintKeyset as CashuMintKeyset
} from '@cashu/cashu-ts'
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
    inFlightFrom?: number // starting counter index for pending split request sent to mint (for recovery from failure to receive proofs)
    inFlightTo?: number // last counter index for pending split request sent to mint 
    inFlightTid?: number // related tx id
}

export const MintProofsCounterModel = types
    .model('MintProofsCounter', {        
        keyset: types.string,
        unit: types.optional(types.frozen<MintUnit>(), 'sat'),
        counter: types.number,              
        inFlightFrom: types.maybe(types.number),
        inFlightTo: types.maybe(types.number),
        inFlightTid: types.maybe(types.number)
    })
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
        keysets: types.array(types.frozen<CashuMintKeyset>()),   
        keys: types.array(types.frozen<CashuMintKeys>()),
        proofsCounters: types.array(MintProofsCounterModel),
        color: types.optional(types.string, colors.palette.iconBlue200),
        status: types.optional(types.frozen<MintStatus>(), MintStatus.ONLINE),
        createdAt: types.optional(types.Date, new Date()),
    })
    .actions(withSetPropAction) // TODO? start to use across app to avoid pure setter methods, e.g. mint.setProp('color', '#ccc')
    .actions(self => ({
        addKeyset(keyset: CashuMintKeyset) {
            const alreadyExists = self.keysets.some(k => k.id === keyset.id)

            if(!alreadyExists) {
                self.keysets.push(keyset)
            }

            self.keysets = cast(self.keysets)
        },
        removeKeyset(keyset: CashuMintKeyset) {
            const index = self.keysets.findIndex(k => k.id === keyset.id)

            if(index) {
                self.keysets.splice(index, 0)
            }

            self.keysets = cast(self.keysets)
        },
        setIsActive(freshKeyset: CashuMintKeyset) {
            const keyset = self.keysets.find(k => k.id === freshKeyset.id)

            if(keyset) {
                keyset.active = freshKeyset.active
            }

            self.keysets = cast(self.keysets)
        },
        addKeys(keys: CashuMintKeys) {
            const alreadyExists = self.keys.some(k => k.id === keys.id)

            if(!alreadyExists) {
                self.keys.push(keys)
            }

            self.keys = cast(self.keys)
        },
        removeKeys(keys: CashuMintKeys) {
            const index = self.keys.findIndex(k => k.id === keys.id)

            if(index) {
                self.keys.splice(index, 0)
            }

            self.keys = cast(self.keys)
        },
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
        addProofsCounter(counter: MintProofsCounter) {
            const alreadyExists = self.proofsCounters.some(p => p.keyset === counter.keyset)

            if(!alreadyExists) {
                self.proofsCounters.push(counter)
            }

            self.proofsCounters = cast(self.proofsCounters)
        },
        removeProofsCounter(counter: MintProofsCounter) {
            const index = self.proofsCounters.findIndex(p => p.keyset === counter.keyset)

            if(index) {
                self.proofsCounters.splice(index, 0)
            }

            self.proofsCounters = cast(self.proofsCounters)
        },
        getProofsCounter(keysetId: string) {
            const counter = self.proofsCounters.find(c => c.keyset === keysetId)            
            return counter
        },
        isUnitSupported(unit: MintUnit): boolean {
            return MintUnits.includes(unit) ? true : false
        },
        keysetExists(keyset: CashuMintKeyset): boolean {
            return self.keysets.some(k => k.id === keyset.id)
        },
    }))
    .actions(self => ({
        createProofsCounter(keyset: CashuMintKeyset) {
            const newCounter: MintProofsCounter = {
                keyset: keyset.id,
                unit: keyset.unit as MintUnit,
                counter: 0,                    
            }

            const proofsCounterInstance = MintProofsCounterModel.create(newCounter)
            self.addProofsCounter(newCounter)
            
            log.trace('[ceateProofsCounter]', {newCounter: getSnapshot(proofsCounterInstance)})
            return proofsCounterInstance            
        }
    }))
    .actions(self => ({ 
        initKeyset(keyset: CashuMintKeyset) {
            // Do not add unit the wallet does not have configured
            if(!self.isUnitSupported(keyset.unit as MintUnit)) {                                
                throw new AppError(Err.VALIDATION_ERROR, `Unsupported unit provided by the mint: ${keyset.unit}`)            
            }
            
            const existing = self.keysets.find(k => k.id === keyset.id)

            if(existing) {
                if (existing.unit !== keyset.unit) {                    
                    throw new AppError(Err.VALIDATION_ERROR, `Keyset unit mismatch, got ${keyset.unit}, expected ${existing.unit}`)                 
                }  
                
                return existing
            }

            if(!keyset.input_fee_ppk) {
                keyset.input_fee_ppk = 0
            }

            if(!keyset.unit) {
                keyset.unit = 'sat'
            }

            self.addKeyset(keyset)            
            self.addUnit(keyset.unit as MintUnit)            
            self.createProofsCounter(keyset)

            log.trace('[initKeyset]', {newKeyset: keyset})          
        },
        initKeys(key: CashuMintKeys) {
            // Do not add unit the wallet does not have configured
            if(!self.isUnitSupported(key.unit as MintUnit)) {                                
                throw new AppError(Err.VALIDATION_ERROR, `Unsupported unit provided by the mint: ${key.unit}`)            
            }            
            
            const existing = self.keys.find(k => k.id === key.id)

            if(existing) {
                if (existing.unit !== key.unit) {                    
                    throw new AppError(Err.VALIDATION_ERROR, `Keyset unit mismatch, got ${key.unit}, expected ${existing.unit}`)                 
                }  
                
                return existing
            }

            self.addKeys(key)            
            log.trace('[initKeys]', {newKeys: key.id})                   
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
        refreshKeysets(freshKeysets: CashuMintKeyset[]) {            
            // add new keyset if not exists            
            for (const keyset of freshKeysets) {
                self.initKeyset(keyset)
                self.setIsActive(keyset)
            }
        },
        refreshKeys(freshKeys: CashuMintKeys[]) {            
            for (const key of freshKeys) {
                self.initKeys(key)                
            }
        },
        getProofsCounterByUnit(unit: MintUnit, useActiveKeyset: boolean = true) {                        
            let keyset: CashuMintKeyset | undefined

            if(useActiveKeyset) {
                keyset = self.keysets.find(k => k.active === true && k.unit === unit)
            } else {
                keyset = self.keysets.find(k => k.active === false && k.unit === unit)
            }

            if(!keyset) {
                throw new AppError(Err.NOTFOUND_ERROR, 'Mint has no keyset for this unit', {unit})
            }
            
            const counter = self.proofsCounters.find(p => p.keyset === keyset?.id)

            if(!counter) {
                return self.createProofsCounter(keyset)                
            }

            return counter
        },
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
            // Find the corresponding keyset for each proof and sum the input fees
            const totalInputFees = proofs.reduce((sum, proof) => {
              const keyset = self.keysets.find(k => k.id === proof.id)
              return keyset && keyset.input_fee_ppk ? sum + keyset.input_fee_ppk : sum
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
        get keysetIds(): string[] {
            return self.keysets.map(k => k.id)
        }        
     }))
    
    

export type Mint = {
    mintUrl: string   
} & Partial<Instance<typeof MintModel>>
export interface MintSnapshotOut extends SnapshotOut<typeof MintModel> {}
export interface MintSnapshotIn extends SnapshotIn<typeof MintModel> {}