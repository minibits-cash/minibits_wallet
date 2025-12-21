import {
    Instance,
    SnapshotOut,
    types,
    isStateTreeNode,
    getSnapshot,
    flow,
    isAlive,
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
import { SerializedDLEQ } from '@cashu/cashu-ts'
  
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
          let proofs = Array.from(self.proofs.values())
              .filter(p => !p.isSpent)
      
          // Default: only non-pending proofs. Explicit true returns only pending.
          const includePending = options.isPending ?? false
          proofs = proofs.filter(p => p.isPending === includePending)
      
          if (options.keysetIds?.length) {
              proofs = proofs.filter(p => options.keysetIds!.includes(p.id))
          }
      
          proofs = proofs.filter(p => p.mintUrl === mintUrl)
      
          if (options.unit) {
              proofs = proofs.filter(p => p.unit === options.unit)
          }
      
          return proofs
              .slice()
              .sort((a, b) => 
                  options.ascending ? a.amount - b.amount : b.amount - a.amount
              )
      },))
    
        // ───────────────────── ACTIONS ─────────────────────
        .actions(self => ({
            loadProofsFromDatabase: flow(function* loadProofsFromDatabase(includeSpent: boolean = false) {
                // Load all proofs we care about (unspent + pending + optionally spent)
                const proofRecords: ProofRecord[] = yield Database.getProofs(
                  true,   // includeUnspent
                  true,   // includePending
                  includeSpent
                )

                // log.trace({proofRecords})
              
                self.proofs.clear()
              
                for (const record of proofRecords) {
                  const {
                    isPending: dbIsPending,   // 0 or 1 from DB
                    isSpent: dbIsSpent,       // 0 or 1 from DB
                    dleq_e,
                    dleq_r,
                    dleq_s,
                    updatedAt,
                    ...coreProof
                  } = record
              
                  // Normalize boolean fields: 0|1|undefined → proper boolean
                  const isPending = !!dbIsPending
                  const isSpent = !!dbIsSpent
              
                  // Reconstruct DLEQ only if mandatory parts exist
                  const dleq = dleq_e && dleq_s
                    ? { e: dleq_e as string, r: dleq_r as string, s: dleq_s as string }
                    : undefined
              
                  self.proofs.put(
                    ProofModel.create({
                      ...coreProof,
                      isPending,
                      isSpent,
                      dleq,
                    })
                  )
                }
              
                log.trace('[loadProofsFromDatabase]', {
                  loaded: self.proofs.size,
                  unspent: Array.from(self.proofs.values()).filter(p => !p.isSpent && !p.isPending).length,
                  pending: Array.from(self.proofs.values()).filter(p => p.isPending).length,
                  spent: Array.from(self.proofs.values()).filter(p => p.isSpent).length,
                })
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
                    
                    if (!isAlive(proofNode)) {
                        log.error('[addOrUpdate]', 'Proof instance is not alive, aborting state update', { secret: proofNode.secret })
                        continue
                    }

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
                Database.addOrUpdateProofs(updatedProofs, isPending, isSpent)
            }
    
            log.trace('[addOrUpdate]', `Added or updated ${updatedProofs.length} ${isPending && 'pending '} ${isSpent && 'spent '} proofs`)
            return { updatedAmount, updatedProofs }
        },

        // Only call this when proofs are locally pending (ecash send, melt prepare, etc.)
        // Does NOT touch pendingByMintSecrets
        moveToPending(proofs: Proof[]) {            
            Database.addOrUpdateProofs(proofs, true, false)

            for (const p of proofs) { 
              if (!isAlive(p)) {
                log.error('[moveToPending]', 'Proof instance is not alive, aborting state update', { secret: p.secret })
                continue
              }

                p.isPending = true
                p.isSpent = false                
            }
        },

        // Only call this when mint explicitly reports PENDING state (lightning in flight)
        // This is the ONLY place that should add to pendingByMintSecrets
        registerAsPendingAtMint(proofs: Proof[]) {
            for (const p of proofs) {
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
        },

        moveToSpent(proofs: Proof[]) {
            Database.addOrUpdateProofs(proofs, false, true)

            for (const p of proofs) {
              if (!isAlive(p)) {
                log.error('[moveToSpent]', 'Proof instance is not alive, aborting state update', { secret: p.secret })
                continue
              }

              p.isPending = false
              p.isSpent = true                
            }
            // Automatically clean if any were in mint-pending list
            const secrets = new Set(proofs.map(p => p.secret))
            self.pendingByMintSecrets.replace(
              self.pendingByMintSecrets.filter(s => !secrets.has(s))
            )
        },

        revertToSpendable(proofs: Proof[]) {
            Database.addOrUpdateProofs(proofs, false, false)

            for (const p of proofs) {
              if (!isAlive(p)) {
                log.error('[revertToSpendable]', 'Proof instance is not alive, aborting state update', { secret: p.secret })
                continue
              }

              p.isPending = false
              p.isSpent = false
            }
        },

        updateMintUrl(currentMintUrl: string, updatedMintUrl: string) {
            const updateInMap = (map: typeof self.proofs) => {
                for (const proof of map.values()) {
                    if (proof.mintUrl === currentMintUrl) {
                      if (!isAlive(proof)) {
                        log.error('[revertToSpendable]', 'Proof instance is not alive, aborting state update', { secret: proof.secret })
                        continue
                      }
                      
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
      
        // Collect all unique units across all mints
        const allUnits = new Set<MintUnit>()
        for (const mint of mints) {
          if (mint.units) {
            for (const unit of mint.units) {
              allUnits.add(unit)
            }
          }
        }
      
        // Pre-seed unit maps with 0 for all known units → ensures zero values even if no proofs
        for (const unit of allUnits) {
          unitBalancesMap.set(unit, 0)
          unitPendingMap.set(unit, 0)
        }
      
        // Pre-seed mint balances (you already did this correctly)
        for (const mint of mints) {
          const zero = Object.fromEntries(
            (mint.units ?? []).map(u => [u, 0])
          ) as Record<MintUnit, number>
      
          mintBalancesMap.set(mint.mintUrl, {
            mintUrl: mint.mintUrl,
            balances: { ...zero },
          })
          mintPendingMap.set(mint.mintUrl, {
            mintUrl: mint.mintUrl,
            balances: { ...zero },
          })
        }
      
        // Now process proofs
        for (const proof of self.proofs.values()) {
          if (proof.isSpent) continue
      
          const isPending = proof.isPending
          const targetMintMap = isPending ? mintPendingMap : mintBalancesMap
          const targetUnitMap = isPending ? unitPendingMap : unitBalancesMap
      
          // Update mint-specific balance
          const mintBalance = targetMintMap.get(proof.mintUrl)
          if (mintBalance) {
            mintBalance.balances[proof.unit]! += proof.amount
          }
      
          // Update global unit balance (safe because pre-seeded)
          targetUnitMap.set(proof.unit, targetUnitMap.get(proof.unit)! + proof.amount)
        }
      
        return {
          mintBalances: Array.from(mintBalancesMap.values()),
          mintPendingBalances: Array.from(mintPendingMap.values()),
          unitBalances: Array.from(unitBalancesMap.entries()).map(([unit, unitBalance]) => ({
            unit,
            unitBalance,
          })),
          unitPendingBalances: Array.from(unitPendingMap.entries()).map(([unit, unitBalance]) => ({
            unit,
            unitBalance,
          })),
        }
      }
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
  
    // Only persist the array of pending by mint secrets (proofs are loaded from DB on app start)
    .postProcessSnapshot(snapshot => ({
      proofs: {},
      pendingByMintSecrets: snapshot.pendingByMintSecrets,
    }))
  
  export interface ProofsStore extends Instance<typeof ProofsStoreModel> {}
  export interface ProofsStoreSnapshot extends SnapshotOut<typeof ProofsStoreModel> {}