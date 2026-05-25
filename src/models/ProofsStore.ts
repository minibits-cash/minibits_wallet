import {
    Instance,
    SnapshotOut,
    types,
    flow,
    isAlive,
  } from 'mobx-state-tree'
  import { withSetPropAction } from './helpers/withSetPropAction'
  import { ProofModel, Proof, ProofRecord, ProofState } from './Proof'
  import { log } from '../services/logService'
  import { getRootStore } from './helpers/getRootStore'
  import AppError, { Err } from '../utils/AppError'
  import { Mint, MintBalance } from './Mint'
  import { Database } from '../services'
  import { ReservationTransactionUpdate } from '../services/sqlite'
  import { MintUnit } from '../services/wallet/currency'
  import { CashuProof } from '../services/cashu/cashuUtils'
  import { generateId } from '../utils/utils'
  import { ProofReservation } from '../services/wallet/proofReservation'

  export const ProofsStoreModel = types
    .model('ProofsStore', {
      proofs: types.optional(types.map(ProofModel), {}),
      // Tracks secrets that the mint itself reports as PENDING (lightning in-flight).
      // Distinct from proof.state === 'PENDING' (local lock): all mint-pending proofs are
      // locally PENDING, but not all locally-PENDING proofs are confirmed pending at the mint.
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

        get unspentProofs() {
            return Array.from(self.proofs.values()).filter(p => p.state === 'UNSPENT')
        },
        get pendingProofs() {
            return Array.from(self.proofs.values()).filter(p => p.state === 'PENDING')
        },
        get spentProofs() {
            return Array.from(self.proofs.values()).filter(p => p.state === 'SPENT')
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
              state?: ProofState
              unit?: MintUnit
              keysetIds?: string[]
              ascending?: boolean
          } = {}
      ): Proof[] {
          // Default to UNSPENT — the primary spendable pool
          const targetState = options.state ?? 'UNSPENT'

          let proofs = Array.from(self.proofs.values())
              .filter(p => p.state === targetState && p.mintUrl === mintUrl)

          if (options.keysetIds?.length) {
              proofs = proofs.filter(p => options.keysetIds!.includes(p.id))
          }

          if (options.unit) {
              proofs = proofs.filter(p => p.unit === options.unit)
          }

          return proofs
              .slice()
              .sort((a, b) =>
                  options.ascending ? a.amount - b.amount : b.amount - a.amount
              )
        }
      }))

        // ───────────────────── ACTIONS ─────────────────────
        .actions(self => ({
            loadProofsFromDatabase: flow(function* loadProofsFromDatabase(includeSpent: boolean = false) {
                const proofRecords: ProofRecord[] = yield Database.getProofs(
                  true,   // includeUnspent
                  true,   // includePending
                  includeSpent
                )

                self.proofs.clear()

                for (const record of proofRecords) {
                  const {
                    state,
                    dleq_e,
                    dleq_r,
                    dleq_s,
                    updatedAt,
                    ...coreProof
                  } = record

                  const dleq = dleq_e && dleq_s
                    ? { e: dleq_e as string, r: dleq_r as string, s: dleq_s as string }
                    : undefined

                  self.proofs.put(
                    ProofModel.create({
                      ...coreProof,
                      state: state ?? 'UNSPENT',
                      dleq,
                    })
                  )
                }

                log.trace('[loadProofsFromDatabase]', {
                  loaded: self.proofs.size,
                  unspent: Array.from(self.proofs.values()).filter(p => p.state === 'UNSPENT').length,
                  pending: Array.from(self.proofs.values()).filter(p => p.state === 'PENDING').length,
                  spent: Array.from(self.proofs.values()).filter(p => p.state === 'SPENT').length,
                })
              }),

        addOrUpdate(
            proofs: CashuProof[] | Proof[],
            update: {
                mintUrl: string,
                tId: number,
                unit: MintUnit
                state: ProofState,
        }): { updatedAmount: number; updatedProofs: Proof[] } {

            if (proofs.length === 0) return { updatedAmount: 0, updatedProofs: [] }

            let updatedAmount = 0
            const updatedProofs: Proof[] = []
            const { state, tId, unit, mintUrl } = update

            const mintsStore = getRootStore(self).mintsStore
            const mintInstance = mintsStore.findByUrl(mintUrl)

            if (!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint not found in the wallet', { mintUrl })
            }

            const proofsByKeyset = new Map<string, Proof[]>()

            for (const proof of proofs) {

                let proofNode = self.getBySecret(proof.secret)

                if (proofNode) {
                    if (proofNode.state === 'SPENT') continue // never move a spent proof backward

                    if (!isAlive(proofNode)) {
                        log.error('[addOrUpdate]', 'Proof instance is not alive, aborting state update', { secret: proofNode.secret })
                        continue
                    }

                    proofNode?.setProp('mintUrl', mintUrl)
                    proofNode?.setProp('tId', tId)
                    proofNode?.setProp('unit', unit)
                    proofNode?.setProp('state', state)
                } else {
                    proofNode = ProofModel.create({
                        ...proof,
                        amount: Number(proof.amount),
                        mintUrl,
                        tId,
                        unit,
                        state,
                    })
                    self.proofs.put(proofNode)
                }

                updatedAmount += proofNode.amount
                updatedProofs.push(proofNode)

                proofsByKeyset.set(proof.id, (proofsByKeyset.get(proof.id) || []).concat(proofNode))
            }

            // Increment counters only when proofs become freshly spendable
            if (state === 'UNSPENT') {
                for (const [keysetId, proofs] of proofsByKeyset) {
                    const counter = mintInstance.getProofsCounterByKeysetId(keysetId)
                    counter?.increaseProofsCounter(proofs.length)
                }
            }

            if (updatedProofs.length > 0) {
                Database.addOrUpdateProofs(updatedProofs, state)
            }

            log.trace('[addOrUpdate]', `Added or updated ${updatedProofs.length} ${state} proofs`)
            return { updatedAmount, updatedProofs }
        },

        // Lock proofs locally during an outgoing operation (send, melt prepare, etc.)
        // Does NOT touch pendingByMintSecrets — that is mint-reported pending.
        moveToPending(proofs: Proof[]) {
            const liveProofs = proofs.filter(p => isAlive(p))
            if (liveProofs.length === 0) return

            Database.addOrUpdateProofs(liveProofs, 'PENDING')

            for (const p of liveProofs) {
                p.state = 'PENDING'
            }
        },

        // Called when the mint explicitly reports PENDING (lightning in-flight).
        // Only place that adds to pendingByMintSecrets.
        registerAsPendingAtMint(proofs: Proof[]) {
            for (const p of proofs) {
              if (!self.pendingByMintSecrets.includes(p.secret)) {
                  self.pendingByMintSecrets.push(p.secret)
              }
            }
        },

        // Called when the mint no longer reports PENDING (payment settled or failed).
        unregisterFromPendingAtMint(secrets: string[] | Set<string>) {
            const set = secrets instanceof Set ? secrets : new Set(secrets)
            self.pendingByMintSecrets.replace(
            self.pendingByMintSecrets.filter(s => !set.has(s)))
        },

        moveToSpent(proofs: Proof[]) {
            const liveProofs = proofs.filter(p => isAlive(p))
            if (liveProofs.length === 0) return

            Database.addOrUpdateProofs(liveProofs, 'SPENT')

            for (const p of liveProofs) {
                p.state = 'SPENT'
            }
            // Clean mint-pending registry for any proofs that are now definitively spent
            const secrets = new Set(liveProofs.map(p => p.secret))
            self.pendingByMintSecrets.replace(
                self.pendingByMintSecrets.filter(s => !secrets.has(s))
            )
        },

        revertToSpendable(proofs: Proof[]) {
            const liveProofs = proofs.filter(p => isAlive(p))
            if (liveProofs.length === 0) return

            Database.addOrUpdateProofs(liveProofs, 'UNSPENT')

            for (const p of liveProofs) {
                p.state = 'UNSPENT'
            }
        },

        updateMintUrl(currentMintUrl: string, updatedMintUrl: string) {
            const updateInMap = (map: typeof self.proofs) => {
                for (const proof of map.values()) {
                    if (proof.mintUrl === currentMintUrl) {
                      if (!isAlive(proof)) {
                        log.error('[updateMintUrl]', 'Proof instance is not alive, aborting state update', { secret: proof.secret })
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

        // Import proofs from backup without validation or side effects
        importProofs(proofs: Proof[]) {
            for (const proof of proofs) {
                self.proofs.put(ProofModel.create(proof))
            }
            log.trace('[importProofs]', `Imported ${proofs.length} proofs from backup`)
        },

        // ─────────────────────────────────────────────────────────────
        // Proof reservations (Phase 5)
        //
        // Wraps a sequence of state transitions in a single SQLite transaction
        // with deterministic rollback. See [src/services/wallet/proofReservation.ts]
        // for usage patterns.
        // ─────────────────────────────────────────────────────────────

        /**
         * Lock `proofs` as PENDING under a new reservation id. Atomic in SQLite
         * (reservation row + state updates in one batch). MST is updated only
         * after SQLite commit succeeds.
         */
        reserve(
            proofs: Proof[],
            opts: {
                transactionId: number
                mintUrl: string
                unit: MintUnit
                operationType: string
                /**
                 * What state to restore the locked proofs to on rollback.
                 * REQUIRED — every reservation site must declare its rollback
                 * intent explicitly. This protects against silent bugs when
                 * refactoring (e.g. an earlier commit changes proof state, so
                 * the "restore current state" default would mis-rollback).
                 *
                 * - A `ProofState` value ('UNSPENT' | 'PENDING' | 'SPENT'):
                 *   restore ALL locked proofs to this state uniformly.
                 *   Use when the entire batch should reach the same state
                 *   on failure (the common case — e.g. release sent ecash
                 *   back to spendable: `'UNSPENT'`).
                 *
                 * - `'preserve'`: restore each proof to its individual state
                 *   at reserve time. Use when the batch is mixed (some
                 *   UNSPENT, some PENDING) and you literally want "undo".
                 */
                rollbackTo: ProofState | 'preserve'
            },
        ): ProofReservation {
            const liveProofs = proofs.filter(p => isAlive(p))

            const reservationId = generateId(16)
            const lockedProofs = liveProofs.map(p => ({
                secret: p.secret,
                originalState: opts.rollbackTo === 'preserve' ? p.state : opts.rollbackTo,
                originalTId: p.tId ?? null,
            }))

            // ATOMIC: write reservation row + lock proofs to PENDING in one batch.
            Database.openReservation(
                {
                    id: reservationId,
                    transactionId: opts.transactionId,
                    mintUrl: opts.mintUrl,
                    unit: opts.unit,
                    operationType: opts.operationType,
                    lockedProofs,
                },
                liveProofs,
            )

            // SQLite is durable — mirror into MST. Both state AND tId are
            // reassigned: the operation now "owns" these proofs for the
            // duration of the reservation, so any sync sweep that sees them
            // SPENT will correctly attribute the spend to opts.transactionId.
            for (const p of liveProofs) {
                if (isAlive(p) && p.state !== 'SPENT') {
                    p.setProp('state', 'PENDING')
                    p.setProp('tId', opts.transactionId)
                }
            }

            return {
                id: reservationId,
                transactionId: opts.transactionId,
                mintUrl: opts.mintUrl,
                unit: opts.unit,
                operationType: opts.operationType,
                lockedProofs,
            }
        },

        /**
         * Commit a reservation: apply final state transitions + add new proofs +
         * delete the reservation row, all in one SQLite transaction. MST is
         * mirrored after SQLite commit.
         */
        commitReservation(
            reservation: ProofReservation,
            changes: {
                toSpent?: Proof[]
                toUnspent?: Proof[]
                newProofs?: Array<{
                    proofs: CashuProof[]
                    state: ProofState
                    tId: number
                }>
                /**
                 * Atomically apply a transaction-row update inside the same
                 * SQLite batch as the proof-state finalize. Closes the
                 * proofs-table ↔ transactions-table atomicity window.
                 */
                transactionUpdate?: ReservationTransactionUpdate
            } = {},
        ): { added: Proof[] } {
            const mintsStore = getRootStore(self).mintsStore
            const mintInstance = mintsStore.findByUrl(reservation.mintUrl)
            if (!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint not found for reservation', {
                    mintUrl: reservation.mintUrl,
                    reservationId: reservation.id,
                })
            }

            // ATOMIC SQLite write of every state transition + (optional)
            // transaction-row update + reservation deletion.
            Database.commitReservation(reservation.id, {
                toSpent: changes.toSpent,
                toUnspent: changes.toUnspent,
                newProofs: changes.newProofs?.map(group => ({
                    proofs: group.proofs,
                    state: group.state,
                    mintUrl: reservation.mintUrl,
                    unit: reservation.unit,
                    tId: group.tId,
                })),
                transactionUpdate: changes.transactionUpdate,
            })

            // Mirror to MST now that SQLite is durable.
            const added: Proof[] = []

            for (const p of changes.toSpent ?? []) {
                if (isAlive(p)) p.setProp('state', 'SPENT')
            }
            for (const p of changes.toUnspent ?? []) {
                if (isAlive(p)) p.setProp('state', 'UNSPENT')
            }

            // Clean pendingByMintSecrets for anything that just became SPENT.
            if (changes.toSpent && changes.toSpent.length > 0) {
                const spentSecrets = new Set(changes.toSpent.map(p => p.secret))
                self.pendingByMintSecrets.replace(
                    self.pendingByMintSecrets.filter(s => !spentSecrets.has(s)),
                )
            }

            const proofsByKeyset = new Map<string, Proof[]>()

            for (const group of changes.newProofs ?? []) {
                for (const proof of group.proofs) {
                    const existing = self.getBySecret(proof.secret)
                    if (existing) {
                        if (existing.state === 'SPENT') continue
                        if (isAlive(existing)) {
                            existing.setProp('mintUrl', reservation.mintUrl)
                            existing.setProp('tId', group.tId)
                            existing.setProp('unit', reservation.unit)
                            existing.setProp('state', group.state)
                            added.push(existing)
                            if (group.state === 'UNSPENT') {
                                proofsByKeyset.set(
                                    proof.id,
                                    (proofsByKeyset.get(proof.id) || []).concat(existing),
                                )
                            }
                        }
                    } else {
                        const node = ProofModel.create({
                            ...proof,
                            amount: Number(proof.amount),
                            mintUrl: reservation.mintUrl,
                            tId: group.tId,
                            unit: reservation.unit,
                            state: group.state,
                        })
                        self.proofs.put(node)
                        added.push(node)
                        if (group.state === 'UNSPENT') {
                            proofsByKeyset.set(
                                proof.id,
                                (proofsByKeyset.get(proof.id) || []).concat(node),
                            )
                        }
                    }
                }
            }

            // Increment keyset counters for proofs that became freshly spendable.
            for (const [keysetId, addedProofs] of proofsByKeyset) {
                const counter = mintInstance.getProofsCounterByKeysetId(keysetId)
                counter?.increaseProofsCounter(addedProofs.length)
            }

            // Mirror the (already-durable) transaction update to MST so the
            // in-memory model reflects the new tx state immediately. Uses
            // setProp to avoid re-writing SQLite (Database.commitReservation
            // already wrote the UPDATE atomically with the proof batch).
            if (changes.transactionUpdate) {
                const tu = changes.transactionUpdate
                const transactionsStore = getRootStore(self).transactionsStore
                const tx = transactionsStore.findById(tu.id)
                if (tx && isAlive(tx)) {
                    if (tu.status !== undefined) tx.setProp('status', tu.status)
                    if (tu.data !== undefined) tx.setProp('data', tu.data)
                    if (tu.amount !== undefined) tx.setProp('amount', tu.amount)
                    if (tu.fee !== undefined) tx.setProp('fee', tu.fee)
                    if (tu.balanceAfter !== undefined) tx.setProp('balanceAfter', tu.balanceAfter)
                    if (tu.outputToken !== undefined) tx.setProp('outputToken', tu.outputToken)
                    if (tu.keysetId !== undefined) tx.setProp('keysetId', tu.keysetId)
                    if (tu.proof !== undefined) tx.setProp('proof', tu.proof)
                }
            }

            log.trace('[commitReservation] ', 'Reservation committed', {
                id: reservation.id,
                toSpent: changes.toSpent?.length ?? 0,
                toUnspent: changes.toUnspent?.length ?? 0,
                addedCount: added.length,
                txUpdate: changes.transactionUpdate?.id,
            })

            return { added }
        },

        /**
         * Rollback a reservation: restore each locked proof to its originalState
         * and delete the reservation row. Safe to call multiple times; the second
         * call is a no-op because the reservation row has already been deleted.
         */
        rollbackReservation(reservation: ProofReservation): void {
            Database.rollbackReservation(reservation.id, reservation.lockedProofs)

            // Mirror to MST: restore BOTH state and tId from the pre-reserve
            // snapshot so the proof goes back to "owned by its prior tx in its
            // prior state" — matches the SQL UPDATE done above.
            for (const snap of reservation.lockedProofs) {
                const node = self.getBySecret(snap.secret)
                if (node && isAlive(node) && node.state !== 'SPENT') {
                    node.setProp('state', snap.originalState)
                    if (snap.originalTId !== null) {
                        node.setProp('tId', snap.originalTId)
                    }
                }
            }

            log.trace('[rollbackReservation]', 'Reservation rolled back', {
                id: reservation.id,
                restored: reservation.lockedProofs.length,
            })
        },

        /**
         * Detect orphan reservations (rows left behind by a process that died
         * before it could commit or rollback) and roll each one back.
         *
         * Intended to run once at startup, after proofs have been loaded from
         * the database. Idempotent.
         */
        recoverOrphanReservations(): { recoveredCount: number } {
            const orphans = Database.getOpenReservations()
            if (orphans.length === 0) return { recoveredCount: 0 }

            log.warn(
                `[recoverOrphanReservations] Found ${orphans.length} orphan reservations — rolling back`,
            )

            for (const orphan of orphans) {
                try {
                    Database.rollbackReservation(orphan.id, orphan.lockedProofs)
                    // Mirror into MST: restore BOTH state and tId from the
                    // pre-reserve snapshot to match the SQL UPDATE above.
                    for (const snap of orphan.lockedProofs) {
                        const node = self.getBySecret(snap.secret)
                        if (node && isAlive(node) && node.state !== 'SPENT') {
                            node.setProp('state', snap.originalState)
                            if (snap.originalTId !== null) {
                                node.setProp('tId', snap.originalTId)
                            }
                        }
                    }
                } catch (e: any) {
                    log.error('[recoverOrphanReservations] rollback failed', {
                        id: orphan.id,
                        error: e.message,
                    })
                }
            }

            return { recoveredCount: orphans.length }
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

        const allUnits = new Set<MintUnit>()
        for (const mint of mints) {
          if (mint.units) {
            for (const unit of mint.units) {
              allUnits.add(unit)
            }
          }
        }

        for (const unit of allUnits) {
          unitBalancesMap.set(unit, 0)
          unitPendingMap.set(unit, 0)
        }

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

        for (const proof of self.proofs.values()) {
          if (proof.state === 'SPENT') continue

          const isPending = proof.state === 'PENDING'
          const targetMintMap = isPending ? mintPendingMap : mintBalancesMap
          const targetUnitMap = isPending ? unitPendingMap : unitBalancesMap

          const mintBalance = targetMintMap.get(proof.mintUrl)
          if (mintBalance) {
            mintBalance.balances[proof.unit]! += proof.amount
          }

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
      getMintBalance: (mintUrl: string) => self.balances.mintBalances.find(b => b.mintUrl.replace(/\/$/, '') === mintUrl.replace(/\/$/, '')),
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

    // Proofs are loaded from DB on startup; only persist the mint-pending secrets list.
    .postProcessSnapshot(snapshot => ({
      proofs: {},
      pendingByMintSecrets: snapshot.pendingByMintSecrets,
    }))

  export interface ProofsStore extends Instance<typeof ProofsStoreModel> {}
  export interface ProofsStoreSnapshot extends SnapshotOut<typeof ProofsStoreModel> {}
