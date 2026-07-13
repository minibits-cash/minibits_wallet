import {type GetInfoResponse} from '@cashu/cashu-ts'

/**
 * How long a cached mint NUT-06 info stays fresh, in seconds.
 *
 * mintInfo carries the mint's advertised payment methods and their min/max limits,
 * which drive what the wallet offers the user. An hour picks up a mint that gains
 * (or drops) a method reasonably soon, at a cost of at most one getInfo() per mint
 * per hour.
 */
export const MINT_INFO_TTL_SECONDS = 3600

/**
 * Is a cached mint info due a refresh?
 *
 * A MISSING `time` counts as STALE, and that is the entire reason this is a named
 * function with tests rather than an inline comparison.
 *
 * The `time` stamp only started being written when the capability model landed, so
 * every mint info cached before that has `time: undefined`. `now - undefined` is
 * NaN, and every comparison against NaN is false — so the obvious
 * `now - time > TTL` check reports those records as FRESH and never refetches them.
 * A mint that has since gained onchain support then keeps looking like a mint that
 * never had it, and the wallet quietly refuses to offer something the mint supports.
 *
 * Kept in its own module (no stores, no services) so it can be tested without
 * dragging in the WalletStore import chain.
 */
export const isMintInfoStale = (
    mintInfo: (GetInfoResponse & {time?: number}) | undefined,
    nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean => {
    if (!mintInfo) return true
    if (!Number.isFinite(mintInfo.time)) return true
    return nowSeconds - (mintInfo.time as number) > MINT_INFO_TTL_SECONDS
}
