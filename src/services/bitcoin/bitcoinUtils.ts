/**
 * Bitcoin address and BIP21 URI parsing.
 *
 * Used on the way OUT (NUT-30 onchain melt): the user pastes or scans something and
 * the wallet has to decide what it is before it can route them anywhere. Onchain
 * payments are irreversible, so this errs towards refusing input it does not fully
 * understand — the checksums are verified locally rather than left for the mint to
 * catch, so a mistyped address fails on the screen the user is looking at instead of
 * one round-trip later.
 *
 * Checksums catch typos, not mistakes: a valid address for the wrong recipient looks
 * exactly like a valid address. Nothing here can help with that.
 */
import {bech32, bech32m, createBase58check} from '@scure/base'
import {sha256} from '@noble/hashes/sha2.js'

const base58Check = createBase58check(sha256)

export type BitcoinNetwork = 'mainnet' | 'testnet' | 'regtest'

export type BitcoinAddressInfo = {
    address: string
    network: BitcoinNetwork
    /** Human-readable script type, for display and for logs. */
    kind: 'P2PKH' | 'P2SH' | 'P2WPKH' | 'P2WSH' | 'P2TR' | 'SEGWIT'
}

/** Bech32 human-readable prefixes, per BIP-173 / BIP-350. */
const SEGWIT_PREFIXES: Record<string, BitcoinNetwork> = {
    bc: 'mainnet',
    tb: 'testnet',
    bcrt: 'regtest',
}

/** Base58 version bytes. */
const BASE58_VERSIONS: Record<number, {network: BitcoinNetwork; kind: 'P2PKH' | 'P2SH'}> = {
    0x00: {network: 'mainnet', kind: 'P2PKH'}, // 1...
    0x05: {network: 'mainnet', kind: 'P2SH'}, // 3...
    0x6f: {network: 'testnet', kind: 'P2PKH'}, // m... / n...
    0xc4: {network: 'testnet', kind: 'P2SH'}, // 2...
}

/**
 * Decode a segwit (bech32 / bech32m) address.
 *
 * The witness version decides the checksum constant: v0 MUST use bech32, v1+ (taproot
 * and anything after it) MUST use bech32m. They are different checksums over the same
 * alphabet, so accepting either for both versions would let a v0 address with a
 * corrupted checksum through as long as it happened to satisfy the other constant.
 * We decode with both and then insist the one that worked matches the version.
 */
const decodeSegwitAddress = (address: string): BitcoinAddressInfo | undefined => {
    const lower = address.toLowerCase()

    // BIP-173: mixed case is invalid. Checked before lowercasing loses the evidence.
    if (address !== lower && address !== address.toUpperCase()) return undefined

    const separator = lower.lastIndexOf('1')
    if (separator < 1) return undefined

    const network = SEGWIT_PREFIXES[lower.slice(0, separator)]
    if (!network) return undefined

    let words: number[]
    let usedBech32m = false

    try {
        words = bech32.decode(lower as `${string}1${string}`, 90).words
    } catch {
        try {
            words = bech32m.decode(lower as `${string}1${string}`, 90).words
            usedBech32m = true
        } catch {
            return undefined
        }
    }

    const version = words[0]
    if (version === undefined || version > 16) return undefined
    if (version === 0 && usedBech32m) return undefined
    if (version > 0 && !usedBech32m) return undefined

    let program: Uint8Array
    try {
        program = bech32.fromWords(words.slice(1))
    } catch {
        return undefined
    }

    if (program.length < 2 || program.length > 40) return undefined
    // v0 is only ever defined for P2WPKH (20 bytes) and P2WSH (32).
    if (version === 0 && program.length !== 20 && program.length !== 32) return undefined

    let kind: BitcoinAddressInfo['kind'] = 'SEGWIT'
    if (version === 0) kind = program.length === 20 ? 'P2WPKH' : 'P2WSH'
    else if (version === 1 && program.length === 32) kind = 'P2TR'

    return {address: lower, network, kind}
}

/** Decode a legacy base58check address (P2PKH / P2SH). */
const decodeBase58Address = (address: string): BitcoinAddressInfo | undefined => {
    let decoded: Uint8Array
    try {
        decoded = base58Check.decode(address)
    } catch {
        return undefined
    }

    // version byte + 20-byte hash (the 4-byte checksum is consumed by the decoder)
    if (decoded.length !== 21) return undefined

    const version = BASE58_VERSIONS[decoded[0]]
    if (!version) return undefined

    return {address, network: version.network, kind: version.kind}
}

/**
 * Decode a bare Bitcoin address, verifying its checksum.
 *
 * Returns undefined rather than throwing, so it can be used as a predicate while
 * sniffing unknown input.
 */
export const decodeBitcoinAddress = (
    address: string,
): BitcoinAddressInfo | undefined => {
    const trimmed = address.trim()
    if (trimmed.length === 0) return undefined

    return decodeSegwitAddress(trimmed) ?? decodeBase58Address(trimmed)
}

export const isBitcoinAddress = (address: string): boolean =>
    decodeBitcoinAddress(address) !== undefined

/**
 * Is this an address Minibits is allowed to pay?
 *
 * Mainnet only. The wallet holds mainnet-backed ecash and the mints melt to the real
 * chain, so a testnet or regtest address is never a payment — it is a mistake, and an
 * irreversible one if a mint broadcasts against it.
 *
 * This is not hypothetical. The CDK fakewallet backend hands out REGTEST deposit
 * addresses (`bcrt1q…`) for onchain topup quotes, so anyone testing this wallet ends
 * up with one in their clipboard. Pasting it back into Pay must fail loudly, not
 * quietly reach the mint.
 *
 * Kept separate from `decodeBitcoinAddress` on purpose: decoding tells you WHAT an
 * address is (and needs to recognise testnet in order to say so), while this decides
 * whether we are willing to send money to it. Collapsing the two would leave us
 * unable to tell "that is not an address" apart from "that is not OUR network", and
 * the second deserves its own error message.
 */
export const isPayableBitcoinAddress = (address: string): boolean =>
    decodeBitcoinAddress(address)?.network === 'mainnet'

export type Bip21Data = {
    address: string
    /** Amount in SATS, converted from the BIP21 `amount` (which is in BTC). */
    amountSat?: number
    label?: string
    message?: string
    /** A BOLT11 invoice carried alongside the address in a unified QR. */
    lightning?: string
}

/**
 * Parse a BIP21 `bitcoin:` URI.
 *
 * Only the address is required; everything else is a hint the wallet may use or
 * ignore. Returns undefined if the URI is not BIP21 or the address does not check
 * out — a `bitcoin:` URI with an address we cannot verify is not something to pass
 * along half-understood.
 *
 * The scheme is case-insensitive (BIP21 allows `BITCOIN:`, which is what QR encoders
 * emit to stay in the alphanumeric mode).
 */
export const parseBip21 = (uri: string): Bip21Data | undefined => {
    const trimmed = uri.trim()
    if (!/^bitcoin:/i.test(trimmed)) return undefined

    const body = trimmed.slice('bitcoin:'.length)
    const [addressPart, queryPart] = body.split('?', 2)

    // `bitcoin:?lightning=...` (no address) is a legal BOLT11-only unified URI, but
    // it is not something an onchain melt can use — the caller wants an address.
    const decoded = decodeBitcoinAddress(addressPart)
    if (!decoded) return undefined

    // Take the DECODED address, not the raw text: QR encoders uppercase bech32 to stay
    // in alphanumeric mode, and this string is what we hand to the mint.
    const result: Bip21Data = {address: decoded.address}
    if (!queryPart) return result

    const params = new URLSearchParams(queryPart)

    const amount = params.get('amount')
    if (amount) {
        const btc = Number(amount)
        // BIP21 amounts are decimal BTC. Round rather than truncate: 0.0001 parses to
        // 9999.999999999999 sats in binary floating point, and a truncating conversion
        // would quietly under-request by one sat.
        if (Number.isFinite(btc) && btc > 0) result.amountSat = Math.round(btc * 100_000_000)
    }

    const label = params.get('label')
    if (label) result.label = label

    const message = params.get('message')
    if (message) result.message = message

    const lightning = params.get('lightning')
    if (lightning) result.lightning = lightning.toLowerCase()

    return result
}

/**
 * Find a Bitcoin address or BIP21 URI inside arbitrary pasted text.
 *
 * Mirrors `LightningUtils.findEncodedLightningInvoice` — clipboards carry surrounding
 * prose, and QR payloads sometimes carry a URI inside a larger string.
 */
export const findBitcoinAddress = (text: string): string | undefined => {
    const trimmed = text.trim()

    const uriMatch = trimmed.match(/bitcoin:[^\s]+/i)
    if (uriMatch && parseBip21(uriMatch[0])) return uriMatch[0]

    if (decodeBitcoinAddress(trimmed)) return trimmed

    // Bare address embedded in text. The candidate pattern is deliberately loose —
    // `decodeBitcoinAddress` is the actual filter, so a false candidate costs a failed
    // checksum, not a false positive.
    const candidates = trimmed.match(/\b(bc1|tb1|bcrt1)[a-z0-9]{6,87}\b|\b[13mn2][a-km-zA-HJ-NP-Z1-9]{25,39}\b/gi)
    if (!candidates) return undefined

    for (const candidate of candidates) {
        if (decodeBitcoinAddress(candidate)) return candidate
    }

    return undefined
}

export const BitcoinUtils = {
    decodeBitcoinAddress,
    isBitcoinAddress,
    isPayableBitcoinAddress,
    parseBip21,
    findBitcoinAddress,
}
