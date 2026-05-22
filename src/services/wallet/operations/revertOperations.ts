import {Transaction} from '../../../models/Transaction'
import {revertTask} from '../revertTask'
import {createQueueAwaitable} from '../queueHelper'
import {TransactionTaskResult} from '../types'

const revertQueueAwaitable = (
    transaction: Transaction,
): Promise<TransactionTaskResult> =>
    createQueueAwaitable<TransactionTaskResult>({
        taskFunction: 'revertTask',
        timeoutMessage: 'Revert task timed out',
        task: () => revertTask(transaction),
    })

export const RevertOperationService = {
    revertQueueAwaitable,
}
