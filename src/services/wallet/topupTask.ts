import {rootStoreInstance} from '../../models'
import {TransactionTaskResult} from '../walletService'
import {MintBalance} from '../../models/Mint'
import {TransactionData, TransactionStatus} from '../../models/Transaction'
import {log} from '../logService'
import {Contact} from '../../models/Contact'
import {WalletUtils} from './utils'
import {MintUnit} from './currency'
import {NostrEvent} from '../nostrService'

const {transactionsStore} = rootStoreInstance

export const TOPUP_TASK = 'topupTask'

/**
 * Backward-compatible topup (lightning mint) task wrapper.
 *
 * Preserves the historical `WalletTask.topupQueueAwaitable` contract: a single
 * call that creates the draft, fetches a mint quote, transitions the tx to
 * PENDING, arms the ws/poller watch, and returns a `TransactionTaskResult`
 * with the encoded invoice for the user to pay.
 *
 * Internally delegates to the lifecycle API:
 *   `TopupOperationApi.prepare()` (DRAFT → PREPARED, quote created)
 *   `TopupOperationApi.execute()` (PREPARED → PENDING, watcher armed)
 *
 * Screens that want to defer the watcher / surface the invoice before
 * committing should call the lifecycle methods directly.
 */
export const topupTask = async function (
    mintBalanceToTopup: MintBalance,
    amountToTopup: number,
    unit: MintUnit,
    memo: string,
    contactToSendTo?: Contact,
    nwcEvent?: NostrEvent,
): Promise<TransactionTaskResult> {
    log.info('[topupTask]', {mintBalanceToTopup})
    log.info('[topupTask]', {amountToTopup, unit})

    const mintUrl = mintBalanceToTopup.mintUrl

    // Lazy import avoids a circular dep across the operations module graph.
    const {TopupOperationApi} = await import('./operations/topupOperationApi')

    let transactionIdForRecovery: number | undefined

    try {
        const prepared = await TopupOperationApi.prepare({
            mintBalance: mintBalanceToTopup,
            amount: amountToTopup,
            unit,
            memo,
            method: {method: 'bolt11', options: {contactToSendTo}},
            nwcEvent,
        })
        transactionIdForRecovery = prepared.transactionId

        const pending = await TopupOperationApi.execute(prepared)

        return {
            taskFunction: TOPUP_TASK,
            mintUrl,
            transaction: pending,
            message: '',
            encodedInvoice: prepared.encodedInvoice,
            nwcEvent,
        } as TransactionTaskResult
    } catch (e: any) {
        if (transactionIdForRecovery) {
            const tx = transactionsStore.findById(transactionIdForRecovery)
            if (tx && tx.status !== TransactionStatus.ERROR) {
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
        }

        log.error(e.name, e.message)

        return {
            taskFunction: TOPUP_TASK,
            transaction: transactionIdForRecovery
                ? transactionsStore.findById(transactionIdForRecovery)
                : undefined,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}
