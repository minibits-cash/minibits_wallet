import {Transaction} from '../../models/Transaction'

// Helper functions to normalize transaction records with Date objects
export const normalizeTransactionRecord = function (r: any) {
  if (r.createdAt) r.createdAt = new Date(r.createdAt)
  if (r.expiresAt) r.expiresAt = r.expiresAt ? new Date(r.expiresAt) : null
  return r as Transaction
}

export const normalizeTransactionRows = function (rows: any) {
  return rows?._array.map(normalizeTransactionRecord) as Transaction[]
}
