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
  import {MintModel, Mint, MintBalance} from './Mint'
  import {log} from '../services/logService'  
  import { MintClient } from '../services'  
  import AppError, { Err } from '../utils/AppError'
  import type {
    MintKeys as CashuMintKeys, 
    MintKeyset as CashuMintKeyset
  } from '@cashu/cashu-ts'

import { MintUnit, MintUnits } from '../services/wallet/currency'
  
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
    .views(self => ({
        findByUrl: (mintUrl: string | URL) => {
            const mint = self.mints.find(m => m.mintUrl === mintUrl)
            return mint ? mint : undefined
        },
    }))
    .actions(withSetPropAction)
    .actions(self => ({
        addMint: flow(function* addMint(mintUrl: string) {
            if(!mintUrl.includes('.onion') && !mintUrl.startsWith('https')) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint URL needs to start with https.')
            }

            // create default wallet instance then download and cache up to date mint keys in that instance
            const keysets: CashuMintKeyset[] = yield MintClient.getMintKeysets(mintUrl)
            const keys: CashuMintKeys[] = yield MintClient.getMintKeys(mintUrl)                

            if(!keysets || keysets.length === 0 || !keys || keys.length === 0) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint has no keysets and is not operational.', {mintUrl})
            }

            const mintInstance = MintModel.create({mintUrl})                              

            for(const keyset of keysets) {
                if (!mintInstance.isUnitSupported(keyset.unit as MintUnit)) {                    
                    continue                    
                }

                mintInstance.initKeyset(keyset)                    
            }

            for(const key of keys) {
                if (!mintInstance.isUnitSupported(key.unit as MintUnit)) {                    
                    continue                    
                }

                mintInstance.initKeys(key)                    
            }

            mintInstance.setHostname()      
            yield mintInstance.setShortname()                
            
            self.mints.push(mintInstance)
        }),
        updateMint: flow(function* updateMint(mintUrl: string) {            
            const mintInstance = self.findByUrl(mintUrl)

            if(!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Could not find mint to update', {mintUrl})
            }
            // refresh up to date mint keys
            const keysets: CashuMintKeyset[] = yield MintClient.getMintKeysets(mintUrl)
            const keys: CashuMintKeys[] = yield MintClient.getMintKeys(mintUrl)        

            if(!keysets || keysets.length === 0 || !keys || keys.length === 0) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint has no keysets and is not operational', {mintUrl})
            }            

            for(const keyset of keysets) {
                if (!mintInstance.isUnitSupported(keyset.unit as MintUnit)) {                    
                    continue                    
                }

                mintInstance.initKeyset(keyset)          
            }

            for(const key of keys) {
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
                const {hostname} = mint

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