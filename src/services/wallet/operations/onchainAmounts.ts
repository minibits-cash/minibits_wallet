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
