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

const _monitorSentProofs = async (params: {
    mintUrl: string
    proofsToSend: CashuProof[]
}) => {
    const { mintUrl, proofsToSend } = params
    const proofsToSync = proofsStore.getByMint(mintUrl, {state: 'PENDING'})
    const wsMint = new CashuMint(mintUrl)
    const wsWallet = new CashuWallet(wsMint)

    try {
        log.trace('[send] Subscribing to proofStateUpdates for sent proof', {secret: proofsToSend[0]})
        const unsub = await wsWallet.on.proofStateUpdates(
            normalizeProofAmounts([proofsToSend[0]]),
            async (proofState: CashuProofState) => {
                log.trace(`Websocket: proof state updated: ${proofState.state} with secret: ${proofsToSend[0].secret}`)
                if (proofState.state == CheckStateEnum.SPENT) {
                    WalletTask.syncStateWithMintQueueAwaitable({proofsToSync, mintUrl, proofState: 'PENDING'})
                    unsub()
                }
            },
            async (error: any) => {
                throw error
            },
        )
    } catch (error: any) {
        log.error(Err.NETWORK_ERROR,
            "Error in websocket subscription. Starting poller.",
            error.message,
        )
        poller(
            `syncStateWithMintPoller-${mintUrl}`,
            WalletTask.syncStateWithMintQueueAwaitable,
            {interval: 10 * 1000, maxPolls: 3, maxErrors: 1},
            {proofsToSend, mintUrl, isPending: true},
        )
        .then(() => log.trace('[syncStateWithMintPoller]', 'polling completed', {mintUrl}))
    }
}

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
    
    if(amountToSend <= 0) {
        throw new AppError(Err.VALIDATION_ERROR, 'Amount to send must be above zero.')
    }

    let transaction: Transaction | undefined = undefined
    let transactionData: TransactionData[] = []

    try {
        if(draftTransactionId && draftTransactionId > 0) {
            transaction = transactionsStore.findById(draftTransactionId)!
        } else {
            // create draft transaction
            transactionData.push({
                status: TransactionStatus.DRAFT,
                mintBalanceToSendFrom,
                createdAt: new Date(),
            })
            
            const newTransaction = {
                type: TransactionType.SEND,
                amount: amountToSend,
                fee: 0,
                unit,
                data: JSON.stringify(transactionData),
                memo,
                mint: mintUrl,
                status: TransactionStatus.DRAFT,
            }

            // store tx in db and in the model
            transaction = await transactionsStore.addTransaction(newTransaction)
        }   


        // get proofs to send
        const {
            proofs: proofsToSend, 
            swapFeePaid, 
            swapFeeReserve, 
            isSwapNeeded,            
        } = await sendFromMintSync(
            mintBalanceToSendFrom,
            amountToSend,
            unit,
            selectedProofs,
            transaction.id,
            p2pk
        )

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            swapFeeReserve,
            swapFeePaid,
            isSwapNeeded,
            createdAt: new Date(),
        })

        const outputToken = getEncodedToken({
            mint: mintUrl,
            proofs: normalizeProofAmounts(proofsToSend),
            unit,
            memo,
        })

        transaction.update({
            status: TransactionStatus.PREPARED,
            data: JSON.stringify(transactionData),
            outputToken
        })
        
        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance

        transactionData.push({
            status: TransactionStatus.PENDING,                      
            createdAt: new Date(),
        })
        
        transaction.update({
            status: TransactionStatus.PENDING,
            data: JSON.stringify(transactionData),
            keysetId: proofsToSend[0].id,
            balanceAfter,
            ...(swapFeePaid > 0 && {fee: swapFeePaid})
        })

        log.trace('[send] totalBalance after', balanceAfter)

        // Start monitoring for accepted payment if it is not an offline send
        if(selectedProofs.length === 0) {
            _monitorSentProofs({mintUrl, proofsToSend})
        }

        return {
            taskFunction: SEND_TASK,
            mintUrl,
            transaction,
            message: '',
            encodedTokenToSend: outputToken,
            swapFeePaid
        } as TransactionTaskResult

    } catch (e: any) {
        if (transaction) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
                createdAt: new Date()
            })

            transaction.update({
                status: TransactionStatus.ERROR,
                data: JSON.stringify(transactionData)
            })
        }        

        return {
            taskFunction: SEND_TASK,
            mintUrl,
            transaction,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}



export const sendFromMintSync = async function (
    mintBalance: MintBalance,
    amountToSend: number,
    unit: MintUnit,
    selectedProofs: Proof[],
    transactionId: number,
    p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> }
) {
    const mintUrl = mintBalance.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)

    if (!mintInstance) {
        throw new AppError(
            Err.VALIDATION_ERROR,
            'Could not find mint', {mintUrl, transactionId}
        )
    }

    const proofsFromMint = proofsStore.getByMint(mintUrl, {state: 'UNSPENT', unit})

    log.debug('[sendFromMintSync]', {
        proofsFromMintCount: proofsFromMint.length,
        mintBalance: mintBalance.balances[unit],
        amountToSend,
        transactionId,
        unit
    })

    const totalAmountFromMint = CashuUtils.getProofsAmount(proofsFromMint)

    if (totalAmountFromMint < amountToSend) {
        throw new AppError(
            Err.VALIDATION_ERROR,
            'There is not enough funds to send this amount.',
            {totalAmountFromMint, amountToSend, transactionId, caller: 'sendFromMintSync'},
        )
    }

    // ─── OFFLINE SEND ────────────────────────────────────────────────
    // User selected specific ecash; no mint interaction. Lock the selection
    // as PENDING under a reservation and commit immediately. Crash before
    // commit → orphan recovery rolls the lock back.
    const selectedProofsAmount = CashuUtils.getProofsAmount(selectedProofs)
    if (selectedProofsAmount > 0) {
        if (amountToSend !== selectedProofsAmount) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Requested amount to send does not equal sum of ecash denominations provided.',
                {transactionId}
            )
        }

        if (selectedProofs.length > MAX_SWAP_INPUT_SIZE) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                `Number of proofs is above max of ${MAX_SWAP_INPUT_SIZE}. Visit Settings > Backup to optimize, then try again.`,
                {transactionId}
            )
        }

        const reservation = proofsStore.reserve(selectedProofs, {
            transactionId,
            mintUrl,
            unit,
            operationType: 'send-offline',
            rollbackTo: 'UNSPENT',
        })

        try {
            // Commit with empty changes: deletes the reservation row, proofs
            // stay PENDING (sent ecash remains locked until redeemed/reverted).
            proofsStore.commitReservation(reservation)

            return {
                proofs: CashuUtils.exportProofs(selectedProofs),
                swapFeeReserve: 0,
                swapFeePaid: 0,
            }
        } catch (e: any) {
            proofsStore.rollbackReservation(reservation)
            throw e
        }
    }

    // ─── ONLINE SEND (auto-selected proofs, optional mint swap) ──────
    let proofsToSendFrom: Proof[] = []
    let proofsToSend: CashuProof[] | Proof[] = []

    // Prioritize send from inactive keysets
    const inactiveKeysetIds = getInactiveKeysetIds(mintInstance)
    const activeKeysetIds = getActiveKeysetIds(mintInstance)

    log.trace('[sendFromMintSync]', {inactiveKeysetIds, activeKeysetIds})

    if (inactiveKeysetIds.length > 0) {
        proofsToSendFrom = prioritizeFromInactiveKeysets(
            mintInstance,
            amountToSend,
            unit,
            proofsFromMint
        )
    } else {
        proofsToSendFrom = CashuUtils.getProofsToSend(
            amountToSend,
            proofsFromMint
        )
    }

    let proofsToSendFromAmount = CashuUtils.getProofsAmount(proofsToSendFrom)
    let swapFeeReserve: number = 0
    let returnedAmount = 0
    let swapFeePaid: number = 0
    let returnedProofs: CashuProof[] = []
    let isSwapNeeded: boolean = false

    if ((p2pk && p2pk.pubkey) || proofsToSendFromAmount - amountToSend > 0) {
        isSwapNeeded = true
    }

    log.trace('[sendFromMintSync]', {proofsToSendFromAmount, amountToSend})

    // Re-select inputs if a swap fee will be needed (must happen BEFORE
    // opening the reservation so we lock the right set).
    if (isSwapNeeded) {
        const walletInstance = await walletStore.getWallet(mintUrl, unit, {withSeed: true}) as CashuWallet
        swapFeeReserve = walletInstance.getFeesForProofs(proofsToSendFrom).toNumber()
        const amountWithFees = amountToSend + swapFeeReserve

        if (totalAmountFromMint < amountWithFees) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'There is not enough funds to send this amount.',
                {totalAmountFromMint, amountWithFees, transactionId, caller: 'sendFromMintSync'},
            )
        }

        if (swapFeeReserve > 0) {
            proofsToSendFrom = CashuUtils.getProofsToSend(
                amountWithFees,
                proofsFromMint
            )
            proofsToSendFromAmount = CashuUtils.getProofsAmount(proofsToSendFrom)
        }

        returnedAmount = proofsToSendFromAmount - (amountToSend + swapFeeReserve)
    } else {
        if (proofsToSendFrom.length > MAX_SWAP_INPUT_SIZE) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                `Number of proofs is above max limit of ${MAX_SWAP_INPUT_SIZE}. Visit Backup to optimize your wallet, then try again.`,
                {transactionId}
            )
        }
    }

    // Open reservation: locks proofsToSendFrom as PENDING atomically in SQLite.
    const reservation = proofsStore.reserve(proofsToSendFrom, {
        transactionId,
        mintUrl,
        unit,
        operationType: isSwapNeeded ? 'send-swap' : 'send-direct',
        rollbackTo: 'UNSPENT',
    })

    try {
        if (isSwapNeeded) {
            log.debug('[sendFromMintSync] Swap is needed.', {
                proofsToSendFromAmount,
                amountWithFees: amountToSend + swapFeeReserve,
                returnedAmount,
                transactionId
            })

            let sendResult = {} as {
                returnedProofs: CashuProof[]
                proofsToSend: CashuProof[]
                swapFeePaid: number
            }

            try {
                sendResult = await walletStore.send(
                    mintUrl,
                    amountToSend,
                    unit,
                    proofsToSendFrom,
                    transactionId,
                    {p2pk: p2pk && p2pk.pubkey ? p2pk : undefined}
                )
            } catch (e: any) {
                if (WalletUtils.shouldHealOutputsError(e)) {
                    log.error('[sendFromMintSync] Increasing proofsCounter outdated values and repeating send.')
                    sendResult = await walletStore.send(
                        mintUrl,
                        amountToSend,
                        unit,
                        proofsToSendFrom,
                        transactionId,
                        {p2pk: p2pk && p2pk.pubkey ? p2pk : undefined, increaseCounterBy: 10}
                    )
                } else {
                    throw e
                }
            }

            returnedProofs = sendResult.returnedProofs
            proofsToSend = sendResult.proofsToSend
            swapFeePaid = sendResult.swapFeePaid

            // cashu-ts may "return unchanged" some inputs that didn't need splitting;
            // those should NOT be marked spent — they remain in the wallet.
            const returnedSecrets = new Set(returnedProofs.map(p => p.secret))
            const actuallySpentProofs = proofsToSendFrom.filter(p => !returnedSecrets.has(p.secret))

            log.trace('[sendFromMintSync] swap finalize', {
                inputCount: proofsToSendFrom.length,
                returnedUnchangedCount: proofsToSendFrom.length - actuallySpentProofs.length,
                actuallySpentCount: actuallySpentProofs.length,
                returnedProofsCount: returnedProofs.length,
                proofsToSendCount: proofsToSend.length,
            })

            // ATOMIC commit: inputs → SPENT, returned change → UNSPENT,
            // proofsToSend → PENDING, reservation row deleted — one SQLite txn.
            proofsStore.commitReservation(reservation, {
                toSpent: actuallySpentProofs,
                newProofs: [
                    { proofs: returnedProofs, state: 'UNSPENT', tId: transactionId },
                    { proofs: proofsToSend as CashuProof[], state: 'PENDING', tId: transactionId },
                ],
            })
        } else {
            // No swap: reserved proofs ARE the proofs to send; they remain PENDING.
            log.trace('[sendFromMintSync] Swap is not necessary.', {transactionId})
            proofsToSend = CashuUtils.exportProofs(proofsToSendFrom)
            proofsStore.commitReservation(reservation)
        }

        return {
            proofs: proofsToSend,
            swapFeeReserve,
            swapFeePaid,
            isSwapNeeded
        }
    } catch (e: any) {
        // Atomic rollback: restore reserved proofs to their original state +
        // delete the reservation row.
        proofsStore.rollbackReservation(reservation)

        // Try to clean up already-spent proofs surfaced by the mint as the
        // root cause of the swap error.
        if (e.params && e.params.message && e.params.message.toLowerCase().includes('token already spent')) {
            log.error('[sendFromMintSync] Going to clean spent proofs from proofsToSendFrom and from pending', {transactionId})

            await WalletTask.syncStateWithMintTask({
                proofsToSync: proofsToSend as Proof[],
                mintUrl,
                proofState: 'PENDING',
            })

            await WalletTask.syncStateWithMintTask({
                proofsToSync: proofsStore.getByMint(mintUrl, {state: 'PENDING', unit}),
                mintUrl,
                proofState: 'PENDING',
            })
        }

        if (e instanceof AppError) {
            throw e
        } else {
            throw new AppError(Err.WALLET_ERROR, e.message, e.stack.slice(0, 200))
        }
    }
}


const prioritizeFromInactiveKeysets = function (
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


const getActiveKeysetIds = function(mint: Mint) {
    
    if(mint.keysets) {
        return mint.keysets
        .filter((k: MintKeyset) => k.active === true)
        .map((k: MintKeyset) => k.id)
    }

    return []
}


const getInactiveKeysetIds = function(mint: Mint) {

    if(mint.keysets) {
        return mint.keysets
        .filter((k: MintKeyset) => k.active === false)
        .map((k: MintKeyset) => k.id)
    }
    
    return []   
}
