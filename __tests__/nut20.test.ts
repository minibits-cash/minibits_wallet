/**
 * NUT-20 quote-locking key tests.
 *
 * Two halves:
 *
 *  1. DERIVATION (src/services/cashu/nut20.ts) — determinism, key format, a
 *     pinned regression vector, and a sign/verify round-trip through cashu-ts's
 *     own NUT-20 primitives.
 *
 *  2. THE COUNTER (src/services/db/walletCountersRepo.ts) — the burn-forward
 *     allocation and monotonic set, exercised through the REAL repo against a real
 *     database (the op-sqlite jest mock backs the driver seam with node:sqlite).
 *
 * The counter is the load-bearing part: handing the same index out twice would
 * give two quotes the same pubkey, which lets the mint link them (NUT-20 asks
 * for a unique key per quote precisely to prevent that) and makes the signature
 * ambiguous. Skipping an index is harmless; reusing one is not.
 *
 * @jest-environment node
 */
import {Database} from '../src/services/db'
import {Amount, signMintQuote, verifyMintQuoteSignature} from '@cashu/cashu-ts'
import type {SerializedBlindedMessage} from '@cashu/cashu-ts'
import {hexToBytes} from '@noble/curves/utils.js'

jest.mock('../src/services/logService', () => ({
    log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

// The DERIVATION half stubs the counter so it can pin the index it is handed
// (allocateQuoteKeypair must use whatever the counter returns, whatever that is).
// The COUNTER half below reaches past this mock with requireActual and exercises
// the real repo against a real database.
const mockAllocateNextCounter = jest.fn()
jest.mock('../src/services/db/walletCountersRepo', () => ({
    NUT20_COUNTER: 'nut20',
    allocateNextCounter: (name: string) => mockAllocateNextCounter(name),
}))

import {
    allocateQuoteKeypair,
    deriveQuoteKeypair,
    quoteKeyDerivationPath,
} from '../src/services/cashu/nut20'

/**
 * Seed for the standard BIP39 test mnemonic
 * ("abandon" x11 + "about", empty passphrase) — the canonical value from the
 * BIP39 spec's own test vectors, so it can be checked against the spec rather
 * than against us. Pinned as bytes because NUT-20 derives from the seed, not the
 * mnemonic; that keeps BIP39 (and its PBKDF2 native dep) out of this test.
 */
const SEED = hexToBytes(
    '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1' +
        '9a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4',
)

/**
 * Pinned NUT-20 vector for m/129373'/20'/0'/0'/{0,1}.
 *
 * Computed INDEPENDENTLY (a clean @scure/bip32 install outside this codebase),
 * not captured from our own output — so it cross-checks the implementation
 * rather than enshrining whatever it happened to produce.
 *
 * Stage 1 validates derivation by round-trip only; a real mint accepting these
 * signatures is not proven until the first onchain mint (Stage 5). Until then
 * this vector is what stops the path from silently drifting. If it ever fails,
 * the derivation path changed — that would orphan every existing quote, so do
 * not "fix" it by updating the constant.
 */
const VECTOR = [
    {
        index: 0,
        privkey: '26392b1fd4bd70c14f27c30368a896412ce5a44f22a3035ce820f91324c7d49b',
        pubkey: '025c820f30db9b7d9479a0337aeed771162e291e9cd711ce8f42b1a188a39d3c9e',
    },
    {
        index: 1,
        privkey: '13dbe6792e239fd6a9b0d96263076e67507aef397453a314a6e68d5fc390cc22',
        pubkey: '032acf3ccf5f01638ec9110a997d75797805c1e37f050de814263beceb7d8996a6',
    },
]

const BLINDED_MESSAGES: SerializedBlindedMessage[] = [
    {
        amount: Amount.from(8),
        id: '009a1f293253e41e',
        B_: '035015e6d7ade60ba8426cefaf1832bbd27257636e44a76b922d78e79b47cb689d',
    },
    {
        amount: Amount.from(2),
        id: '009a1f293253e41e',
        B_: '0288d7649652d0a83fc9c966c969fb217f15904431e61a44b14999fabc1b5d9ac6',
    },
]

const QUOTE_ID = '019e6d5a-2347-7000-8850-39c85ed1b5d3'

describe('NUT-20 quote key derivation', () => {
    beforeEach(() => mockAllocateNextCounter.mockReset())

    it('uses the NUT-20 path, with a non-hardened counter', () => {
        // 129373' = cashu namespace, 20' = NUT-20; the counter is NOT hardened.
        expect(quoteKeyDerivationPath(0)).toBe("m/129373'/20'/0'/0'/0")
        expect(quoteKeyDerivationPath(42)).toBe("m/129373'/20'/0'/0'/42")
    })

    it('matches the pinned vector (independently computed)', () => {
        for (const {index, privkey, pubkey} of VECTOR) {
            expect(deriveQuoteKeypair(SEED, index)).toEqual({privkey, pubkey})
        }
    })

    it('is deterministic for a given seed and index', () => {
        expect(deriveQuoteKeypair(SEED, 7)).toEqual(deriveQuoteKeypair(SEED, 7))
    })

    it('gives a distinct key per index', () => {
        const keys = [0, 1, 2, 3, 4].map(i => deriveQuoteKeypair(SEED, i).pubkey)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it('produces a 32-byte privkey and a 33-byte compressed pubkey', () => {
        const {privkey, pubkey} = deriveQuoteKeypair(SEED, 3)
        expect(privkey).toMatch(/^[0-9a-f]{64}$/)
        expect(pubkey).toMatch(/^0[23][0-9a-f]{64}$/) // compressed: 02/03 prefix
    })

    it('rejects a negative or non-integer index', () => {
        expect(() => deriveQuoteKeypair(SEED, -1)).toThrow()
        expect(() => deriveQuoteKeypair(SEED, 1.5)).toThrow()
    })
})

/**
 * Round-trip through cashu-ts's NUT-20 primitives.
 *
 * These prove the DERIVED KEY is a usable NUT-20 signing key — they do not pin
 * the wire format, and deliberately so. cashu-ts 4.7.0 carries TWO mint-quote
 * message aggregations:
 *
 *   - the spec's `Cashu_MintQuoteSig_v1` (domain tag, len32-prefixed quote, and
 *     per-output amount + B_), and
 *   - a legacy one: sha256(quote || B_0 || B_1 ...), with no domain tag and no
 *     amounts.
 *
 * The EXPORTED `signMintQuote` / `verifyMintQuoteSignature` are the LEGACY pair.
 * The library's own mint path (prepareMint, and so mintProofsOnchain) signs with
 * the spec-v1 aggregation and puts THAT in the request's `signature` field — so
 * what Minibits actually sends is spec-correct. The wire format is proven when a
 * real mint accepts a signed mint request (Stage 5); here we only need to know
 * the key itself signs and verifies.
 *
 * Consequence: assertions below stick to what the legacy message commits to
 * (quote id and B_). It does NOT commit to output amounts, so a tampered amount
 * would still verify through this pair — which says nothing about the v1 format
 * we actually transmit.
 */
describe('NUT-20 signing round-trip (via cashu-ts)', () => {
    it('signs a mint request the matching pubkey verifies', () => {
        const {privkey, pubkey} = deriveQuoteKeypair(SEED, 0)

        const signature = signMintQuote(privkey, QUOTE_ID, BLINDED_MESSAGES)

        expect(verifyMintQuoteSignature(pubkey, QUOTE_ID, BLINDED_MESSAGES, signature)).toBe(true)
    })

    it('does not verify under a different quote key', () => {
        const {privkey} = deriveQuoteKeypair(SEED, 0)
        const {pubkey: otherPubkey} = deriveQuoteKeypair(SEED, 1)

        const signature = signMintQuote(privkey, QUOTE_ID, BLINDED_MESSAGES)

        expect(verifyMintQuoteSignature(otherPubkey, QUOTE_ID, BLINDED_MESSAGES, signature)).toBe(
            false,
        )
    })

    it('does not verify against a different quote id', () => {
        const {privkey, pubkey} = deriveQuoteKeypair(SEED, 0)

        const signature = signMintQuote(privkey, QUOTE_ID, BLINDED_MESSAGES)

        expect(
            verifyMintQuoteSignature(pubkey, 'some-other-quote-id', BLINDED_MESSAGES, signature),
        ).toBe(false)
    })

    it('does not verify against tampered outputs (B_ is committed)', () => {
        const {privkey, pubkey} = deriveQuoteKeypair(SEED, 0)

        const signature = signMintQuote(privkey, QUOTE_ID, BLINDED_MESSAGES)
        const tampered = [
            {
                ...BLINDED_MESSAGES[0],
                B_: '0288d7649652d0a83fc9c966c969fb217f15904431e61a44b14999fabc1b5d9ac6',
            },
            BLINDED_MESSAGES[1],
        ]

        expect(verifyMintQuoteSignature(pubkey, QUOTE_ID, tampered, signature)).toBe(false)
    })
})

describe('allocateQuoteKeypair', () => {
    beforeEach(() => mockAllocateNextCounter.mockReset())

    it('allocates from the nut20 counter and derives that index', () => {
        mockAllocateNextCounter.mockReturnValue(5)

        const result = allocateQuoteKeypair(SEED)

        expect(mockAllocateNextCounter).toHaveBeenCalledWith('nut20')
        expect(result).toEqual({index: 5, ...deriveQuoteKeypair(SEED, 5)})
    })

    it('never repeats a keypair across calls', () => {
        mockAllocateNextCounter.mockReturnValueOnce(0).mockReturnValueOnce(1)

        const first = allocateQuoteKeypair(SEED)
        const second = allocateQuoteKeypair(SEED)

        expect(first.pubkey).not.toBe(second.pubkey)
    })
})

// ── The counter, through the REAL repo ──────────────────────────────────────
//
// These call walletCountersRepo directly rather than mirroring its SQL. The
// allocation is a single RETURNING statement whose exact semantics ARE the safety
// property, so a hand-copy would prove nothing about the statement that runs.

// requireActual reaches past the module-level stub above: this half is about the
// real statements, not about isolating the derivation from them.
const {allocateNextCounter, getWalletCounter, setWalletCounter} = jest.requireActual(
    '../src/services/db/walletCountersRepo',
)

describe('wallet_counters (burn-forward allocation)', () => {
    // One in-memory database per test FILE (instance.ts caches its connection), so
    // clear the table between tests rather than rebuilding.
    beforeEach(() => {
        Database.getInstance().executeBatch([['DELETE FROM wallet_counters']])
    })

    it('starts at index 0 when no row exists', () => {
        expect(getWalletCounter('nut20')).toBe(0)
        expect(allocateNextCounter('nut20')).toBe(0)
    })

    it('hands out consecutive indices and stores the next free one', () => {
        const allocated = [0, 1, 2, 3].map(() => allocateNextCounter('nut20'))

        expect(allocated).toEqual([0, 1, 2, 3])
        expect(getWalletCounter('nut20')).toBe(4) // next free, not last used
    })

    it('never hands out the same index twice', () => {
        const allocated = Array.from({length: 50}, () => allocateNextCounter('nut20'))

        expect(new Set(allocated).size).toBe(allocated.length)
    })

    it('burns the index when the caller fails: a retry gets a NEW one', () => {
        // The whole point of committing before the network call. Quote request
        // dies -> index 0 is spent, never recycled.
        const burned = allocateNextCounter('nut20')
        const afterRetry = allocateNextCounter('nut20')

        expect(burned).toBe(0)
        expect(afterRetry).toBe(1)
        expect(afterRetry).not.toBe(burned)
    })

    it('keeps counters independent per purpose name', () => {
        expect(allocateNextCounter('nut20')).toBe(0)
        expect(allocateNextCounter('other')).toBe(0)
        expect(allocateNextCounter('nut20')).toBe(1)

        expect(getWalletCounter('nut20')).toBe(2)
        expect(getWalletCounter('other')).toBe(1)
    })

    it('setWalletCounter is monotonic: a lower value is a no-op', () => {
        setWalletCounter('nut20', 10)
        expect(getWalletCounter('nut20')).toBe(10)

        setWalletCounter('nut20', 3) // stale writer
        expect(getWalletCounter('nut20')).toBe(10)

        setWalletCounter('nut20', 12)
        expect(getWalletCounter('nut20')).toBe(12)
    })

    it('cannot walk back onto an index already handed out', () => {
        const first = allocateNextCounter('nut20') // 0
        allocateNextCounter('nut20') // 1

        setWalletCounter('nut20', 0) // stale/replayed write

        expect(allocateNextCounter('nut20')).toBe(2)
        expect(allocateNextCounter('nut20')).not.toBe(first)
    })
})
