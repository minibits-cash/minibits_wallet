import {
    Instance,
    SnapshotOut,
    types,
    isStateTreeNode,
    detach,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {ProofModel, Proof} from './Proof'
import {log} from '../utils/logger'
import {getRootStore} from './helpers/getRootStore'
import AppError, {Err} from '../utils/AppError'
import {Mint, MintBalance} from './Mint'
import {Database} from '../services'

export const ProofsStoreModel = types
    .model('Proofs', {
        proofs: types.array(ProofModel),
        pendingProofs: types.array(ProofModel),
    })
    .actions(withSetPropAction)
    .views(self => ({
        getBySecret(secret: string, isPending: boolean = false): Proof | undefined {
            const proofs = isPending ? self.pendingProofs : self.proofs
            return proofs.find(proof => proof.secret === secret) || undefined
        },
    }))
    .views(self => ({
        getMintFromProof(proof: Proof): Mint | undefined {
            const rootStore = getRootStore(self)
            const {mintsStore} = rootStore

            for (const m of mintsStore.allMints) {
                if (m.keysets?.includes(proof.id)) {
                    return m
                }
            }

            return undefined
        },
        getByMint(
            mintUrl: string,
            isPending: boolean = false,
        ): Proof[] | undefined {
            const proofs = isPending ? self.pendingProofs : self.proofs
            return proofs.filter(proof => proof.mintUrl === mintUrl)
        },
        getProofInstance(proof: Proof, isPending: boolean = false) {
            let proofInstance: Proof | undefined
            if (isStateTreeNode(proof)) {
                proofInstance = proof
            } else {
                proofInstance = self.getBySecret((proof as Proof).secret, isPending)
            }

            return proofInstance
        },

    }))
    .actions(self => ({
        addProofs(newProofs: Proof[], isPending: boolean = false) {
        try {
            const proofs = isPending ? self.pendingProofs : self.proofs

            for (const proof of newProofs) {
                if (isStateTreeNode(proof)) {
                    proofs.push(proof)
                } else {
                    const proofInstance = ProofModel.create(proof)
                    proofs.push(proofInstance)
                }
            }

            log.trace(`Added new ${newProofs.length}${isPending ? ' pending' : ''} proofs to ProofsStore`,)

            const rootStore = getRootStore(self)
            const {userSettingsStore} = rootStore

            if (userSettingsStore.isLocalBackupOn === true) {
                Database.addOrUpdateProofs(newProofs, isPending) // isSpent = false
            }
        } catch (e: any) {
            throw new AppError(Err.STORAGE_ERROR, e.message)
        }
        },
        removeProofs(proofsToRemove: Proof[], isPending: boolean = false, isRecoveredFromPending: boolean = false) {
            try {                
                const proofs = isPending ? self.pendingProofs : self.proofs

                const rootStore = getRootStore(self)
                const count = proofsToRemove.length
                const {userSettingsStore} = rootStore

                if (userSettingsStore.isLocalBackupOn === true) {
                    // TODO refactor recovery to separate model method
                    if(isRecoveredFromPending) { 
                        Database.addOrUpdateProofs(proofsToRemove, false, false) // isPending = false, isSpent = false
                    } else {
                        Database.addOrUpdateProofs(proofsToRemove, false, true) // isPending = false, isSpent = true
                    }                    
                }

                proofsToRemove.map((proof) => {
                    if (isStateTreeNode(proof)) {
                        // proofInstances?.push(proof)
                        detach(proof) // vital
                    } else {
                        const proofInstance = self.getProofInstance(proof, isPending)
                        // proofInstances?.push(proofInstance as Proof)
                        detach(proofInstance) // vital
                    }                    
                }) 

                proofs.replace(proofs.filter(proof => !proofsToRemove.includes(proof)))

                log.trace(`${count} ${(isPending) ? 'pending' : ''} proofs removed from ProofsStore`)

            } catch (e: any) {
                throw new AppError(Err.STORAGE_ERROR, e.message.toString())
            }
        },
    }))
    .views(self => ({
        get proofsCount() {
            return self.proofs.length
        },
        get allProofs() {
            return self.proofs
        },
        get allPendingProofs() {
            return self.pendingProofs
        },
    }))
    .views(self => ({
        getBalances() {
            let totalBalance = 0
            let totalPendingBalance = 0

            const mints = getRootStore(self).mintsStore.allMints
            const mintBalances: MintBalance[] = mints.map(mint => {
                return {mint: mint.mintUrl, balance: 0}
            })
            const mintPendingBalances: MintBalance[] = mints.map(mint => {
                return {mint: mint.mintUrl, balance: 0}
            })

            self.proofs.forEach(proof => {
                const amount = proof.amount
                totalBalance += amount

                for (const mintBalance of mintBalances) {
                if (mintBalance.mint === proof.mintUrl) {
                    mintBalance.balance += amount
                }
                }
            })

            self.pendingProofs.forEach(proof => {
                const amount = proof.amount
                totalPendingBalance += amount

                for (const pendingBalance of mintPendingBalances) {
                if (pendingBalance.mint === proof.mintUrl) {
                    pendingBalance.balance += amount
                }
                }
            })

            const balances = {
                totalBalance,
                totalPendingBalance,
                mintBalances,
                mintPendingBalances,
            }

            log.trace(balances)

            return balances
        },
    }))
    .views(self => ({
        getMintBalancesWithEnoughBalance: (amount: number) => {
            const balances = self.getBalances().mintBalances

            const filteredMintBalances = balances
                .slice()
                .filter((balance: MintBalance) => balance.balance >= amount)
                .sort((a, b) => b.balance - a.balance)

            return filteredMintBalances
        },
        getProofsToSend: (amount: number, proofs: Proof[]) => {
            let proofsAmount = 0
            const proofSubset = proofs.filter(proof => {
                if (proofsAmount < amount) {
                proofsAmount += proof.amount
                return true
                }
            })
        return proofSubset
        },
        getProofsSubset: (proofs: Proof[], proofsToRemove: Proof[]) => {
            return proofs.filter(proof => !proofsToRemove.includes(proof))
        },
    }))


export interface Proofs extends Instance<typeof ProofsStoreModel> {}
export interface ProofsStoreSnapshot
  extends SnapshotOut<typeof ProofsStoreModel> {}
