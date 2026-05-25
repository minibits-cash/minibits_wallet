/**
 * Pluggable send-method registry (extensibility hook).
 *
 * Each entry in `SendMethodOptions` is a send "method" — the way a token is
 * locked or made claimable. The discriminator lets `SendOperationApi` accept
 * a typed payload per method without growing a parameter for each method.
 *
 * Today's methods:
 *   - `default`: plain sendable token (anyone with the token can claim)
 *   - `p2pk`: token locked to a public key (NUT-11)
 *
 * Future methods drop in by adding entries here — for example HTLC sends
 * would add `htlc: { hash: string; timeout: number }`. The same shape will
 * extend cleanly to onchain mint/melt method registries in a separate file
 * (`mintMethods.ts` / `meltMethods.ts`) when those operations are migrated.
 */

export interface SendMethodOptions {
    /** No method-specific payload — token is shareable as-is. */
    default: Record<string, never>

    /**
     * NUT-11 Pay-to-Public-Key locked send.
     * - `pubkey`: hex-encoded compressed secp256k1 public key the recipient holds.
     * - `locktime`: optional unix-seconds after which the lock expires.
     * - `refundKeys`: optional pubkeys allowed to claim after `locktime`.
     */
    p2pk: {
        pubkey: string
        locktime?: number
        refundKeys?: string[]
    }
}

export type SendMethod = keyof SendMethodOptions

export type SendMethodPayload<M extends SendMethod = SendMethod> = SendMethodOptions[M]

/**
 * Method-tagged payload, the canonical input shape for
 * `SendOperationApi.prepare` (and the future per-method handler dispatch).
 *
 * Examples:
 *   { method: 'default', options: {} }
 *   { method: 'p2pk',    options: { pubkey: '02ab…' } }
 */
export type SendMethodInput =
    | {method: 'default'; options: SendMethodOptions['default']}
    | {method: 'p2pk'; options: SendMethodOptions['p2pk']}
