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
import {capMintAmount, mintableAmount} from '../src/services/wallet/operations/onchainAmounts'

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
