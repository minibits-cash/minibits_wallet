import {cast, detach, flow, getParent, getRoot, getSnapshot, IAnyStateTreeNode, Instance, isAlive, IStateTreeNode, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {
    type GetInfoResponse,
    type MintKeys as CashuMintKeys,
    type MintKeyset as CashuMintKeyset,
    Mint as CashuMint,
} from '@cashu/cashu-ts'
import {colors, getRandomIconColor} from '../theme'
import { log, Database } from '../services'

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

// === Migration function ===
// inFlightRequests and meltCounterValues moved to SQLite (inflight_requests /
// melt_recovery tables). Strip both from any old snapshot so applySnapshot does
// not choke on the removed fields. A MintProofsCounter snapshot is now just
// {keyset, unit, counter}.
const migrateSnapshot = (snapshot: any): any => {
    if (!snapshot) return snapshot
    const {inFlightRequests, meltCounterValues, ...rest} = snapshot
    return rest
}


/**
 * Write a counter mutation through to the SQLite authority — the PRIMARY
 * counter persistence ("W1").
 *
 * `mode: 'set'` persists an absolute value monotonically (never lowers);
 * `mode: 'bump'` advances by a relative delta. The (mint, keyset) identity is
 * read from the parent Mint node — a counter is always nested two levels up
 * (counter -> proofsCounters array -> Mint).
 *
 * This fires the instant cashu derives (right after onCountersReserved, BEFORE
 * the reservation commit), so the advance is durable the moment the mint could
 * have seen those outputs — covering a crash before commit AND an explicit
 * rollback. Those indices are consumed at the mint and must never be reused even
 * if the operation aborts, which is exactly why rollback does NOT rewind the
 * counter.
 *
 * Errors are logged (→ Sentry in prod) but never rethrown: a counter write must
 * not break a wallet flow, and there is a complementary safety net —
 * commitReservation re-persists this same value ATOMICALLY with the proofs
 * ("W2", see reservationsRepo), so even if this write is dropped a successful
 * commit cannot leave the counter behind its proofs. A detached instance (e.g. a
 * counter created for a CounterBackup, not yet attached to a Mint) has no parent
 * and is a no-op here.
 */
const persistCounter = (self: any, mode: 'set' | 'bump', value: number): void => {
    let mintUrl: string | undefined
    try {
        mintUrl = getParent<any>(self, 2)?.mintUrl
    } catch {
        return // not attached to a Mint (e.g. CounterBackup) — nothing to persist
    }
    if (!mintUrl) return

    try {
        if (mode === 'set') {
            Database.setCounter(mintUrl, self.keyset, self.unit, value)
        } else {
            Database.bumpCounter(mintUrl, self.keyset, self.unit, value)
        }
    } catch (e: any) {
        log.error('[persistCounter]', 'Counter write-through failed', {
            error: e?.message,
            mintUrl,
            keyset: self.keyset,
        })
    }
}

export const MintProofsCounterModel = types
    .model('MintProofsCounter', {
        keyset: types.string,
        unit: types.optional(types.frozen<MintUnit>(), 'sat'),
        counter: types.optional(types.number, 0),
    })
    .preProcessSnapshot(migrateSnapshot)
    .actions(self => ({
        // === Counter mutations (write through to the SQLite authority) ===
        increaseProofsCounter(numberOfProofs: number) {
            self.counter += numberOfProofs
            persistCounter(self, 'bump', numberOfProofs)
            log.info('[increaseProofsCounter]', 'Increased proofsCounter', {
                numberOfProofs,
                counter: self.counter,
            })
        },

        setProofsCounter(newCounter: number) {
            self.counter = newCounter
            persistCounter(self, 'set', newCounter)
            log.debug('[setProofsCounter]', 'Set proofsCounter', {
                counter: self.counter,
            })
        },

        /**
         * Load the authoritative value from SQLite into the in-memory cache on
         * startup/resume. Monotonic (only raises) and does NOT write back, so it
         * can't loop with the write-through above.
         */
        hydrateCounterFromDb(value: number) {
            if (value > self.counter) {
                self.counter = value
            }
        },
    }))
    // The derivation counter is mastered in SQLite (mint_counters), hydrated
    // into this model as an in-memory cache on startup/resume. Strip it from
    // every persisted snapshot so the MMKV whole-tree save can never write a
    // stale value back over the SQLite authority — exactly as ProofsStore strips
    // `proofs`. Consumers that legitimately need the value (backup export,
    // counter backups) re-inject it from the live model / SQLite.
    .postProcessSnapshot(snapshot => ({
        ...snapshot,
        counter: 0,
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
        mintInfo: types.maybe(types.frozen<GetInfoResponse & {time: number}>()),
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
            const index = self.keysets.findIndex(k => k.id === freshKeyset.id)

            if(index !== -1) {
                // Since keysets is a frozen array, we need to replace the entire keyset object
                const updatedKeyset = {
                    ...self.keysets[index],
                    active: freshKeyset.active
                }
                self.keysets[index] = updatedKeyset
                self.keysets = cast(self.keysets)
            }
        },
        setInputFeePpk(keysetId: string, inputFeePpk: number) {
            const index = self.keysets.findIndex(k => k.id === keysetId)

            if(index !== -1) {
                // Since keysets is a frozen array, we need to replace the entire keyset object
                const updatedKeyset = {
                    ...self.keysets[index],
                    input_fee_ppk: inputFeePpk
                }
                self.keysets[index] = updatedKeyset
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
                self.proofsCounters.splice(index, 1)
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
        keysExist(keysetId: string): boolean {
            return self.keys.some(k => k.id === keysetId)
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

                if(existing.active !== keyset.active) {
                    self.setIsActive(keyset)
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
                // initKeyset now handles active status updates internally
                self.initKeyset(keyset, allKeysetIds)
            }
        },
        refreshKeys(freshKeys: CashuMintKeys[]) {
            for (const key of freshKeys) {
                self.initKeys(key)
            }
        },
        setMintInfo(info: GetInfoResponse & {time: number}) {
            self.mintInfo = info
            log.trace('[setMintInfo]', {mintUrl: self.mintUrl})
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
            } catch (e: any) {
                log.warn('[setShortname]', {error: e.message})
            }

            // Mint may have been removed while the network call was in flight
            if (!isAlive(self)) return

            self.shortname = shortname
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