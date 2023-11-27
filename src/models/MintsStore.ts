import {
  Instance,
  SnapshotOut,
  types,
  destroy,
  isStateTreeNode,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {MintModel, Mint} from './Mint'
import {log} from '../services/logService'

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
        addMint(newMint: Mint) {
            const mintInstance = MintModel.create(newMint)
            // set derived properties
            mintInstance.setHostname()
            const lastSlashIndex = newMint.mintUrl.lastIndexOf('/')
            let shortname = newMint.mintUrl.substring(lastSlashIndex + 1)

            // temporary UX fix for minibits mint
            if(shortname === 'Bitcoin') {
                shortname = 'Bitcoin (sats)'
            }

            mintInstance.setShortname(shortname)
            mintInstance.setRandomColor()

            self.mints.push(mintInstance)

            log.info('[addMint]', 'New mint added to the MintsStore', newMint.mintUrl)
        },
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
        },
        increaseProofsCounter(mintUrl: string, numberOfProofs: number) {
            const mintInstance = self.findByUrl(mintUrl)

            if(mintInstance) {
                mintInstance.increaseProofsCounter(numberOfProofs)
                return mintInstance.currentProofsCounter
            }

            log.warn('[increaseProofsCounter]', 'Could not find mint', {mintUrl})
            return 0
            
        },
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
        currentProofsCounterValue(mintUrl: string) {
            const mintInstance = self.findByUrl(mintUrl)

            if (mintInstance) {
                return mintInstance.currentProofsCounter?.counter || 0
            }

            log.warn('[currentProofsCounter]', 'Could not find mint', {mintUrl})
            return 0
        },
  }))

export interface MintsStore extends Instance<typeof MintsStoreModel> {}
export interface MintsStoreSnapshot
  extends SnapshotOut<typeof MintsStoreModel> {}
