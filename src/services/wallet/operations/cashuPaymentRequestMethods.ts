/**
 * Pluggable transport-method registry for Cashu Payment Requests (NUT-18).
 *
 * A Cashu Payment Request advertises "send me this much ecash, on this mint,
 * via this transport." The transport determines where the payer sends the
 * proofs. Each entry in `CashuPaymentRequestMethodOptions` is a transport
 * channel.
 *
 * Today's methods:
 *   - `nostr`: NUT-18 transport via Nostr DM (NIP-17 / gift-wrap), the only
 *      transport Minibits currently supports.
 *
 * Future methods can add HTTP POST transports, BIP-353 lookups, etc.
 */

export interface CashuPaymentRequestMethodOptions {
    /**
     * NUT-18 Nostr-DM transport.
     *
     * No method-specific payload — the wallet's own Nostr profile and configured
     * relays drive the transport target.
     */
    nostr: Record<string, never>
}

export type CashuPaymentRequestMethod = keyof CashuPaymentRequestMethodOptions

export type CashuPaymentRequestMethodPayload<
    M extends CashuPaymentRequestMethod = CashuPaymentRequestMethod,
> = CashuPaymentRequestMethodOptions[M]

/**
 * Method-tagged payload, the canonical input shape for
 * `CashuPaymentRequestApi.prepare`.
 *
 * Example:
 *   { method: 'nostr', options: {} }
 */
export type CashuPaymentRequestMethodInput = {
    method: 'nostr'
    options: CashuPaymentRequestMethodOptions['nostr']
}
