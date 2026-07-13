/**
 * Onchain (NUT-30) deposit watcher.
 *
 * Runs off the existing pending-check cadence (handlePendingQueue, which
 * performChecks drives on app start / foreground / WalletScreen focus, debounced).
 * There is no separate poller and no websocket: onchain settlement is bounded by
 * block times, so a ~60s check is already far finer-grained than the thing it is
 * waiting for.
 *
 * The watch set is QUOTE-driven, not transaction-driven — the one structural
 * difference from the bolt11 watcher, which walks PENDING transactions. An onchain
 * address can be paid again after its transaction has COMPLETED, so a
 * transaction-driven sweep would miss exactly the deposits that need catching. The
 * quote rows know whether money is outstanding; the transactions do not.
 *
 * See onchainQuotesRepo for the watch rule itself.
 */
import {log} from '../../logService'
import {Database} from '../../../services'
import {SyncQueue} from '../../syncQueueService'
import {OnchainTopupOperationApi} from './onchainTopupOperationApi'

/**
 * Check every quote the wallet is still watching, minting anything that has been
 * credited but not yet issued.
 *
 * Each quote is queued as its own task so one unreachable mint cannot stall the
 * others, and so a mint that lands mid-sweep does not block the rest.
 */
const handleOnchainQuoteQueue = async (): Promise<void> => {
    const watched = Database.getWatchedOnchainMintQuotes()

    if (watched.length === 0) {
        log.trace('[handleOnchainQuoteQueue] No watched onchain quotes')
        return
    }

    log.trace('[handleOnchainQuoteQueue] start', {watched: watched.length})

    for (const quote of watched) {
        const taskId = `handleOnchainQuoteTask-${quote.quote}-${Date.now()}`
        SyncQueue.addTask(taskId, () => handleOnchainQuoteTask(quote.quote))
    }
}

/**
 * Re-check one quote. Errors are swallowed and logged: an offline mint, or one
 * quote failing, must not abort the sweep — the next tick simply tries again.
 */
const handleOnchainQuoteTask = async (quote: string) => {
    try {
        const result = await OnchainTopupOperationApi.refreshQuote(quote)

        if (result.minted > 0) {
            log.info('[handleOnchainQuoteTask] Minted an onchain deposit', {
                quote,
                minted: result.minted,
                transactionId: result.transactionId,
            })
        }

        return result
    } catch (e: any) {
        log.warn('[handleOnchainQuoteTask]', {quote, error: e.message})
        return {quote, error: e.message}
    }
}

export const OnchainOperationService = {
    handleOnchainQuoteQueue,
    handleOnchainQuoteTask,
}
