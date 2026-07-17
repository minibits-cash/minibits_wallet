/**
 * Pluggable transfer-method registry (extensibility hook).
 *
 * A "transfer" pays funds OUT of the mint. Each entry in `TransferMethodOptions`
 * is a payment rail — the way the mint settles the outgoing payment. The
 * discriminator lets `TransferOperationApi` accept a typed payload per method
 * without growing a parameter for each new rail.
 *
 * Today's methods:
 *   - `bolt11`: lightning invoice melt (NUT-05).
 *   - `onchain`: Bitcoin onchain melt (NUT-30).
 *
 * The two rails share ONE lifecycle. That is the point of this file: proof
 * reservation, the preemptive swap, and the execute-error recovery matrix (re-check
 * the quote, distinguish paid-despite-error from already-spent from pending-at-mint)
 * are the most safety-critical code in the wallet, and there is exactly one copy of
 * them. What actually differs between rails is small and local — where the fee
 * reserve comes from, what identifies the payment, what the destination is called —
 * and lives in `resolveTransferMethod` below.
 */

import {MeltQuoteBolt11Response, MeltQuoteOnchainResponse} from '@cashu/cashu-ts'
import {TransactionType} from '../../../models/Transaction'
import {LightningUtils} from '../../lightning/lightningUtils'

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
    /**
     * NUT-30 onchain melt.
     * - `address`: the Bitcoin address the mint will pay. MAINNET only — see
     *    `BitcoinUtils.isPayableBitcoinAddress`.
     * - `meltQuote`: the mint's melt quote. Unlike bolt11 it carries no single
     *    `fee_reserve` but a list of `fee_options` tiers, fixed for the quote's life.
     * - `feeIndex`: the tier the user picked, by the mint's `fee_index` (which is an
     *    identifier, NOT a rank). Locks on execute — once the mint sets
     *    `selected_fee_index` it MUST NOT execute the quote with a different one.
     * - `quoteExpiry`: when the QUOTE stops being executable. Emphatically not when
     *    the payment stops being settleable: a broadcast transaction can take many
     *    blocks to confirm, long after this passes. Nothing may expire a transfer on
     *    the strength of it once the melt has been submitted.
     */
    onchain: {
        address: string
        meltQuote: MeltQuoteOnchainResponse
        feeIndex: number
        quoteExpiry: Date
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
 *   { method: 'onchain', options: { address, meltQuote, feeIndex, quoteExpiry } }
 */
export type TransferMethodInput = {
    [M in TransferMethod]: {method: M; options: TransferMethodOptions[M]}
}[TransferMethod]

/**
 * Everything the shared transfer lifecycle needs to know about a rail, resolved from
 * the method payload in one place.
 *
 * The lifecycle reads these instead of branching on `method` at each site it needs a
 * fee or an expiry, so adding a rail means adding a case here rather than hunting for
 * every `if (method === 'bolt11')` in a 1200-line file.
 */
export interface ResolvedTransferMethod {
    method: TransferMethod
    /** Transaction type this rail records. */
    transactionType: TransactionType
    /** Quote id, as the mint knows it. */
    quoteId: string
    /**
     * The fee the mint may charge to settle the payment, on top of the amount.
     * bolt11: the quote's `fee_reserve`. onchain: the SELECTED tier's `fee_reserve`.
     * Either way the mint returns whatever it does not spend as NUT-08 change.
     */
    feeReserve: number
    /** Where the money is going, as the user typed or scanned it. */
    paymentRequest: string
    /** Rail-native payment identifier: the payment hash for bolt11, none for onchain. */
    paymentId?: string
    /** When the quote stops being executable. */
    expiry: Date
    /**
     * Does an expired quote mean the transfer itself is dead?
     *
     * bolt11: yes — an expired invoice cannot be paid, so there is nothing to wait for.
     * onchain: NO. The expiry bounds executing the QUOTE, not confirming the PAYMENT.
     * Once the mint has broadcast, the transaction confirms on the chain's schedule
     * and may well outlive the quote. Expiring the transfer then would mark a real,
     * in-flight payment dead and hide it from the user.
     */
    expiresPendingTransfer: boolean
}

export const resolveTransferMethod = (
    input: TransferMethodInput,
): ResolvedTransferMethod => {
    switch (input.method) {
        case 'bolt11': {
            const {meltQuote, encodedInvoice, invoiceExpiry} = input.options
            return {
                method: 'bolt11',
                transactionType: TransactionType.TRANSFER,
                quoteId: meltQuote.quote,
                feeReserve: meltQuote.fee_reserve.toNumber(),
                paymentRequest: encodedInvoice,
                paymentId: LightningUtils.getInvoiceData(
                    LightningUtils.decodeInvoice(encodedInvoice),
                ).payment_hash,
                expiry: invoiceExpiry,
                expiresPendingTransfer: true,
            }
        }
        case 'onchain': {
            const {meltQuote, address, feeIndex, quoteExpiry} = input.options
            const tier = meltQuote.fee_options.find(o => o.fee_index === feeIndex)

            if (!tier) {
                // The mint MUST reject a fee_index it never offered, so failing here
                // saves a round-trip and a burned quote.
                throw new Error(
                    `Fee index ${feeIndex} was not offered by the mint for quote ${meltQuote.quote}`,
                )
            }

            return {
                method: 'onchain',
                transactionType: TransactionType.TRANSFER_ONCHAIN,
                quoteId: meltQuote.quote,
                feeReserve: tier.fee_reserve.toNumber(),
                paymentRequest: address,
                expiry: quoteExpiry,
                expiresPendingTransfer: false,
            }
        }
    }
}
