/**
 * NUT-20 quote-locking keys.
 *
 * A NUT-20 mint quote is locked to a public key: the mint will only issue ecash
 * against it after seeing a signature from the matching private key. Onchain
 * (NUT-30) makes this MANDATORY — the mint refuses to issue an onchain mint quote
 * without a `pubkey` (error 20009).
 *
 * Keys are derived deterministically from the wallet seed, so the key needed to
 * sign for a quote can always be re-derived — including days later, after an
 * onchain deposit finally confirms, and (in future) after a seed restore.
 *
 * NUT-20 derivation path:
 *
 *     m/129373'/20'/0'/0'/{counter}
 *
 * where 129373' is the Cashu namespace, 20' the NUT-20 index, and {counter} an
 * incrementing NON-hardened child index. The path has no keyset component, so the
 * counter is wallet-global — see walletCountersRepo, which owns it (mint_counters
 * is for the keyset-scoped NUT-13 counters and is unrelated).
 *
 * The spec asks for a UNIQUE key per quote, so the mint cannot link a wallet's
 * quotes to each other. `allocateQuoteKeypair` is the only thing call sites
 * should use: it burns the index before handing it back, so an index can never
 * be issued twice.
 *
 * Signing itself is cashu-ts's job (`signMintQuote`), which implements the
 * `Cashu_MintQuoteSig_v1` message aggregation and BIP340 Schnorr signature. We
 * only supply the key.
 */
import {HDKey} from '@scure/bip32'
// `.js` suffix: the bare '@noble/hashes/utils' specifier used elsewhere in this
// codebase does not resolve under tsc (the package's exports map only names the
// suffixed path). Both forms work at runtime; this one also typechecks.
import {bytesToHex} from '@noble/hashes/utils.js'
import {allocateNextCounter, NUT20_COUNTER} from '../db/walletCountersRepo'
import AppError, {Err} from '../../utils/AppError'

export type QuoteKeypair = {
    /** 32-byte private key, hex. Never persisted — re-derived from the seed. */
    privkey: string
    /** 33-byte compressed secp256k1 public key, hex. Sent to the mint. */
    pubkey: string
}

/** BIP32 path for the NUT-20 quote-locking key at `index`. */
export const quoteKeyDerivationPath = (index: number): string =>
    `m/129373'/20'/0'/0'/${index}`

/**
 * Derive the NUT-20 quote-locking keypair at `index` from the wallet seed.
 *
 * Pure: no database, no MST, no keychain — the caller supplies the seed. That
 * keeps it trivially testable and usable from the off-MST background paths that
 * will need to sign mint requests.
 */
export const deriveQuoteKeypair = function (
    seed: Uint8Array,
    index: number,
): QuoteKeypair {
    if (!Number.isInteger(index) || index < 0) {
        throw new AppError(
            Err.VALIDATION_ERROR,
            'NUT-20 quote key index must be a non-negative integer',
            {index, caller: 'deriveQuoteKeypair'},
        )
    }

    const derived = HDKey.fromMasterSeed(seed).derive(quoteKeyDerivationPath(index))

    if (!derived.privateKey || !derived.publicKey) {
        throw new AppError(
            Err.VALIDATION_ERROR,
            'NUT-20 quote key derivation produced no key material',
            {index, caller: 'deriveQuoteKeypair'},
        )
    }

    return {
        privkey: bytesToHex(derived.privateKey),
        pubkey: bytesToHex(derived.publicKey),
    }
}

/**
 * Allocate a fresh index and derive its keypair — the entry point call sites use.
 *
 * The index is COMMITTED to the database before this returns, so if the caller's
 * mint-quote request then fails (or the app dies mid-request), the index is
 * simply skipped and never handed out again. Reuse is the thing we cannot allow:
 * two quotes sharing a pubkey would let the mint link them and would make the
 * NUT-20 signature ambiguous. Skipped indices are harmless.
 *
 * The returned `index` MUST be persisted alongside the quote — it is the only
 * thing that lets the wallet re-derive the private key to sign the mint request
 * later.
 */
export const allocateQuoteKeypair = function (
    seed: Uint8Array,
): QuoteKeypair & {index: number} {
    const index = allocateNextCounter(NUT20_COUNTER)
    return {index, ...deriveQuoteKeypair(seed, index)}
}
