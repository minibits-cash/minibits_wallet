import {log} from '../logService'
import {
  Transaction,
  TransactionData,  
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuUtils, CashuProof} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {
    Mint as CashuMint,
    Wallet as CashuWallet,
    CheckStateEnum,
    MintKeyset,
    ProofState as CashuProofState,
    getEncodedToken,
    normalizeProofAmounts,
} from '@cashu/cashu-ts'
import { MAX_SWAP_INPUT_SIZE, TransactionTaskResult, WalletTask } from '../walletService'
import { Mint, MintBalance } from '../../models/Mint'
import { Proof } from '../../models/Proof'
import { poller } from '../../utils/poller'
import { WalletUtils } from './utils'
import { MintUnit } from './currency'

const {
    mintsStore,
    proofsStore,
    transactionsStore,    
    walletStore
} = rootStoreInstance

export const SEND_TASK = 'sendTask'

/**
 * Backward-compatible send task wrapper.
 *
 * This function preserves the historical `WalletTask.sendQueueAwaitable`
 * contract: a single call that creates the draft, reserves proofs, executes
 * the (optional) swap, and returns a `TransactionTaskResult` with the
 * encoded token.
 *
 * Internally it now delegates to the lifecycle API:
 *   `SendOperationApi.prepare()` (DRAFT → PREPARED, reservation opens)
 *   `SendOperationApi.execute()` (PREPARED → [EXECUTING →] PENDING, atomic commit)
 *
 * Screens that want fee preview / cancel-before-execute should call the
 * lifecycle methods directly instead of going through this wrapper.
 */
export const sendTask = async function (
    mintBalanceToSendFrom: MintBalance,
    amountToSend: number,
    unit: MintUnit,
    memo: string,
    selectedProofs: Proof[],
    p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> },
    draftTransactionId?: number | null
) : Promise<TransactionTaskResult> {

    const mintUrl = mintBalanceToSendFrom.mintUrl

    log.trace('[sendTask]', 'mintBalanceToSendFrom', mintBalanceToSendFrom)
    log.trace('[sendTask]', 'amountToSend', {amountToSend, unit})

    // Lazy import avoids a circular dep: sendOperationApi imports from
    // this file (the keyset helpers) and Phase 7 wires walletService events
    // through the same module graph.
    const {SendOperationApi} = await import('./operations/sendOperationApi')

    let transactionIdForRecovery: number | undefined

    try {
        const method = p2pk && p2pk.pubkey
            ? {method: 'p2pk' as const, options: p2pk}
            : {method: 'default' as const, options: {} as Record<string, never>}

        const prepared = await SendOperationApi.prepare({
            mintBalance: mintBalanceToSendFrom,
            amount: amountToSend,
            unit,
            memo,
            selectedProofs: selectedProofs.length > 0 ? selectedProofs : undefined,
            method,
            draftTransactionId: draftTransactionId ?? undefined,
        })
        transactionIdForRecovery = prepared.transactionId

        const pending = await SendOperationApi.execute(prepared)

        const swapFeePaid = pending.fee ?? 0
        return {
            taskFunction: SEND_TASK,
            mintUrl,
            transaction: pending,
            message: '',
            swapFeePaid,
        } as TransactionTaskResult
    } catch (e: any) {
        // Mark the tx ERROR if one was created during prepare.
        if (transactionIdForRecovery) {
            const tx = transactionsStore.findById(transactionIdForRecovery)
            if (tx) {
                let transactionData: TransactionData[] = []
                try { transactionData = JSON.parse(tx.data) } catch {}
                transactionData.push({
                    status: TransactionStatus.ERROR,
                    error: WalletUtils.formatError(e),
                    createdAt: new Date(),
                })
                tx.update({
                    status: TransactionStatus.ERROR,
                    data: JSON.stringify(transactionData),
                })
            }
            return {
                taskFunction: SEND_TASK,
                mintUrl,
                transaction: transactionsStore.findById(transactionIdForRecovery),
                message: e.message,
                error: WalletUtils.formatError(e),
            } as TransactionTaskResult
        }
        return {
            taskFunction: SEND_TASK,
            mintUrl,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}


export const prioritizeFromInactiveKeysets = function (
    mint: Mint,
    amountToSend: number,
    unit: MintUnit,
    proofsFromMint: Proof[]
) {
    let proofsToSendFrom: Proof[] = []
    const activeKeysetIds = getActiveKeysetIds(mint)
    const inactiveKeysetIds = getInactiveKeysetIds(mint)

    const proofsFromInactiveKeysets = proofsStore.getByMint(
        mint.mintUrl, {
            state: 'UNSPENT',
            unit,
            keysetIds: inactiveKeysetIds,
        }
    )

    const proofsFromActiveKeysets = proofsStore.getByMint(
        mint.mintUrl, {
            state: 'UNSPENT',
            unit,
            keysetIds: activeKeysetIds,
        }
    )

    if(proofsFromInactiveKeysets && proofsFromInactiveKeysets.length > 0) {
        let proofsFromInactiveKeysetsAmount = CashuUtils.getProofsAmount(proofsFromInactiveKeysets)

        log.trace('[prioritizeFromInactiveKeysets]', {proofsFromInactiveKeysetsAmount})

        if(proofsFromInactiveKeysetsAmount >= amountToSend) {

            proofsToSendFrom = CashuUtils.getProofsToSend(
                amountToSend,
                proofsFromInactiveKeysets
            )

        } else {
            const remainingAmount = amountToSend - proofsFromInactiveKeysetsAmount
            const remainingProofs = CashuUtils.findMinExcess(remainingAmount, proofsFromActiveKeysets!)   

            proofsToSendFrom = CashuUtils.getProofsToSend(
                amountToSend,
                [...proofsFromInactiveKeysets, ...remainingProofs]
            )
        }
    } else {
        proofsToSendFrom = CashuUtils.getProofsToSend(
            amountToSend,
            proofsFromMint
        )
    }

    return proofsToSendFrom
}


export const getActiveKeysetIds = function(mint: Mint) {
    
    if(mint.keysets) {
        return mint.keysets
        .filter((k: MintKeyset) => k.active === true)
        .map((k: MintKeyset) => k.id)
    }

    return []
}


export const getInactiveKeysetIds = function(mint: Mint) {

    if(mint.keysets) {
        return mint.keysets
        .filter((k: MintKeyset) => k.active === false)
        .map((k: MintKeyset) => k.id)
    }
    
    return []   
}
