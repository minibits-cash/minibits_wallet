/**
 * Pure arithmetic for onchain (NUT-30) minting and melting.
 *
 * Kept free of stores, database and cashu-ts on purpose: these functions decide how
 * much money to mint, how much to spend on miner fees, and whether an amount is even
 * worth sending, so they are worth being able to test in isolation. Most of them
 * exist to refuse a mint response we did not expect, rather than passing it through
 * into a request.
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

// ─────────────────────────────────────────────────────────────────────────────
// Melt (paying out onchain)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minibits' own minimum for paying out onchain, in sats.
 *
 * Lower than the topup floor, and for a different reason. The topup floor is high
 * because the mint credits deposits PER UTXO and dust below its minimum is
 * unrecoverable — money can actually be lost. Nothing like that happens on the way
 * out: the mint either accepts the melt or refuses it.
 *
 * What this floor protects against is creating an output nobody can afford to spend.
 * 1000 sat clears every script type's dust limit (546 for P2PKH, 330 for P2WSH) with
 * enough margin that the recipient's output is still economically spendable. The
 * mint's own `min_amount` wins whenever it is higher — but as with topup, it is not
 * trusted to be sane on its own.
 */
export const MINIBITS_ONCHAIN_MELT_FLOOR_SAT = 1000

/**
 * The smallest amount worth paying out onchain: `max(our floor, the mint's minimum)`.
 *
 * Denominated in sats, so applied only to sat payouts; any other unit defers to the
 * mint. Mirrors `onchainTopupFloor`.
 */
export const onchainMeltFloor = (
    unit: string,
    mintMinAmount?: number | null,
): number => {
    const mintFloor = mintMinAmount && mintMinAmount > 0 ? Number(mintMinAmount) : 0
    if (unit !== 'sat') return mintFloor
    return Math.max(MINIBITS_ONCHAIN_MELT_FLOOR_SAT, mintFloor)
}

/**
 * A NUT-30 melt fee tier, normalized to plain numbers.
 *
 * cashu-ts hands us `fee_reserve` as an `Amount` object. Everything here works in
 * numbers so the selection logic stays testable without pulling cashu-ts (and the
 * store graph behind it) into the test.
 */
export type OnchainFeeOption = {
    feeIndex: number
    feeReserve: number
    estimatedBlocks: number
    /**
     * True for a tier this wallet invented in a debug build (see `mockOnchainFeeTiers`).
     * Never set on anything a mint sent.
     */
    isMock?: boolean
}

/** Shape of a `fee_options` entry as it arrives from cashu-ts. */
type RawFeeOption = {
    fee_index: number
    fee_reserve: number | {toNumber: () => number}
    estimated_blocks: number
}

/**
 * Normalize a quote's `fee_options` into plain numbers, sorted cheapest first.
 *
 * Sorting is not cosmetic — `selectDefaultFeeOption` picks by position, and the mint
 * is under no obligation to return the tiers in any particular order. `fee_index` is
 * the mint's identifier for a tier, NOT its rank, so it must never be used as one.
 */
export const normalizeFeeOptions = (options: RawFeeOption[]): OnchainFeeOption[] =>
    options
        .map(o => ({
            feeIndex: o.fee_index,
            feeReserve:
                typeof o.fee_reserve === 'number' ? o.fee_reserve : o.fee_reserve.toNumber(),
            estimatedBlocks: o.estimated_blocks,
        }))
        .sort((a, b) => a.feeReserve - b.feeReserve)

/**
 * Which fee tier to pre-select: the middle one, rounding to the cheaper side.
 *
 * The "normal" choice — fast enough not to strand the payment, cheap enough not to
 * quietly overspend. With an even number of tiers there is no true middle, so we
 * take the cheaper of the two: the user is always free to pay more, and a wallet
 * should never round a fee UP on the user's behalf without being asked.
 *
 * Expects the sorted output of `normalizeFeeOptions`. Returns undefined only when the
 * mint returned no tiers at all, which the spec forbids ("The mint MUST return at
 * least one fee_options item") — callers treat that as a broken quote rather than
 * inventing a fee.
 */
export const selectDefaultFeeOption = (
    options: OnchainFeeOption[],
): OnchainFeeOption | undefined => {
    if (options.length === 0) return undefined
    return options[Math.floor((options.length - 1) / 2)]
}

/** Look up a tier by the mint's `fee_index`. Undefined if the mint never offered it. */
export const findFeeOption = (
    options: OnchainFeeOption[],
    feeIndex: number,
): OnchainFeeOption | undefined => options.find(o => o.feeIndex === feeIndex)

/**
 * Invent extra fee tiers so the picker can be exercised. DEBUG BUILDS ONLY.
 *
 * The CDK fakewallet backend returns exactly ONE fee option, so against the only mint we
 * can test with, the picker always collapses to its read-only single-tier form and the
 * multi-tier path never runs. This fabricates a slower/cheaper and a faster/dearer tier
 * around whatever the mint actually sent.
 *
 * **The mint's real tier is kept, untouched, with its real `fee_index`.** That matters:
 * NUT-30 says the mint MUST reject a melt whose `fee_index` it never offered, so a
 * fabricated index cannot be paid with. The caller submits the REAL index whichever tier
 * the user picks (see `isMock`) — so what is mocked is the CHOICE, and the payment that
 * follows is a real one at the mint's real price. A mocked tier's `feeReserve` is a
 * fiction for display; nothing downstream may bill against it.
 *
 * A no-op when the mint already returned more than one tier — there is nothing to
 * simulate, and overwriting real tiers with invented ones would be actively misleading.
 */
export const mockOnchainFeeTiers = (
    options: OnchainFeeOption[],
): OnchainFeeOption[] => {
    if (options.length !== 1) return options

    const real = options[0]

    // Indices that cannot collide with the mint's own. They are never sent to it.
    const cheaper: OnchainFeeOption = {
        feeIndex: real.feeIndex + 1001,
        feeReserve: Math.max(1, Math.round(real.feeReserve * 0.4)),
        estimatedBlocks: Math.max(real.estimatedBlocks * 4, 12),
        isMock: true,
    }
    const faster: OnchainFeeOption = {
        feeIndex: real.feeIndex + 1002,
        feeReserve: Math.round(real.feeReserve * 2.5),
        estimatedBlocks: 1,
        isMock: true,
    }

    return normalizeFeeOptions(
        [cheaper, real, faster].map(o => ({
            fee_index: o.feeIndex,
            fee_reserve: o.feeReserve,
            estimated_blocks: o.estimatedBlocks,
        })),
    ).map(o => ({
        ...o,
        isMock: o.feeIndex !== real.feeIndex,
    }))
}

/**
 * The `fee_index` that may actually be sent to the mint.
 *
 * Identity for a real tier. For a mocked one it resolves back to the mint's own tier —
 * the only index the mint will accept — so a debug build can exercise the picker without
 * the melt being rejected. Returns undefined if there is no real tier to fall back to,
 * which cannot happen with a quote from a mint.
 */
export const payableFeeIndex = (
    options: OnchainFeeOption[],
    selected: OnchainFeeOption,
): number | undefined => {
    if (!selected.isMock) return selected.feeIndex
    return options.find(o => !o.isMock)?.feeIndex
}

/**
 * Total that must be covered by the inputs of an onchain melt.
 *
 * `amount + fee_reserve + input_fee`, per NUT-30. The mint may keep the whole
 * `fee_reserve` ("the mint is entitled to claim the full selected_fee_reserve as the
 * actual fee") — anything it does not spend comes back as NUT-08 change.
 */
export const onchainMeltTotal = (
    amount: number,
    feeReserve: number,
    inputFee: number = 0,
): number => amount + feeReserve + inputFee
