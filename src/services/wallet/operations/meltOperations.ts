import {isBefore} from 'date-fns'
import {
    MeltQuoteBolt11Response,
    MeltQuoteState,
    getEncodedToken,
} from '@cashu/cashu-ts'
import {log} from '../../logService'
import {MintError, ValidationError} from '../../../utils/AppError'
import EventEmitter from '../../../utils/eventEmitter'
import {rootStoreInstance} from '../../../models'
import {
    Transaction,
    TransactionData,
    TransactionStatus,
} from '../../../models/Transaction'
import {MintBalance} from '../../../models/Mint'
import {Proof} from '../../../models/Proof'
import {CashuUtils} from '../../cashu/cashuUtils'
import {NostrEvent} from '../../nostrService'
import {MintUnit, formatCurrency, getCurrency} from '../currency'
import {transferTask} from '../transferTask'
import {WalletUtils} from '../utils'
import {createQueueAwaitable} from '../queueHelper'
import {TransactionTaskResult} from '../types'

const {
    mintsStore,
    proofsStore,
    transactionsStore,
    walletStore,
} = rootStoreInstance

const transferQueueAwaitable = (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    unit: MintUnit,
    meltQuote: MeltQuoteBolt11Response,
    memo: string,
    invoiceExpiry: Date,
    encodedInvoice: string,
    nwcEvent?: NostrEvent,
    draftTransactionId?: number,
): Promise<TransactionTaskResult> =>
    createQueueAwaitable<TransactionTaskResult>({
        taskFunction: 'transferTask',
        timeoutMessage: 'transferQueue timed out',
        task: () =>
            transferTask(
                mintBalanceToTransferFrom,
                amountToTransfer,
                unit,
                meltQuote,
                memo,
                invoiceExpiry,
                encodedInvoice,
                nwcEvent,
                draftTransactionId,
            ),
    })

/**
 *  Recover change from a paid melt quote (lightning out)
 */
const recoverMeltQuoteChange = async (
    params: {
        mintUrl: string
        meltQuote: string | MeltQuoteBolt11Response
    },
): Promise<{recoveredAmount: number}> => {
    const {mintUrl, meltQuote} = params
    const mintInstance = mintsStore.findByUrl(mintUrl)
    const unit: MintUnit = 'sat'

    if (!mintInstance || !meltQuote) {
        throw new ValidationError('Missing mint or melt quote', {mintUrl, meltQuote})
    }

    log.trace('[recoverMeltQuoteChange] start', {mintUrl, meltQuote})

    const meltQuoteResponse: MeltQuoteBolt11Response =
        typeof meltQuote === 'string'
            ? await walletStore.checkLightningMeltQuote(mintUrl, meltQuote)
            : meltQuote

    const {quote, state, change} = meltQuoteResponse

    const tx = transactionsStore.findLastBy({quote})

    if (!tx) {
        throw new ValidationError(`Original melt transaction not found for quote ${meltQuoteResponse.quote}`)
    }

    switch (state) {
        case MeltQuoteState.UNPAID:
            if (tx.keysetId) {
                const currentCounter = mintInstance.getProofsCounterByKeysetId!(tx.keysetId)
                currentCounter.removeMeltCounterValue(tx.id)
            }

            throw new ValidationError(`Melt quote ${meltQuote} was not paid`)

        case MeltQuoteState.PENDING:
            throw new ValidationError(`Melt quote ${meltQuote} is still pending – cannot recover change yet`)

        case MeltQuoteState.PAID: {
            if (!change || change.length === 0) {
                throw new ValidationError(`No change available for melt quote ${meltQuoteResponse.quote}`)
            }

            let txData: TransactionData = tx.data ? JSON.parse(tx.data) : []

            try {
                if (!tx.keysetId) {
                    throw new ValidationError('Missing keysetId on transaction', {meltQuote})
                }

                const currentCounter = mintInstance.getProofsCounterByKeysetId!(tx.keysetId)
                const meltCounterValue = currentCounter?.getMeltCounterValue(tx.id)

                if (!meltCounterValue?.meltPreview) {
                    throw new ValidationError('MeltPreview not found – this transaction may be from an older version', {meltQuote})
                }

                const meltPreview = meltCounterValue.meltPreview
                const cashuWallet = await walletStore.getWallet(mintUrl, unit, {withSeed: true, keysetId: meltPreview.keysetId})
                const keyset = cashuWallet.getKeyset(meltPreview.keysetId)

                const reconstructedOutputData = CashuUtils.deserializeOutputData(meltPreview.outputData)
                const recoveredChange = change.map((sig, i) => reconstructedOutputData[i].toProof(sig, keyset))
                currentCounter.removeMeltCounterValue(tx.id)

                const newChange = recoveredChange.filter(proof => !proofsStore.alreadyExists(proof))

                if (newChange.length === 0) {
                    throw new MintError(`No new ecash proofs to recover from melt quote ${meltQuoteResponse.quote}, ${recoveredChange.length} proofs already in wallet.`)
                }

                const {updatedAmount: recoveredAmount} = proofsStore.addOrUpdate(newChange, {
                    mintUrl,
                    unit,
                    tId: tx.id,
                    state: 'UNSPENT',
                })

                const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance
                const outputToken = getEncodedToken({mint: mintUrl, proofs: newChange, unit})

                txData.push({
                    status: TransactionStatus.RECOVERED,
                    recoveredAmount,
                    createdAt: new Date(),
                })

                tx.update({
                    status: TransactionStatus.RECOVERED,
                    amount: recoveredAmount,
                    balanceAfter,
                    outputToken,
                    data: JSON.stringify(txData),
                })

                log.debug('[recoverMeltQuoteChange] Success', {meltQuote, recoveredAmount})
                return {recoveredAmount}
            } catch (e: any) {
                log.error('[recoverMeltQuoteChange] Failed', {meltQuote, error: e.message})

                txData.push({
                    status: TransactionStatus.ERROR,
                    error: WalletUtils.formatError(e),
                    createdAt: new Date(),
                })

                tx.update({
                    status: TransactionStatus.ERROR,
                    data: JSON.stringify(txData),
                })

                return {recoveredAmount: 0}
            }
        }

        default:
            log.error('[recoverMeltQuoteChange] Unknown melt state', {state})
            throw new ValidationError(`Unknown melt quote state: ${state}`)
    }
}

/**
 * Reconstruct change proofs returned by an async melt that just settled.
 *
 * Uses the meltPreview captured when the transfer was first prepared to
 * unblind the change signatures the mint reports on the resolved quote.
 *
 * Extracted as a standalone helper so its return type can flow back into the
 * caller via inference (avoiding explicit type-annotation gymnastics around
 * the cashu-ts strict-vs-loose Proof types).
 *
 * Returns `{ change: [...] }` — empty array if anything goes wrong; logs but
 * never throws, matching the pre-reservation behaviour where change-recovery
 * failure does not block the melt from finalizing.
 */
const unblindPendingMeltChange = async function (params: {
    mintUrl: string
    unit: MintUnit
    quoteId: string
    transaction: Transaction
    quoteChange: MeltQuoteBolt11Response['change']
}) {
    const {mintUrl, unit, quoteId, transaction, quoteChange} = params
    try {
        const mintInstance = mintsStore.findByUrl(mintUrl)
        if (!mintInstance || !transaction.keysetId) return {change: []}

        const currentCounter = mintInstance.getProofsCounterByKeysetId!(transaction.keysetId)
        const meltCounterValue = currentCounter?.getMeltCounterValue(transaction.id)

        if (!meltCounterValue?.meltPreview || !quoteChange?.length) {
            return {change: []}
        }

        log.trace('[handlePendingMelt] Unblinding change from quote response', {
            transactionId: transaction.id,
            quoteId,
            changeCount: quoteChange.length,
        })

        const {meltPreview} = meltCounterValue
        const cashuWallet = await walletStore.getWallet(mintUrl, unit, {
            withSeed: true,
            keysetId: meltPreview.keysetId,
        })
        const keyset = cashuWallet.getKeyset(meltPreview.keysetId)

        const reconstructedOutputData = CashuUtils.deserializeOutputData(meltPreview.outputData)
        const change = quoteChange.map((sig, i) => reconstructedOutputData[i].toProof(sig, keyset))

        log.trace('[handlePendingMelt] Change unblinded', {transactionId: transaction.id, quoteId, change})

        currentCounter.removeMeltCounterValue(transaction.id)

        return {change}
    } catch (e: any) {
        log.error('[handlePendingMelt] change recovery failed, completing without change', {
            message: e.message,
        })
        return {change: []}
    }
}

const handlePendingMeltTask = async (params: {
    mintUrl: string
    unit: MintUnit
    quoteId: string
    proofsToMeltFrom: Proof[]
    proofsToMeltFromAmount: number
    amountToTransfer: number
    meltFeeReserve: number
    transactionId: number
}): Promise<void> => {
    const {
        mintUrl,
        unit,
        quoteId,
        proofsToMeltFrom,
        proofsToMeltFromAmount,
        amountToTransfer,
        meltFeeReserve,
        transactionId,
    } = params

    const transaction = transactionsStore.findById(transactionId)
    if (!transaction || transaction.status !== TransactionStatus.PENDING) return

    const quote = await walletStore.checkLightningMeltQuote(mintUrl, quoteId)

    if (quote.state === MeltQuoteState.PAID) {
        let totalFeePaid = proofsToMeltFromAmount - amountToTransfer
        let lightningFeePaid = totalFeePaid - meltFeeReserve
        const meltFeePaid = meltFeeReserve

        // Unblind change BEFORE opening the reservation. Failure here just
        // means no change recovery — same fallback behaviour as the
        // pre-reservation code; the melt itself still finalizes.
        const unblinded = await unblindPendingMeltChange({
            mintUrl, unit, quoteId, transaction, quoteChange: quote.change,
        })

        let returnedAmount = 0
        let outputToken: string | undefined
        if (unblinded.change.length > 0) {
            returnedAmount = CashuUtils.getProofsAmount(unblinded.change)
            outputToken = getEncodedToken({mint: mintUrl, proofs: unblinded.change, unit})
            totalFeePaid = totalFeePaid - returnedAmount
            lightningFeePaid = totalFeePaid - meltFeeReserve
        }

        // Atomic finalize: proofsToMeltFrom move PENDING → SPENT and change (if any)
        // is added as UNSPENT in a single SQLite transaction. Replaces the previous
        // two-step `moveToSpent` + `addOrUpdate(change)` which left a crash window
        // where ecash could be marked SPENT without the change being recorded.
        const reservation = proofsStore.reserve(proofsToMeltFrom, {
            transactionId,
            mintUrl,
            unit,
            operationType: 'pending-melt-finalize-paid',
            rollbackTo: 'PENDING',
        })

        proofsStore.commitReservation(reservation, {
            toSpent: proofsToMeltFrom,
            newProofs: unblinded.change.length > 0
                ? [{ proofs: unblinded.change, state: 'UNSPENT', tId: transactionId }]
                : [],
        })

        const txData: TransactionData[] = transaction.data ? JSON.parse(transaction.data) : []
        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance
        txData.push({
            status: TransactionStatus.COMPLETED,
            lightningFeePaid,
            meltFeePaid,
            returnedAmount,
            //@ts-ignore
            preimage: quote.payment_preimage,
            createdAt: new Date(),
        })
        const updatePayload: any = {
            status: TransactionStatus.COMPLETED,
            data: JSON.stringify(txData),
            fee: totalFeePaid,
            balanceAfter,
        }
        if (outputToken) updatePayload.outputToken = outputToken
        //@ts-ignore
        if (quote.payment_preimage) updatePayload.proof = quote.payment_preimage
        transaction.update(updatePayload)

        log.debug('[handlePendingMelt] Transaction completed', {transactionId, totalFeePaid})

        EventEmitter.emit('ev_asyncMeltResult', {
            transactionId,
            status: TransactionStatus.COMPLETED,
            message: `Lightning invoice paid. Fee: ${formatCurrency(transaction.fee, getCurrency(unit).code)} ${getCurrency(unit).code}.`,
        })

    } else if (quote.state === MeltQuoteState.UNPAID) {
        // Single state transition (PENDING → UNSPENT); SQLite's per-write
        // atomicity is sufficient — no reservation needed.
        proofsStore.revertToSpendable(proofsToMeltFrom)

        const txData: TransactionData[] = transaction.data ? JSON.parse(transaction.data) : []
        txData.push({
            status: TransactionStatus.ERROR,
            error: WalletUtils.formatError(new MintError('Async lightning payment failed.')),
            createdAt: new Date(),
        })
        transaction.update({status: TransactionStatus.ERROR, data: JSON.stringify(txData)})

        log.debug('[handlePendingMelt] Transaction failed (UNPAID)', {transactionId})

        EventEmitter.emit('ev_asyncMeltResult', {
            transactionId,
            status: TransactionStatus.ERROR,
            message: 'Lightning payment failed. Ecash returned to spendable balance.',
        })
    }
    // MeltQuoteState.PENDING: no-op, ws/poller will call again
}

/**
 * Expire lightning transfers whose invoices have passed. Used by handlePendingQueue.
 */
const expirePendingTransfers = (pendingTransfers: Transaction[]): void => {
    for (const tx of pendingTransfers) {
        if (tx.expiresAt && isBefore(tx.expiresAt, new Date())) {
            log.debug('[MeltOperationService] Expiring transfer', {paymentId: tx.paymentId})

            const update = {
                status: TransactionStatus.EXPIRED,
                message: 'Lightning invoice expired',
                createdAt: new Date(),
            }

            try {
                const txData = tx.data ? [...JSON.parse(tx.data), update] : [update]
                tx.update({
                    status: TransactionStatus.EXPIRED,
                    data: JSON.stringify(txData),
                })
            } catch (e: any) {
                tx.update({
                    status: TransactionStatus.EXPIRED,
                    data: JSON.stringify(update),
                })
            }
        }
    }
}

export const MeltOperationService = {
    transferQueueAwaitable,
    recoverMeltQuoteChange,
    handlePendingMeltTask,
    expirePendingTransfers,
}
