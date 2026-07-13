/**
 * Pure arithmetic for onchain (NUT-30) minting.
 *
 * Kept free of stores, database and cashu-ts on purpose: these two functions decide
 * how much money to mint, so they are worth being able to test in isolation. Both
 * exist to refuse a mint response we did not expect, rather than passing it through
 * into a mint request.
 */

/**
 * How much of a quote is credited but not yet minted.
 *
 * Clamped at zero. `amount_issued` should never exceed `amount_paid`, but an
 * unclamped negative would reach a mint request as a negative amount — better to
 * refuse it explicitly than to end up with "nothing to do" by accident.
 */
export const mintableAmount = (amountPaid: number, amountIssued: number): number =>
    Math.max(0, amountPaid - amountIssued)

/**
 * Cap a mint request at the mint's advertised per-operation maximum.
 *
 * A deposit can legitimately exceed `max_amount` — the sender ignores our BIP21
 * hint, or pays a stale address. Asking for more than the mint allows fails the
 * whole request, stranding money we could have taken in instalments. Minting up to
 * the cap leaves the remainder credited on the quote, where the watch rule
 * (`amountPaid > amountIssued`) keeps it visible and the next sweep collects it.
 */
export const capMintAmount = (mintable: number, maxAmount?: number | null): number =>
    maxAmount && maxAmount > 0 ? Math.min(mintable, Number(maxAmount)) : mintable

/**
 * Minibits' own minimum for offering an onchain topup, in sats.
 *
 * NUT-30 has a `min_amount`, but we cannot rely on it. It is evaluated PER UTXO by
 * the mint — a deposit below it never increases `amount_paid`, cannot be aggregated
 * with others to clear the bar, and per the spec is "not recoverable through the
 * mint quote protocol". In other words, dust sent to a quote address is simply
 * gone.
 *
 * And a mint's advertised value cannot be trusted to protect anyone: the CDK test
 * mint advertised `min_amount: 1` — below Bitcoin's own 546-sat dust limit, and far
 * below the fee needed to spend such an output. We watched it be wrong in two
 * independent ways (frozen in its database, then inherited from the wrong config
 * section). So the wallet keeps a floor of its own and takes whichever is higher.
 */
export const MINIBITS_ONCHAIN_FLOOR_SAT = 10000

/**
 * The smallest amount for which onchain topup is worth offering.
 *
 * `max(our floor, the mint's minimum)`. The floor is denominated in sats, so it is
 * only applied to sat-denominated topups; for any other unit we defer to the mint
 * (in practice mints only advertise onchain for sat, and the capability check
 * already hides it elsewhere).
 */
export const onchainTopupFloor = (
    unit: string,
    mintMinAmount?: number | null,
): number => {
    const mintFloor = mintMinAmount && mintMinAmount > 0 ? Number(mintMinAmount) : 0
    if (unit !== 'sat') return mintFloor
    return Math.max(MINIBITS_ONCHAIN_FLOOR_SAT, mintFloor)
}

/**
 * BIP21 payment URI: `bitcoin:<address>?amount=<btc>`.
 *
 * The amount is a HINT — the sender's wallet pre-fills it, and the sender is free
 * to change or ignore it. NUT-30 does not price the quote, so under- and
 * overpayment are both normal and handled downstream.
 *
 * BIP21 amounts are in BTC, not sats, so this converts. Formatted with toFixed(8)
 * and trimmed rather than by dividing and stringifying, because `1e-8` and
 * `0.000010000000000000001` are both things JS will happily hand you for small
 * satoshi values, and neither is a valid BIP21 amount.
 */
export const buildBip21Uri = (address: string, amountSat?: number): string => {
    if (!amountSat || amountSat <= 0) return `bitcoin:${address}`

    const btc = (amountSat / 100_000_000).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')

    return `bitcoin:${address}?amount=${btc}`
}
