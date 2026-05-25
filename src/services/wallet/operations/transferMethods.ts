/**
 * Pluggable transfer-method registry (extensibility hook).
 *
 * A "transfer" pays funds OUT of the mint. Each entry in `TransferMethodOptions`
 * is a payment rail — the way the mint settles the outgoing payment. The
 * discriminator lets `TransferOperationApi` accept a typed payload per method
 * without growing a parameter for each new rail.
 *
 * Today's methods:
 *   - `bolt11`: lightning invoice melt (NUT-05, the only payment rail Minibits
 *      currently supports).
 *
 * Future methods drop in by adding entries here — for example NUT-23 onchain
 * melt would add `onchain: { address, meltQuote: MeltQuoteBtcOnchainResponse }`
 * and the state machine in `TransferOperationApi` stays the same.
 */

import {MeltQuoteBolt11Response} from '@cashu/cashu-ts'

export interface TransferMethodOptions {
    /**
     * NUT-05 BOLT11 lightning melt.
     * - `encodedInvoice`: BOLT11 string the user wants the mint to pay.
     * - `meltQuote`: the mint's response to the melt-quote request (already
     *    fetched by the caller; carries `fee_reserve`, `quote` id, etc.).
     * - `invoiceExpiry`: parsed expiry from the invoice — used to short-circuit
     *    expired invoices before contacting the mint.
     */
    bolt11: {
        encodedInvoice: string
        meltQuote: MeltQuoteBolt11Response
        invoiceExpiry: Date
    }
}

export type TransferMethod = keyof TransferMethodOptions

export type TransferMethodPayload<M extends TransferMethod = TransferMethod> =
    TransferMethodOptions[M]

/**
 * Method-tagged payload, the canonical input shape for
 * `TransferOperationApi.prepare`.
 *
 * Example:
 *   { method: 'bolt11', options: { encodedInvoice, meltQuote, invoiceExpiry } }
 */
export type TransferMethodInput = {
    method: 'bolt11'
    options: TransferMethodOptions['bolt11']
}
