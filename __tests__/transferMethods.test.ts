/**
 * The transfer-method resolver: the one place the two melt rails differ.
 *
 * `TransferOperationApi` reads everything rail-specific from here instead of branching
 * on `method` at each site that needs a fee or an expiry, so this is where a mistake
 * about a rail would actually live. Worth pinning:
 *
 *  - where the fee reserve comes from (a field on the quote vs the SELECTED tier),
 *  - that an onchain transfer is never expirable,
 *  - that a fee_index the mint never offered is refused before it reaches the mint.
 *
 * @jest-environment node
 */
// Transaction.ts -> services -> logService -> @sentry/react-native (ESM, not transformed)
// and on into the MST store graph + op-sqlite. Mock the chain so the test stays pure,
// same as transactionStates.test.ts.
jest.mock('../src/services/logService', () => ({
    log: {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        trace: jest.fn(),
        warn: jest.fn(),
    },
    LogLevel: {ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG', TRACE: 'TRACE'},
}))
jest.mock('../src/services', () => ({
    log: {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        trace: jest.fn(),
        warn: jest.fn(),
    },
    Database: {},
}))

import {resolveTransferMethod} from '../src/services/wallet/operations/transferMethods'
import {TransactionType} from '../src/models/Transaction'

/** cashu-ts hands amounts over as Amount objects, not numbers. */
const amount = (n: number) => ({toNumber: () => n}) as any

const onchainQuote = (feeOptions: Array<[number, number, number]>) =>
    ({
        quote: 'quote-onchain-1',
        amount: amount(50000),
        unit: 'sat',
        state: 'UNPAID',
        expiry: 1800000000,
        request: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        fee_options: feeOptions.map(([fee_index, fee_reserve, estimated_blocks]) => ({
            fee_index,
            fee_reserve: amount(fee_reserve),
            estimated_blocks,
        })),
        selected_fee_index: null,
        outpoint: null,
    }) as any

describe('resolveTransferMethod — onchain', () => {
    const QUOTE_EXPIRY = new Date('2027-01-01T00:00:00Z')
    const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

    const resolveOnchain = (feeIndex: number, feeOptions: Array<[number, number, number]>) =>
        resolveTransferMethod({
            method: 'onchain',
            options: {
                address: ADDRESS,
                meltQuote: onchainQuote(feeOptions),
                feeIndex,
                quoteExpiry: QUOTE_EXPIRY,
            },
        })

    it('records the onchain transaction type', () => {
        const resolved = resolveOnchain(0, [[0, 400, 6]])
        expect(resolved.transactionType).toBe(TransactionType.TRANSFER_ONCHAIN)
        expect(resolved.method).toBe('onchain')
    })

    // An onchain quote has NO fee_reserve field — it has a list of tiers, and the reserve
    // depends entirely on which one the user picked.
    it('takes the fee reserve from the SELECTED tier', () => {
        const tiers: Array<[number, number, number]> = [
            [0, 400, 6],
            [1, 900, 3],
            [2, 2100, 1],
        ]
        expect(resolveOnchain(0, tiers).feeReserve).toBe(400)
        expect(resolveOnchain(1, tiers).feeReserve).toBe(900)
        expect(resolveOnchain(2, tiers).feeReserve).toBe(2100)
    })

    // fee_index is the mint's identifier for a tier, not its position in the array.
    it('selects by the mint\'s fee_index, not by array position', () => {
        const tiers: Array<[number, number, number]> = [
            [7, 2100, 1],
            [3, 400, 6],
        ]
        expect(resolveOnchain(3, tiers).feeReserve).toBe(400)
        expect(resolveOnchain(7, tiers).feeReserve).toBe(2100)
    })

    // The mint MUST reject a fee_index it never offered, so catching it locally saves a
    // round-trip and a quote that can then never be executed with a different index.
    it('refuses a fee_index the mint never offered', () => {
        expect(() => resolveOnchain(5, [[0, 400, 6]])).toThrow(/Fee index 5 was not offered/)
    })

    /**
     * THE rule that keeps a real payment from being declared dead.
     *
     * A melt quote's expiry bounds EXECUTING the quote, not CONFIRMING the payment. Once
     * the mint has broadcast, the transaction confirms on the chain's schedule and can
     * easily outlive the quote it came from. If anything ever expires a pending onchain
     * transfer on the strength of this date, it marks an irreversible, in-flight payment
     * as failed and hides it from the user.
     */
    it('is never expirable once pending', () => {
        expect(resolveOnchain(0, [[0, 400, 6]]).expiresPendingTransfer).toBe(false)
    })

    it('carries the address as the payment request and has no payment id', () => {
        const resolved = resolveOnchain(0, [[0, 400, 6]])
        expect(resolved.paymentRequest).toBe(ADDRESS)
        // Onchain has no preimage-style identifier. It gets an `outpoint` once broadcast.
        expect(resolved.paymentId).toBeUndefined()
    })

    it('passes the quote id and expiry through', () => {
        const resolved = resolveOnchain(0, [[0, 400, 6]])
        expect(resolved.quoteId).toBe('quote-onchain-1')
        expect(resolved.expiry).toBe(QUOTE_EXPIRY)
    })
})

describe('resolveTransferMethod — bolt11', () => {
    // BOLT11 spec test vector (2500 µBTC). Must actually decode — resolveTransferMethod
    // derives the payment hash from it.
    const INVOICE =
        'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp'

    const invoiceExpiry = new Date('2027-01-01T00:00:00Z')

    const bolt11Quote = {
        quote: 'quote-bolt11-1',
        amount: amount(1000),
        unit: 'sat',
        state: 'UNPAID',
        expiry: 1800000000,
        request: INVOICE,
        fee_reserve: amount(12),
        payment_preimage: null,
    } as any

    it('takes the fee reserve straight off the quote and stays expirable', () => {
        const resolved = resolveTransferMethod({
            method: 'bolt11',
            options: {encodedInvoice: INVOICE, meltQuote: bolt11Quote, invoiceExpiry},
        })

        expect(resolved.method).toBe('bolt11')
        expect(resolved.transactionType).toBe(TransactionType.TRANSFER)
        expect(resolved.feeReserve).toBe(12)
        expect(resolved.paymentRequest).toBe(INVOICE)
        // An expired invoice genuinely cannot be paid, so there IS nothing left to wait for.
        expect(resolved.expiresPendingTransfer).toBe(true)
        // bolt11 settles with a preimage, and the payment hash identifies it beforehand.
        expect(typeof resolved.paymentId).toBe('string')
        expect(resolved.paymentId).toHaveLength(64)
    })
})
