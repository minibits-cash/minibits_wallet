/**
 * The NIP-47 transaction object, and the mapping from a wallet transaction onto it.
 *
 * Split out of NwcStore so the wire shape can be exercised without loading the
 * whole store (nostr, notifee, firebase); NwcStore owns the protocol handlers,
 * this owns what a transaction looks like once it leaves the wallet.
 */
import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils.js'
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
    /** The serialized zap request for a zap, per NIP-57; the wallet memo otherwise. */
    description: string | null
    preimage: string | null
    payment_hash: string | null
    /** msats, per NIP-47 — as is fees_paid. The wallet stores sats. */
    amount: number
    fees_paid: number | null
    created_at: number
    settled_at: number | null
    expires_at: number | null
    /** NWC-06 metadata; carries the zap request as `nostr` for a zap. */
    metadata?: {nostr: object}
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
        // NIP-57: a zap's invoice description IS the signed kind-9734 zap request, and
        // clients recover the sender, comment and zapped note from it. Ecash received at
        // a lightning address has no bolt11 to carry it, so it would otherwise reach the
        // client as an anonymous credit — the memo alone attributes nothing. Falls back to
        // the memo, which is the zap request's own `content` when there is one.
        description: t.zapRequest ?? t.memo ?? null,
        preimage: t.proof ?? null,
        payment_hash: t.paymentId ?? null,
        amount: t.amount * 1000,
        fees_paid: (t.fee ?? 0) * 1000,
        created_at: toUnixSeconds(t.createdAt),
        // An unsettled transaction has no settlement time. Reporting createdAt here
        // told clients an invoice they are still waiting on had already been paid.
        settled_at: isSettled ? toUnixSeconds(t.createdAt) : null,
        expires_at: t.expiresAt ? toUnixSeconds(t.expiresAt) : null,
        metadata: toZapMetadata(t.zapRequest),
    }
}

const toZapMetadata = function (zapRequest?: string | null) {
    if (!zapRequest) return undefined
    try {
        return {nostr: JSON.parse(zapRequest)}
    } catch (e) {
        return undefined
    }
}

/**
 * The NIP-57 zap request a client attached to pay_invoice as NWC-06 `metadata.nostr`,
 * serialized for the transaction's zapRequest column — but only when the invoice
 * commits to it (its description_hash is the sha256 of the zap request). The client
 * may send anything; an unverified one could label the payment with a note it
 * never zapped.
 */
export const getVerifiedZapRequest = function (
    metadata: any,
    descriptionHash?: string,
): string | undefined {
    const nostr = metadata?.nostr
    if (!nostr || !descriptionHash) return undefined

    // Must be hashed as the lnurl server received it. Clients send JSON.stringify of
    // the event, which a parse/stringify round-trip reproduces; a string is taken verbatim.
    const zapRequest = typeof nostr === 'string' ? nostr : JSON.stringify(nostr)

    return bytesToHex(sha256(utf8ToBytes(zapRequest))) === descriptionHash.toLowerCase()
        ? zapRequest
        : undefined
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
