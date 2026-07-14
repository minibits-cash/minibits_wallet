import {
    decodeBitcoinAddress,
    isBitcoinAddress,
    isPayableBitcoinAddress,
    parseBip21,
    findBitcoinAddress,
} from '../src/services/bitcoin/bitcoinUtils'

/**
 * A REAL deposit address handed out by the CDK fakewallet backend for an onchain
 * topup quote. Anyone testing this wallet ends up with one of these in their
 * clipboard, so it is the single most likely wrong thing to be pasted into Pay.
 */
const FAKEWALLET_REGTEST = 'bcrt1qq723ledhgscxenun8z2pt3atxtnqef3csv0hl9'

// BIP-173 / BIP-350 test vectors plus real-world addresses.
const P2PKH = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
const P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'
const P2WPKH = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
const P2WSH = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'
const P2TR = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'
const TESTNET_P2WPKH = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
const TESTNET_P2PKH = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'

describe('decodeBitcoinAddress', () => {
    it('decodes mainnet legacy addresses', () => {
        expect(decodeBitcoinAddress(P2PKH)).toEqual({
            address: P2PKH,
            network: 'mainnet',
            kind: 'P2PKH',
        })
        expect(decodeBitcoinAddress(P2SH)).toEqual({
            address: P2SH,
            network: 'mainnet',
            kind: 'P2SH',
        })
    })

    it('decodes segwit v0 addresses and distinguishes P2WPKH from P2WSH by program length', () => {
        expect(decodeBitcoinAddress(P2WPKH)).toEqual({
            address: P2WPKH,
            network: 'mainnet',
            kind: 'P2WPKH',
        })
        expect(decodeBitcoinAddress(P2WSH)).toEqual({
            address: P2WSH,
            network: 'mainnet',
            kind: 'P2WSH',
        })
    })

    it('decodes taproot (bech32m)', () => {
        expect(decodeBitcoinAddress(P2TR)).toEqual({
            address: P2TR,
            network: 'mainnet',
            kind: 'P2TR',
        })
    })

    it('decodes testnet addresses', () => {
        expect(decodeBitcoinAddress(TESTNET_P2WPKH)?.network).toBe('testnet')
        expect(decodeBitcoinAddress(TESTNET_P2PKH)?.network).toBe('testnet')
    })

    it('accepts uppercase segwit and normalizes it', () => {
        // QR encoders uppercase bech32 to stay in alphanumeric mode.
        expect(decodeBitcoinAddress(P2WPKH.toUpperCase())?.address).toBe(P2WPKH)
    })

    it('rejects mixed-case segwit (BIP-173)', () => {
        const mixed = 'bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
        expect(decodeBitcoinAddress(mixed)).toBeUndefined()
    })

    // The checksum is the whole point: a wallet that accepts a typo'd address is a
    // wallet that sends money nowhere. Both encodings must actually verify.
    it('rejects a corrupted base58 checksum', () => {
        expect(decodeBitcoinAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3')).toBeUndefined()
    })

    it('rejects a corrupted bech32 checksum', () => {
        expect(decodeBitcoinAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5')).toBeUndefined()
    })

    // Witness version selects the checksum constant. Accepting either constant for
    // either version would let a corrupted address through whenever it happened to
    // satisfy the other one.
    it('rejects a v0 address encoded with bech32m', () => {
        // BIP-350 invalid vector: v0 witness with bech32m checksum.
        expect(
            decodeBitcoinAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh'),
        ).toBeUndefined()
    })

    it('rejects a v1 address encoded with bech32', () => {
        // BIP-350 invalid vector: v1 witness with bech32 (not bech32m) checksum.
        expect(
            decodeBitcoinAddress('bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4'),
        ).toBeUndefined()
    })

    it('rejects an unknown human-readable prefix', () => {
        expect(decodeBitcoinAddress('ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBeUndefined()
    })

    it('rejects lightning invoices, empty strings and noise', () => {
        expect(decodeBitcoinAddress('')).toBeUndefined()
        expect(decodeBitcoinAddress('   ')).toBeUndefined()
        expect(decodeBitcoinAddress('lnbc1u1p...')).toBeUndefined()
        expect(decodeBitcoinAddress('not an address')).toBeUndefined()
    })

    it('isBitcoinAddress is a predicate over the same rules', () => {
        expect(isBitcoinAddress(P2TR)).toBe(true)
        expect(isBitcoinAddress('nope')).toBe(false)
    })

    it('decodes the CDK fakewallet regtest address rather than rejecting it outright', () => {
        // Recognising it is what lets the pay flow say "wrong network" instead of
        // "unknown data". Refusing to PAY it is isPayableBitcoinAddress's job.
        expect(decodeBitcoinAddress(FAKEWALLET_REGTEST)).toEqual({
            address: FAKEWALLET_REGTEST,
            network: 'regtest',
            kind: 'P2WPKH',
        })
    })
})

describe('isPayableBitcoinAddress', () => {
    it('accepts mainnet addresses of every script type', () => {
        for (const address of [P2PKH, P2SH, P2WPKH, P2WSH, P2TR]) {
            expect(isPayableBitcoinAddress(address)).toBe(true)
        }
    })

    /**
     * The loss vector this exists for: a CDK fakewallet topup hands the user a REGTEST
     * deposit address, it sits in their clipboard, and Pay auto-pastes it. A regtest
     * address is never a payment — it is a mistake, and an irreversible one if a mint
     * broadcasts against it.
     */
    it('refuses the CDK fakewallet regtest address', () => {
        expect(isPayableBitcoinAddress(FAKEWALLET_REGTEST)).toBe(false)
    })

    it('refuses every non-mainnet address', () => {
        expect(isPayableBitcoinAddress(TESTNET_P2WPKH)).toBe(false)
        expect(isPayableBitcoinAddress(TESTNET_P2PKH)).toBe(false)
        expect(isPayableBitcoinAddress('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7k1234a')).toBe(false)
    })

    it('refuses input that is not an address at all', () => {
        expect(isPayableBitcoinAddress('nope')).toBe(false)
        expect(isPayableBitcoinAddress('')).toBe(false)
    })
})

describe('parseBip21', () => {
    it('parses a bare bitcoin: URI', () => {
        expect(parseBip21(`bitcoin:${P2WPKH}`)).toEqual({address: P2WPKH})
    })

    it('converts the BTC amount to sats', () => {
        expect(parseBip21(`bitcoin:${P2WPKH}?amount=0.0001`)?.amountSat).toBe(10000)
        expect(parseBip21(`bitcoin:${P2WPKH}?amount=1`)?.amountSat).toBe(100000000)
    })

    // 0.0001 * 1e8 is 9999.999999999999 in binary floating point. Truncating would
    // under-request by a sat; the round-trip through buildBip21Uri must be stable.
    it('rounds rather than truncates the float conversion', () => {
        expect(parseBip21(`bitcoin:${P2WPKH}?amount=0.00010000`)?.amountSat).toBe(10000)
        expect(parseBip21(`bitcoin:${P2WPKH}?amount=0.00000001`)?.amountSat).toBe(1)
    })

    it('parses label, message and a unified lightning invoice', () => {
        const parsed = parseBip21(
            `bitcoin:${P2WPKH}?amount=0.001&label=Alice&message=Thanks&lightning=LNBC1U1PABC`,
        )
        expect(parsed).toEqual({
            address: P2WPKH,
            amountSat: 100000,
            label: 'Alice',
            message: 'Thanks',
            lightning: 'lnbc1u1pabc',
        })
    })

    it('accepts an uppercase scheme', () => {
        expect(parseBip21(`BITCOIN:${P2WPKH.toUpperCase()}`)?.address).toBe(P2WPKH)
    })

    it('ignores an unusable amount instead of failing the URI', () => {
        expect(parseBip21(`bitcoin:${P2WPKH}?amount=abc`)?.amountSat).toBeUndefined()
        expect(parseBip21(`bitcoin:${P2WPKH}?amount=-1`)?.amountSat).toBeUndefined()
        expect(parseBip21(`bitcoin:${P2WPKH}?amount=0`)?.amountSat).toBeUndefined()
    })

    it('rejects a URI whose address does not check out', () => {
        expect(parseBip21('bitcoin:not-an-address')).toBeUndefined()
        expect(parseBip21('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3')).toBeUndefined()
    })

    // A lightning-only unified URI is legal BIP21, but an onchain melt cannot use it.
    it('rejects an addressless URI', () => {
        expect(parseBip21('bitcoin:?lightning=lnbc1u1pabc')).toBeUndefined()
    })

    it('rejects non-BIP21 input', () => {
        expect(parseBip21(P2WPKH)).toBeUndefined()
        expect(parseBip21('lightning:lnbc1')).toBeUndefined()
    })
})

describe('findBitcoinAddress', () => {
    it('finds a bare address', () => {
        expect(findBitcoinAddress(P2TR)).toBe(P2TR)
    })

    it('finds a BIP21 URI inside surrounding text', () => {
        const found = findBitcoinAddress(`Pay me here: bitcoin:${P2WPKH}?amount=0.001 thanks!`)
        expect(found).toBe(`bitcoin:${P2WPKH}?amount=0.001`)
    })

    it('finds an address embedded in pasted prose', () => {
        expect(findBitcoinAddress(`send to ${P2PKH} please`)).toBe(P2PKH)
    })

    it('skips candidates that fail their checksum', () => {
        expect(findBitcoinAddress('send to 1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3 please')).toBeUndefined()
    })

    it('returns undefined for text with no address', () => {
        expect(findBitcoinAddress('just some words')).toBeUndefined()
        expect(findBitcoinAddress('')).toBeUndefined()
    })
})
