/**
 * Mint info staleness (WalletStore.isMintInfoStale).
 *
 * The reason this is its own test: a MISSING `time` must count as STALE.
 *
 * The stamp was only added when the capability model landed, so every mint info
 * cached before that has `time: undefined`. `now - undefined` is NaN, and every
 * comparison against NaN is false — so the obvious `now - time > TTL` check reports
 * those records as FRESH, forever. A mint that has since gained onchain support then
 * keeps looking like a mint that never had it, and the wallet quietly refuses to
 * offer a feature the mint supports.
 *
 * That is not hypothetical: it is exactly what happened on device.
 *
 * @jest-environment node
 */
import {isMintInfoStale, MINT_INFO_TTL_SECONDS} from '../src/models/helpers/mintInfoStale'

const NOW = 1_800_000_000

const infoAt = (time?: number) => ({time} as any)

describe('isMintInfoStale', () => {
    it('treats absent info as stale', () => {
        expect(isMintInfoStale(undefined, NOW)).toBe(true)
    })

    it('treats info with NO timestamp as stale (the legacy-cache trap)', () => {
        // `now - undefined` is NaN; `NaN > TTL` is false. A naive check calls this
        // fresh and never refetches.
        expect(isMintInfoStale(infoAt(undefined), NOW)).toBe(true)
    })

    it('treats a non-finite timestamp as stale', () => {
        expect(isMintInfoStale(infoAt(NaN), NOW)).toBe(true)
    })

    it('is fresh within the TTL', () => {
        expect(isMintInfoStale(infoAt(NOW - 60), NOW)).toBe(false)
        expect(isMintInfoStale(infoAt(NOW), NOW)).toBe(false)
    })

    it('is stale past the TTL', () => {
        expect(isMintInfoStale(infoAt(NOW - MINT_INFO_TTL_SECONDS - 1), NOW)).toBe(true)
    })

    it('is fresh exactly at the TTL boundary', () => {
        expect(isMintInfoStale(infoAt(NOW - MINT_INFO_TTL_SECONDS), NOW)).toBe(false)
    })
})
