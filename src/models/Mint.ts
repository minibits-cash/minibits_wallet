import {cast, detach, flow, getRoot, getSnapshot, IAnyStateTreeNode, Instance, isAlive, IStateTreeNode, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {
    type GetInfoResponse,
    type MintKeys as CashuMintKeys,
    type MintKeyset as CashuMintKeyset,
    type MintMethod,
    type SwapMethod,
    Mint as CashuMint,
} from '@cashu/cashu-ts'
// From '../theme/colors', NOT the '../theme' barrel. The barrel re-exports
// useThemeColor, which imports '../services' — so a barrel import here would make
// this model transitively depend on mmkvStorage, keyChain (and nostr-tools) and the
// database, purely to read two colour constants. colors.ts imports nothing but
// react-native.
import {colors} from '../theme/colors'
// Direct imports, NOT the '../services' barrel: that barrel re-exports
// walletService -> syncQueueService -> notificationService (notifee) and keyChain
// (nostr-tools), so a barrel import here makes this model transitively depend on
// most of the app — and on native modules — to read a logger and the db facade.
import { log } from '../services/logService'
import { Database } from '../services/db'

import AppError, { Err } from '../utils/AppError'
import { MintUnit, MintUnits } from '../services/wallet/currency'
import { getRootStore } from './helpers/getRootStore'
import { generateId } from '../utils/generateId'
import { Proof } from './Proof'
import { CashuProof, CashuUtils } from '../services/cashu/cashuUtils'
import { normalizeMintUrl } from '../services/cashu/mintUrl'

/**
 * A mint payment method — the rail the mint settles on.
 *
 * Aliased from cashu-ts so the set cannot drift from the library's. Note the
 * wallet only implements bolt11 today; `onchain` arrives with NUT-30 and
 * `bolt12` is advertised by some mints but not yet supported here. The capability
 * views below can answer for any of them.
 */
export type PaymentMethod = MintMethod

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
    // `counter` is now VOLATILE (mastered in SQLite, see model below) — drop it
    // from any incoming snapshot so applySnapshot never carries a stale value.
    const {inFlightRequests, meltCounterValues, counter, ...rest} = snapshot
    return rest
}


/**
 * Write a counter mutation through to the SQLite authority — the PRIMARY
 * counter persistence ("W1").
 *
 * `mode: 'set'` persists an absolute value monotonically (never lowers);
 * `mode: 'bump'` advances by a relative delta. The keyset id is the entire
 * identity: NUT-13 derives from (seed, keysetId, counter), so a counter needs no
 * mint reference. This used to walk two levels up the tree for the parent Mint's
 * url — which meant a counter not yet attached to a Mint silently dropped its
 * write, and a mint-url edit orphaned the row it had been writing to.
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
 * commit cannot leave the counter behind its proofs.
 */
const persistCounter = (self: any, mode: 'set' | 'bump', value: number): void => {
    try {
        if (mode === 'set') {
            Database.setCounter(self.keyset, self.unit, value)
        } else {
            Database.bumpCounter(self.keyset, self.unit, value)
        }
    } catch (e: any) {
        log.error('[persistCounter]', 'Counter write-through failed', {
            error: e?.message,
            keyset: self.keyset,
        })
    }
}

export const MintProofsCounterModel = types
    .model('MintProofsCounter', {
        keyset: types.string,
        unit: types.optional(types.frozen<MintUnit>(), 'sat'),
    })
    // The derivation counter is mastered in SQLite (mint_counters) and kept here
    // only as an in-memory cache, hydrated from the authority on startup/resume.
    // It is VOLATILE — deliberately NOT part of the MST snapshot — so the many
    // per-derivation bumps during a wallet transaction never invalidate the root
    // snapshot, and therefore never trigger a serialize + MMKV write. It used to
    // be a persisted prop stripped to 0 in postProcessSnapshot, but MST still
    // fired onSnapshot (and thus a redundant whole-tree write) on every bump.
    // Persistence of the real value happens through the SQLite write-through in
    // the counter actions below; this field is a cache only.
    .volatile(() => ({
        counter: 0,
    }))
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
        /**
         * The mint's advertised setting for a (method, unit) pair, or undefined when
         * it does not offer that combination.
         *
         * NUT-04 (mint) and NUT-05 (melt) each advertise a flat list of method
         * settings. A payment method is just an entry in that list — `onchain`
         * (NUT-30) has no `nuts['30']` block of its own, it simply appears as
         * `{method: 'onchain', unit: 'sat', ...}`. So capability is always a
         * question about a (method, unit) pair, never about a NUT number.
         *
         * The setting also carries `min_amount` / `max_amount` (and, for onchain,
         * `options.confirmations`), which callers need for limit checks.
         */
        mintMethodSetting(method: PaymentMethod, unit: MintUnit): SwapMethod | undefined {
            return self.mintInfo?.nuts?.['4']?.methods?.find(
                m => m.method === method && m.unit === unit,
            )
        },
        meltMethodSetting(method: PaymentMethod, unit: MintUnit): SwapMethod | undefined {
            return self.mintInfo?.nuts?.['5']?.methods?.find(
                m => m.method === method && m.unit === unit,
            )
        },
        /** Does the mint advertise NUT-20 (signed mint quotes)? */
        get supportsNut20(): boolean {
            return self.mintInfo?.nuts?.['20']?.supported === true
        },
        /** True while we have never managed to cache this mint's info. */
        get hasUnknownCapabilities(): boolean {
            return !self.mintInfo
        },
    }))
    .views(self => ({
        /**
         * Can this mint MINT (topup) with `method` in `unit`?
         *
         * Two rules layered on the advertised methods:
         *
         *  - `onchain` additionally requires NUT-20. NUT-30 depends on it and the
         *    mint MUST refuse an onchain quote with no pubkey (error 20009), so an
         *    onchain method without NUT-20 is unusable to us.
         *
         *  - When capabilities are UNKNOWN (info never cached — mint offline when
         *    added, or a very old wallet entry), bolt11 is assumed supported and
         *    everything else is not. bolt11 has been the only method the wallet
         *    ever used, so assuming it exactly preserves today's behaviour and
         *    cannot strand a user with an empty menu; anything newer has to prove
         *    itself. The check is otherwise symmetric across methods.
         */
        supportsMint(method: PaymentMethod, unit: MintUnit): boolean {
            if (self.hasUnknownCapabilities) return method === 'bolt11'
            if (!self.mintMethodSetting(method, unit)) return false
            if (method === 'onchain') return self.supportsNut20
            return true
        },
        /** Can this mint MELT (pay out) with `method` in `unit`? See supportsMint. */
        supportsMelt(method: PaymentMethod, unit: MintUnit): boolean {
            if (self.hasUnknownCapabilities) return method === 'bolt11'
            if (!self.meltMethodSetting(method, unit)) return false
            // NUT-20 gates mint quotes only; melt needs no quote signature.
            return true
        },
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
        /**
         * Cache the mint's NUT-06 info, stamping the fetch time.
         *
         * The stamp is applied HERE rather than at call sites: `time` drives the
         * staleness check in WalletStore.getMint, and every caller used to pass a
         * raw GetInfoResponse through a cast, leaving `time` undefined. `now -
         * undefined` is NaN, NaN > ttl is false, so the TTL never fired and info
         * was cached forever — which is how mints kept advertising capabilities
         * they no longer had.
         */
        setMintInfo(info: GetInfoResponse) {
            self.mintInfo = {...info, time: Math.floor(Date.now() / 1000)}
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
    // Declared after the block holding setHostname so it can call it — MST types
    // `self` without the actions of its own block.
    .actions(self => ({
        /**
         * Move this mint to a new url, carrying over the state that points at it
         * BY url.
         *
         * A mint url is a network LOCATOR, not an identity — the mint here is the
         * same mint (callers confirm that by matching keysets), it just answers
         * somewhere else now. So everything addressed by the old location has to
         * follow. What follows, and what deliberately does not:
         *
         *  - proofs — repointed. `proofs.mintUrl` is how a balance is found, and it
         *    is the last denormalized copy of the url left in the schema.
         *  - transactions — nothing to do. `mint` is the url the payment happened at,
         *    a historical fact that must NOT move; `mintId` carries the identity.
         *  - derivation counters — nothing to do: keyed by keysetId, which no url
         *    edit can disturb (see MINT_COUNTERS_COLUMNS).
         *  - onchain mint quotes, open reservations — nothing to do: they reference
         *    the mint by `mintId` and resolve the live url through it at use time.
         *  - in-flight requests, melt recovery — nothing to do: they are child rows
         *    of a transaction and hold no mint reference at all; the one mint-scoped
         *    query joins through the parent's mintId.
         *
         * Validation runs through the same normalizer as `addMint`, so a rename can
         * no longer install a url that adding the same mint would have rejected.
         */
        setMintUrl(url: string) {
            // Throws AppError(VALIDATION_ERROR) on a malformed or non-https url.
            const normalized = normalizeMintUrl(url)
            const currentMintUrl = self.mintUrl

            // Renaming to the url already held (or merely its trailing-slash
            // spelling) is a no-op, not a duplicate — the check below would
            // otherwise match this very mint and reject.
            if (normalized === currentMintUrl) {
                return true
            }

            const {mintsStore, proofsStore} = getRootStore(self)

            // mintExists (normalized), not alreadyExists (literal string compare):
            // the latter misses a twin differing only by a trailing slash, which
            // would let one real mint become two Mint nodes.
            if (mintsStore.mintExists(normalized)) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint URL already exists.', {url: normalized})
            }

            proofsStore.updateMintUrl(currentMintUrl, normalized)

            self.mintUrl = normalized
            self.setHostname() // derived from mintUrl — stale until recomputed

            log.debug('[setMintUrl]', 'Mint url updated', {currentMintUrl, updatedMintUrl: normalized})

            return true
        },
     }))
    
    

export type Mint = {
    mintUrl: string   
} & Partial<Instance<typeof MintModel>>
export interface MintSnapshotOut extends SnapshotOut<typeof MintModel> {}
export interface MintSnapshotIn extends SnapshotIn<typeof MintModel> {}