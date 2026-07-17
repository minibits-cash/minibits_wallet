import {MeltQuoteBolt11Response, MeltQuoteOnchainResponse} from '@cashu/cashu-ts'
import {rootStoreInstance} from '../../models'
import {TransactionTaskResult} from '../walletService'
import {MintBalance} from '../../models/Mint'
import {TransactionData, TransactionStatus} from '../../models/Transaction'
import {log} from '../logService'
import {WalletUtils} from './utils'
import {MintUnit, formatCurrency, getCurrency} from './currency'
import {NostrEvent} from '../nostrService'
import { translate } from '../../i18n'

const {transactionsStore} = rootStoreInstance

export const TRANSFER_TASK = 'transferTask'
export const TRANSFER_ONCHAIN_TASK = 'transferOnchainTask'

/**
 * Backward-compatible transfer (lightning melt) task wrapper.
 *
 * Preserves the historical `WalletTask.transferQueueAwaitable` contract: a
 * single call that creates the draft, reserves proofs, optionally swaps for
 * tighter denominations, calls the mint to pay the invoice, and returns a
 * `TransactionTaskResult`.
 *
 * Internally delegates to the lifecycle API:
 *   `TransferOperationApi.prepare()`  (DRAFT → PREPARED, reservation opens)
 *   `TransferOperationApi.execute()`  (PREPARED → EXECUTING → PENDING|COMPLETED)
 *
 * Screens that want fee preview / cancel-before-execute should call the
 * lifecycle methods directly instead of going through this wrapper.
 */
export const transferTask = async function (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    unit: MintUnit,
    meltQuote: MeltQuoteBolt11Response,
    memo: string,
    invoiceExpiry: Date,
    encodedInvoice: string,
    nwcEvent?: NostrEvent,
    draftTransactionId?: number,
): Promise<TransactionTaskResult> {
    const mintUrl = mintBalanceToTransferFrom.mintUrl

    log.debug('[transferTask]', 'mintBalanceToTransferFrom', {mintBalanceToTransferFrom})
    log.debug('[transferTask]', 'amountToTransfer', {amountToTransfer})
    log.debug('[transferTask]', 'meltQuote', {meltQuote})

    // Lazy import avoids a circular dep across the operations module graph.
    const {TransferOperationApi} = await import('./operations/transferOperationApi')

    let transactionIdForRecovery: number | undefined

    try {
        const prepared = await TransferOperationApi.prepare({
            mintBalance: mintBalanceToTransferFrom,
            amount: amountToTransfer,
            unit,
            memo,
            method: {
                method: 'bolt11',
                options: {encodedInvoice, meltQuote, invoiceExpiry},
            },
            nwcEvent,
            draftTransactionId,
        })
        transactionIdForRecovery = prepared.transactionId

        const settled = await TransferOperationApi.execute(prepared)

        // execute returns either COMPLETED (sync PAID) or PENDING (async).
        if (settled.status === TransactionStatus.COMPLETED) {
            const totalFeePaid = settled.fee ?? 0
            const meltFeePaid = prepared.meltFeeReserve + prepared.preemptiveSwapFeePaid
            const lightningFeePaid = totalFeePaid - meltFeePaid
            return {
                taskFunction: TRANSFER_TASK,
                mintUrl,
                transaction: settled,
                message: translate('transactionResult_lightningInvoicePaidFee', {
                                fee: `${formatCurrency(settled.fee, getCurrency(unit).code)} ${getCurrency(unit).code}`,
                        }),
                lightningFeePaid,
                meltFeePaid,
                totalFeePaid,
                meltQuote,
                //@ts-ignore
                preimage: settled.proof ?? undefined,
                nwcEvent,
            } as TransactionTaskResult
        }

        // PENDING — async melt in progress; monitor will resolve via refresh.
        return {
            taskFunction: TRANSFER_TASK,
            mintUrl,
            transaction: settled,
            message: 'Lightning payment is in progress...',
            meltQuote,
            nwcEvent,
        } as TransactionTaskResult
    } catch (e: any) {
        let txAfterError = transactionIdForRecovery
            ? transactionsStore.findById(transactionIdForRecovery)
            : undefined

        if (txAfterError && txAfterError.status !== TransactionStatus.PENDING) {
            // execute()'s error handler may have already marked tx RECOVERED;
            // only stamp ERROR if execute() didn't.
            if (
                txAfterError.status !== TransactionStatus.RECOVERED &&
                txAfterError.status !== TransactionStatus.ERROR
            ) {
                let transactionData: TransactionData[] = []
                try { transactionData = JSON.parse(txAfterError.data) } catch {}
                transactionData.push({
                    status: TransactionStatus.ERROR,
                    error: WalletUtils.formatError(e),
                    createdAt: new Date(),
                })
                txAfterError.update({
                    status: TransactionStatus.ERROR,
                    data: JSON.stringify(transactionData),
                })
            }
        }

        return {
            taskFunction: TRANSFER_TASK,
            mintUrl,
            transaction: txAfterError,
            message: e.message,
            error: WalletUtils.formatError(e),
            nwcEvent,
        } as TransactionTaskResult
    }
}

/**
 * Onchain (NUT-30) melt task.
 *
 * Same two-step lifecycle as `transferTask` — `prepare()` then `execute()`, sharing
 * the one copy of the reservation, preemptive-swap and error-recovery machinery. Only
 * the result mapping differs, and it differs because the RAILS differ:
 *
 * `transferTask` treats PENDING as the exception (lightning usually settles in the
 * same round-trip). Here PENDING is the ONLY outcome. NUT-30 requires the mint to
 * answer PENDING and broadcast in the background, so a COMPLETED transaction coming
 * back from `execute()` would mean the mint did something the spec forbids — we still
 * handle it rather than assert on it, since being wrong about a payment that already
 * went through helps nobody.
 *
 * The transaction is resolved later by the pending-transfer sweep, which checks the
 * quote until the mint reports PAID (confirmed).
 */
export const transferOnchainTask = async function (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    unit: MintUnit,
    meltQuote: MeltQuoteOnchainResponse,
    feeIndex: number,
    memo: string,
    quoteExpiry: Date,
    address: string,
    nwcEvent?: NostrEvent,
    draftTransactionId?: number,
): Promise<TransactionTaskResult> {
    const mintUrl = mintBalanceToTransferFrom.mintUrl

    log.debug('[transferOnchainTask]', {mintUrl, amountToTransfer, feeIndex, address})

    // Lazy import avoids a circular dep across the operations module graph.
    const {TransferOperationApi} = await import('./operations/transferOperationApi')

    let transactionIdForRecovery: number | undefined

    try {
        const prepared = await TransferOperationApi.prepare({
            mintBalance: mintBalanceToTransferFrom,
            amount: amountToTransfer,
            unit,
            memo,
            method: {
                method: 'onchain',
                options: {address, meltQuote, feeIndex, quoteExpiry},
            },
            nwcEvent,
            draftTransactionId,
        })
        transactionIdForRecovery = prepared.transactionId

        const settled = await TransferOperationApi.execute(prepared)

        if (settled.status === TransactionStatus.COMPLETED) {
            const totalFeePaid = settled.fee ?? 0
            const meltFeePaid = prepared.meltFeeReserve + prepared.preemptiveSwapFeePaid
            return {
                taskFunction: TRANSFER_ONCHAIN_TASK,
                mintUrl,
                transaction: settled,
                message: translate('transactionResult_onchainPaymentConfirmed'),
                meltFeePaid,
                totalFeePaid,
                meltQuote,
                nwcEvent,
            } as TransactionTaskResult
        }

        // The normal path: broadcast, awaiting confirmations.
        return {
            taskFunction: TRANSFER_ONCHAIN_TASK,
            mintUrl,
            transaction: settled,
            message: translate('transactionResult_onchainPaymentBroadcast'),
            meltQuote,
            nwcEvent,
        } as TransactionTaskResult
    } catch (e: any) {
        const txAfterError = transactionIdForRecovery
            ? transactionsStore.findById(transactionIdForRecovery)
            : undefined

        // A PENDING transaction is in flight at the mint — never stamp it ERROR, that
        // would hide a real payment. execute()'s handler may also already have marked it
        // RECOVERED (paid despite a client error).
        if (txAfterError && txAfterError.status !== TransactionStatus.PENDING) {
            if (
                txAfterError.status !== TransactionStatus.RECOVERED &&
                txAfterError.status !== TransactionStatus.ERROR
            ) {
                let transactionData: TransactionData[] = []
                try { transactionData = JSON.parse(txAfterError.data) } catch {}
                transactionData.push({
                    status: TransactionStatus.ERROR,
                    error: WalletUtils.formatError(e),
                    createdAt: new Date(),
                })
                txAfterError.update({
                    status: TransactionStatus.ERROR,
                    data: JSON.stringify(transactionData),
                })
            }
        }

        return {
            taskFunction: TRANSFER_ONCHAIN_TASK,
            mintUrl,
            transaction: txAfterError,
            message: e.message,
            error: WalletUtils.formatError(e),
            nwcEvent,
        } as TransactionTaskResult
    }
}
