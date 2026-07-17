/**
 * Grouping separators on confirmed amounts.
 *
 * AmountInput SHOWS a confirmed amount grouped ("12,345") but never STORES it that way:
 * state holds the plain number and the grouped text is derived at render time, only while
 * the field is unfocused.
 *
 * That split is the whole design, and this pins why it has to be. These are controlled
 * TextInputs, and AmountInput rewrites the first comma to a dot on input so a
 * decimal-comma keyboard can type "1,5" and mean 1.5. Keep a grouped string in state and
 * that rewrite gets a chance at it: "1,000" becomes "1.000", which is 1 — a thousandfold
 * error, silent, in the field that decides how much money leaves the wallet. Derived
 * display cannot be read back in as input, so the two meanings of "," never meet.
 *
 * @jest-environment node
 */
import {formatNumber, toNumber} from '../src/utils/number'

/** What AmountInput renders when a field is unfocused. Never written to state. */
const formatForDisplay = (v: string, mantissa: number) => {
    const n = toNumber(v.replace(/,/g, ''))
    if (n === undefined || !Number.isFinite(n)) return v
    return formatNumber(n, mantissa)
}

/** What AmountInput does to every keystroke, before it reaches state. */
const normalizeDecimalComma = (v: string) => v.replace(',', '.')

describe('formatForDisplay groups a confirmed amount to the unit precision', () => {
    // sat: mantissa 0. Fractional sats do not exist, and every screen rounds to an integer
    // before doing anything with the value anyway.
    it('groups sats without a mantissa', () => {
        expect(formatForDisplay('1000', 0)).toBe('1,000')
        expect(formatForDisplay('12345', 0)).toBe('12,345')
        expect(formatForDisplay('999999999', 0)).toBe('999,999,999')
        expect(formatForDisplay('0', 0)).toBe('0')
    })

    // fiat: mantissa 2.
    it('pads a fiat amount to two places', () => {
        expect(formatForDisplay('1234.5', 2)).toBe('1,234.50')
        expect(formatForDisplay('12', 2)).toBe('12.00')
    })

    it('leaves unparseable text alone rather than blanking the field', () => {
        expect(formatForDisplay('', 0)).toBe('')
    })

    // Screens pre-fill from BIP21 / melt quotes with numbro's thousandSeparated, so a
    // grouped string can arrive from outside. Formatting it again must not compound.
    it('is idempotent, so an already-grouped input survives', () => {
        expect(formatForDisplay('1,000', 0)).toBe('1,000')
        expect(formatForDisplay(formatForDisplay('12345', 0), 0)).toBe('12,345')
    })
})

describe('the grouped form never reaches state', () => {
    /**
     * What storing the grouped value would have cost.
     *
     * The decimal-comma rewrite fires on whatever text the input hands back — and on
     * Android a programmatically-set `value` is echoed straight back through onChangeText.
     * So a grouped value in state gets exactly one keystroke, or one echo, before it means
     * something else entirely.
     */
    it('shows what a grouped value in state would have become', () => {
        const grouped = '1,000'

        expect(normalizeDecimalComma(grouped)).toBe('1.000')
        expect(toNumber(normalizeDecimalComma(grouped))).toBe(1) // meant 1000

        const bigger = '12,345'
        expect(toNumber(normalizeDecimalComma(bigger))).toBe(12.345) // meant 12345
    })

    // Which is exactly why the rewrite is harmless against a plain value: there is no
    // grouping comma for it to find, only a decimal one the user typed.
    it('leaves a plain value — and the decimal-comma keyboard — untouched', () => {
        expect(normalizeDecimalComma('1000')).toBe('1000')
        expect(toNumber(normalizeDecimalComma('1000'))).toBe(1000)

        // The rewrite's actual purpose.
        expect(toNumber(normalizeDecimalComma('1,5'))).toBe(1.5)
    })
})

describe('toNumber reads a grouped amount, whatever the source', () => {
    // Parents pre-fill with grouped strings and AmountInput strips them on ingest, but the
    // screens also parse their own amount state — so this has to hold either way.
    it('parses grouped and plain alike', () => {
        expect(toNumber('12,345')).toBe(12345)
        expect(toNumber('12345')).toBe(12345)
        expect(toNumber('1,234,567')).toBe(1234567)
        expect(toNumber('1,234.56')).toBe(1234.56)
    })
})
