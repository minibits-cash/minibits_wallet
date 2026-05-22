import {isBefore} from 'date-fns'
import {MintQuoteState} from '@cashu/cashu-ts'
import {log} from '../../logService'
import {MintError, ValidationError} from '../../../utils/AppError'
import {rootStoreInstance} from '../../../models'
import {
    Transaction,
    TransactionData,
    TransactionStatus,
    TransactionType,
} from '../../../models/Transaction'
import {MintBalance} from '../../../models/Mint'
import {Contact} from '../../../models/Contact'
import {CashuProof, CashuUtils} from '../../cashu/cashuUtils'
import {LightningUtils} from '../../lightning/lightningUtils'
import {NostrEvent} from '../../nostrService'
import {pollerExists, stopPolling} from '../../../utils/poller'
import {MintUnit, formatCurrency, getCurrency} from '../currency'
import {SyncQueue} from '../../syncQueueService'
import {topupTask} from '../topupTask'
import {WalletUtils} from '../utils'
import {createQueueAwaitable} from '../queueHelper'
import {
    HANDLE_PENDING_TOPUP_TASK,
    TransactionTaskResult,
    WalletTaskResult,
} from '../types'
import {sendTopupNotification} from '../notifications'

const {
    mintsStore,
    proofsStore,
    transactionsStore,
    walletStore,
} = rootStoreInstance

const topupQueueAwaitable = (
    mintBalanceToTopup: MintBalance,
    amountToTopup: number,
    unit: MintUnit,
    memo: string,
    contactToSendTo?: Contact,
    nwcEvent?: NostrEvent,
): Promise<TransactionTaskResult> =>
    createQueueAwaitable<TransactionTaskResult>({
        taskFunction: 'topupTask',
        timeoutMessage: 'Topup task timed out',
        task: () =>
            topupTask(
                mintBalanceToTopup,
                amountToTopup,
                unit,
                memo,
                contactToSendTo,
                nwcEvent,
            ),
    })

/**
 * Check a single pending mint quote and mint proofs if paid — even after expiry
 */
const handlePendingTopupTask = async (
    params: {transaction: Transaction},
): Promise<WalletTaskResult> => {
    const {transaction: tx} = params
    const {
        id: tId,
        mint: mintUrl,
        unit,
        amount,
        paymentId: paymentHash,
        quote: mintQuote,
        expiresAt,
    } = tx

    log.warn('[handlePendingTopupTask] start', {tx})

    const mint = mintsStore.findByUrl(mintUrl)
    if (!mint || !mintQuote || !unit || !amount) {
        throw new ValidationError('Invalid pending topup transaction', {tId})
    }

    let txData: TransactionData = tx.data ? JSON.parse(tx.data) : []

    try {
        const {state} = await walletStore.checkLightningMintQuote(mintUrl, mintQuote)

        const isExpired = expiresAt && isBefore(expiresAt, new Date())

        if (isExpired && state !== MintQuoteState.PAID) {
            log.debug('[handlePendingTopupTask] Invoice expired and not paid', {paymentHash})

            txData.push({status: TransactionStatus.EXPIRED, message: 'Invoice expired', createdAt: new Date()})
            tx.update({status: TransactionStatus.EXPIRED, data: JSON.stringify(txData)})
            stopPolling(`handlePendingTopupPoller-${paymentHash}`)

            return {
                taskFunction: HANDLE_PENDING_TOPUP_TASK,
                transaction: tx,
                mintUrl,
                unit,
                amount,
                paymentHash,
                message: 'Topup invoice expired and was not paid',
            }
        }

        switch (state) {
            case MintQuoteState.UNPAID:
                log.trace('[handlePendingTopupTask] Quote still unpaid', {mintQuote})

                if (isExpired) {
                    txData.push({status: TransactionStatus.EXPIRED, message: 'Invoice expired (unpaid)', createdAt: new Date()})
                    tx.update({status: TransactionStatus.EXPIRED, data: JSON.stringify(txData)})
                    stopPolling(`handlePendingTopupPoller-${paymentHash}`)
                }

                return {
                    taskFunction: HANDLE_PENDING_TOPUP_TASK,
                    transaction: tx,
                    mintUrl,
                    unit,
                    amount,
                    paymentHash,
                    message: isExpired ? 'Invoice expired (unpaid)' : 'Quote not paid yet',
                }

            case MintQuoteState.ISSUED:
                log.info('[handlePendingTopupTask] Proofs already issued (likely from another device)', {mintQuote})
                txData.push({status: TransactionStatus.COMPLETED, note: 'Already issued', createdAt: new Date()})
                tx.update({status: TransactionStatus.COMPLETED, data: JSON.stringify(txData)})
                stopPolling(`handlePendingTopupPoller-${paymentHash}`)
                return {
                    taskFunction: HANDLE_PENDING_TOPUP_TASK,
                    transaction: tx,
                    mintUrl,
                    unit,
                    amount,
                    paymentHash,
                    message: 'Ecash already issued',
                }

            case MintQuoteState.PAID: {
                log.debug('[handlePendingTopupTask] Quote PAID – minting proofs (even if expired)', {paymentHash, amount, unit, isExpired})

                let proofs: CashuProof[] = []

                try {
                    proofs = await walletStore.mintProofs(mintUrl, amount, unit, mintQuote, tId)
                } catch (e: any) {
                    if (WalletUtils.shouldHealOutputsError(e)) {
                        log.error('[handlePendingTopupTask] Increasing proofsCounter outdated values and repeating mintProofs.')
                        proofs = await walletStore.mintProofs(mintUrl, amount, unit, mintQuote, tId, {increaseCounterBy: 10})
                    } else {
                        throw e
                    }
                }

                if (proofs.length === 0) {
                    throw new MintError('Mint returned no proofs after payment')
                }

                proofsStore.addOrUpdate(proofs, {
                    mintUrl,
                    unit,
                    tId,
                    state: 'UNSPENT',
                })

                const currencyCode = getCurrency(unit).code
                const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance

                txData.push({status: TransactionStatus.COMPLETED, createdAt: new Date()})

                tx.update({
                    status: TransactionStatus.COMPLETED,
                    data: JSON.stringify(txData),
                    balanceAfter,
                })

                stopPolling(`handlePendingTopupPoller-${paymentHash}`)
                sendTopupNotification(amount, unit)

                return {
                    taskFunction: HANDLE_PENDING_TOPUP_TASK,
                    transaction: tx,
                    mintUrl,
                    unit,
                    amount,
                    paymentHash,
                    message: `Topup successful: +${formatCurrency(amount, currencyCode)} ${currencyCode}${isExpired ? ' (paid after expiry)' : ''}`,
                }
            }

            default:
                log.error('[handlePendingTopupTask] Unknown quote state', {state})
                return {
                    taskFunction: HANDLE_PENDING_TOPUP_TASK,
                    transaction: tx,
                    mintUrl,
                    unit,
                    amount,
                    paymentHash,
                    message: `Unknown quote state: ${state}`,
                }
        }
    } catch (e: any) {
        log.error('[handlePendingTopupTask] failed', {
            tId,
            paymentHash,
            error: e.name,
            message: e.message,
        })

        return {
            taskFunction: HANDLE_PENDING_TOPUP_TASK,
            transaction: tx,
            mintUrl,
            unit,
            amount,
            paymentHash,
            error: WalletUtils.formatError(e),
            message: `Topup failed: ${e.message}`,
        }
    }
}

/**
 * Manually recover minted ecash from a paid mint quote (e.g. lost topup)
 */
const recoverMintQuote = async (
    params: {mintUrl: string; mintQuote: string},
): Promise<{recoveredAmount: number}> => {
    const {mintUrl, mintQuote} = params
    const mint = mintsStore.findByUrl(mintUrl)
    const unit: MintUnit = 'sat'

    if (!mint || !mintQuote) {
        throw new ValidationError('Missing mint or mint quote', {mintUrl, mintQuote})
    }

    log.trace('[recoverMintQuote] start', {mintUrl, mintQuote})

    const {state, mintQuote: returnedQuote, encodedInvoice} = await walletStore.checkLightningMintQuote(mintUrl, mintQuote)

    if (returnedQuote !== mintQuote) {
        throw new ValidationError('Mint returned mismatched quote', {mintQuote, returnedQuote})
    }

    switch (state) {
        case MintQuoteState.UNPAID:
            throw new ValidationError(`Quote ${mintQuote} is not paid`)

        case MintQuoteState.ISSUED:
            throw new ValidationError(`Quote ${mintQuote} already issued – nothing to recover`)

        case MintQuoteState.PAID: {
            const invoice = LightningUtils.decodeInvoice(encodedInvoice)
            const {amount, description} = LightningUtils.getInvoiceData(invoice)

            const txData: TransactionData[] = [
                {status: TransactionStatus.DRAFT, amount, unit, createdAt: new Date()},
            ]

            const tx = await transactionsStore.addTransaction({
                type: TransactionType.TOPUP,
                amount,
                fee: 0,
                unit,
                data: JSON.stringify(txData),
                memo: description || 'Recovered topup',
                mint: mintUrl,
                status: TransactionStatus.DRAFT,
                quote: mintQuote,
            })

            let proofs: CashuProof[] = []

            try {
                proofs = await walletStore.mintProofs(mintUrl, amount, unit, mintQuote, tx.id)
            } catch (e: any) {
                if (WalletUtils.shouldHealOutputsError(e)) {
                    log.error('[recoverMintQuote] Increasing proofsCounter outdated values and repeating mintProofs')
                    proofs = await walletStore.mintProofs(mintUrl, amount, unit, mintQuote, tx.id, {increaseCounterBy: 10})
                } else {
                    throw e
                }
            }

            if (proofs.length === 0) {
                throw new MintError('Mint returned no proofs to recover')
            }

            const {updatedAmount: recoveredAmount} = proofsStore.addOrUpdate(proofs, {
                mintUrl,
                unit,
                tId: tx.id,
                state: 'UNSPENT',
            })

            const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance

            txData.push({status: TransactionStatus.RECOVERED, recoveredAmount, createdAt: new Date()})

            tx.update({
                status: TransactionStatus.RECOVERED,
                amount: recoveredAmount,
                keysetId: proofs[0].id,
                balanceAfter,
                data: JSON.stringify(txData),
            })

            log.debug('[recoverMintQuote] Success', {mintUrl, mintQuote, recoveredAmount})
            return {recoveredAmount}
        }

        default:
            log.error('[recoverMintQuote] Unknown quote state', {state})
            throw new ValidationError(`Unknown quote state: ${state}`)
    }
}

/**
 * Enqueue a pending topup check for a single transaction (used by handlePendingQueue).
 */
const enqueuePendingTopupCheck = (tx: Transaction): void => {
    if (pollerExists(`handlePendingTopupPoller-${tx.paymentId}`)) {
        log.trace('[MintOperationService] Skipping topup – poller active', {paymentId: tx.paymentId})
        return
    }

    const taskId = `handlePendingTopupTask-${tx.id}-${Date.now()}`
    SyncQueue.addTask(taskId, () => handlePendingTopupTask({transaction: tx}))
}

export const MintOperationService = {
    topupQueueAwaitable,
    handlePendingTopupTask,
    recoverMintQuote,
    enqueuePendingTopupCheck,
}
