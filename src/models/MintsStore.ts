import {
    Instance,
    SnapshotOut,
    types,
    destroy,
    isStateTreeNode,
    detach,
    flow,
  } from 'mobx-state-tree'
  import {withSetPropAction} from './helpers/withSetPropAction'
  import {MintModel, Mint} from './Mint'
  import {log} from '../services/logService'
  import {Database} from '../services'
  import type {CounterSeed} from '../services/db'
  import AppError, { Err } from '../utils/AppError'
  import {
    Mint as CashuMint,
    GetKeysetsResponse,
    GetKeysResponse,
  } from '@cashu/cashu-ts'

import { MintUnit } from '../services/wallet/currency'


  
export type MintsByHostname = {
    hostname: string
    mints: Mint[]
}

export type MintsByUnit = {
    unit: MintUnit
    mints: Mint[]
}

export const MintsStoreModel = types
    .model('MintsStore', {
        mints: types.array(MintModel),
        blockedMintUrls: types.array(types.string),
    })
    // counterBackups removed: a removed mint's counters are retained in SQLite
    // (mint_counters rows are never deleted) and restored on re-add via
    // hydrateCountersFromDatabase. Strip the field from any old snapshot so
    // applySnapshot tolerates it; pre-upgrade backup values are migrated into
    // SQLite by a one-time seed in setupRootStore._runMigrations.
    .preProcessSnapshot((s: any) => {
        if (!s) return s
        const {counterBackups, ...rest} = s
        return rest
    })
    .views(self => ({
        findByUrl: (mintUrl: string | URL) => {
            const mint = self.mints.find(m => m.mintUrl === mintUrl)
            return mint ? mint : undefined
        },
        get allKeysetIds() {
            return self.mints.flatMap(m => m.keysetIds)
        },
    }))
    .actions(withSetPropAction)
    .actions(self => ({
        mintExists: (mintUrl: string | URL) => {
            const normalized = String(mintUrl).replace(/\/$/, '')
            const mint = self.mints.find(m => m.mintUrl.replace(/\/$/, '') === normalized)
            if(mint) {return true} else {return false}
        },
        /**
         * One-time copy of the in-memory (MMKV-loaded) derivation counters into
         * SQLite. Run from _runMigrations on upgrade, and on backup import.
         *
         * Two safeguards make this safe even on a device that has ALREADY
         * migrated (SQLite populated, MMKV stripped to 0, model not yet
         * re-hydrated this launch):
         *   1. only counters that have actually advanced (> 0) are seeded, so a
         *      stripped/zero value is never written; and
         *   2. the repo upsert is monotonic (MAX), so a seed can never lower an
         *      existing SQLite counter.
         */
        seedCountersToDatabase() {
            const seeds: CounterSeed[] = []

            for (const mint of self.mints) {
                for (const c of mint.proofsCounters) {
                    if (c.counter > 0) {
                        seeds.push({mintUrl: mint.mintUrl, keysetId: c.keyset, unit: c.unit, counter: c.counter})
                    }
                }
            }

            if (seeds.length > 0) {
                Database.seedCounters(seeds)
            }
        },
        /**
         * Load the authoritative counter values from SQLite into the in-memory
         * cache (startup / foreground resume). Monotonic per counter, so a value
         * already advanced in memory is never lowered.
         */
        hydrateCountersFromDatabase() {
            const rows = Database.getCounters()

            for (const row of rows) {
                const mint = self.mints.find(m => m.mintUrl === row.mintUrl)
                const counter = mint?.proofsCounters.find(c => c.keyset === row.keysetId)
                if (counter) {
                    counter.hydrateCounterFromDb(row.counter)
                }
            }
        },
    }))
    .actions(self => ({
        addMint: flow(function* addMint(mintUrl: string) {
            if(!mintUrl) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint URL is required.')
            }

            // Cashu spec: mint URL must be stripped of trailing slashes
            mintUrl = mintUrl.replace(/\/$/, '')

            if(!mintUrl.includes('.onion') && !mintUrl.startsWith('https')) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint URL needs to start with https.')
            }

            if(self.mintExists(mintUrl)) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint URL already exists.', {mintUrl})
            }

            log.trace('[addMint] start')

            const newMint = new CashuMint(mintUrl)
            // get fresh keysets
            const keySetResult: GetKeysetsResponse = yield newMint.getKeySets()
            const keysResult: GetKeysResponse = yield newMint.getKeys()
            const {keysets} = keySetResult
            const {keysets: keys} = keysResult
            
            log.trace('[addMint]', {keysets})

            if(!keysets || keysets.length === 0 || !keys || keys.length === 0) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint has no keysets and is not operational.', {mintUrl})
            }

            const mintInstance = MintModel.create({mintUrl})                              

            for(const keyset of keysets) {
                if(!keyset.unit) {
                    continue
                }

                if (!mintInstance.isUnitSupported(keyset.unit as MintUnit)) {
                    log.error('Unsupported mint unit, skipping...', {caller: 'addMint', keyset})                    
                    continue                    
                }

                mintInstance.initKeyset(keyset, self.allKeysetIds)            
            }

            for(const key of keys) {
                if(!key.unit) {
                    continue
                }

                if (!mintInstance.isUnitSupported(key.unit as MintUnit)) {                    
                    continue                    
                }

                mintInstance.initKeys(key)
            }

            mintInstance.setHostname()
            yield mintInstance.setShortname()

            self.mints.push(mintInstance)

            // SQLite retains derivation counters by (mintUrl, keysetId) across
            // mint removal (rows are never deleted), so a re-added mint recovers
            // its real counter from the authority here. Monotonic, so a genuinely
            // new mint (no row) simply stays at 0.
            self.hydrateCountersFromDatabase()

            return mintInstance
        }),
        updateMint: flow(function* updateMint(mintUrl: string) {            
            const mintInstance = self.findByUrl(mintUrl)

            if(!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Could not find mint to update', {mintUrl})
            }
            // refresh up to date mint keys
            const newMint = new CashuMint(mintUrl)
            // get fresh keysets
            const keySetResult: GetKeysetsResponse = yield newMint.getKeySets()
            const keysResult: GetKeysResponse = yield newMint.getKeys()
            const {keysets} = keySetResult
            const {keysets: keys} = keysResult       

            if(!keysets || keysets.length === 0 || !keys || keys.length === 0) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint has no keysets and is not operational', {mintUrl})
            }
            
            for(const keyset of keysets) {
                if(!keyset.unit) {
                    continue
                }

                if (!mintInstance.isUnitSupported(keyset.unit as MintUnit)) {
                    log.error('Unsupported mint usnit, skipping...', {caller: 'addMint', keyset})                    
                    continue                    
                }

                mintInstance.initKeyset(keyset, self.allKeysetIds)      
            }

            for(const key of keys) {
                if(!key.unit) {
                    continue
                }

                if (!mintInstance.isUnitSupported(key.unit as MintUnit)) {                    
                    continue                    
                }

                mintInstance.initKeys(key)                    
            }            
            
            yield mintInstance.setShortname()
            
        }),
        removeMint(mintToBeRemoved: Mint) {
            if (self.blockedMintUrls.some(m => m === mintToBeRemoved.mintUrl)) {
                self.blockedMintUrls.remove(mintToBeRemoved.mintUrl)
                log.debug('[removeMint]', 'Mint removed from blockedMintUrls')
            }

            let mintInstance: Mint | undefined

            if (isStateTreeNode(mintToBeRemoved)) {
                mintInstance = mintToBeRemoved
            } else {
                mintInstance = self.findByUrl((mintToBeRemoved as Mint).mintUrl)
            }

            if (mintInstance) {
                // No counter backup needed: the mint's mint_counters rows are
                // retained in SQLite and restored on re-add via hydrate.
                detach(mintInstance)
                destroy(mintInstance)
                log.info('[removeMint]', 'Mint removed from MintsStore')
            }
        },
        blockMint(mintToBeBlocked: Mint) {
            if(self.blockedMintUrls.some(url => url === mintToBeBlocked.mintUrl)) {
                return
            }

            self.blockedMintUrls.push(mintToBeBlocked.mintUrl)
            log.debug('[blockMint]', 'Mint blocked in MintsStore')
        },
        unblockMint(blockedMint: Mint) {
            self.blockedMintUrls.remove(blockedMint.mintUrl)
            log.debug('[unblockMint]', 'Mint unblocked in MintsStore')
        }        
    }))
    .views(self => ({
        get mintCount() {
            return self.mints.length
        },
        get allMints() {
            return self.mints
        },
        get groupedByHostname() {
            const grouped: Record<string, MintsByHostname> = {}

            self.mints.forEach((mint: Mint) => {
                const hostname = mint.hostname!

                if (!grouped[hostname as string]) {
                    grouped[hostname as string] = {
                        hostname,
                        mints: [],
                    }
                }

                grouped[hostname as string].mints.push(mint)
            })

            return Object.values(grouped) as MintsByHostname[]
        },
        get groupedByUnit() {
            const groupedByUnit: Record<string, MintsByUnit> = {}

            self.mints.forEach(mint => {
                mint.units.forEach(unit => {
                    if (!groupedByUnit[unit]) {
                        groupedByUnit[unit] = { unit, mints: [] }
                    }
                    groupedByUnit[unit].mints.push(mint)
                })
            })

            return Object.values(groupedByUnit) as MintsByUnit[]
        },
        alreadyExists(mintUrl: string) {
            return self.mints.some(m => m.mintUrl === mintUrl) ? true : false
        },
        isBlocked(mintUrl: string) {
            return self.blockedMintUrls.some(m => m === mintUrl) ? true : false
        },
        getBlockedFromList(mintUrls: string[]) {
            return mintUrls.filter(mintUrl =>
                self.blockedMintUrls.some(blockedUrl => blockedUrl === mintUrl),
            )
        },
        getMissingMints: (mintUrls: string[]) => {
            const missingMints: string[] = []
            for (const url of mintUrls) {
                if (!self.mints.find(mint => mint.mintUrl === url)) {
                missingMints.push(url)
                }
            }
            return missingMints
        },
}))
  
export interface MintsStore extends Instance<typeof MintsStoreModel> {}
export interface MintsStoreSnapshot
    extends SnapshotOut<typeof MintsStoreModel> {}