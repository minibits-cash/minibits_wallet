import {log} from '../../logService'
import {rootStoreInstance} from '../../../models'
import {MintOperationService} from './mintOperations'
import {MeltOperationService} from './meltOperations'

const {transactionsStore} = rootStoreInstance

/**
 * Process all pending topups and expired lightning transfers.
 *
 * Topup polling is delegated to MintOperationService (mint quote lifecycle).
 * Transfer expiry is delegated to MeltOperationService (lightning out lifecycle).
 */
const handlePendingQueue = async (): Promise<void> => {
    const pendingTopups = transactionsStore.getPendingTopups()
    const pendingTransfers = transactionsStore.getPendingTransfers()

    log.trace('[handlePendingQueue] start', {
        pendingTopups: pendingTopups.length,
        pendingTransfers: pendingTransfers.length,
    })

    MeltOperationService.expirePendingTransfers(pendingTransfers)

    for (const tx of pendingTopups) {
        MintOperationService.enqueuePendingTopupCheck(tx)
    }

    if (pendingTopups.length === 0) {
        log.trace('[handlePendingQueue] No pending topups')
    }
}

export const PendingOperationService = {
    handlePendingQueue,
}
