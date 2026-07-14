/**
 * Grouping-separator round trip for confirmed amounts.
 *
 * AmountInput now GROUPS an amount once the user confirms it ("12,345") and STRIPS the
 * grouping again while it is being edited. That only works if every consumer of the
 * amount string can read a grouped number back — and every screen parses it with
 * `toNumber`, so that is the contract worth pinning.
 *
 * The reason the strip half exists is subtler and is pinned here too: AmountInput
 * rewrites a comma to a dot on input, so a decimal-comma keyboard can type "1,5" and
 * mean 1.5. If a grouped value were ever left sitting in a focused field, editing
 * "12,345" would silently reinterpret it as 12.345 — a hundredfold error, in a field
 * whose entire job is to say how much money to move.
 *
 * @jest-environment node
 */
import {formatNumber, toNumber} from '../src/utils/number'

/** What AmountInput does on focus. */
const stripGrouping = (v: string) => v.replace(/,/g, '')

/** What AmountInput does on input, before the value reaches state. */
const normalizeDecimalComma = (v: string) => v.replace(',', '.')

describe('toNumber reads grouped amounts', () => {
    it('parses what formatNumber produces', () => {
        expect(toNumber('12,345')).toBe(12345)
        expect(toNumber('1,234,567')).toBe(1234567)
        expect(toNumber('999,999,999')).toBe(999999999)
    })

    it('still parses ungrouped amounts, so nothing regresses mid-edit', () => {
        expect(toNumber('12345')).toBe(12345)
        expect(toNumber('0')).toBe(0)
    })

    it('parses a grouped fiat amount with a mantissa', () => {
        expect(toNumber('1,234.56')).toBe(1234.56)
    })
})

describe('formatNumber groups a confirmed amount to the unit precision', () => {
    // sat: mantissa 0. Fractional sats do not exist, and the screens round to integers
    // anyway before doing anything with the value.
    it('groups sats without a mantissa', () => {
        expect(formatNumber(12345, 0)).toBe('12,345')
        expect(formatNumber(999999999, 0)).toBe('999,999,999')
        expect(formatNumber(0, 0)).toBe('0')
    })

    // fiat: mantissa 2.
    it('pads a fiat amount to two places', () => {
        expect(formatNumber(1234.5, 2)).toBe('1,234.50')
        expect(formatNumber(12, 2)).toBe('12.00')
    })
})

describe('round trip: confirm, then edit again', () => {
    const confirm = (raw: string, mantissa: number) => formatNumber(toNumber(raw), mantissa)

    it('survives confirm -> focus -> confirm without drifting', () => {
        const confirmed = confirm('12345', 0)
        expect(confirmed).toBe('12,345')

        // Focus strips the grouping, so the field holds a plain number again...
        const editing = stripGrouping(confirmed)
        expect(editing).toBe('12345')

        // ...and re-confirming lands on the same value rather than compounding.
        expect(confirm(editing, 0)).toBe('12,345')
    })

    /**
     * THE reason the value is stripped on focus.
     *
     * If a grouped amount were left in a focused field, AmountInput's decimal-comma
     * normalisation would rewrite the FIRST comma to a dot the moment the user touched it.
     * "12,345" sats — a real amount someone is about to send — would become 12.345, which
     * rounds to 12. Off by a factor of a thousand, silently, in the field that decides how
     * much money leaves the wallet.
     */
    it('shows what NOT stripping on focus would have cost', () => {
        const confirmed = '12,345'

        const ifLeftGrouped = normalizeDecimalComma(confirmed)
        expect(ifLeftGrouped).toBe('12.345')
        expect(toNumber(ifLeftGrouped)).toBe(12.345)
        expect(Math.round(toNumber(ifLeftGrouped))).toBe(12) // vs 12345

        // Stripped first, the same keystroke path is harmless.
        expect(normalizeDecimalComma(stripGrouping(confirmed))).toBe('12345')
        expect(toNumber(normalizeDecimalComma(stripGrouping(confirmed)))).toBe(12345)
    })

    // A decimal-comma keyboard must still work: that is what the normalisation is FOR.
    it('leaves the decimal-comma keyboard working', () => {
        expect(toNumber(normalizeDecimalComma('1,5'))).toBe(1.5)
    })
})
