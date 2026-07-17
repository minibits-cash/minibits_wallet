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
export type {MintRecord} from './mintsRepo'

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
}
