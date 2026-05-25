import {isAlive} from 'mobx-state-tree'
import {getEncodedToken, normalizeProofAmounts} from '@cashu/cashu-ts'
import {log} from '../../logService'
import {CashuUtils} from '../../cashu/cashuUtils'
import {rootStoreInstance} from '../../../models'
import {Mint} from '../../../models/Mint'
import {Proof} from '../../../models/Proof'
import {
    TransactionData,
    TransactionStatus,
    TransactionType,
} from '../../../models/Transaction'
import {SyncQueue} from '../../syncQueueService'
import {stopPolling} from '../../../utils/poller'
import {
    HANDLE_INFLIGHT_BY_MINT_TASK,
    WalletTaskResult,
} from '../types'

const {
    mintsStore,
    proofsStore,
    transactionsStore,
    walletStore,
} = rootStoreInstance

/**
 * Recover proofs from in-flight mint/swap requests that failed due to network issues.
 * Uses mint's idempotent endpoints to safely retry and complete pending operations.
 */
const handleInFlightByMintTask = async (mint: Mint): Promise<WalletTaskResult> => {
    const mintUrl = mint.mintUrl
    const countersWithInFlight = mint.proofsCountersWithInFlightRequests || []

    log.trace('[handleInFlightByMintTask] start', {
        mintUrl,
        counters: countersWithInFlight?.length,
        totalRequests: mint.allInFlightRequests?.length ?? 0,
    })

    if (countersWithInFlight.length === 0) {
        return {
            taskFunction: HANDLE_INFLIGHT_BY_MINT_TASK,
            mintUrl,
            message: 'No in-flight requests found',
        }
    }

    const errors: string[] = []

    for (const counter of countersWithInFlight) {
        for (const inFlight of counter.allInFlightRequests) {

            if (!isAlive(inFlight)) {
                log.error('[handleInFlightByMintTask]', 'InFlightRequest is not alive', {mintUrl})
                continue
            }

            const tx = transactionsStore.findById(inFlight.transactionId)
            if (!tx) {
                counter.removeInFlightRequest(inFlight.transactionId)
                continue
            }

            let txData: TransactionData[] = []
            try {
                txData = tx.data ? JSON.parse(tx.data) : []
            } catch (e) {
                log.warn('Failed to parse transaction.data', {tId: tx.id})
            }

            const {unit} = tx

            try {
                switch (tx.type) {
                    case TransactionType.RECEIVE: {
                        const {proofs, swapFeePaid} = await walletStore.receive(
                            mintUrl,
                            unit,
                            inFlight.request.token,
                            tx.id,
                            {inFlightRequest: inFlight},
                        )

                        const {updatedAmount: receivedAmount} = proofsStore.addOrUpdate(proofs, {
                            mintUrl,
                            tId: tx.id,
                            unit,
                            state: 'UNSPENT',
                        })

                        const outputToken = getEncodedToken({mint: mintUrl, proofs: normalizeProofAmounts(proofs), unit})
                        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance

                        txData.push({status: TransactionStatus.COMPLETED, receivedAmount, swapFeePaid, createdAt: new Date()})

                        tx.update({
                            amount: receivedAmount,
                            status: TransactionStatus.COMPLETED,
                            data: JSON.stringify(txData),
                            outputToken,
                            balanceAfter,
                            fee: swapFeePaid > 0 ? swapFeePaid : tx.fee,
                        })

                        break
                    }

                    case TransactionType.SEND: {
                        // Look up the MST nodes for the persisted input proofs so
                        // they can be reserved (and atomically transitioned to
                        // SPENT below). In the common case all proofs exist and
                        // are PENDING (left by the original send that died). Edge
                        // case: a prior retry could have committed and only the
                        // tx update failed — then they're already SPENT and
                        // commit + rollback are no-ops for those entries.
                        const lockedInputs = inFlight.request.proofs
                            .map((p: {secret: string}) => proofsStore.getBySecret(p.secret))
                            .filter((p: Proof | undefined): p is Proof => !!p && isAlive(p))

                        // rollbackTo: 'preserve' keeps each input at its actual
                        // pre-reservation state on failure (PENDING stays PENDING,
                        // SPENT stays SPENT — never un-spends).
                        const reservation = proofsStore.reserve(lockedInputs, {
                            transactionId: tx.id,
                            mintUrl,
                            unit,
                            operationType: 'in-flight-send-retry',
                            rollbackTo: 'preserve',
                        })

                        try {
                            const {returnedProofs, proofsToSend, swapFeePaid} = await walletStore.send(
                                mintUrl,
                                inFlight.request.amount,
                                unit,
                                inFlight.request.proofs,
                                tx.id,
                                {inFlightRequest: inFlight},
                            )

                            // Pre-compute everything that needs to land
                            // atomically. balanceAfter: locked inputs were
                            // PENDING (contribute 0 to UNSPENT); marking SPENT
                            // changes nothing. The returnedProofs (change) are
                            // added as UNSPENT, raising spendable.
                            const outputToken = getEncodedToken({
                                mint: mintUrl,
                                proofs: normalizeProofAmounts(proofsToSend),
                                unit,
                            })
                            const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
                            const sumReturnedChange = CashuUtils.getProofsAmount(returnedProofs)
                            const balanceAfter = currentSpendable + sumReturnedChange

                            txData.push({status: TransactionStatus.PENDING, createdAt: new Date()})

                            // ATOMIC: inputs → SPENT, change → UNSPENT,
                            // proofsToSend → PENDING, tx → PENDING, reservation
                            // row deleted — single SQLite transaction.
                            proofsStore.commitReservation(reservation, {
                                toSpent: lockedInputs,
                                newProofs: [
                                    { proofs: returnedProofs, state: 'UNSPENT', tId: tx.id },
                                    { proofs: proofsToSend, state: 'PENDING', tId: tx.id },
                                ],
                                transactionUpdate: {
                                    id: tx.id,
                                    status: TransactionStatus.PENDING,
                                    data: JSON.stringify(txData),
                                    outputToken,
                                    balanceAfter,
                                    fee: swapFeePaid > 0 ? swapFeePaid : tx.fee,
                                },
                            })
                        } catch (sendError: any) {
                            // Rollback restores each input to its pre-reservation
                            // state (atomic with reservation row deletion).
                            // inFlightRequest stays in place so the next sweep
                            // retries this entry.
                            proofsStore.rollbackReservation(reservation)
                            throw sendError
                        }

                        break
                    }

                    case TransactionType.TOPUP: {
                        const proofs = await walletStore.mintProofs(
                            mintUrl,
                            inFlight.request.amount,
                            unit,
                            inFlight.request.quote,
                            tx.id,
                            {inFlightRequest: inFlight},
                        )

                        proofsStore.addOrUpdate(proofs, {
                            mintUrl,
                            tId: tx.id,
                            unit,
                            state: 'UNSPENT',
                        })

                        stopPolling(`handlePendingTopupPoller-${tx.paymentId}`)

                        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance

                        txData.push({status: TransactionStatus.COMPLETED, createdAt: new Date()})

                        tx.update({
                            status: TransactionStatus.COMPLETED,
                            data: JSON.stringify(txData),
                            balanceAfter,
                        })

                        break
                    }

                    // TRANSFER (melt / lightning out retry)
                    // COMMENTED OUT — solved by syncStateWithMintTask which recovers change
                    // from pending-yet-paid transfers. Request params (meltPreview) is stored
                    // in proofsCounter.meltCounterValues, not inFlightRequests.
                    case TransactionType.TRANSFER: {
                        break
                    }

                    default:
                        log.error('[handleInFlightByMintTask] Unknown tx type', {type: tx.type, tId: tx.id})
                }

                counter.removeInFlightRequest(inFlight.transactionId)

            } catch (e: any) {
                log.error(`[handleInFlightByMintTask] ${tx.type} failed`, {
                    tId: tx.id,
                    error: e.name,
                    message: e.message,
                })
                errors.push(`${tx.type} tId=${tx.id}: ${e.message}`)
            }
        }
    }

    const totalProcessed = mint.allInFlightRequests?.length ?? 0

    return {
        taskFunction: HANDLE_INFLIGHT_BY_MINT_TASK,
        mintUrl,
        errors,
        message: `Processed ${totalProcessed} in-flight requests (${errors.length} failed)`,
    }
}

const handleInFlightQueue = async function (): Promise<void> {
    log.trace('[handleInFlight] start')
    if (mintsStore.mintCount === 0) {
        return
    }

    for (const mint of mintsStore.allMints) {

        if (mint.proofsCountersWithInFlightRequests.length === 0) {
            log.trace('No proofCounters with inFlight requests, skipping...')
            continue
        }

        const now = new Date().getTime()

        SyncQueue.addTask(
            `${HANDLE_INFLIGHT_BY_MINT_TASK}-${now}`,
            async () => await handleInFlightByMintTask(mint),
        )
    }
}

export const InFlightOperationService = {
    handleInFlightQueue,
    handleInFlightByMintTask,
}
