import {MintBalance} from '../../../models/Mint'
import {Proof} from '../../../models/Proof'
import {MintUnit} from '../currency'
import {sendTask} from '../sendTask'
import {cashuPaymentRequestTask} from '../cashuPaymentRequestTask'
import {createQueueAwaitable} from '../queueHelper'
import {TransactionTaskResult} from '../types'

const sendQueueAwaitable = (
    mintBalanceToSendFrom: MintBalance,
    amountToSend: number,
    unit: MintUnit,
    memo: string,
    selectedProofs: Proof[],
    p2pk?: {pubkey: string; locktime?: number; refundKeys?: Array<string>},
    draftTransactionId?: number,
): Promise<TransactionTaskResult> =>
    createQueueAwaitable<TransactionTaskResult>({
        taskFunction: 'sendTask',
        task: () =>
            sendTask(
                mintBalanceToSendFrom,
                amountToSend,
                unit,
                memo,
                selectedProofs,
                p2pk,
                draftTransactionId,
            ),
    })

const cashuPaymentRequestQueueAwaitable = (
    mintBalanceToReceiveTo: MintBalance,
    amountToRequest: number,
    unit: MintUnit,
    memo: string,
): Promise<TransactionTaskResult> =>
    createQueueAwaitable<TransactionTaskResult>({
        taskFunction: 'cashuPaymentRequestTask',
        task: () =>
            cashuPaymentRequestTask(
                mintBalanceToReceiveTo,
                amountToRequest,
                unit,
                memo,
            ),
    })

export const SendOperationService = {
    sendQueueAwaitable,
    cashuPaymentRequestQueueAwaitable,
}
