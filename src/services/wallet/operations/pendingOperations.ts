import {log} from '../../logService'
import {rootStoreInstance} from '../../../models'
import {MintOperationService} from './mintOperations'
import {MeltOperationService} from './meltOperations'
import {OnchainOperationService} from './onchainOperations'

const {transactionsStore} = rootStoreInstance

/**
 * Process all pending topups and expired lightning transfers, and check for
 * onchain deposits.
 *
 * Topup polling is delegated to MintOperationService (mint quote lifecycle).
 * Transfer expiry is delegated to MeltOperationService (lightning out lifecycle).
 * Onchain deposits are delegated to OnchainOperationService.
 *
 * Note the onchain sweep is driven by QUOTES, not by pending transactions: an
 * onchain address can be paid again after its transaction has COMPLETED, so
 * walking pending transactions (as the bolt11 path does) would miss precisely the
 * deposits that need catching.
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

    await OnchainOperationService.handleOnchainQuoteQueue()
}

export const PendingOperationService = {
    handlePendingQueue,
}
