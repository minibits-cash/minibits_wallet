/**
 * Public database facade.
 *
 * Assembles the `Database` object from the focused repository modules and
 * re-exports the public types. The `Database.*` shape is a contract consumed
 * across the app (stores, screens, wallet operations) and must stay stable.
 */
import {getInstance, cleanAll} from './instance'
import {getDatabaseVersion} from './migrations'
import {
  getTransactionsCount,
  getTransactionById,
  getAbandonedDraftTransactions,
  getPendingSendAndTopupTransactions,
  getTransactionsByQuoteOrPaymentId,
  getLastTransactionBy,
  getRecentTransactionsByUnitAsync,
  getTransactionsAsync,
  searchTransactionsAsync,
  searchTransactionsCount,
  getTransactionsForNwc,
  getPendingTopups,
  getPendingTopupsCount,
  getPendingTransfers,
  getPendingTransfersCount,
  getPendingOnchainTransfers,
  addTransactionAsync,
  updateTransaction,
  backfillTransactionMintIds,
  expireAllAfterRecovery,
  updateStatusesAsync,
  deleteTransactionsByStatus,
  deleteTransactionById,
  getIncomingPendingCount,
  deleteIncomingPending,
  getPendingAmount,
} from './transactionsRepo'
import {
  addOrUpdateProof,
  addOrUpdateProofs,
  removeAllProofs,
  getProofById,
  getProofs,
  getProofsByTransaction,
  getMintBalanceWithMaxBalance,
} from './proofsRepo'
import {
  openReservation,
  commitReservation,
  rollbackReservation,
  getOpenReservations,
  setReservationCounters,
  backfillReservationMintIds,
} from './reservationsRepo'
import {
  getCounters,
  getCounter,
  setCounter,
  bumpCounter,
  seedCounters,
} from './countersRepo'
import {
  addMeltRecovery,
  getMeltRecovery,
  removeMeltRecovery,
  seedMeltRecoveries,
} from './meltRecoveryRepo'
import {
  addInFlightRequest,
  getInFlightRequest,
  getInFlightRequestsByMintId,
  removeInFlightRequest,
  seedInFlightRequests,
} from './inFlightRepo'
import {
  allocateNextCounter,
  getWalletCounter,
  setWalletCounter,
} from './walletCountersRepo'
import {
  addOnchainMintQuote,
  getOnchainMintQuote,
  getOnchainMintQuotesByMintId,
  backfillOnchainMintQuoteMintIds,
  getWatchedOnchainMintQuotes,
  updateOnchainMintQuoteAmounts,
  extendOnchainMintQuoteWatch,
} from './onchainQuotesRepo'
import {
  upsertMint,
  getMints,
  removeMintById,
  updateMintUrl as updateMintUrlWithProofs,
  seedMints,
} from './mintsRepo'
import {
  addMessage,
  updateMessage,
  getMessages,
  getConversationSummaries,
  markMessagesRead,
  deleteMessage,
  deleteMessages,
} from './messagesRepo'

export type {TransactionSearchFilters, NwcTransactionQuery} from './transactionsRepo'
export type {
  LockedProofSnapshot,
  ReservationRow,
  ReservationCounters,
  ReservationTransactionUpdate,
} from './reservationsRepo'
export type {CounterRecord, CounterSeed} from './countersRepo'
export {NUT20_COUNTER} from './walletCountersRepo'
export type {OnchainMintQuoteRecord} from './onchainQuotesRepo'
export {ONCHAIN_QUOTE_WATCH_DAYS} from './onchainQuotesRepo'
export type {MeltRecoveryRecord, MeltRecoverySeed} from './meltRecoveryRepo'
export type {InFlightRequestRecord, InFlightRequestSeed} from './inFlightRepo'
export type {MintRecord} from './mintsRepo'
export type {MessageRecord, ConversationSummary} from './messagesRepo'
export {MessageDirection, MessageTransport, MessageStatus} from './messagesRepo'

export const Database = {
  getInstance,
  upsertMint,
  getMints,
  removeMintById,
  updateMintUrlWithProofs,
  seedMints,
  getDatabaseVersion,
  cleanAll,
  getTransactionsCount,
  getTransactionById,
  getAbandonedDraftTransactions,
  getPendingSendAndTopupTransactions,
  getTransactionsByQuoteOrPaymentId,
  getLastTransactionBy,
  getRecentTransactionsByUnitAsync,
  getTransactionsAsync,
  searchTransactionsAsync,
  searchTransactionsCount,
  getTransactionsForNwc,
  getPendingTopups,
  getPendingTopupsCount,
  getPendingTransfers,
  getPendingTransfersCount,
  getPendingOnchainTransfers,
  addTransactionAsync,
  updateTransaction,
  backfillTransactionMintIds,
  expireAllAfterRecovery,
  updateStatusesAsync,
  deleteTransactionsByStatus,
  deleteTransactionById,
  getIncomingPendingCount,
  deleteIncomingPending,
  getPendingAmount,
  addOrUpdateProof,
  addOrUpdateProofs,
  removeAllProofs,
  getProofById,
  getProofs,
  getProofsByTransaction,
  getMintBalanceWithMaxBalance,
  openReservation,
  commitReservation,
  rollbackReservation,
  getOpenReservations,
  setReservationCounters,
  backfillReservationMintIds,
  getCounters,
  getCounter,
  setCounter,
  bumpCounter,
  seedCounters,
  addMeltRecovery,
  getMeltRecovery,
  removeMeltRecovery,
  seedMeltRecoveries,
  addInFlightRequest,
  getInFlightRequest,
  getInFlightRequestsByMintId,
  removeInFlightRequest,
  seedInFlightRequests,
  allocateNextCounter,
  getWalletCounter,
  setWalletCounter,
  addOnchainMintQuote,
  getOnchainMintQuote,
  getOnchainMintQuotesByMintId,
  backfillOnchainMintQuoteMintIds,
  getWatchedOnchainMintQuotes,
  updateOnchainMintQuoteAmounts,
  extendOnchainMintQuoteWatch,
  addMessage,
  updateMessage,
  getMessages,
  getConversationSummaries,
  markMessagesRead,
  deleteMessage,
  deleteMessages,
}
