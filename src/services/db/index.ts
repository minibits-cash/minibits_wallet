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
} from './proofsRepo'
import {
  openReservation,
  commitReservation,
  rollbackReservation,
  getOpenReservations,
} from './reservationsRepo'

export type {TransactionSearchFilters} from './transactionsRepo'
export type {
  LockedProofSnapshot,
  ReservationRow,
  ReservationTransactionUpdate,
} from './reservationsRepo'

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
  openReservation,
  commitReservation,
  rollbackReservation,
  getOpenReservations,
}
