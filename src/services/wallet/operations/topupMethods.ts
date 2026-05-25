/**
 * Pluggable topup-method registry (extensibility hook).
 *
 * A "topup" pays funds INTO the mint and receives freshly-minted ecash. Each
 * entry in `TopupMethodOptions` is a funding rail — the way the user pays the
 * mint. The discriminator lets `TopupOperationApi` accept a typed payload per
 * method without growing a parameter for each new rail.
 *
 * Today's methods:
 *   - `bolt11`: lightning invoice mint (NUT-04, the only funding rail Minibits
 *      currently supports).
 *
 * Future methods drop in by adding entries here — for example NUT-23 onchain
 * mint would add `onchain: { address, ... }` and the state machine in
 * `TopupOperationApi` stays the same (only the wait/poll logic differs).
 */

import {Contact} from '../../../models/Contact'

export interface TopupMethodOptions {
    /**
     * NUT-04 BOLT11 lightning mint.
     * - `contactToSendTo`: optional contact the invoice is shared with — stored
     *    on the transaction as `sentFrom` for display in the history (the
     *    contact is the one paying us, so they're the "from" party).
     */
    bolt11: {
        contactToSendTo?: Contact
    }
}

export type TopupMethod = keyof TopupMethodOptions

export type TopupMethodPayload<M extends TopupMethod = TopupMethod> =
    TopupMethodOptions[M]

/**
 * Method-tagged payload, the canonical input shape for
 * `TopupOperationApi.prepare`.
 *
 * Example:
 *   { method: 'bolt11', options: { contactToSendTo } }
 */
export type TopupMethodInput = {
    method: 'bolt11'
    options: TopupMethodOptions['bolt11']
}
