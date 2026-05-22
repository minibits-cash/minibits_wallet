import {Token, TokenMetadata, getDecodedToken, getEncodedToken} from '@cashu/cashu-ts'
import {Mint} from '../../../models/Mint'
import {CashuUtils} from '../../cashu/cashuUtils'
import {MintUnit} from '../currency'
import {
    receiveTask,
    receiveOfflinePrepareTask,
    receiveOfflineCompleteTask,
} from '../receiveTask'
import {createQueueAwaitable} from '../queueHelper'
import {
    MAX_SWAP_INPUT_SIZE,
    TransactionTaskResult,
    WalletTaskResult,
} from '../types'

/**
 * Receive big tokens in batches to keep mint load reasonable.
 */
export const receiveBatchTask = async function (
    token: Token,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
): Promise<WalletTaskResult> {

    const maxBatchSize = MAX_SWAP_INPUT_SIZE
    const mintUrl = token.mint
    const proofsToReceive = token.proofs
    const unit = token.unit

    let receivedProofsCount = 0

    if (proofsToReceive.length > maxBatchSize) {
        let index = 0
        for (let i = 0; i < proofsToReceive.length; i += maxBatchSize) {
            index++
            const batch = proofsToReceive.slice(i, i + maxBatchSize)
            const batchAmount = CashuUtils.getProofsAmount(batch)

            const batchToken: Token = {
                mint: mintUrl,
                proofs: batch,
                memo: `${memo} #${index}`,
                unit,
            }

            const batchEncodedToken = getEncodedToken(batchToken)

            const result = await receiveTask(
                batchToken,
                batchAmount,
                `${memo} #${index}`,
                batchEncodedToken,
            )

            if (result.receivedProofsCount) {
                receivedProofsCount += result.receivedProofsCount
            }
        }
    } else {
        const result = await receiveTask(
            token,
            amountToReceive,
            memo,
            encodedToken,
        )

        if (result.receivedProofsCount) {
            receivedProofsCount += result.receivedProofsCount
        }
    }

    return {
        taskFunction: 'receiveBatchTask',
        mintUrl,
        message: 'receiveBatchTask completed. ',
        receivedProofsCount,
    }
}

const receiveQueueAwaitable = (
    mint: Mint,
    tokenMetadata: TokenMetadata,
    encodedToken: string,
): Promise<TransactionTaskResult> => {
    const {amount: rawAmount, memo, unit} = tokenMetadata
    const amount = Number(rawAmount)
    const proofsCount = tokenMetadata.incompleteProofs.length
    const useBatch = proofsCount > MAX_SWAP_INPUT_SIZE

    return createQueueAwaitable<TransactionTaskResult>({
        taskFunction: useBatch ? 'receiveBatchTask' : 'receiveTask',
        timeoutMessage: 'receiveQueue timed out',
        task: async () => {
            const token = getDecodedToken(encodedToken, mint.keysetIds ?? [])
            return (useBatch
                ? await receiveBatchTask(token, amount, memo || '', encodedToken)
                : await receiveTask(token, amount, memo || '', encodedToken)) as TransactionTaskResult
        },
    })
}

const receiveOfflinePrepareQueueAwaitable = (
    tokenMetadata: TokenMetadata,
    encodedToken: string,
): Promise<TransactionTaskResult> => {
    const {mint: mintUrl, amount: rawAmount, memo, unit} = tokenMetadata
    const amount = Number(rawAmount)

    return createQueueAwaitable<TransactionTaskResult>({
        taskFunction: 'receiveOfflinePrepareTask',
        prioritized: false,
        timeoutMessage: 'Offline receive prepare timed out',
        task: () =>
            receiveOfflinePrepareTask(
                mintUrl,
                unit as MintUnit,
                amount,
                memo || '',
                encodedToken,
            ),
    })
}

const receiveOfflineCompleteQueueAwaitable = (
    transactionId: number,
): Promise<TransactionTaskResult> =>
    createQueueAwaitable<TransactionTaskResult>({
        taskFunction: 'receiveOfflineCompleteTask',
        prioritized: false,
        timeoutMessage: 'Offline receive complete timed out',
        task: () => receiveOfflineCompleteTask(transactionId),
    })

export const ReceiveOperationService = {
    receiveQueueAwaitable,
    receiveOfflinePrepareQueueAwaitable,
    receiveOfflineCompleteQueueAwaitable,
    receiveBatchTask,
}
