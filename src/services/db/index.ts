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
  getLastTransactionBy,
  getRecentTransactionsByUnitAsync,
  getTransactionsAsync,
  searchTransactionsAsync,
  searchTransactionsCount,
  getPendingTopups,
  getPendingTopupsCount,
  getPendingTransfers,
  getPendingTransfersCount,
  getPendingOnchainTransfers,
  addTransactionAsync,
  updateTransaction,
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
  updateProofsMintUrl,
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
  getInFlightRequestsByMint,
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
  getOnchainMintQuotesByMint,
  getWatchedOnchainMintQuotes,
  updateOnchainMintQuoteAmounts,
  extendOnchainMintQuoteWatch,
} from './onchainQuotesRepo'

export type {TransactionSearchFilters} from './transactionsRepo'
export type {
  LockedProofSnapshot,
  ReservationRow,
  ReservationTransactionUpdate,
} from './reservationsRepo'
export type {CounterRecord, CounterSeed} from './countersRepo'
export {NUT20_COUNTER} from './walletCountersRepo'
export type {OnchainMintQuoteRecord} from './onchainQuotesRepo'
export {ONCHAIN_QUOTE_WATCH_DAYS} from './onchainQuotesRepo'
export type {MeltRecoveryRecord, MeltRecoverySeed} from './meltRecoveryRepo'
export type {InFlightRequestRecord, InFlightRequestSeed} from './inFlightRepo'

export const Database = {
  getInstance,
  getDatabaseVersion,
  cleanAll,
  getTransactionsCount,
  getTransactionById,
  getLastTransactionBy,
  getRecentTransactionsByUnitAsync,
  getTransactionsAsync,
  searchTransactionsAsync,
  searchTransactionsCount,
  getPendingTopups,
  getPendingTopupsCount,
  getPendingTransfers,
  getPendingTransfersCount,
  getPendingOnchainTransfers,
  addTransactionAsync,
  updateTransaction,
  expireAllAfterRecovery,
  updateStatusesAsync,
  deleteTransactionsByStatus,
  deleteTransactionById,
  getIncomingPendingCount,
  deleteIncomingPending,
  getPendingAmount,
  addOrUpdateProof,
  addOrUpdateProofs,
  updateProofsMintUrl,
  removeAllProofs,
  getProofById,
  getProofs,
  getProofsByTransaction,
  getMintBalanceWithMaxBalance,
  openReservation,
  commitReservation,
  rollbackReservation,
  getOpenReservations,
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
  getInFlightRequestsByMint,
  removeInFlightRequest,
  seedInFlightRequests,
  allocateNextCounter,
  getWalletCounter,
  setWalletCounter,
  addOnchainMintQuote,
  getOnchainMintQuote,
  getOnchainMintQuotesByMint,
  getWatchedOnchainMintQuotes,
  updateOnchainMintQuoteAmounts,
  extendOnchainMintQuoteWatch,
}
