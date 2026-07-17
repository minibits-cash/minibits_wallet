/**
 * Onchain (NUT-30) melt arithmetic: fee-tier selection and the payout floor.
 *
 * Same split as the topup arithmetic tests — jest pins the pure decisions, device
 * testing covers the orchestration. What matters here is that the wallet never
 * silently spends more of the user's money on miner fees than it was asked to, and
 * never ranks fee tiers by a field that is not a rank.
 *
 * @jest-environment node
 */
import {
    findFeeOption,
    mockOnchainFeeTiers,
    normalizeFeeOptions,
    onchainMeltFloor,
    onchainMeltTotal,
    payableFeeIndex,
    selectDefaultFeeOption,
    MINIBITS_ONCHAIN_MELT_FLOOR_SAT,
} from '../src/services/wallet/operations/onchainAmounts'

/** cashu-ts hands `fee_reserve` over as an Amount object, not a number. */
const amount = (n: number) => ({toNumber: () => n})

describe('normalizeFeeOptions', () => {
    it('unwraps cashu-ts Amount objects into plain numbers', () => {
        const options = normalizeFeeOptions([
            {fee_index: 0, fee_reserve: amount(400), estimated_blocks: 6},
        ])
        expect(options).toEqual([{feeIndex: 0, feeReserve: 400, estimatedBlocks: 6}])
    })

    it('accepts plain numbers too', () => {
        const options = normalizeFeeOptions([
            {fee_index: 0, fee_reserve: 400, estimated_blocks: 6},
        ])
        expect(options[0].feeReserve).toBe(400)
    })

    it('sorts cheapest first', () => {
        const options = normalizeFeeOptions([
            {fee_index: 0, fee_reserve: amount(2100), estimated_blocks: 1},
            {fee_index: 1, fee_reserve: amount(400), estimated_blocks: 6},
            {fee_index: 2, fee_reserve: amount(900), estimated_blocks: 3},
        ])
        expect(options.map(o => o.feeReserve)).toEqual([400, 900, 2100])
    })

    // fee_index is the mint's IDENTIFIER for a tier, not its rank. A mint is free to
    // hand back the expensive tier as fee_index 0 — selecting by position without
    // sorting first would then pick the most expensive option as the "cheap" default.
    it('does not assume fee_index encodes the ranking', () => {
        const options = normalizeFeeOptions([
            {fee_index: 7, fee_reserve: amount(2100), estimated_blocks: 1},
            {fee_index: 3, fee_reserve: amount(400), estimated_blocks: 6},
        ])
        expect(options[0].feeIndex).toBe(3)
        expect(options[0].feeReserve).toBe(400)
    })

    it('handles an empty list without throwing', () => {
        expect(normalizeFeeOptions([])).toEqual([])
    })
})

describe('selectDefaultFeeOption', () => {
    const tiers = (...reserves: number[]) =>
        normalizeFeeOptions(
            reserves.map((r, i) => ({
                fee_index: i,
                fee_reserve: amount(r),
                estimated_blocks: reserves.length - i,
            })),
        )

    // The CDK fakewallet returns exactly one option. The picker must not ask the user
    // to choose from a list of one.
    it('returns the only option when the mint offers one tier', () => {
        const selected = selectDefaultFeeOption(tiers(400))
        expect(selected?.feeReserve).toBe(400)
    })

    it('picks the middle tier when there is a true middle', () => {
        expect(selectDefaultFeeOption(tiers(400, 900, 2100))?.feeReserve).toBe(900)
        expect(selectDefaultFeeOption(tiers(100, 200, 300, 400, 500))?.feeReserve).toBe(300)
    })

    // With an even count there is no true middle. Round DOWN: the user can always
    // choose to pay more, but a wallet must never round a fee up on their behalf.
    it('rounds to the cheaper side when there is no true middle', () => {
        expect(selectDefaultFeeOption(tiers(400, 2100))?.feeReserve).toBe(400)
        expect(selectDefaultFeeOption(tiers(100, 200, 300, 400))?.feeReserve).toBe(200)
    })

    it('is undefined when the mint returned no tiers', () => {
        // NUT-30 forbids this ("The mint MUST return at least one fee_options item"),
        // so callers treat it as a broken quote rather than inventing a fee.
        expect(selectDefaultFeeOption([])).toBeUndefined()
    })
})

describe('findFeeOption', () => {
    const options = normalizeFeeOptions([
        {fee_index: 7, fee_reserve: amount(2100), estimated_blocks: 1},
        {fee_index: 3, fee_reserve: amount(400), estimated_blocks: 6},
    ])

    it('looks a tier up by the mint\'s fee_index, not by position', () => {
        expect(findFeeOption(options, 7)?.feeReserve).toBe(2100)
        expect(findFeeOption(options, 3)?.feeReserve).toBe(400)
    })

    it('is undefined for a fee_index the mint never offered', () => {
        // The mint MUST reject a melt with an unoffered fee_index, so catching it here
        // saves a round-trip and a burned quote.
        expect(findFeeOption(options, 0)).toBeUndefined()
    })
})

describe('onchainMeltFloor', () => {
    it('applies our own floor when the mint asks for less', () => {
        expect(onchainMeltFloor('sat', 1)).toBe(MINIBITS_ONCHAIN_MELT_FLOOR_SAT)
        expect(onchainMeltFloor('sat', 546)).toBe(MINIBITS_ONCHAIN_MELT_FLOOR_SAT)
    })

    it('defers to the mint when it asks for more', () => {
        expect(onchainMeltFloor('sat', 50000)).toBe(50000)
    })

    it('applies our floor when the mint advertises nothing usable', () => {
        expect(onchainMeltFloor('sat')).toBe(MINIBITS_ONCHAIN_MELT_FLOOR_SAT)
        expect(onchainMeltFloor('sat', 0)).toBe(MINIBITS_ONCHAIN_MELT_FLOOR_SAT)
        expect(onchainMeltFloor('sat', null)).toBe(MINIBITS_ONCHAIN_MELT_FLOOR_SAT)
    })

    // The floor is denominated in sats, so it means nothing for other units.
    it('defers entirely to the mint for non-sat units', () => {
        expect(onchainMeltFloor('usd', 5)).toBe(5)
        expect(onchainMeltFloor('usd')).toBe(0)
    })

    it('clears every script type\'s dust limit', () => {
        // P2PKH dust is 546, P2WSH 330. An output below that is unspendable.
        expect(MINIBITS_ONCHAIN_MELT_FLOOR_SAT).toBeGreaterThan(546)
    })
})

describe('mockOnchainFeeTiers (debug-only picker mock)', () => {
    const realTier = normalizeFeeOptions([
        {fee_index: 0, fee_reserve: amount(400), estimated_blocks: 6},
    ])

    it('turns the fakewallet\'s single tier into three', () => {
        const tiers = mockOnchainFeeTiers(realTier)
        expect(tiers).toHaveLength(3)
        expect(tiers.map(t => t.feeReserve)).toEqual([160, 400, 1000])
    })

    /**
     * The load-bearing property. NUT-30: "The mint MUST reject a melt request with a
     * fee_index that was not returned in the quote." So the mint's own tier has to survive
     * the mock intact — it is the only index that can actually be paid with.
     */
    it('keeps the mint\'s real tier untouched, and marks only the invented ones', () => {
        const tiers = mockOnchainFeeTiers(realTier)
        const real = tiers.filter(t => !t.isMock)

        expect(real).toHaveLength(1)
        expect(real[0]).toEqual({feeIndex: 0, feeReserve: 400, estimatedBlocks: 6, isMock: false})
        expect(tiers.filter(t => t.isMock)).toHaveLength(2)
    })

    it('gives invented tiers indices that cannot collide with the mint\'s', () => {
        const tiers = mockOnchainFeeTiers(realTier)
        const indices = tiers.map(t => t.feeIndex)
        expect(new Set(indices).size).toBe(3)
        for (const mock of tiers.filter(t => t.isMock)) {
            expect(mock.feeIndex).not.toBe(0)
        }
    })

    // Overwriting tiers a mint really sent with invented ones would be worse than useless.
    it('is a no-op when the mint already offered more than one tier', () => {
        const realTiers = normalizeFeeOptions([
            {fee_index: 0, fee_reserve: amount(400), estimated_blocks: 6},
            {fee_index: 1, fee_reserve: amount(900), estimated_blocks: 3},
        ])
        expect(mockOnchainFeeTiers(realTiers)).toBe(realTiers)
    })

    it('is a no-op on an empty list', () => {
        expect(mockOnchainFeeTiers([])).toEqual([])
    })
})

describe('payableFeeIndex', () => {
    const tiers = mockOnchainFeeTiers(
        normalizeFeeOptions([{fee_index: 3, fee_reserve: amount(400), estimated_blocks: 6}]),
    )

    it('is the identity for a real tier', () => {
        const real = tiers.find(t => !t.isMock)!
        expect(payableFeeIndex(tiers, real)).toBe(3)
    })

    /**
     * Selecting a fabricated tier must still submit an index the mint offered, or the melt
     * is rejected outright. The CHOICE is mocked; the payment is real, at the mint's real
     * price.
     */
    it('falls back to the mint\'s real index for a fabricated tier', () => {
        for (const mock of tiers.filter(t => t.isMock)) {
            expect(payableFeeIndex(tiers, mock)).toBe(3)
        }
    })

    it('is undefined when there is no real tier to fall back to', () => {
        const orphan = {feeIndex: 99, feeReserve: 1, estimatedBlocks: 1, isMock: true}
        expect(payableFeeIndex([orphan], orphan)).toBeUndefined()
    })
})

describe('onchainMeltTotal', () => {
    it('is amount + fee reserve + input fee, per NUT-30', () => {
        expect(onchainMeltTotal(10000, 400, 2)).toBe(10402)
    })

    it('treats the input fee as optional', () => {
        expect(onchainMeltTotal(10000, 400)).toBe(10400)
    })
})
