import {getEncodedToken, normalizeProofAmounts} from '@cashu/cashu-ts'
import {log, logMilestone} from '../../logService'
import {Database} from '../../sqlite'
import {CashuUtils} from '../../cashu/cashuUtils'
import {rootStoreInstance} from '../../../models'
import {Mint} from '../../../models/Mint'
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
    // By id, not url: the requests are found through their transaction's mintId, so
    // a mint that has changed url still finds its own in-flight work.
    const inFlightRequests = Database.getInFlightRequestsByMintId(mint.id!)
    const totalRequests = inFlightRequests.length

    log.trace('[handleInFlightByMintTask] start', {mintUrl, totalRequests})

    if (totalRequests === 0) {
        return {
            taskFunction: HANDLE_INFLIGHT_BY_MINT_TASK,
            mintUrl,
            message: 'No in-flight requests found',
        }
    }

    const errors: string[] = []

    for (const inFlight of inFlightRequests) {

            const tx = transactionsStore.findById(inFlight.transactionId)
            if (!tx) {
                Database.removeInFlightRequest(inFlight.transactionId)
                continue
            }

            // Held by an interrupted operation: the resolver settles it and removes this
            // record. Replaying here would race it over the same inputs.
            if (proofsStore.isTransactionInterrupted(tx.id)) {
                continue
            }

            // Already resolved elsewhere (e.g. sync confirmed the proofs SPENT and finalized
            // the tx): nothing to recover. Drop the lingering in-flight request so it isn't
            // retried on every sweep.
            if (tx.status === TransactionStatus.COMPLETED || tx.status === TransactionStatus.REVERTED) {
                Database.removeInFlightRequest(inFlight.transactionId)
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

                        const receivedAmount = CashuUtils.getProofsAmount(proofs)
                        const outputToken = getEncodedToken({mint: mintUrl, proofs: normalizeProofAmounts(proofs), unit})
                        const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
                        const balanceAfter = currentSpendable + receivedAmount

                        txData.push({status: TransactionStatus.COMPLETED, receivedAmount, swapFeePaid, createdAt: new Date()})

                        // Add received proofs + complete the tx atomically (one
                        // SQLite txn, incl. the keyset counter). No inputs locked.
                        const reservation = proofsStore.reserve([], {
                            transactionId: tx.id,
                            mintUrl,
                            unit,
                            operationType: 'receive-retry',
                            rollbackTo: 'UNSPENT',
                        })
                        proofsStore.commitReservation(reservation, {
                            newProofs: [{proofs, state: 'UNSPENT', tId: tx.id}],
                            transactionUpdate: {
                                id: tx.id,
                                amount: receivedAmount,
                                status: TransactionStatus.COMPLETED,
                                data: JSON.stringify(txData),
                                outputToken,
                                balanceAfter,
                                fee: swapFeePaid > 0 ? swapFeePaid : tx.fee,
                            },
                        })

                        logMilestone('[handleInFlightByMintTask] Recovery succeeded: in-flight request replayed', {
                            type: TransactionType.RECEIVE,
                        })
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

                        const recoveredAmount = CashuUtils.getProofsAmount(proofs)
                        const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
                        const balanceAfter = currentSpendable + recoveredAmount

                        stopPolling(`handlePendingTopupPoller-${tx.paymentId}`)

                        txData.push({status: TransactionStatus.COMPLETED, createdAt: new Date()})

                        // Add minted proofs + complete the tx atomically (one
                        // SQLite txn, incl. the keyset counter). No inputs locked.
                        const reservation = proofsStore.reserve([], {
                            transactionId: tx.id,
                            mintUrl,
                            unit,
                            operationType: 'topup-retry',
                            rollbackTo: 'UNSPENT',
                        })
                        proofsStore.commitReservation(reservation, {
                            newProofs: [{proofs, state: 'UNSPENT', tId: tx.id}],
                            transactionUpdate: {
                                id: tx.id,
                                status: TransactionStatus.COMPLETED,
                                data: JSON.stringify(txData),
                                balanceAfter,
                            },
                        })

                        logMilestone('[handleInFlightByMintTask] Recovery succeeded: in-flight request replayed', {
                            type: TransactionType.TOPUP,
                        })
                        break
                    }

                    // TOPUP_ONCHAIN (mint from an onchain deposit, retry)
                    //
                    // Same hazard as TOPUP, and worse to leave unhandled: if the mint
                    // processed the request but we never saw the response, it has already
                    // counted the ecash as issued. The quote then reads as drained
                    // (amount_paid == amount_issued), the watcher stops looking at it, and
                    // the proofs are stranded. Replaying the identical request hits the
                    // mint's NUT-19 cache and returns the same signatures.
                    case TransactionType.TOPUP_ONCHAIN: {
                        const quoteRow = tx.quote
                            ? Database.getOnchainMintQuote(tx.quote)
                            : undefined

                        if (!quoteRow) {
                            log.error('[handleInFlightByMintTask] No onchain quote for tx', {
                                tId: tx.id,
                                quote: tx.quote,
                            })
                            break
                        }

                        // The signing key was never persisted — re-derive it from the seed
                        // and the quote's NUT-20 index.
                        const {deriveQuoteKeypair} = await import('../../cashu/nut20')
                        const seed: Uint8Array = await walletStore.getCachedSeed()
                        const {privkey} = deriveQuoteKeypair(seed, quoteRow.counterIndex)

                        const quoteResponse = await walletStore.checkOnchainMintQuote(
                            mintUrl,
                            quoteRow.quote,
                        )

                        const proofs = await walletStore.mintOnchainProofs(
                            mintUrl,
                            inFlight.request.amount,
                            unit,
                            quoteResponse,
                            privkey,
                            tx.id,
                            {inFlightRequest: inFlight},
                        )

                        const recoveredAmount = CashuUtils.getProofsAmount(proofs)
                        const currentSpendable =
                            proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
                        const balanceAfter = currentSpendable + recoveredAmount

                        txData.push({status: TransactionStatus.COMPLETED, createdAt: new Date()})

                        const reservation = proofsStore.reserve([], {
                            transactionId: tx.id,
                            mintUrl,
                            unit,
                            operationType: 'onchain-topup-retry',
                            rollbackTo: 'UNSPENT',
                        })
                        proofsStore.commitReservation(reservation, {
                            newProofs: [{proofs, state: 'UNSPENT', tId: tx.id}],
                            transactionUpdate: {
                                id: tx.id,
                                status: TransactionStatus.COMPLETED,
                                amount: recoveredAmount,
                                data: JSON.stringify(txData),
                                balanceAfter,
                            },
                        })

                        Database.updateOnchainMintQuoteAmounts(
                            quoteRow.quote,
                            Number(quoteResponse.amount_paid ?? 0),
                            Number(quoteResponse.amount_issued ?? 0),
                        )

                        logMilestone('[handleInFlightByMintTask] Recovery succeeded: in-flight request replayed', {
                            type: TransactionType.TOPUP_ONCHAIN,
                        })
                        break
                    }

                    // SEND / TRANSFER / TRANSFER_ONCHAIN — owned by the interrupted-operation
                    // resolver, not by replay.
                    //
                    // Their records come from swaps (an online send, a transfer's preemptive
                    // swap), which run under a reservation. When a swap's outcome is unknown —
                    // the process died, or the request failed without a mint rejection — that
                    // reservation is held and the resolver settles it: it asks the mint, and
                    // restores the outputs via NUT-09 from the counter range recorded before
                    // the request. That works without NUT-19, after the cache ttl, and after
                    // the counter was reused; a replay needs all three to hold. Held
                    // transactions are skipped above, and the resolver deletes their record.
                    //
                    // Melts are not replayed either: a lost melt response strands nothing the
                    // melt_recovery record and refresh() cannot rebuild, and replaying one
                    // risks paying twice.
                    //
                    // Reaching here means a record left by an older version, whose
                    // reservation is gone; the NUT-19 cache has expired by now, so drop it.
                    case TransactionType.SEND:
                    case TransactionType.TRANSFER:
                    case TransactionType.TRANSFER_ONCHAIN: {
                        break
                    }

                    default:
                        log.error('[handleInFlightByMintTask] Unknown tx type', {type: tx.type, tId: tx.id})
                }

                Database.removeInFlightRequest(inFlight.transactionId)

            } catch (e: any) {
                log.error(`[handleInFlightByMintTask] ${tx.type} failed`, {
                    tId: tx.id,
                    error: e.name,
                    message: e.message,
                })
                errors.push(`${tx.type} tId=${tx.id}: ${e.message}`)
            }
    }

    const totalProcessed = totalRequests

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

        if (Database.getInFlightRequestsByMintId(mint.id!).length === 0) {
            log.trace('No inFlight requests for mint, skipping...')
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
