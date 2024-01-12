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
import { MINIBITS_MINT_URL } from '@env'
import { MintClient } from '../services'
import { GetInfoResponse, MintKeys } from '@cashu/cashu-ts'
import AppError, { Err } from '../utils/AppError'
import { stopPolling } from '../utils/poller'

export type MintsByHostname = {
    hostname: string
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
        getMintKeys: flow(function* getMintName(mintUrl: string) {
            const mintKeys: {
                keys: MintKeys
                keyset: string
            } = yield MintClient.getMintKeys(mintUrl)
            return mintKeys
        }),
    }))
    .actions(self => ({
        addMint: flow(function* addMint(mintUrl: string) {
            if(!mintUrl.includes('.onion') && !mintUrl.startsWith('https')) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint URL needs to start with https')
            }

            const {keys, keyset} = yield self.getMintKeys(mintUrl)            
            
            const newMint: Mint = {
                mintUrl,
                keys,
                keysets: [keyset],
            }

            const mintInstance = MintModel.create(newMint)

            mintInstance.setHostname()
            mintInstance.setRandomColor()       
            yield mintInstance.setShortname()            

            self.mints.push(mintInstance)
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

                stopPolling('checkPendingTopupsPoller')
                stopPolling('checkSpentByMintPoller')
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
