/**
 * Onchain (NUT-30) mint-amount arithmetic.
 *
 * Same split as the other operation-lifecycle tests: jest pins what it can verify
 * without bringing up MST stores / cashu-ts / SQLite, and runtime orchestration is
 * verified on device.
 *
 * What IS worth pinning here is the arithmetic, because it decides how much money
 * to mint. Both functions exist to refuse a mint response we did not expect — a
 * negative mintable balance, or a deposit larger than the mint will issue in one
 * operation — rather than passing it into a mint request.
 *
 * @jest-environment node
 */
import {
    buildBip21Uri,
    capMintAmount,
    mintableAmount,
    onchainTopupFloor,
    MINIBITS_ONCHAIN_FLOOR_SAT,
} from '../src/services/wallet/operations/onchainAmounts'

describe('mintableAmount', () => {
    it('is what the mint has credited but not yet issued', () => {
        expect(mintableAmount(50000, 0)).toBe(50000)
    })

    it('is zero for a fully drained quote', () => {
        expect(mintableAmount(50000, 50000)).toBe(0)
    })

    it('is the remainder for a partially drained quote', () => {
        expect(mintableAmount(70000, 50000)).toBe(20000)
    })

    it('is zero before any deposit confirms', () => {
        expect(mintableAmount(0, 0)).toBe(0)
    })

    it('clamps to zero if a mint ever reports issued > paid', () => {
        // Should not happen. But an unclamped negative would flow into a mint
        // request as a negative amount, so refuse it explicitly rather than by
        // accident.
        expect(mintableAmount(10000, 20000)).toBe(0)
    })
})

describe('onchainTopupFloor', () => {
    it('takes the wallet floor when the mint asks for less', () => {
        // The CDK test mint really did advertise min_amount: 1 — below Bitcoin's own
        // 546-sat dust limit. NUT-30 evaluates min_amount PER UTXO and says such a
        // deposit is "not recoverable through the mint quote protocol", i.e. the money
        // is gone. So the mint's number can never lower our bar.
        expect(onchainTopupFloor('sat', 1)).toBe(MINIBITS_ONCHAIN_FLOOR_SAT)
    })

    it('takes the mint floor when it is higher than ours', () => {
        expect(onchainTopupFloor('sat', 50000)).toBe(50000)
    })

    it('falls back to the wallet floor when the mint advertises none', () => {
        expect(onchainTopupFloor('sat', null)).toBe(MINIBITS_ONCHAIN_FLOOR_SAT)
        expect(onchainTopupFloor('sat', undefined)).toBe(MINIBITS_ONCHAIN_FLOOR_SAT)
        expect(onchainTopupFloor('sat', 0)).toBe(MINIBITS_ONCHAIN_FLOOR_SAT)
    })

    it('defers to the mint for non-sat units (our floor is denominated in sats)', () => {
        expect(onchainTopupFloor('usd', 500)).toBe(500)
        expect(onchainTopupFloor('usd', null)).toBe(0)
    })
})

describe('buildBip21Uri', () => {
    it('encodes the amount in BTC, not sats', () => {
        expect(buildBip21Uri('bc1qtest', 50000)).toBe('bitcoin:bc1qtest?amount=0.0005')
    })

    it('does not emit scientific notation for small amounts', () => {
        // 1000 / 1e8 is 0.00001 in JS, but smaller values reach 1e-8 and stringify as
        // exponent form, which is not a valid BIP21 amount.
        expect(buildBip21Uri('bc1qtest', 1)).toBe('bitcoin:bc1qtest?amount=0.00000001')
        expect(buildBip21Uri('bc1qtest', 10)).toBe('bitcoin:bc1qtest?amount=0.0000001')
    })

    it('does not leak float error into the amount', () => {
        // naive (amountSat / 1e8).toString() gives 0.000010000000000000001 here
        expect(buildBip21Uri('bc1qtest', 1000)).toBe('bitcoin:bc1qtest?amount=0.00001')
    })

    it('trims trailing zeros but keeps a whole-BTC amount valid', () => {
        expect(buildBip21Uri('bc1qtest', 100_000_000)).toBe('bitcoin:bc1qtest?amount=1')
        expect(buildBip21Uri('bc1qtest', 150_000_000)).toBe('bitcoin:bc1qtest?amount=1.5')
    })

    it('omits the amount entirely when there is none', () => {
        // A bare address is still a valid BIP21 URI, and the amount is only a hint.
        expect(buildBip21Uri('bc1qtest')).toBe('bitcoin:bc1qtest')
        expect(buildBip21Uri('bc1qtest', 0)).toBe('bitcoin:bc1qtest')
    })
})

describe('capMintAmount', () => {
    it('leaves a mintable balance under the cap alone', () => {
        expect(capMintAmount(50000, 500000)).toBe(50000)
    })

    it('caps a deposit larger than the mint will issue in one operation', () => {
        // Asking for more than max_amount fails the whole request, which would
        // strand a deposit we could take in instalments. The remainder stays
        // credited on the quote and the next sweep collects it.
        expect(capMintAmount(750000, 500000)).toBe(500000)
    })

    it('is a no-op when the mint advertises no maximum', () => {
        expect(capMintAmount(50000, null)).toBe(50000)
        expect(capMintAmount(50000, undefined)).toBe(50000)
    })

    it('ignores a nonsensical zero or negative cap', () => {
        expect(capMintAmount(50000, 0)).toBe(50000)
        expect(capMintAmount(50000, -1)).toBe(50000)
    })

    it('caps exactly at the boundary', () => {
        expect(capMintAmount(500000, 500000)).toBe(500000)
    })
})
