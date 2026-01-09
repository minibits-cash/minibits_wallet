import {cast, detach, flow, getParent, getRoot, getSnapshot, IAnyStateTreeNode, Instance, isAlive, IStateTreeNode, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {
    type GetInfoResponse,
    type MintKeys as CashuMintKeys,
    type MintKeyset as CashuMintKeyset,
    Mint as CashuMint,
    type MeltPreview,
} from '@cashu/cashu-ts'
import {colors, getRandomIconColor} from '../theme'
import { log } from '../services'

import AppError, { Err } from '../utils/AppError'
import { MintUnit, MintUnits } from '../services/wallet/currency'
import { getRootStore } from './helpers/getRootStore'
import { generateId } from '../utils/utils'
import { Proof } from './Proof'
import { CashuProof, CashuUtils } from '../services/cashu/cashuUtils'

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

export type InFlightRequest<TRequest = any>  = {
    transactionId: number
    request: TRequest
}

const InFlightRequestModel = types.model('InFlightRequest', {
    transactionId: types.number,
    request: types.frozen<any>(), // or replace `any` with your actual request type
})

// Sub-model for melt previews (v3.x uses MeltPreview instead of just counter)
const MeltCounterValueModel = types.model('MeltCounterValue', {
    transactionId: types.number,
    counterAtMelt: types.number,        // the counter value when melt started (kept for backward compatibility)
    meltPreview: types.maybe(types.frozen<MeltPreview>()),  // v3.x MeltPreview object for recovery
    createdAt: types.optional(types.Date, () => new Date()), // optional: when it was added
})

// === Migration function ===
const migrateSnapshot = (snapshot: any): any => {
    if (!snapshot) return snapshot

    // 1. Convert old inFlightRequests array → map (if needed)
    if (Array.isArray(snapshot.inFlightRequests)) {
        const oldArray = snapshot.inFlightRequests as Array<{ transactionId: number; request: any }>
        const newMap: Record<string, any> = {}

        oldArray.forEach(item => {
            if (item && typeof item.transactionId === 'number') {
                newMap[item.transactionId.toString()] = {
                    transactionId: item.transactionId,
                    request: item.request ?? null,
                }
            }
        })

        snapshot = {
            ...snapshot,
            inFlightRequests: newMap,
        }
    } else if (snapshot.inFlightRequests == null) {
        // Ensure it's an object (empty map)
        snapshot = { ...snapshot, inFlightRequests: {} }
    }

    // 2. Add missing meltCounterValues map (new in v2+)
    if (snapshot.meltCounterValues === undefined) {
        snapshot = { ...snapshot, meltCounterValues: {} }
    }

    return snapshot
}


export const MintProofsCounterModel = types
    .model('MintProofsCounter', {
        keyset: types.string,
        unit: types.optional(types.frozen<MintUnit>(), 'sat'),
        counter: types.optional(types.number, 0),

        // In-flight mint requests
        inFlightRequests: types.map(InFlightRequestModel),

        // Melt transactions that have started (counter value frozen at start)
        meltCounterValues: types.map(MeltCounterValueModel),
    })
    .preProcessSnapshot(migrateSnapshot)
    .actions(self => ({
        // === In-flight mint requests (unchanged) ===
        addInFlightRequest(transactionId: number, request: any) {
            self.inFlightRequests.set(transactionId.toString(), {
                transactionId,
                request,
            })
            log.trace('[addInFlightRequest]', { transactionId, request })
        },

        removeInFlightRequest(transactionId: number) {
            if (!isAlive(self)) {
                log.error('[removeInFlightRequest]', 'ProofsCounter is not alive', { keyset: self.keyset })
                return
            }
            const key = transactionId.toString()
            if (self.inFlightRequests.has(key)) {
                self.inFlightRequests.delete(key)
                log.trace('[removeInFlightRequest]', { transactionId })
            }
        },

        clearAllInFlightRequests() {
            if (!isAlive(self)) {
                log.error('[clearAllInFlightRequests]', 'ProofsCounter is not alive', { keyset: self.keyset })
                return
            }
            const count = self.inFlightRequests.size
            if (count > 0) {
                self.inFlightRequests.clear()
                log.info('[clearAllInFlightRequests]', `Cleared ${count} in-flight request(s)`)
            }
        },

        // === Melt counter tracking ===
        addMeltCounterValue(transactionId: number, meltPreview?: MeltPreview): number {
            const key = transactionId.toString()
            if (self.meltCounterValues.has(key)) {
                log.warn('[addMeltCounterValue]', 'Melt already tracked', { transactionId })
                return self.meltCounterValues.get(key)!.counterAtMelt
            }

            self.meltCounterValues.set(key, {
                transactionId,
                counterAtMelt: self.counter,
                meltPreview,
                createdAt: new Date(),
            })

            log.trace('[addMeltCounterValue]', {
                transactionId,
                counterAtMelt: self.counter,
                hasMeltPreview: !!meltPreview,
            })

            return self.counter
        },

        removeMeltCounterValue(transactionId: number) {
            if (!isAlive(self)) {
                log.error('[removeMeltCounterValue]', 'ProofsCounter is not alive', { keyset: self.keyset })
                return
            }

            const key = transactionId.toString()
            if (self.meltCounterValues.has(key)) {
                self.meltCounterValues.delete(key)
                log.trace('[removeMeltCounterValue]', { transactionId })
            }
        },

        clearAllMeltCounterValues() {
            if (!isAlive(self)) {
                log.error('[clearAllMeltCounterValues]', 'ProofsCounter is not alive', { keyset: self.keyset })
                return
            }

            const count = self.meltCounterValues.size
            if (count > 0) {
                self.meltCounterValues.clear()
                log.info('[clearAllMeltCounterValues]', `Cleared ${count} melt tracking entries`)
            }
        },

        // === Counter mutations (unchanged) ===
        increaseProofsCounter(numberOfProofs: number) {
            self.counter += numberOfProofs
            log.info('[increaseProofsCounter]', 'Increased proofsCounter', {
                numberOfProofs,
                counter: self.counter,
            })
        },

        decreaseProofsCounter(numberOfProofs: number) {
            self.counter = Math.max(0, self.counter - numberOfProofs)
            log.trace('[decreaseProofsCounter]', 'Decreased proofsCounter', {
                numberOfProofs,
                counter: self.counter,
            })
        },

        setProofsCounter(newCounter: number) {
            self.counter = newCounter
            log.debug('[setProofsCounter]', 'Set proofsCounter', {
                counter: self.counter,
            })
        },
    }))
    .views(self => ({
        // === In-flight requests ===
        inFlightRequestExists(transactionId: number): boolean {
            return self.inFlightRequests.has(transactionId.toString())
        },
        getInFlightRequest(transactionId: number): InFlightRequest | undefined {
            return self.inFlightRequests.get(transactionId.toString())
        },
        get inFlightRequestCount(): number {
            return self.inFlightRequests.size
        },
        get allInFlightRequests(): Instance<typeof InFlightRequestModel>[] {
            return Array.from(self.inFlightRequests.values())
        },

        // === Melt counter values ===
        meltCounterValueExists(transactionId: number): boolean {
            return self.meltCounterValues.has(transactionId.toString())
        },
        getMeltCounterValue(transactionId: number): Instance<typeof MeltCounterValueModel> | undefined {
            return self.meltCounterValues.get(transactionId.toString())
        },
        get meltCounterValueCount(): number {
            return self.meltCounterValues.size
        },
        get allMeltCounterValues(): Instance<typeof MeltCounterValueModel>[] {
            return Array.from(self.meltCounterValues.values())
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
    .views(self => ({
    
    }))
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
        }
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
        initKeyset(keyset: CashuMintKeyset, allKeysetIds: string[]) {
            // ATTN: const mintsStore = getRootStore(self).mintsStore does not work here (may be because it is being called from within loop)

            // Do not add unit the wallet does not have configured
            
            if(!self.isUnitSupported(keyset.unit as MintUnit)) {                                
                throw new AppError(
                    Err.VALIDATION_ERROR, 
                    `Unsupported unit provided by the mint`,
                    {caller: 'initKeyset', unit: keyset.unit}
                )            
            }
            
            const existing = self.keysets.find(k => k.id === keyset.id)

            if(existing) {
                if (existing.unit !== keyset.unit) {                    
                    throw new AppError(
                        Err.VALIDATION_ERROR, 
                        `Keyset unit mismatch.`,
                        {caller: 'initKeyset', existingUnit: existing.unit, keysetUnit: keyset.unit}
                    )                 
                }

                if(keyset.input_fee_ppk && existing.input_fee_ppk !== keyset.input_fee_ppk) {
                    self.setInputFeePpk(existing.id, keyset.input_fee_ppk)
                }

                return existing
            }

            // Prevent keysetId collision with other mints
            if(CashuUtils.isCollidingKeysetId(keyset.id, allKeysetIds)) {
                throw new AppError(
                    Err.VALIDATION_ERROR, 
                    `KeysetId validation failed, collision detected.`,
                    {caller: 'initKeyset', keysetId: keyset.id}
                )
            }

            if(!keyset.input_fee_ppk) {
                keyset.input_fee_ppk = 0
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
            const mintsStore = getRootStore(self).mintsStore
            const allKeysetIds = mintsStore.allKeysetIds

            log.trace('[refreshKeysets]', {freshKeysets, allKeysetIds})

            // add new keyset if not exists            
            for (const keyset of freshKeysets) {
                self.initKeyset(keyset, allKeysetIds)
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

                //log.trace('[setMintUrl]', {mintsStore})

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
            const totalInputFees: number = proofs.reduce((sum: number, proof) => {
              const keyset = self.keysets.find(k => k.id === proof.id)
              return keyset && keyset.input_fee_ppk ? sum + (keyset?.input_fee_ppk ?? 0) : sum
            }, 0)
      
            // Calculate the fees
            const feeReserve = Math.max(Math.floor((totalInputFees + 999) / 1000), 0)
            
            log.trace('[getMintFeeReserve]', {feeReserve})
            return feeReserve
        },
        removeAllInFlightRequests() {
            log.trace('[removeAllInFlightRequests] Removing all inFlight requests', {mintUrl: self.mintUrl})
            for(const counter of self.proofsCounters) {
                counter.clearAllInFlightRequests() 
            }            
        },
    }))
    .views(self => ({
        findInFlightRequestByTId: (transactionId: number) => {            
            const inFlightCounters = self.proofsCounters.filter(c => c.inFlightRequests && c.inFlightRequests.size > 0)                    
            let inFlightRequest: InFlightRequest | undefined = undefined

            for (const counter of inFlightCounters) {
                const request = counter.getInFlightRequest(transactionId)
                if(request) {
                    inFlightRequest = request
                    break
                }
            }

            return inFlightRequest
        },
        get proofsCountersWithInFlightRequests() {            
            const counters = self.proofsCounters.filter(c => c.inFlightRequests && c.inFlightRequests.size > 0)                       
            return counters || []
        },
        get allInFlightRequests() {            
            const requests = self.proofsCounters // Get all counters as an array
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