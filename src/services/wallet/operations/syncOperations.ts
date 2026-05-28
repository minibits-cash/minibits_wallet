import {isAlive} from 'mobx-state-tree'
import {getDecodedToken} from '@cashu/cashu-ts'
import {log} from '../../logService'
import {NetworkError} from '../../../utils/AppError'
import {rootStoreInstance} from '../../../models'
import {Proof, ProofState} from '../../../models/Proof'
import {MintStatus} from '../../../models/Mint'
import {
    Transaction,
    TransactionData,
    TransactionStatus,
    TransactionType,
} from '../../../models/Transaction'
import {CashuUtils} from '../../cashu/cashuUtils'
import {SyncQueue} from '../../syncQueueService'
import {stopPolling} from '../../../utils/poller'
import {sendTask} from '../sendTask'
import {createQueueAwaitable} from '../queueHelper'
import {receiveBatchTask} from './receiveOperations'
import {SendOperationApi} from './sendOperationApi'
import {TransferOperationApi} from './transferOperationApi'
import {
    MAX_SWAP_INPUT_SIZE,
    MAX_SYNC_INPUT_SIZE,
    SWAP_ALL_TASK,
    SWAP_DENOMINATION_TASK,
    SYNC_STATE_WITH_ALL_MINTS_TASK,
    SYNC_STATE_WITH_MINT_TASK,
    SyncStateTaskResult,
    TransactionStateUpdate,
    WalletTaskResult,
} from '../types'

const {
    mintsStore,
    proofsStore,
    transactionsStore,
    walletStore,
} = rootStoreInstance

/**
 * Sync wallet proof state with mint reality (SPENT / PENDING / UNSPENT)
 * Used both for pending proof resolution and recovery of broken wallet state.
 */
const syncStateWithMintTask = async function (
    options: {
        proofsToSync: Proof[]
        mintUrl: string
        proofState: ProofState
    },
): Promise<SyncStateTaskResult> {
    const {proofsToSync, mintUrl, proofState} = options
    const mint = mintsStore.findByUrl(mintUrl)

    log.trace('[syncStateWithMintTask] start', {mintUrl, proofCount: proofsToSync.length, proofState})

    const transactionStateUpdates: TransactionStateUpdate[] = []
    const completedTxIds: number[] = []
    const errorTxIds: number[] = []
    const pendingTxIds: number[] = []
    const revertedTxIds: number[] = []

    try {
        const aliveProofs = proofsToSync.filter(p => isAlive(p))

        if (aliveProofs.length === 0) {
            const message = `No ${proofState === 'PENDING' ? 'pending ' : ''}proofs to sync with mint`
            log.trace('[syncStateWithMintTask]', message)
            return {
                taskFunction: SYNC_STATE_WITH_MINT_TASK,
                mintUrl,
                message,
                transactionStateUpdates,
                completedTransactionIds: [],
                errorTransactionIds: [],
                revertedTransactionIds: [],
            }
        }

        const statesFromMint = await walletStore.getProofsStatesFromMint(
            mintUrl,
            mint?.units?.[0] ?? 'sat',
            aliveProofs,
        )

        if (mint) mint.setStatus(MintStatus.ONLINE)

        const byMintState = {
            SPENT: statesFromMint.SPENT.map(p => p.secret),
            PENDING: statesFromMint.PENDING.map(p => p.secret),
            UNSPENT: statesFromMint.UNSPENT.map(p => p.secret),
        }

        const secrets = {
            spent: new Set(byMintState.SPENT),
            pending: new Set(byMintState.PENDING),
            unspent: new Set(byMintState.UNSPENT),
        }

        log.debug('[syncStateWithMintTask] Mint state', {
            spent: secrets.spent.size,
            pending: secrets.pending.size,
            unspent: secrets.unspent.size,
            proofState,
        })

        const groupByTId = (proofs: Proof[]) => {
            const map = new Map<number, {proofs: Proof[]; amount: number}>()
            for (const p of proofs) {
                if (!p.tId) continue
                const entry = map.get(p.tId) ?? {proofs: [], amount: 0}
                entry.proofs.push(p)
                entry.amount += p.amount
                map.set(p.tId, entry)
            }
            return map
        }

        // 1. Proofs now SPENT at mint → transaction succeeded
        //
        // Bulk-move proofs to SPENT (one SQL write for N proofs), then
        // dispatch per-tx to the appropriate operation API's `finalize`. Each
        // finalize is idempotent and sync-aware: it sees no PENDING proofs
        // left (we just bulk-moved them) and just flips the tx status, with
        // any side-effects (e.g. melt change recovery for TRANSFER) handled
        // atomically alongside the status update.
        if (secrets.spent.size > 0) {
            const spentProofs = aliveProofs.filter(p => secrets.spent.has(p.secret))
            const spentByTx = groupByTId(spentProofs)
            proofsStore.moveToSpent(spentProofs)

            for (const [tId, {amount: spentAmount}] of spentByTx) {
                const tx = transactionsStore.findById(tId)
                if (!tx) {
                    errorTxIds.push(tId)
                    transactionStateUpdates.push({
                        tId,
                        updatedStatus: TransactionStatus.ERROR,
                        message: 'Transaction not found in DB',
                    })
                    continue
                }

                if (spentAmount < tx.amount) {
                    // Partial spend has no clean lifecycle equivalent — we stamp
                    // ERROR directly and release any still-UNSPENT siblings
                    // back to the spendable pool.
                    _markErrorBySync(tx, 'Partial spend detected – proofs reused')
                    errorTxIds.push(tId)
                    transactionStateUpdates.push({
                        tId,
                        amount: tx.amount,
                        spentByMintAmount: spentAmount,
                        updatedStatus: TransactionStatus.ERROR,
                        message: 'Partial spend detected – proofs reused',
                    })

                    if (proofState === 'PENDING') {
                        const stillUnspent = aliveProofs.filter(p => secrets.unspent.has(p.secret))
                        proofsStore.revertToSpendable(stillUnspent)
                    }
                    continue
                }

                if (tx.status === TransactionStatus.REVERTED) {
                    // Reclaim already happened — leave as REVERTED.
                    continue
                }

                try {
                    await _dispatchFinalize(tx)
                    completedTxIds.push(tId)
                    transactionStateUpdates.push({
                        tId,
                        amount: tx.amount,
                        spentByMintAmount: spentAmount,
                        updatedStatus: TransactionStatus.COMPLETED,
                    })
                } catch (e: any) {
                    log.error('[syncStateWithMintTask] finalize dispatch failed', {
                        tId,
                        type: tx.type,
                        error: e.message,
                    })
                    _markErrorBySync(tx, e.message)
                    errorTxIds.push(tId)
                    transactionStateUpdates.push({
                        tId,
                        amount: tx.amount,
                        spentByMintAmount: spentAmount,
                        updatedStatus: TransactionStatus.ERROR,
                        message: `Finalize failed: ${e.message}`,
                    })
                }
            }

            if (completedTxIds.length > 0 || errorTxIds.length > 0) {
                stopPolling(`syncStateWithMintPoller-${mintUrl}`)
            }
        }

        // 2. Proofs still PENDING at mint → register as mint-pending, mark
        // owning tx PENDING. No lifecycle equivalent — this is a sub-state
        // (locally PENDING + mint-side PENDING) tracked via pendingByMintSecrets
        // so branch 3 can later detect lightning failures.
        if (secrets.pending.size > 0) {
            const newPendingProofs = aliveProofs.filter(p => secrets.pending.has(p.secret) && !proofsStore.pendingByMintSecrets.includes(p.secret))

            if (newPendingProofs.length > 0) {
                proofsStore.registerAsPendingAtMint(newPendingProofs)
                const pendingByTx = groupByTId(newPendingProofs)

                for (const [tId, {amount: pendingAmount}] of pendingByTx) {
                    if (!pendingTxIds.includes(tId)) pendingTxIds.push(tId)
                    transactionStateUpdates.push({
                        tId,
                        pendingByMintAmount: pendingAmount,
                        updatedStatus: TransactionStatus.PENDING,
                    })
                }

                if (proofState !== 'PENDING') {
                    proofsStore.moveToPending(newPendingProofs)
                }

                if (pendingTxIds.length > 0) {
                    await transactionsStore.updateStatuses(
                        pendingTxIds,
                        TransactionStatus.PENDING,
                        JSON.stringify({
                            message: 'Waiting for a payment to settle',
                            pendingStateUpdates: transactionStateUpdates.filter(u => u.updatedStatus === TransactionStatus.PENDING),
                            createdAt: new Date(),
                        }),
                    )
                }
            }
        }

        // 3. Proofs no longer pending at mint → lightning failed.
        //
        // Dispatch each affected tx to `TransferOperationApi.refresh` — its
        // UNPAID branch reverts proofs to spendable and stamps the tx
        // REVERTED. (Only TRANSFER txs ever hit this branch; melts are the
        // only operation that registers mint-pending state.)
        const noLongerPendingSecrets = proofsStore.pendingByMintSecrets.filter(
            s => !secrets.pending.has(s),
        )

        if (noLongerPendingSecrets.length > 0) {
            // Unregister all at once; per-tx refresh handles the proof revert.
            const txsToRefresh = new Map<number, number>()
            for (const secret of noLongerPendingSecrets) {
                const proof = proofsStore.getBySecret(secret)
                if (!proof || !proof.tId) continue
                txsToRefresh.set(proof.tId, (txsToRefresh.get(proof.tId) ?? 0) + proof.amount)
            }
            proofsStore.unregisterFromPendingAtMint(new Set(noLongerPendingSecrets))

            for (const [tId, amount] of txsToRefresh) {
                const tx = transactionsStore.findById(tId)
                if (!tx) continue

                if (tx.type !== TransactionType.TRANSFER) {
                    log.warn(
                        '[syncStateWithMintTask] Unexpected non-TRANSFER tx in branch 3',
                        {tId, type: tx.type},
                    )
                    continue
                }

                try {
                    await TransferOperationApi.refresh(tId)
                    if (!revertedTxIds.includes(tId)) revertedTxIds.push(tId)
                    transactionStateUpdates.push({
                        tId,
                        movedToSpendableAmount: amount,
                        updatedStatus: TransactionStatus.REVERTED,
                    })
                } catch (e: any) {
                    log.error('[syncStateWithMintTask] refresh dispatch failed', {
                        tId,
                        error: e.message,
                    })
                    _markErrorBySync(tx, e.message)
                    errorTxIds.push(tId)
                    transactionStateUpdates.push({
                        tId,
                        movedToSpendableAmount: amount,
                        updatedStatus: TransactionStatus.ERROR,
                        message: `Refresh failed: ${e.message}`,
                    })
                }
            }
        }

        return {
            taskFunction: SYNC_STATE_WITH_MINT_TASK,
            mintUrl,
            message: `Sync completed for ${aliveProofs.length} ${proofState === 'PENDING' ? 'pending ' : ''}proofs`,
            transactionStateUpdates,
            completedTransactionIds: completedTxIds,
            errorTransactionIds: errorTxIds,
            pendingTransactionIds: pendingTxIds,
            revertedTransactionIds: revertedTxIds,
        }
    } catch (e: any) {
        log.error('[syncStateWithMintTask] failed', {mintUrl, error: e.message, stack: e.stack})

        if (mint && e instanceof NetworkError) {
            mint.setStatus(MintStatus.OFFLINE)
        }

        return {
            taskFunction: SYNC_STATE_WITH_MINT_TASK,
            mintUrl,
            message: `Sync failed: ${e.message}`,
            error: e,
            transactionStateUpdates,
            completedTransactionIds: completedTxIds,
            errorTransactionIds: errorTxIds,
            pendingTransactionIds: pendingTxIds,
            revertedTransactionIds: revertedTxIds,
        }
    }
}

/**
 * Route a sync-confirmed-SPENT transaction to the appropriate operation API's
 * `finalize`. Sync has already bulk-moved the proofs to SPENT, so each
 * finalize sees an empty PENDING set and just stamps the tx COMPLETED (and,
 * for TRANSFER, recovers melt change atomically with the status update).
 *
 * Only SEND and TRANSFER are expected here — other types don't park proofs
 * in PENDING that sync could later observe as SPENT.
 */
async function _dispatchFinalize(tx: Transaction): Promise<void> {
    switch (tx.type) {
        case TransactionType.SEND:
            await SendOperationApi.finalize(tx.id)
            return
        case TransactionType.TRANSFER:
            await TransferOperationApi.finalize(tx.id)
            return
        default:
            log.warn('[syncStateWithMintTask] Unexpected tx type in finalize dispatch', {
                tId: tx.id,
                type: tx.type,
            })
    }
}

/**
 * Stamp a transaction as ERROR with the supplied reason. Used for sync's
 * type-agnostic failure paths (partial spend, finalize/refresh dispatch
 * throws) — there's no lifecycle-method equivalent for "external system
 * forced this tx into an error state."
 */
function _markErrorBySync(tx: Transaction, reason: string): void {
    let txData: TransactionData[] = []
    try { txData = JSON.parse(tx.data) } catch {}
    txData.push({
        status: TransactionStatus.ERROR,
        message: reason,
        createdAt: new Date(),
    })
    tx.update({status: TransactionStatus.ERROR, data: JSON.stringify(txData)})
}

const syncStateWithAllMintsTask = async function (options: {
    proofState: ProofState
}): Promise<SyncStateTaskResult> {
    log.trace('[syncStateWithAllMintsTask] start')
    if (mintsStore.mintCount === 0) {
        return {
            taskFunction: SYNC_STATE_WITH_ALL_MINTS_TASK,
            transactionStateUpdates: [],
            completedTransactionIds: [],
            errorTransactionIds: [],
            revertedTransactionIds: [],
            message: 'No mints',
        }
    }

    const {proofState} = options
    const maxBatchSize = MAX_SYNC_INPUT_SIZE
    const transactionStateUpdates: TransactionStateUpdate[] = []
    const completedTransactionIds: number[] = []
    const errorTransactionIds: number[] = []
    const revertedTransactionIds: number[] = []
    const errors: string[] = []

    for (const mint of mintsStore.allMints) {
        const proofsToSync = proofsStore.getByMint(mint.mintUrl, {state: proofState})
        const totalProofsCount = proofsToSync.length

        if (totalProofsCount === 0) {
            log.trace('[syncStateWithAllMintsTask] No proofs to sync, skipping...', {mint: mint.mintUrl})
            continue
        }

        if (totalProofsCount > maxBatchSize) {
            for (let i = 0; i < totalProofsCount; i += maxBatchSize) {
                const batch = proofsToSync.slice(i, i + maxBatchSize)
                const result = await syncStateWithMintTask({proofsToSync: batch, mintUrl: mint.mintUrl, proofState})

                transactionStateUpdates.push(...result.transactionStateUpdates)
                completedTransactionIds.push(...result.completedTransactionIds)
                errorTransactionIds.push(...result.errorTransactionIds)
                revertedTransactionIds.push(...result.revertedTransactionIds)

                if (result.error) {
                    errors.push(result.error.message)
                }
            }
        } else {
            const result = await syncStateWithMintTask({proofsToSync, mintUrl: mint.mintUrl, proofState})

            transactionStateUpdates.push(...result.transactionStateUpdates)
            completedTransactionIds.push(...result.completedTransactionIds)
            errorTransactionIds.push(...result.errorTransactionIds)
            revertedTransactionIds.push(...result.revertedTransactionIds)

            if (result.error) {
                errors.push(result.error.message)
            }
        }
    }

    let totalSpent = 0
    let message = ''

    for (const update of transactionStateUpdates) {
        if (update.spentByMintAmount) {
            totalSpent += update.spentByMintAmount
        }
    }

    if (proofState === 'PENDING') {
        message = 'Pending proofs were synced with the mints.'
    } else {
        message = `Sync completed with ${errors.length} errors. Spent ecash with ${totalSpent} amount was cleaned.`
    }

    return {
        taskFunction: SYNC_STATE_WITH_ALL_MINTS_TASK,
        transactionStateUpdates,
        completedTransactionIds,
        errorTransactionIds,
        revertedTransactionIds,
        errors,
        message,
    }
}

const syncStateWithAllMintsQueueAwaitable = (
    options: {proofState: ProofState},
): Promise<SyncStateTaskResult> =>
    createQueueAwaitable<SyncStateTaskResult>({
        taskFunction: 'syncSpendableStateTask',
        timeoutMessage: 'Sync all mints state timed out',
        task: () => syncStateWithAllMintsTask({proofState: options.proofState}),
    })

const syncStateWithMintQueueAwaitable = (
    options: {
        proofsToSync: Proof[]
        mintUrl: string
        proofState: ProofState
    },
): Promise<SyncStateTaskResult> => {
    log.trace('[syncStateWithMintQueueAwaitable] start', {
        mintUrl: options.mintUrl,
        proofState: options.proofState,
        proofsToSyncCount: options.proofsToSync.length,
    })

    return createQueueAwaitable<SyncStateTaskResult>({
        taskFunction: SYNC_STATE_WITH_MINT_TASK,
        prioritized: false,
        timeoutMessage: 'Sync mint state timed out',
        task: () => syncStateWithMintTask(options),
    })
}

/*
 * swapAllTask sends all proofs to pending and swaps them with the mint for standard amount preference
 * This decreases the total number of proofs held by the wallet. Used to optimize exported backup size.
 * Heavy, needs to run using the foreground service. May freeze the wallet.
 */
const swapAllTask = async function (): Promise<WalletTaskResult> {
    log.trace('[swapAllTask] start')

    if (mintsStore.mintCount === 0) {
        return {
            taskFunction: SWAP_ALL_TASK,
            message: 'No mints to swap with.',
        }
    }

    let initialProofsCount = 0
    let finalProofsCount = 0
    const errors: string[] = []
    const maxBatchSize = MAX_SWAP_INPUT_SIZE

    for (const mint of mintsStore.allMints) {
        for (const unit of mint.units) {
            const proofsToOptimize = proofsStore.getByMint(mint.mintUrl, {state: 'UNSPENT', unit, ascending: true})

            if (proofsToOptimize.length === 0) {
                continue
            }

            initialProofsCount += proofsToOptimize.length
            const mintBalance = mint.balances

            if (proofsToOptimize.length > maxBatchSize) {
                let index = 0
                for (let i = 0; i < proofsToOptimize.length; i += maxBatchSize) {
                    index++
                    const batch = proofsToOptimize.slice(i, i + maxBatchSize)
                    const batchAmount = CashuUtils.getProofsAmount(batch)

                    const sendResult = await sendTask(
                        mintBalance!,
                        batchAmount,
                        unit,
                        `Optimize ecash #${index}`,
                        batch,
                    )

                    const encodedTokenToReceive: string = sendResult.transaction?.outputToken ?? ''

                    const tokenToReceive = getDecodedToken(encodedTokenToReceive, mint.keysetIds)
                    const tokenAmount = CashuUtils.getProofsAmount(tokenToReceive.proofs)

                    const receiveResult = await receiveBatchTask(
                        tokenToReceive,
                        tokenAmount,
                        tokenToReceive.memo as string,
                        encodedTokenToReceive,
                    )

                    await syncStateWithMintTask({proofsToSync: batch, mintUrl: mint.mintUrl, proofState: 'PENDING'})

                    if (receiveResult.receivedProofsCount && receiveResult.receivedProofsCount > 0) {
                        finalProofsCount += receiveResult.receivedProofsCount
                    }

                    if (receiveResult.error) {
                        errors.push(receiveResult.error.message)
                    }
                }
            } else {
                const proofsAmount = CashuUtils.getProofsAmount(proofsToOptimize)

                const sendResult = await sendTask(
                    mintBalance!,
                    proofsAmount,
                    unit,
                    `Optimize ecash`,
                    proofsToOptimize,
                )

                const encodedTokenToReceive: string = sendResult.transaction?.outputToken ?? ''
                const tokenToReceive = getDecodedToken(encodedTokenToReceive, mint.keysetIds)
                const tokenAmount = CashuUtils.getProofsAmount(tokenToReceive.proofs)

                const receiveResult = await receiveBatchTask(
                    tokenToReceive,
                    tokenAmount,
                    tokenToReceive.memo as string,
                    encodedTokenToReceive,
                )

                if (receiveResult.receivedProofsCount && receiveResult.receivedProofsCount > 0) {
                    finalProofsCount += receiveResult.receivedProofsCount
                }

                if (receiveResult.error) {
                    errors.push(receiveResult.error.message)
                }
            }
        }
    }

    return {
        taskFunction: SWAP_ALL_TASK,
        message: `Proofs optimization completed with ${errors.length} errors. Proofs number went from ${initialProofsCount} to ${finalProofsCount}`,
        initialProofsCount,
        finalProofsCount,
        errors,
    }
}

/*
 * swapByDenominationTask swaps only proofs with the given denomination (amount)
 * for a single mint identified by mintUrl.
 */
const swapByDenominationTask = async function (
    denomination: number,
    mintUrl: string,
): Promise<WalletTaskResult> {
    log.trace('[swapByDenominationTask] start', {denomination, mintUrl})

    if (mintsStore.mintCount === 0) {
        return {
            taskFunction: SWAP_DENOMINATION_TASK,
            message: 'No mints to swap with.',
        }
    }

    const mint = mintsStore.findByUrl(mintUrl)

    if (!mint) {
        return {
            taskFunction: SWAP_DENOMINATION_TASK,
            message: `Mint ${mintUrl} not found.`,
        }
    }

    let initialProofsCount = 0
    let finalProofsCount = 0
    const errors: string[] = []
    const maxBatchSize = MAX_SWAP_INPUT_SIZE

    for (const unit of mint.units) {
        const allProofs = proofsStore.getByMint(mint.mintUrl, {state: 'UNSPENT', unit, ascending: true})
        const proofsToOptimize = allProofs.filter(p => p.amount === denomination)

        if (proofsToOptimize.length === 0) {
            continue
        }

        initialProofsCount += proofsToOptimize.length
        const mintBalance = mint.balances

        if (proofsToOptimize.length > maxBatchSize) {
            let index = 0
            for (let i = 0; i < proofsToOptimize.length; i += maxBatchSize) {
                index++
                const batch = proofsToOptimize.slice(i, i + maxBatchSize)
                const batchAmount = CashuUtils.getProofsAmount(batch)

                const sendResult = await sendTask(
                    mintBalance!,
                    batchAmount,
                    unit,
                    `Optimize denomination ${denomination} #${index}`,
                    batch,
                )

                const encodedTokenToReceive: string = sendResult.transaction?.outputToken ?? ''
                const tokenToReceive = getDecodedToken(encodedTokenToReceive, mint.keysetIds)
                const tokenAmount = CashuUtils.getProofsAmount(tokenToReceive.proofs)

                const receiveResult = await receiveBatchTask(
                    tokenToReceive,
                    tokenAmount,
                    tokenToReceive.memo as string,
                    encodedTokenToReceive,
                )

                await syncStateWithMintTask({proofsToSync: batch, mintUrl: mint.mintUrl, proofState: 'PENDING'})

                if (receiveResult.receivedProofsCount && receiveResult.receivedProofsCount > 0) {
                    finalProofsCount += receiveResult.receivedProofsCount
                }
                if (receiveResult.error) {
                    errors.push(receiveResult.error.message)
                }
            }
        } else {
            const proofsAmount = CashuUtils.getProofsAmount(proofsToOptimize)

            const sendResult = await sendTask(
                mintBalance!,
                proofsAmount,
                unit,
                `Optimize denomination ${denomination}`,
                proofsToOptimize,
            )

            const encodedTokenToReceive: string = sendResult.transaction?.outputToken ?? ''
            const tokenToReceive = getDecodedToken(encodedTokenToReceive, mint.keysetIds)
            const tokenAmount = CashuUtils.getProofsAmount(tokenToReceive.proofs)

            const receiveResult = await receiveBatchTask(
                tokenToReceive,
                tokenAmount,
                tokenToReceive.memo as string,
                encodedTokenToReceive,
            )

            await syncStateWithMintTask({proofsToSync: proofsToOptimize, mintUrl: mint.mintUrl, proofState: 'PENDING'})

            if (receiveResult.receivedProofsCount && receiveResult.receivedProofsCount > 0) {
                finalProofsCount += receiveResult.receivedProofsCount
            }
            if (receiveResult.error) {
                errors.push(receiveResult.error.message)
            }
        }
    }

    return {
        taskFunction: SWAP_DENOMINATION_TASK,
        message: `Denomination ${denomination} optimization completed with ${errors.length} errors. Proofs went from ${initialProofsCount} to ${finalProofsCount}`,
        initialProofsCount,
        finalProofsCount,
        errors,
    }
}

const swapAllQueue = async function (): Promise<void> {
    const now = new Date().getTime()
    return SyncQueue.addPrioritizedTask(
        `swapAllTask-${now}`,
        async () => await swapAllTask(),
    )
}

const swapByDenominationQueue = async function (
    denomination: number,
    mintUrl: string,
): Promise<void> {
    const now = new Date().getTime()
    return SyncQueue.addPrioritizedTask(
        `swapDenominationTask-${denomination}-${now}`,
        async () => await swapByDenominationTask(denomination, mintUrl),
    )
}

export const SyncOperationService = {
    syncStateWithAllMintsQueueAwaitable,
    syncStateWithMintQueueAwaitable,
    syncStateWithMintTask,
    swapAllQueue,
    swapByDenominationQueue,
}
