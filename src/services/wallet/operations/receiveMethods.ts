/**
 * Pluggable receive-method registry (extensibility hook).
 *
 * A "receive" brings ecash INTO the wallet from an external source. Each entry
 * in `ReceiveMethodOptions` is an incoming-token format — the way the proofs
 * arrive at the wallet boundary. The discriminator lets `ReceiveOperationApi`
 * accept a typed payload per method without growing a parameter for each
 * format.
 *
 * Today's methods:
 *   - `cashu-token`: standard NUT-00 token (V3/V4) handed to the wallet via
 *      copy-paste, NFC, deep link, or QR scan.
 *
 * The token's *fulfillment path* (online swap vs offline DLEQ-verify) is a
 * mode flag on the options, not a separate method — both share the same
 * underlying receive primitives.
 *
 * Future methods can be added (e.g. raw `proofs-array` from a custom transport,
 * onchain mint receive after NUT-23). Cashu Payment Request fulfillment lives
 * in `cashuPaymentRequestApi.ts` since it has a distinct lifecycle (the wallet
 * issues a request, then waits for proofs to arrive).
 */

import type {Token} from '@cashu/cashu-ts'

export interface ReceiveMethodOptions {
    /**
     * NUT-00 cashu token receive.
     *
     * - `token`: pre-decoded token (saves a re-decode in execute).
     * - `encodedToken`: the original encoded form (preserved on the transaction
     *    so an offline-prepared receive can be completed later from disk).
     * - `offline`: when true, prepare runs DLEQ verification locally without
     *    contacting the mint. execute() must be called later when online to
     *    swap the proofs.
     */
    'cashu-token': {
        token: Token
        encodedToken: string
        offline?: boolean
    }
}

export type ReceiveMethod = keyof ReceiveMethodOptions

export type ReceiveMethodPayload<M extends ReceiveMethod = ReceiveMethod> =
    ReceiveMethodOptions[M]

/**
 * Method-tagged payload, the canonical input shape for
 * `ReceiveOperationApi.prepare`.
 *
 * Example:
 *   { method: 'cashu-token', options: { token, encodedToken, offline: false } }
 */
export type ReceiveMethodInput = {
    method: 'cashu-token'
    options: ReceiveMethodOptions['cashu-token']
}
