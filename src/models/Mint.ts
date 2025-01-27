import {cast, flow, getParent, getRoot, getSnapshot, IAnyStateTreeNode, Instance, IStateTreeNode, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {    
    type GetInfoResponse, 
    type MintKeys as CashuMintKeys, 
    type MintKeyset as CashuMintKeyset,    
    CashuMint,    
} from '@cashu/cashu-ts'
import {colors, getRandomIconColor} from '../theme'
import { log } from '../services'

import AppError, { Err } from '../utils/AppError'
import { MintUnit, MintUnits } from '../services/wallet/currency'
import { getRootStore } from './helpers/getRootStore'
import { generateId } from '../utils/utils'
import { Proof } from './Proof'
import { CashuProof } from '../services/cashu/cashuUtils'


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

export type InFlightRequest<TRequest = any> = {
    transactionId: number;
    request: TRequest;
}

export enum MintStatus {
    ONLINE = 'ONLINE',
    OFFLINE = 'OFFLINE'
}

export const MintProofsCounterModel = types.model('MintProofsCounter', {
    keyset: types.string,
    unit: types.optional(types.frozen<MintUnit>(), 'sat'),
    counter: types.optional(types.number, 0),
    inFlightRequests: types.array(types.frozen<InFlightRequest>()),    
}).actions(self => ({
    addInFlightRequest(transactionId: number, request: any) {
        if(!self.inFlightRequests.find(r => r.transactionId === transactionId)) {
            self.inFlightRequests.push({transactionId, request})
            log.trace('[addInFlightRequest]', {transactionId, request})
        }
    },
    removeInFlightRequest(transactionId: number) {        
        const index = self.inFlightRequests.findIndex(r => r.transactionId === transactionId)
        
        if(index !== -1) {
            self.inFlightRequests.splice(index, 1)
            self.inFlightRequests = cast(self.inFlightRequests)

            log.trace('[removeInFlightRequest]', {transactionId})
        }
    },  
    increaseProofsCounter(numberOfProofs: number) {
        if(isNaN(self.counter)) self.counter = 0
        self.counter += numberOfProofs
        log.info('[increaseProofsCounter]', 'Increased proofsCounter', {numberOfProofs, counter: self.counter})
    },
    decreaseProofsCounter(numberOfProofs: number) {
        self.counter -= numberOfProofs
        Math.max(0, self.counter)
        log.trace('[decreaseProofsCounter]', 'Decreased proofsCounter', {numberOfProofs, counter: self.counter})
    },
}))

export type MintProofsCounter = Instance<typeof MintProofsCounterModel>

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
                self.keysets = cast(self.keysets)
            }            
        },
        removeKeyset(keyset: CashuMintKeyset) {
            const index = self.keysets.findIndex(k => k.id === keyset.id)

            if(index !== -1) {
                self.keysets.splice(index, 1)
                self.keysets = cast(self.keysets)
            }            
        },
        setIsActive(freshKeyset: CashuMintKeyset) {
            const keyset = self.keysets.find(k => k.id === freshKeyset.id)

            if(keyset) {
                keyset.active = freshKeyset.active
                self.keysets = cast(self.keysets)
            }            
        },
        setInputFeePpk(keysetId: string, inputFeePpk: number) {
            const keyset = self.keysets.find(k => k.id === keysetId)

            if(keyset) {
                keyset.input_fee_ppk = inputFeePpk
                self.keysets = cast(self.keysets)
            }            
        },
        addKeys(keys: CashuMintKeys) {
            const alreadyExists = self.keys.some(k => k.id === keys.id)

            if(!alreadyExists) {
                self.keys.push(keys)
                self.keys = cast(self.keys)
            }            
        },
        removeKeys(keys: CashuMintKeys) {
            const index = self.keys.findIndex(k => k.id === keys.id)

            if(index !== -1) {
                self.keys.splice(index, 1)
                self.keys = cast(self.keys)
            }            
        },
        addUnit(unit: MintUnit) {
            const alreadyExists = self.units.some(u => u === unit)

            if(!alreadyExists) {
                self.units.push(unit)
                self.units = cast(self.units)
            }            
        },        
        removeUnit(unit: MintUnit) {
            const index = self.units.findIndex(u => u === unit)

            if(index !== -1) {
                self.units.splice(index, 1)
                self.units = cast(self.units)
            }            
        },
        addProofsCounter(counter: MintProofsCounter) {
            const alreadyExists = self.proofsCounters.some(p => p.keyset === counter.keyset)

            if(!alreadyExists) {
                log.trace('[addProofsCounter]', {counter})          
                self.proofsCounters.push(counter)
                self.proofsCounters = cast(self.proofsCounters)
            }
            
        },
        removeProofsCounter(counter: MintProofsCounter) {
            const index = self.proofsCounters.findIndex(p => p.keyset === counter.keyset)

            if(index !== -1) {
                self.proofsCounters.splice(index, 0)
                self.proofsCounters = cast(self.proofsCounters)
            }
        },
        getProofsCounter(keysetId: string) {
            const counter = self.proofsCounters.find(c => c.keyset === keysetId)
            
            // Make sure we did not lost counter, breaks the wallet
            if(counter && isNaN(counter?.counter)) {
                counter.counter = 0
                self.proofsCounters = cast(self.proofsCounters)
            }
                        
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
            const existing = self.getProofsCounter(keyset.id)

            if(!existing) {
                const newCounter = MintProofsCounterModel.create({
                    keyset: keyset.id,
                    unit: keyset.unit as MintUnit,
                    counter: 0,                    
                })
    
                self.addProofsCounter(newCounter)
                return newCounter
            }

            return existing
        }
    }))
    .actions(self => ({ 
        initKeyset(keyset: CashuMintKeyset) {
            // Do not add unit the wallet does not have configured
            try {
                if(!self.isUnitSupported(keyset.unit as MintUnit)) {                                
                    throw new AppError(Err.VALIDATION_ERROR, `Unsupported unit provided by the mint: ${keyset.unit}`)            
                }
                
                const existing = self.keysets.find(k => k.id === keyset.id)

                if(existing) {
                    if (existing.unit !== keyset.unit) {                    
                        throw new AppError(Err.VALIDATION_ERROR, `Keyset unit mismatch, got ${keyset.unit}, expected ${existing.unit}`)                 
                    }

                    if(keyset.input_fee_ppk && existing.input_fee_ppk !== keyset.input_fee_ppk) {
                        self.setInputFeePpk(existing.id, keyset.input_fee_ppk)
                    }

                    return existing
                }

                if(!keyset.input_fee_ppk) {
                    keyset.input_fee_ppk = 0
                }

                self.addKeyset(keyset)            
                self.addUnit(keyset.unit as MintUnit)            
                self.createProofsCounter(keyset)

                log.trace('[initKeyset]', {newKeyset: keyset})
            } catch (e: any) {
                throw new AppError(Err.WALLET_ERROR, '[initKeyset] ' + e.message)
            }        
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
        getProofsCounterByKeysetId(keysetId: string) {                        
            const counter = self.proofsCounters.find(p => p.keyset === keysetId)
            if(!counter) {
                const keyset = self.keysets.find(k => k.id === keysetId)
                if(!keyset) {
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing keyset.')                    
                }
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
                const cashuMint = new CashuMint(self.mintUrl)
                const info: GetInfoResponse = yield cashuMint.getInfo()                

                if(info.name.length > 0) {
                    shortname = info.name                    
                }

                self.shortname = shortname
                
            } catch (e: any) {
                log.warn('[setShortname]', {error: e.message})
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
        resetCounters() {
            for(const counter of self.proofsCounters) {
                log.warn('Resetting counter', counter.keyset)
                counter.counter = 0
            }
            
            self.proofsCounters = cast(self.proofsCounters)
        },
        getMintFeeReserve(proofs: CashuProof[] | Proof[]): number {
            // Find the corresponding keyset for each proof and sum the input fees
            const totalInputFees = proofs.reduce((sum, proof) => {
              const keyset = self.keysets.find(k => k.id === proof.id)
              return keyset && keyset.input_fee_ppk ? sum + keyset.input_fee_ppk : sum
            }, 0)
      
            // Calculate the fees
            const feeReserve = Math.max(Math.floor((totalInputFees + 999) / 1000), 0)
            
            log.trace('[getMintFeeReserve]', {feeReserve})
            return feeReserve
        },
        removeAllInFlightRequests() {
            log.trace('[removeAllInFlightRequests] Removing all inFlight requests', {mintUrl: self.mintUrl})
            for(const counter of self.proofsCounters) {
                counter.inFlightRequests.length = 0
            }            
        },
    }))
    .views(self => ({
        findInFlightRequestByTId: (transactionId: number) => {            
            const inFlightCounters = self.proofsCounters.filter(c => c.inFlightRequests && c.inFlightRequests.length > 0)                    
            let inFlightRequest: InFlightRequest | undefined = undefined

            for (const counter of inFlightCounters) {
                const request = counter.inFlightRequests.find(r => r.transactionId === transactionId)
                if(request) {
                    inFlightRequest = request
                    break
                }
            }

            return inFlightRequest
        },
        get proofsCountersWithInFlightRequests(): MintProofsCounter[] {            
            const counters = self.proofsCounters.filter(c => c.inFlightRequests && c.inFlightRequests.length > 0)                       
            return counters as MintProofsCounter[]
        },
        get allInFLightRequests(): InFlightRequest[] {            
            const requests = self.proofsCounters
                .flatMap((counter) => counter.inFlightRequests) // Combine all `inFlightRequests` arrays  
                
            return requests
        },
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