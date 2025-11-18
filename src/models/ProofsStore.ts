import {
    Instance,
    SnapshotOut,
    types,
    isStateTreeNode,
    isAlive,
    getSnapshot,
    flow,
} from 'mobx-state-tree'
import { withSetPropAction } from './helpers/withSetPropAction'
import { ProofModel, Proof, ProofRecord } from './Proof'
import { log } from '../services/logService'
import { getRootStore } from './helpers/getRootStore'
import AppError, { Err } from '../utils/AppError'
import { Mint, MintBalance, UnitBalance } from './Mint'
import { Database } from '../services'
import { MintUnit } from '../services/wallet/currency'

export const ProofsStoreModel = types
    .model('ProofsStore', {
        // Map with `secret` as key → O(1) lookup, safe delete, no duplicates
        proofs: types.map(ProofModel),
        pendingProofs: types.map(ProofModel),
        pendingByMintSecrets: types.array(types.string),
    })
    .actions(withSetPropAction)

    // ───────────────────── VIEWS ─────────────────────
    .views(self => ({
        getBySecret(secret: string, isPending = false): Proof | undefined {
            const map = isPending ? self.pendingProofs : self.proofs
            return map.get(secret)
        },

        getByTransactionId(tId: number, isPending = false): Proof[] {
            const map = isPending ? self.pendingProofs : self.proofs
            return Array.from(map.values()).filter(proof => proof.tId === tId)
        },

        alreadyExists(proof: Proof | { secret: string }, isPending = false): boolean {
            const map = isPending ? self.pendingProofs : self.proofs
            return map.has(typeof proof === 'object' ? proof.secret : proof)
        },

        getProofInstance(proof: Proof | { secret: string }, isPending = false): Proof | undefined {
            return this.getBySecret(typeof proof === 'object' ? proof.secret : proof, isPending)
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
                isPending: boolean
                unit?: MintUnit
                keysetIds?: string[]
                ascending?: boolean
            }
        ): Proof[] {
            const map = options.isPending ? self.pendingProofs : self.proofs
            let proofs = Array.from(map.values())

            // Filter by keysetIds if provided
            if (options.keysetIds && options.keysetIds.length > 0) {
                proofs = proofs.filter(p => options.keysetIds!.includes(p.id))
            }

            // Filter by mintUrl and optionally unit
            proofs = proofs.filter(p => p.mintUrl === mintUrl)
            if (options.unit) {
                proofs = proofs.filter(p => p.unit === options.unit)
            }

            // Sort ascending/descending by amount
            return proofs
                .slice()
                .sort((a, b) => (options.ascending ? a.amount - b.amount : b.amount - a.amount))
        },
    }))

    // ───────────────────── ACTIONS ─────────────────────
    .actions(self => ({
        loadProofsFromDatabase: flow(function* loadProofsFromDatabase() {
            const unspentAndPendingProofs: ProofRecord[] = yield Database.getProofs(true, true, false)

            const cleanProof = (p: ProofRecord): Proof => {
                const { isPending, isSpent, updatedAt, ...cleaned } = p
                return cleaned as Proof
            }

            // Clear current maps
            self.proofs.clear()
            self.pendingProofs.clear()

            for (const record of unspentAndPendingProofs) {
                const proof = cleanProof(record)
                const targetMap = record.isPending ? self.pendingProofs : self.proofs
                targetMap.put(ProofModel.create(proof)) // put() uses `secret` as key
            }

            log.trace('[loadProofsFromDatabase]', `Loaded ${self.proofs.size} proofs + ${self.pendingProofs.size} pending`)
        }),

        addProofs(newProofs: Proof[], isPending = false): { addedAmount: number; addedProofs: Proof[] } {
            if (newProofs.length === 0) return { addedAmount: 0, addedProofs: [] }

            const map = isPending ? self.pendingProofs : self.proofs
            let addedAmount = 0
            const addedProofs: Proof[] = []
            const unit = newProofs[0].unit

            const mintsStore = getRootStore(self).mintsStore
            const mintInstance = mintsStore.findByUrl(newProofs[0].mintUrl)

            if (!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint not found', { mintUrl: newProofs[0].mintUrl })
            }

            const proofsByKeyset = new Map<string, Proof[]>()

            for (const proof of newProofs) {
                if (self.alreadyExists(proof, isPending)) {
                    log.warn('[addProofs] Duplicate proof skipped', { secret: proof.secret })
                    continue
                }
                if (proof.unit !== unit) {
                    log.error('[addProofs] Mixed units in batch')
                    continue
                }

                // Create MST node or plain object → always use put()
                const proofNode = isStateTreeNode(proof) ? proof : ProofModel.create(proof)
                map.put(proofNode) // ← automatically uses `secret` as key

                addedAmount += proof.amount
                addedProofs.push(proofNode)

                proofsByKeyset.set(proof.id, (proofsByKeyset.get(proof.id) || []).concat(proofNode))
            }

            // Update counters
            for (const [keysetId, proofs] of proofsByKeyset) {
                if(isPending) continue // do not update counters for move to pending proofs

                const counter = mintInstance.getProofsCounterByKeysetId(keysetId)
                counter?.increaseProofsCounter(proofs.length)
            }

            if (addedProofs.length > 0) {
                Database.addOrUpdateProofs(addedProofs, isPending) // isSpent = false
            }

            log.trace('[addProofs]', `Added ${addedProofs.length} ${isPending ? 'pending ' : ''}proofs`)
            return { addedAmount, addedProofs }
        },

        removeProofs(
            proofsToRemove: Proof[] | { secret: string }[],  // allow plain objects with at least secret
            isPending = false,
            isRecoveredFromPending = false
        ) {
            const map = isPending ? self.pendingProofs : self.proofs

            const instancesToRemove = proofsToRemove
                .map((p): Proof | undefined => {
                    if (isStateTreeNode(p)) {
                        return p as Proof
                    }
                    // p is now narrowed to { secret: string }
                    return map.get((p as any).secret) ?? undefined
                })
                .filter((p): p is Proof => p !== undefined)

            if (instancesToRemove.length === 0) return

            Database.addOrUpdateProofs(
                instancesToRemove,
                false,
                isRecoveredFromPending ? false : true
            )

            for (const proof of instancesToRemove) {
                map.delete(proof.secret) // safe, automatic detach
            }

            log.trace('[removeProofs]', `${instancesToRemove.length} ${isPending ? 'pending ' : ''}proofs removed`)
        },

        addToPendingByMint(proof: Proof): boolean {
            if (self.pendingByMintSecrets.includes(proof.secret)) return false
            self.pendingByMintSecrets.push(proof.secret)
            log.trace('[addToPendingByMint]', proof.secret)
            return true
        },

        removeFromPendingByMint(proof: Proof) {
            self.pendingByMintSecrets.remove(proof.secret)
            log.trace('[removeFromPendingByMint]', proof.secret)
        },

        removeManyFromPendingByMint(secretsToRemove: string[]) {
            self.pendingByMintSecrets.replace(
                self.pendingByMintSecrets.filter(s => !secretsToRemove.includes(s))
            )
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
            updateInMap(self.pendingProofs)

            Database.updateProofsMintUrl(currentMintUrl, updatedMintUrl)
            log.trace('[updateMintUrl] Updated mint URL in proofs')
        },
    }))

    // ───────────────────── DERIVED VIEWS ─────────────────────
    .views(self => ({
        get proofsCount() { return self.proofs.size },
        get pendingProofsCount() { return self.pendingProofs.size },
        get allProofs() { return Array.from(self.proofs.values()) },
        get allPendingProofs() { return Array.from(self.pendingProofs.values()) },
    }))

    .views(self => ({
        get balances() {
            const mintBalancesMap = new Map<string, MintBalance>()
            const unitBalancesMap = new Map<MintUnit, number>()
            const mintPendingMap = new Map<string, MintBalance>()
            const unitPendingMap = new Map<MintUnit, number>()

            const mints = getRootStore(self).mintsStore.allMints

            // Initialize zero balances
            for (const mint of mints) {
                const zero = Object.fromEntries(mint.units!.map(u => [u, 0])) as Record<MintUnit, number>
                mintBalancesMap.set(mint.mintUrl, { mintUrl: mint.mintUrl, balances: { ...zero } })
                mintPendingMap.set(mint.mintUrl, { mintUrl: mint.mintUrl, balances: { ...zero } })
            }

            for (const proof of self.proofs.values()) {
                const mb = mintBalancesMap.get(proof.mintUrl)
                if (!mb) continue

                mb.balances[proof.unit]! += proof.amount
                unitBalancesMap.set(proof.unit, (unitBalancesMap.get(proof.unit) || 0) + proof.amount)
            }

            for (const proof of self.pendingProofs.values()) {
                const mb = mintPendingMap.get(proof.mintUrl)
                if (!mb) continue

                mb.balances[proof.unit]! += proof.amount
                unitPendingMap.set(proof.unit, (unitPendingMap.get(proof.unit) || 0) + proof.amount)
            }

            const balances = {
                mintBalances: Array.from(mintBalancesMap.values()),
                mintPendingBalances: Array.from(mintPendingMap.values()),
                unitBalances: Array.from(unitBalancesMap.entries()).map(([unit, unitBalance]) => ({ unit, unitBalance })),
                unitPendingBalances: Array.from(unitPendingMap.entries()).map(([unit, unitBalance]) => ({ unit, unitBalance })),
            }

            log.trace('[balances]', balances)

            return balances
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
            self.balances.unitBalances.find(b => b.unit === unit),

        getProofsSubset: (proofs: Proof[], proofsToRemove: Proof[]) => {
            const removeSecrets = new Set(proofsToRemove.map(p => p.secret))
            return proofs.filter(p => !removeSecrets.has(p.secret))
        },
    }))

    // Only persist pendingByMintSecrets (proofs are loaded from DB on startup)
    .postProcessSnapshot(snapshot => ({
        proofs: [],
        pendingProofs: [],
        pendingByMintSecrets: snapshot.pendingByMintSecrets,
    }))

export interface ProofsStore extends Instance<typeof ProofsStoreModel> {}
export interface ProofsStoreSnapshot extends SnapshotOut<typeof ProofsStoreModel> {}