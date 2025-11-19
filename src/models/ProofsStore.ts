import {
    Instance,
    SnapshotOut,
    types,
    isStateTreeNode,
    getSnapshot,
    flow,
  } from 'mobx-state-tree'
  import { withSetPropAction } from './helpers/withSetPropAction'
  import { ProofModel, Proof, ProofRecord } from './Proof' // Proof type now includes isPending/isSpent
  import { log } from '../services/logService'
  import { getRootStore } from './helpers/getRootStore'
  import AppError, { Err } from '../utils/AppError'
  import { Mint, MintBalance, UnitBalance } from './Mint'
  import { Database } from '../services'
  import { MintUnit } from '../services/wallet/currency'
import { CashuProof } from '../services/cashu/cashuUtils'
  
  export const ProofsStoreModel = types
    .model('ProofsStore', {      
      proofs: types.optional(types.map(ProofModel), {}),  
      // Only tracks secrets pending on the mint side
      pendingByMintSecrets: types.array(types.string),
    })
    .actions(withSetPropAction)
  
    // ───────────────────── VIEWS ─────────────────────
    .views(self => ({
        getBySecret(secret: string): Proof | undefined {
            return self.proofs.get(secret)
        },
    
        getByTransactionId(tId: number): Proof[] {
            return Array.from(self.proofs.values()).filter(p => p.tId === tId)
        },
    
        alreadyExists(proof: Proof | { secret: string }): boolean {
            const secret = typeof proof === 'object' ? proof.secret : proof
            return self.proofs.has(secret)
        },
    
        getProofInstance(proof: Proof | { secret: string }): Proof | undefined {
            return self.proofs.get(typeof proof === 'object' ? proof.secret : proof)
        },
    
        // Helper views
        get unspentProofs() {
            return Array.from(self.proofs.values()).filter(p => !p.isSpent)
        },
        get pendingProofs() {
            return Array.from(self.proofs.values()).filter(p => p.isPending && !p.isSpent)
        },
        get spentProofs() {
            return Array.from(self.proofs.values()).filter(p => p.isSpent)
        },
        }))
    
        .views(self => ({
        getMintFromProof(proof: Proof): Mint | undefined {
            const rootStore = getRootStore(self)
            const { mintsStore } = rootStore
    
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
            isPending?: boolean          
            unit?: MintUnit
            keysetIds?: string[]
            ascending?: boolean
            } = {}
        ): Proof[] {
            let proofs = Array.from(self.proofs.values()).filter(p => !p.isSpent)
    
            // Filter by pending
            if (options.isPending) {
            proofs = proofs.filter(p => p.isPending)
            }
    
            // Filter by keysetIds
            if (options.keysetIds && options.keysetIds.length > 0) {
            proofs = proofs.filter(p => options.keysetIds!.includes(p.id))
            }
    
            proofs = proofs.filter(p => p.mintUrl === mintUrl)

            if (options.unit) {
            proofs = proofs.filter(p => p.unit === options.unit)
            }
    
            return proofs
            .slice()
            .sort((a, b) => (options.ascending ? a.amount - b.amount : b.amount - a.amount))
        },
        }))
    
        // ───────────────────── ACTIONS ─────────────────────
        .actions(self => ({
        loadProofsFromDatabase: flow(function* loadProofsFromDatabase() {
            // Load unspent + pending (you can control via param later)
            const allProofRecords: ProofRecord[] = yield Database.getProofs(true, true, false)
    
            self.proofs.clear()
    
            for (const record of allProofRecords) {          
            const {dleq_e, dleq_r, dleq_s, updatedAt, ...withoutDleq} = record

            self.proofs.put(ProofModel.create({
                ...withoutDleq,
                dleq: record.dleq_s? {r: record.dleq_r, s: record.dleq_s as string, e: record.dleq_e as string} : undefined            
            }))
            }
    
            log.trace('[loadProofsFromDatabase]', `Loaded ${self.proofs.size} proofs (incl. spent)`)
        }),
    
        addOrUpdate(
            proofs: CashuProof[] | Proof[], 
            update: {
                mintUrl: string,
                tId: number, 
                unit: MintUnit
                isPending: boolean, 
                isSpent: boolean, 
                
        }) : { updatedAmount: number; updatedProofs: Proof[] } {

            if (proofs.length === 0) return { updatedAmount: 0, updatedProofs: [] }
    
            let updatedAmount = 0
            const updatedProofs: Proof[] = []
            const {isPending, isSpent, tId, unit, mintUrl} = update

            if(isPending === true && isSpent === true) {
                throw new AppError(Err.VALIDATION_ERROR, 'Incorrect proof update', { update })
            }
    
            const mintsStore = getRootStore(self).mintsStore
            const mintInstance = mintsStore.findByUrl(mintUrl)
    
            if (!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint not found in the wallet', { mintUrl })
            }
    
            const proofsByKeyset = new Map<string, Proof[]>()
    
            for (const proof of proofs) {

                let proofNode = self.getBySecret(proof.secret)

                if (proofNode) {
                    if(proofNode.isSpent) continue // skip update if proof is spent already

                    proofNode?.setProp('mintUrl', mintUrl)
                    proofNode?.setProp('tId', tId)
                    proofNode?.setProp('unit', unit)
                    proofNode?.setProp('isPending', isPending)
                    proofNode?.setProp('isSpent', isSpent)
                } else {                
                    proofNode = ProofModel.create({
                        ...proof,
                        mintUrl,
                        tId,
                        unit,
                        isPending,
                        isSpent
                    })
                    self.proofs.put(proofNode)
                }
    
                updatedAmount += proofNode.amount
                updatedProofs.push(proofNode)
    
                proofsByKeyset.set(proof.id, (proofsByKeyset.get(proof.id) || []).concat(proofNode))
            }
    
            // Update counters only for non-pending proofs
            if (!isPending) {
                for (const [keysetId, proofs] of proofsByKeyset) {
                    const counter = mintInstance.getProofsCounterByKeysetId(keysetId)
                    counter?.increaseProofsCounter(proofs.length)
                }
            }
    
            if (updatedProofs.length > 0) {
                Database.addOrUpdateProofs(updatedProofs, isPending, false)
            }
    
            log.trace('[addOrUpdate]', `Added or updated ${updatedProofs.length} ${isPending ? 'pending ' : ''}proofs`)
            return { updatedAmount, updatedProofs }
        },

        // Only call this when proofs are locally pending (ecash send, melt prepare, etc.)
        // Does NOT touch pendingByMintSecrets
        moveToPending(proofs: Proof[]) {
            for (const p of proofs) {
                if (!p.isSpent) {
                    p.isPending = true
                }
            }
        },

        // Only call this when mint explicitly reports PENDING state (lightning in flight)
        // This is the ONLY place that should add to pendingByMintSecrets
        registerAsPendingAtMint(proofs: Proof[]) {
            for (const p of proofs) {
                if (!p.isSpent) {
                    p.isPending = true
                }
                if (!self.pendingByMintSecrets.includes(p.secret)) {
                    self.pendingByMintSecrets.push(p.secret)
                }
            }
        },

        // Only call this when mint no longer reports PENDING (success or failure)
        unregisterFromPendingAtMint(secrets: string[] | Set<string>) {
            const set = secrets instanceof Set ? secrets : new Set(secrets)
            self.pendingByMintSecrets.replace(
            self.pendingByMintSecrets.filter(s => !set.has(s)))

            // Optionally also clear local pending flag if you want to be strict
            // (usually not needed because success → spent, failure → reverted)
            // for (const s of set) {
            //   const p = self.proofs.get(s)
            //   if (p) p.isPending = false
            // }
        },

        moveToSpent(proofs: Proof[]) {
            for (const p of proofs) {
                p.isSpent = true
                p.isPending = false
            }
            // Automatically clean if any were in mint-pending list
            const secrets = proofs.map(p => p.secret)
                self.pendingByMintSecrets.replace(
                self.pendingByMintSecrets.filter(s => !secrets.includes(s))
            )
        },

        revertToSpendable(proofs: Proof[]) {
            for (const p of proofs) {
                p.isPending = false
                p.isSpent = false
            }
        },

        updateMintUrl(currentMintUrl: string, updatedMintUrl: string) {
            const updateInMap = (map: typeof self.proofs) => {
                for (const proof of map.values()) {
                    if (proof.mintUrl === currentMintUrl) {
                        proof.setMintUrl(updatedMintUrl)
                    }
                }
            }

            updateInMap(self.proofs)

            Database.updateProofsMintUrl(currentMintUrl, updatedMintUrl)
            log.trace('[updateMintUrl] Updated mint URL in proofs')
        },
    }))
  
    // ───────────────────── DERIVED VIEWS ─────────────────────
    .views(self => ({
      get proofsCount() { return self.unspentProofs.length },
      get pendingProofsCount() { return self.pendingProofs.length },
      get spentProofsCount() { return self.spentProofs.length },
  
      get allProofs() { return self.unspentProofs },
      get allPendingProofs() { return self.pendingProofs },
      get allSpentProofs() { return self.spentProofs },
    }))
  
    .views(self => ({
      get balances() {
        const mintBalancesMap = new Map<string, MintBalance>()
        const unitBalancesMap = new Map<MintUnit, number>()
        const mintPendingMap = new Map<string, MintBalance>()
        const unitPendingMap = new Map<MintUnit, number>()
  
        const mints = getRootStore(self).mintsStore.allMints
  
        for (const mint of mints) {
          const zero = Object.fromEntries(mint.units!.map(u => [u, 0])) as Record<MintUnit, number>
          mintBalancesMap.set(mint.mintUrl, { mintUrl: mint.mintUrl, balances: { ...zero } })
          mintPendingMap.set(mint.mintUrl, { mintUrl: mint.mintUrl, balances: { ...zero } })
        }
  
        for (const proof of self.proofs.values()) {
          if (proof.isSpent) continue
  
          const targetMap = proof.isPending ? mintPendingMap : mintBalancesMap
          const targetUnitMap = proof.isPending ? unitPendingMap : unitBalancesMap
  
          const mb = targetMap.get(proof.mintUrl)
          if (mb) {
            mb.balances[proof.unit]! += proof.amount
          }
          targetUnitMap.set(proof.unit, (targetUnitMap.get(proof.unit) || 0) + proof.amount)
        }
  
        return {
          mintBalances: Array.from(mintBalancesMap.values()),
          mintPendingBalances: Array.from(mintPendingMap.values()),
          unitBalances: Array.from(unitBalancesMap.entries()).map(([unit, unitBalance]) => ({ unit, unitBalance })),
          unitPendingBalances: Array.from(unitPendingMap.entries()).map(([unit, unitBalance]) => ({ unit, unitBalance })),
        }
      },
    }))
  
    .views(self => ({
      getMintBalance: (mintUrl: string) => self.balances.mintBalances.find(b => b.mintUrl === mintUrl),
      getMintBalancesWithEnoughBalance: (amount: number, unit: MintUnit) =>
        self.balances.mintBalances
          .filter(b => (b.balances[unit] || 0) >= amount)
          .sort((a, b) => (b.balances[unit] || 0) - (a.balances[unit] || 0)),
  
      getMintBalancesWithUnit: (unit: MintUnit) =>
        self.balances.mintBalances
          .filter(b => unit in b.balances)
          .sort((a, b) => (b.balances[unit] || 0) - (a.balances[unit] || 0)),
  
      getMintBalanceWithMaxBalance: (unit: MintUnit) => {
        let max: MintBalance | undefined
        let maxAmt = -1
        for (const b of self.balances.mintBalances) {
          const amt = b.balances[unit] || 0
          if (amt > maxAmt) {
            maxAmt = amt
            max = b
          }
        }
        return max
      },
  
      getUnitBalance: (unit: MintUnit) =>
        self.balances.unitBalances.find(b => b.unit === unit) || { unit, unitBalance: 0 },
  
      getProofsSubset: (proofs: Proof[], proofsToRemove: Proof[]) => {
        const removeSecrets = new Set(proofsToRemove.map(p => p.secret))
        return proofs.filter(p => !removeSecrets.has(p.secret))
      },
    }))
  
    // Only persist the array of pending secrets (proofs themselves are in DB)
    .postProcessSnapshot(snapshot => ({
      proofs: {}, // never persist full proofs
      pendingByMintSecrets: snapshot.pendingByMintSecrets,
    }))
  
  export interface ProofsStore extends Instance<typeof ProofsStoreModel> {}
  export interface ProofsStoreSnapshot extends SnapshotOut<typeof ProofsStoreModel> {}