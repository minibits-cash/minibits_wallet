import {
  Instance,
  SnapshotOut,
  types,
  destroy,
  isStateTreeNode,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {MintModel, Mint} from './Mint'
import {log} from '../utils/logger'

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
            mintInstance.setShortname(newMint.mintUrl.substring(lastSlashIndex + 1))
            mintInstance.setRandomColor()

            self.mints.push(mintInstance)

            log.info('New mint added to the MintsStore')
        },
        removeMint(mintToBeRemoved: Mint) {
            if (self.blockedMintUrls.some(m => m === mintToBeRemoved.mintUrl)) {
                self.blockedMintUrls.remove(mintToBeRemoved.mintUrl)
                log.info('Mint removed from blockedMintUrls')
            }

            let mintInstance: Mint | undefined

            if (isStateTreeNode(mintToBeRemoved)) {
                mintInstance = mintToBeRemoved
            } else {
                mintInstance = self.findByUrl((mintToBeRemoved as Mint).mintUrl)
            }

            if (mintInstance) {
                destroy(mintInstance)
                log.info('Mint removed from MintsStore')
            }
        },
        blockMint(mintToBeBlocked: Mint) {
            self.blockedMintUrls.push(mintToBeBlocked.mintUrl)
            log.info('Mint blocked in MintsStore')
        },
        unblockMint(blockedMint: Mint) {
            self.blockedMintUrls.remove(blockedMint.mintUrl)
            log.info('Mint unblocked in MintsStore')
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

                if (!grouped[hostname]) {
                grouped[hostname] = {
                    hostname,
                    mints: [],
                }
                }

                grouped[hostname].mints.push(mint)
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
