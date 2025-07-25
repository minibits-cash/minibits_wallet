import {
    Instance,
    SnapshotOut,
    types,
    isStateTreeNode,
    detach,
    flow,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {ProofModel, Proof, ProofRecord} from './Proof'
import {log} from '../services/logService'
import {getRootStore} from './helpers/getRootStore'
import AppError, {Err} from '../utils/AppError'
import {Mint, MintBalance, UnitBalance} from './Mint'
import {Database} from '../services'
import { MintUnit } from '../services/wallet/currency'


export const ProofsStoreModel = types
    .model('Proofs', {
        proofs: types.array(ProofModel),
        pendingProofs: types.array(ProofModel),
        pendingByMintSecrets: types.array(types.string),
    })
    .actions(withSetPropAction)
    .views(self => ({
        getBySecret(secret: string, isPending: boolean = false): Proof | undefined {
            const proofs = isPending ? self.pendingProofs : self.proofs
            return proofs.find(proof => proof.secret === secret) || undefined
        },
        getByTransactionId(tId: number, isPending: boolean = false): Proof[] {
            const proofs = isPending ? self.pendingProofs : self.proofs
            return proofs.filter(proof => proof.tId === tId)
        }
    }))
    .views(self => ({
        getMintFromProof(proof: Proof): Mint | undefined {
            const rootStore = getRootStore(self)
            const {mintsStore} = rootStore

            for (const mint of mintsStore.allMints) {
                for (const counter of mint.proofsCounters) {
                    if (counter.keyset === proof.id) {
                        return mint
                    }
                }
            }

            return undefined
        },
        getByMint(
            mintUrl: string,
            options: {
                isPending: boolean,
                unit?: MintUnit,                
                keysetIds?: string[]
                ascending?: boolean
            }
        ): Proof[] {
            let proofs: Proof[] = []
            if(options.keysetIds && options.keysetIds.length > 0) {
                proofs = options.isPending ? 
                    self.pendingProofs.filter(p => options.keysetIds?.includes(p.id)) : 
                    self.proofs.filter(p => options.keysetIds?.includes(p.id))
            } else {
                proofs = options.isPending ? self.pendingProofs : self.proofs
            }

            if (options.unit) {
                if(options.ascending) {
                    return proofs.filter(
                        proof => proof.mintUrl === mintUrl && 
                        proof.unit === options.unit
                    )
                    .slice()
                    .sort((a, b) => a.amount - b.amount)   
                } else {
                    return proofs.filter(
                        proof => proof.mintUrl === mintUrl && 
                        proof.unit === options.unit
                    )
                    .slice()
                    .sort((a, b) => b.amount - a.amount)   
                }                
            }

            if(options.ascending) {
                return proofs.filter(proof => proof.mintUrl === mintUrl)
                .slice()
                .sort((a, b) => a.amount - b.amount)
            } else {
                return proofs.filter(proof => proof.mintUrl === mintUrl)
                .slice()
                .sort((a, b) => b.amount - a.amount)
            }
        },        
        getProofInstance(proof: Proof, isPending: boolean = false) {
            return self.getBySecret(proof.secret, isPending)
        },
        alreadyExists(proof: Proof, isPending: boolean = false) {
            const proofs = isPending ? self.pendingProofs : self.proofs
            return proofs.some(p => p.secret === proof.secret) ? true : false
        },
    }))
    .actions(self => ({
        // Proofs are not more persisted in mmkv storage but loaded from database when hydrating the model
        loadProofsFromDatabase: flow(function* loadProofsFromDatabase() {             
            
            const unspentAndPendingProofs = yield Database.getProofs(true, true, false)
            
            // Group into isUnspent and isPending
            const groupedProofs = unspentAndPendingProofs.reduce(
                (acc: {isPending: ProofRecord[], isUnspent: ProofRecord[]}, proof: ProofRecord) => {
                if (proof.isPending) {
                    acc.isPending.push(proof);
                } else {
                    acc.isUnspent.push(proof);
                }
                return acc;
                },
                { isUnspent: [], isPending: [] } // Initialize the groups
            )

            const cleanProofs = (proofs: ProofRecord[]) => {
                return proofs.map(p => {
                    // Destructure the unwanted properties and collect the rest in `cleaned`
                    const { isPending, isSpent, updatedAt, ...cleaned } = p            
                    // Return the cleaned object
                    return cleaned as Proof
                })
            }

            self.proofs.replace(cleanProofs(groupedProofs.isUnspent))
            self.pendingProofs.replace(cleanProofs(groupedProofs.isPending))
        }),
    }))
    .actions(self => ({
        addProofs(newProofs: Proof[], isPending: boolean = false): {addedAmount: number, addedProofs: Proof[]} {
            try {
                const proofs = isPending ? self.pendingProofs : self.proofs

                if(newProofs.length === 0) {
                    log.error('[addProofs]', 'No proofs to add')
                    return {addedAmount: 0, addedProofs: []}
                }

                let addedAmount: number = 0
                let addedProofs: Proof[] = []
                const unit: MintUnit = newProofs[0].unit

                const proofsByKeysetId = new Map<string, Array<Proof>>();
        
                for (const proof of newProofs) {
                    if (!proofsByKeysetId.has(proof.id)) {
                        proofsByKeysetId.set(proof.id, []);
                    }
                    proofsByKeysetId.get(proof.id)!.push(proof);
                }
        
                // Step 2: Update counters and prepare batches for insertion
                const mintsStore = getRootStore(self).mintsStore
                const mintInstance = mintsStore.findByUrl(newProofs[0].mintUrl as string)

                if(!mintInstance) {
                    throw new AppError(Err.STORAGE_ERROR, 'Could not find mint', {mintUrl: newProofs[0].mintUrl})
                }

                for (const [keysetId, keysetProofs] of Array.from(proofsByKeysetId.entries())) {                    

                    for (const proof of keysetProofs) { 
                        if(self.alreadyExists(proof)) {
                            log.error('[addProofs]', `${isPending ? ' pending' : ''} proof with this secret already exists in the ProofsStore`, {proof})
                            continue
                        }
        
                        if(proof.unit !== unit) {
                            log.error('[addProofs]', `Proof has a different unit then others`, {proof, unit})
                            continue
                        }
        
                        if (isStateTreeNode(proof)) {
                            proofs.push(proof)                    
                        } else {
                            const proofInstance = ProofModel.create(proof)
                            proofs.push(proofInstance)
                        }

                        addedAmount += proof.amount
                        addedProofs.push(proof)
                    }
                    
                    // Find the corresponding counter for this keysetId
                    const proofsCounter = mintInstance.getProofsCounterByKeysetId(keysetId)
                    // Increment the counter by the number of proofs to insert
                    proofsCounter.increaseProofsCounter(keysetProofs.length)                    
                }        
                
                log.trace('[addProofs]', `Added new ${addedProofs.length}${isPending ? ' pending' : ''} proofs to the ProofsStore`)                           
    
                if (addedProofs.length > 0) {
                    Database.addOrUpdateProofs(addedProofs, isPending) // isSpent = false
                }
    
                return { addedAmount, addedProofs }
        
            } catch (e: any) {
                throw new AppError(Err.STORAGE_ERROR, e.message, {caller: 'addProofs'})
            }
        },
        removeProofs(proofsToRemove: Proof[], isPending: boolean = false, isRecoveredFromPending: boolean = false) {
            try {                
                const proofs = isPending ? self.pendingProofs : self.proofs
                const count = proofsToRemove.length
                
                if(isRecoveredFromPending) { 
                    Database.addOrUpdateProofs(proofsToRemove, false, false) // isPending = false, isSpent = false
                } else {
                    Database.addOrUpdateProofs(proofsToRemove, false, true) // isPending = false, isSpent = true
                }

                proofsToRemove.forEach((proof) => {
                    if (isStateTreeNode(proof)) {                        
                        detach(proof) // vital
                    } else {
                        const proofInstance = self.getProofInstance(proof, isPending)                        
                        if(proofInstance) {
                            detach(proofInstance) // vital
                        }
                    }                    
                }) 

                proofs.replace(proofs.filter(proof => !proofsToRemove.some(removed => removed.secret === proof.secret)))

                log.trace('[removeProofs]', `${count} ${(isPending) ? 'pending' : ''} proofs removed from ProofsStore`)

            } catch (e: any) {
                throw new AppError(Err.STORAGE_ERROR, e.message.toString())
            }
        },
        addToPendingByMint(proof: Proof): boolean {
            if(self.pendingByMintSecrets.some(s => s === proof.secret)) {
                return false
            }
            
            self.pendingByMintSecrets.push(proof.secret)
            log.trace('[addToPendingByMint]', 'Proof marked as pending by mint, secret', proof.secret)
            return true            
        },
        removeFromPendingByMint(proof: Proof) {
            self.pendingByMintSecrets.remove(proof.secret)
            log.trace('[removeFromPendingByMint]', 'Proof removed from pending by mint, secret', proof.secret)
        },
        removeManyFromPendingByMint(secretsToRemove: string[]) {
            const secrets = self.pendingByMintSecrets
            secrets.replace(secrets.filter(secret => !secretsToRemove.includes(secret)))
            log.trace('[removeManyFromPendingByMint]', 'Secrets removed from pending by mint', {secretsToRemove, remaining: secrets})
        },
        /* removeOnLocalRecovery(proofsToRemove: ProofV3[], isPending: boolean = false) {
            const proofs = isPending ? self.pendingProofs : self.proofs

            proofsToRemove.map((proof) => {
                const proofInstance = self.getProofInstance(proof, isPending)
                if(proofInstance) {
                    detach(proofInstance) // vital
                }                   
            }) 

            proofs.replace(proofs.filter(proof => !proofsToRemove.some(removed => removed.secret === proof.secret)))
        },*/
        updateMintUrl(currentMintUrl: string, updatedMintUrl: string) {
            log.trace('[proofStore.updateMintUrl] start')
            for (const proof of self.proofs) {
                if(proof.mintUrl === currentMintUrl) {
                    proof.setMintUrl(updatedMintUrl)                    
                }
            }

            for (const proof of self.pendingProofs) {
                if(proof.mintUrl === currentMintUrl) {
                    proof.setMintUrl(updatedMintUrl)                    
                } 
            }

            Database.updateProofsMintUrl(currentMintUrl, updatedMintUrl)
        },
    }))
    .views(self => ({
        get proofsCount() {
            return self.proofs.length
        },
        get pendingProofsCount() {
            return self.pendingProofs.length
        },
        get allProofs() {
            return self.proofs
        },
        get allPendingProofs() {
            return self.pendingProofs
        },
    }))
    .views(self => ({
        get balances() {
            const mintBalancesMap: Map<string, MintBalance> = new Map()
            const unitBalancesMap: Map<MintUnit, number> = new Map()
            const mintPendingBalancesMap: Map<string, MintBalance> = new Map()
            const unitPendingBalancesMap: Map<MintUnit, number> = new Map()

            const mints: Mint[] = getRootStore(self).mintsStore.allMints

            // make sure balances are defined even if we have no proofs
            for (const mint of mints) {
                const {mintUrl, units} = mint
                const zeroBalances = Object.fromEntries(units!.map(unit => [unit, 0])) as { [key in MintUnit]: number };                

                // make distinct copies of zeroBalances so that balances are not summed by reference!!!
                mintBalancesMap.set(mintUrl, { mintUrl, balances: JSON.parse(JSON.stringify(zeroBalances))})
                mintPendingBalancesMap.set(mintUrl, { mintUrl, balances: JSON.parse(JSON.stringify(zeroBalances))})

                for (const unit of mint.units!) {
                    unitBalancesMap.set(unit, 0)
                }
            }

            //log.trace('[getBalances] zero balances', [...mintBalancesMap.entries()])
            //log.trace('[getBalances] zero pendingBalances', [...mintPendingBalancesMap.entries()])

            //log.trace('[getBalances] proofs count', self.proofs.length)

            for (const proof of self.proofs) {
                const { mintUrl, unit, amount } = proof
        
                // Make sure to not cause madness from orphaned proofs if it would happen
                if (!mintBalancesMap.has(mintUrl)) {
                    continue
                }
        
                // Update balance for the unit
                const mintBalance = mintBalancesMap.get(mintUrl)!
                mintBalance.balances[unit] = (mintBalance.balances[unit] || 0) + amount
                unitBalancesMap.set(unit, (unitBalancesMap.get(unit) || 0) + amount)
            }
        
            const mintBalances: MintBalance[] = Array.from(mintBalancesMap.values())

            //log.trace('[getBalances] filled balances', [...mintBalancesMap.entries()])

            //log.trace('[getBalances] zero pendingBalances', [...mintPendingBalancesMap.entries()])

            // Convert map to array of UnitBalance objects
            const unitBalances: UnitBalance[]  = Array.from(unitBalancesMap.entries()).map(([unit, unitBalance]) => ({
                unitBalance,
                unit
            }))            

            for (const proof of self.pendingProofs) {
                const { mintUrl, unit, amount } = proof

                //log.trace('adding pending proof amount', proof.amount)
        
                // Make sure to not cause madness from orphaned proofs if it would happen
                if (!mintPendingBalancesMap.has(mintUrl)) {
                    continue
                }
        
                // Update balance for the unit
                const mintPendingBalance = mintPendingBalancesMap.get(mintUrl)!
                mintPendingBalance.balances[unit] = (mintPendingBalance.balances[unit] || 0) + amount
                unitPendingBalancesMap.set(unit, (unitPendingBalancesMap.get(unit) || 0) + amount)
            }

            //log.trace('[getBalances] pendingBalances', [...mintPendingBalancesMap.entries()])
        
            const mintPendingBalances: MintBalance[] = Array.from(mintPendingBalancesMap.values())

            // Convert map to array of UnitBalance objects
            const unitPendingBalances: UnitBalance[]  = Array.from(unitPendingBalancesMap.entries()).map(([unit, unitBalance]) => ({
                unitBalance,
                unit
            }))            

            const balances = {            
                mintBalances,
                mintPendingBalances,
                unitBalances,
                unitPendingBalances,  
            }
        
            // log.debug('[getBalances]', balances)
            // console.log(balances)

            return balances
        },
    }))
    .views(self => ({ // Move to MintsStore?
        getMintBalance: (mintUrl: string) => {
            const balances = self.balances.mintBalances

            const mintBalance = balances
                .find((balance: MintBalance) => balance.mintUrl === mintUrl)                

            return mintBalance
        },
        getMintBalancesWithEnoughBalance: (amount: number, unit: MintUnit) => {
            const balances = self.balances.mintBalances

            const filteredMintBalances = balances                
                .filter((balance: MintBalance) => {                    
                        if((balance.balances[unit] || 0) >= amount) {
                            return true
                        }                    
                    return false
                })
                .slice()
                .sort((a, b) => b.balances[unit]! - a.balances[unit]!)

            return filteredMintBalances
        },
        getMintBalancesWithUnit: (unit: MintUnit) => {
            const balances = self.balances.mintBalances

            const filteredMintBalances = balances                
                .filter((balance: MintBalance) => {                                            
                        if(Object.keys(balance.balances).includes(unit)) {
                            return true
                        }                    
                    return false
                })
                .slice()
                .sort((a, b) => b.balances[unit]! - a.balances[unit]!)

            return filteredMintBalances
        },
        getMintBalanceWithMaxBalance: (unit: MintUnit) => {
            const balances = self.balances.mintBalances
            let maxBalance = undefined;
            let maxAmount = -Infinity;
          
            for (const balance of balances) {
                const amount = balance.balances[unit];
                if (amount !== undefined && amount > maxAmount) {
                      maxAmount = amount;
                      maxBalance = balance;
                }
            }

            log.debug('[getMintBalanceWithMaxBalance]', {maxBalance})
            return maxBalance;
        },
        getUnitBalance: (unit: MintUnit) => {
            const balances = self.balances.unitBalances

            const unitBalance = balances
                .find((balance: UnitBalance) => balance.unit === unit)                

            return unitBalance
        },        
        getProofsSubset: (proofs: Proof[], proofsToRemove: Proof[]) => {
            // return proofs.filter(proof => !proofsToRemove.includes(proof))
            const secrets = new Set(proofsToRemove.map(p => p.secret));
            return proofs.filter(p => !secrets.has(p.secret));
        },
    })).postProcessSnapshot((snapshot) => {   // NOT persisted to storage except last pendingByMintSecrets!  
        return {
            proofs: [],
            pendingProofs: [],            
            pendingByMintSecrets: snapshot.pendingByMintSecrets
        }          
    })
    

export interface Proofs extends Instance<typeof ProofsStoreModel> {}
export interface ProofsStoreSnapshot
  extends SnapshotOut<typeof ProofsStoreModel> {}
