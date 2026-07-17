import {log} from '../../logService'
import {rootStoreInstance} from '../../../models'
import {MintOperationService} from './mintOperations'
import {MeltOperationService} from './meltOperations'
import {OnchainOperationService} from './onchainOperations'

const {transactionsStore} = rootStoreInstance

/**
 * Process all pending topups and expired lightning transfers, and check on both
 * directions of onchain money: deposits coming in, and melts going out.
 *
 * Topup polling is delegated to MintOperationService (mint quote lifecycle).
 * Transfer expiry and the onchain melt sweep are delegated to MeltOperationService.
 * Onchain deposits are delegated to OnchainOperationService.
 *
 * The two onchain sweeps are driven differently, and the asymmetry is deliberate:
 *
 *  - DEPOSITS are QUOTE-driven. An onchain address can be paid again after its
 *    transaction has COMPLETED, so walking pending transactions (as the bolt11 path
 *    does) would miss precisely the deposits that need catching.
 *  - MELTS are TRANSACTION-driven. A melt quote is one-shot and terminal, so the
 *    pending transaction IS the outstanding work, and there is nothing to find that a
 *    transaction does not already point at.
 *
 * Neither uses a websocket or a poller: onchain settlement is bounded by block times,
 * so this ~60s cadence is already far finer-grained than what it waits for.
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
    await MeltOperationService.handlePendingOnchainTransferQueue()
}

export const PendingOperationService = {
    handlePendingQueue,
}
