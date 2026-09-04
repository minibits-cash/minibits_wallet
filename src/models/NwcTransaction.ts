/**
 * The NIP-47 transaction object, and the mapping from a wallet transaction onto it.
 *
 * Split out of NwcStore so the wire shape can be exercised without loading the
 * whole store (nostr, notifee, firebase); NwcStore owns the protocol handlers,
 * this owns what a transaction looks like once it leaves the wallet.
 */
import type {NwcTransactionQuery} from '../services/db'
import {
    getTransactionDirection,
    Transaction,
    TransactionDirection,
    TransactionStatus,
} from './Transaction'

export type NwcTransaction = {
    type: TransactionDirection
    /** Null for ecash that never had a bolt11 invoice — a token, or a payment request. */
    invoice: string | null
    description: string | null
    preimage: string | null
    payment_hash: string | null
    /** msats, per NIP-47 — as is fees_paid. The wallet stores sats. */
    amount: number
    fees_paid: number | null
    created_at: number
    settled_at: number | null
    expires_at: number | null
}

// NIP-47 leaves list_transactions paging to the wallet: reply with a sane page when
// the client asks for none, and never let one request drag a whole history through
// a single nostr event.
export const DEFAULT_LIST_TRANSACTIONS = 50
export const MAX_LIST_TRANSACTIONS = 200

const toUnixSeconds = (date: Date) => Math.floor(date.getTime() / 1000)

/**
 * A wallet transaction as a NIP-47 transaction object.
 *
 * `type` is derived from the transaction type, never hardcoded: over NWC an
 * incoming payment is as likely to be ecash received at the wallet's lightning
 * address (RECEIVE) as a bolt11 topup, and lookup_invoice may be asked about an
 * outgoing one.
 */
export const toNwcTransaction = function (t: Transaction): NwcTransaction {
    const isSettled =
        t.status === TransactionStatus.COMPLETED || t.status === TransactionStatus.RECOVERED

    return {
        type: getTransactionDirection(t.type),
        invoice: t.paymentRequest ?? null,
        description: t.memo ?? null,
        preimage: t.proof ?? null,
        payment_hash: t.paymentId ?? null,
        amount: t.amount * 1000,
        fees_paid: (t.fee ?? 0) * 1000,
        created_at: toUnixSeconds(t.createdAt),
        // An unsettled transaction has no settlement time. Reporting createdAt here
        // told clients an invoice they are still waiting on had already been paid.
        settled_at: isSettled ? toUnixSeconds(t.createdAt) : null,
        expires_at: t.expiresAt ? toUnixSeconds(t.expiresAt) : null,
    }
}

/**
 * NIP-47 `list_transactions` params as a database query.
 *
 * The params come off the wire from an untrusted client, so every one of them is
 * validated rather than passed through: a missing or nonsense limit becomes the
 * default page, a huge one is capped, and unrecognised `type` values mean "both
 * directions" instead of silently matching nothing.
 */
export const toNwcTransactionQuery = function (params: any): NwcTransactionQuery {
    const {from, until, limit, offset, unpaid, type} = params ?? {}

    return {
        unit: 'sat', // NWC is sats-only; another unit's amounts would be reported as msats
        direction: type === 'incoming' || type === 'outgoing' ? type : undefined,
        from: Number.isFinite(from) ? new Date(from * 1000) : undefined,
        until: Number.isFinite(until) ? new Date(until * 1000) : undefined,
        unpaid: unpaid === true,
        limit: Number.isFinite(limit)
            ? Math.min(Math.max(Math.floor(limit), 1), MAX_LIST_TRANSACTIONS)
            : DEFAULT_LIST_TRANSACTIONS,
        offset: Number.isFinite(offset) ? Math.max(Math.floor(offset), 0) : 0,
    }
}
