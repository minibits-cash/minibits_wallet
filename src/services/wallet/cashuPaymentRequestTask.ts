import {rootStoreInstance} from '../../models'
import {TransactionTaskResult} from '../walletService'
import {MintBalance} from '../../models/Mint'
import {TransactionData, TransactionStatus} from '../../models/Transaction'
import {log} from '../logService'
import {WalletUtils} from './utils'
import {MintUnit} from './currency'

const {transactionsStore} = rootStoreInstance

export const CASHU_PAYMENT_REQUEST_TASK = 'cashuPaymentRequestTask'

/**
 * Backward-compatible Cashu Payment Request creation task wrapper.
 *
 * Preserves the legacy `WalletTask.cashuPaymentRequestQueueAwaitable`
 * contract: a single call that creates the draft, builds the encoded PR,
 * and returns a `TransactionTaskResult` carrying the encoded string for the
 * UI to display (QR / copy-paste).
 *
 * Internally delegates to the lifecycle API:
 *   `CashuPaymentRequestApi.prepare()` (DRAFT → PREPARED)
 *   `CashuPaymentRequestApi.execute()` (PREPARED → PENDING; builds PR)
 */
export const cashuPaymentRequestTask = async function (
    mintBalanceToReceiveTo: MintBalance,
    amountToReceive: number,
    unit: MintUnit,
    memo: string,
): Promise<TransactionTaskResult> {
    log.info('[cashuPaymentRequestTask]', {mintBalanceToReceiveTo})
    log.info('[cashuPaymentRequestTask]', {amountToReceive, unit})

    const mintUrl = mintBalanceToReceiveTo.mintUrl

    const {CashuPaymentRequestApi} = await import('./operations/cashuPaymentRequestApi')

    let transactionIdForRecovery: number | undefined

    try {
        const prepared = await CashuPaymentRequestApi.prepare({
            mintBalance: mintBalanceToReceiveTo,
            amount: amountToReceive,
            unit,
            memo,
            method: {method: 'nostr', options: {}},
        })
        transactionIdForRecovery = prepared.transactionId

        const {transaction, cashuPaymentRequest, encodedCashuPaymentRequest} =
            await CashuPaymentRequestApi.execute(prepared)

        return {
            taskFunction: CASHU_PAYMENT_REQUEST_TASK,
            mintUrl,
            transaction,
            message: '',
            cashuPaymentRequest,
            encodedCashuPaymentRequest,
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
            taskFunction: CASHU_PAYMENT_REQUEST_TASK,
            transaction: transactionIdForRecovery
                ? transactionsStore.findById(transactionIdForRecovery)
                : undefined,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}
