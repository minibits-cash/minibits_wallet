/**
 * Keyset-id collision tests (CashuUtils.isCollidingKeysetId).
 *
 * NUT-02 requires that a wallet "reject any attempt at importing new keysets
 * which IDs collide with any of the previously added keysets". This wallet
 * enforces that WALLET-WIDE (every keyset of every mint), which is what makes a
 * keyset id a sound primary key for a NUT-13 derivation counter — see
 * MINT_COUNTERS_COLUMNS.
 *
 * Two distinct collision classes are covered here:
 *
 *  - Exact id equality: always a collision. One id means one derivation
 *    sequence, so two mints sharing an id would share one counter.
 *
 *  - keysetIdInt equality: a collision ONLY between ids that both derive via the
 *    deprecated BIP-32 path, where the id is reduced mod 2^31-1 to fit a
 *    hardened index and two distinct ids that are congruent therefore land on
 *    the SAME derivation path. NUT-02 v2 (`01`) ids derive by HMAC-SHA256 over
 *    the full id and never compute that integer, so the reduction cannot alias
 *    them and applying the check to them would reject a legitimate mint.
 */
jest.mock('../src/services/logService', () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    trace: jest.fn(),
    warn: jest.fn(),
  },
}))

jest.mock('../src/services/nostrService', () => ({
  NostrClient: {
    getFirstTagValue: jest.fn(),
  },
}))

import {CashuUtils} from '../src/services/cashu/cashuUtils'

const {isCollidingKeysetId} = CashuUtils

const MOD = BigInt(2 ** 31 - 1)

/** Build a v1 (`00`-prefixed, 8-byte) keyset id from its 7 data bytes. */
const v1 = (dataHex: string) => `00${dataHex.padStart(14, '0')}`

/** Build a v2 (`01`-prefixed, 33-byte) keyset id from its 32 data bytes. */
const v2 = (dataHex: string) => `01${dataHex.padStart(64, '0')}`

const keysetIdInt = (id: string) => BigInt(`0x${id}`) % MOD

describe('isCollidingKeysetId', () => {
  describe('exact id equality — always a collision', () => {
    test('detects a v1 id already held', () => {
      const id = v1('a1b2c3d4e5f601')
      expect(isCollidingKeysetId(id, [v1('0000000000ff01'), id])).toBe(true)
    })

    test('detects a v2 id already held', () => {
      const id = v2('deadbeef')
      expect(isCollidingKeysetId(id, [v2('feedface'), id])).toBe(true)
    })

    test('passes an id the wallet does not hold', () => {
      expect(isCollidingKeysetId(v1('a1b2c3d4e5f601'), [v1('0000000000ff01')])).toBe(false)
    })

    test('passes against an empty wallet', () => {
      expect(isCollidingKeysetId(v2('deadbeef'), [])).toBe(false)
    })
  })

  describe('keysetIdInt aliasing — v1 (deprecated BIP-32 derivation)', () => {
    // Two DISTINCT v1 ids that are congruent mod 2^31-1 derive at the same
    // `m/129372'/0'/{int}'/...` path, so the second must be rejected even though
    // the ids differ.
    test('rejects two distinct v1 ids that reduce to the same derivation index', () => {
      const stored = v1('00000000000001')
      const colliding = (BigInt(`0x${stored}`) + MOD).toString(16).padStart(16, '0')

      expect(colliding).not.toBe(stored)
      expect(keysetIdInt(colliding)).toBe(keysetIdInt(stored))
      expect(isCollidingKeysetId(colliding, [stored])).toBe(true)
    })

    test('passes two v1 ids that reduce to different indices', () => {
      expect(isCollidingKeysetId(v1('00000000000002'), [v1('00000000000001')])).toBe(false)
    })
  })

  describe('keysetIdInt aliasing — v2 (HMAC derivation) must NOT be int-checked', () => {
    // The regression this guards: applying the mod-2^31-1 check to v2 ids
    // rejects a legitimate mint over an integer nothing consumes, and re-imposes
    // v1's ~2^31 birthday bound on ids whose whole point is full-width SHA-256
    // collision resistance.
    test('accepts two distinct v2 ids that happen to be congruent mod 2^31-1', () => {
      const stored = v2('01')
      const congruent = (BigInt(`0x${stored}`) + MOD).toString(16).padStart(66, '0')

      expect(congruent).not.toBe(stored)
      expect(congruent.startsWith('01')).toBe(true)
      expect(keysetIdInt(congruent)).toBe(keysetIdInt(stored)) // the alias exists...
      expect(isCollidingKeysetId(congruent, [stored])).toBe(false) // ...and is correctly ignored
    })

    test('a v2 id congruent with a stored v1 id is not a collision (different derivation paths)', () => {
      const storedV1 = v1('00000000000001')
      const target = keysetIdInt(storedV1)

      // Craft a v2 id reducing to the same int as the v1 id above.
      const base = BigInt(`0x${v2('00')}`)
      const delta = (target - (base % MOD) + MOD) % MOD
      const congruentV2 = (base + delta).toString(16).padStart(66, '0')

      expect(congruentV2.startsWith('01')).toBe(true)
      expect(keysetIdInt(congruentV2)).toBe(target)
      // A v2 id never derives at m/129372'/0'/{int}'/…, so it cannot share a
      // path with a v1 id no matter what the ints do.
      expect(isCollidingKeysetId(congruentV2, [storedV1])).toBe(false)
    })

    test('exact equality still wins for v2 — int gating does not disable the real check', () => {
      const id = v2('cafebabe')
      expect(isCollidingKeysetId(id, [id])).toBe(true)
    })
  })

  describe('mixed wallets', () => {
    test('checks every stored id, not just the first', () => {
      const target = v2('deadbeef')
      expect(isCollidingKeysetId(target, [v1('00000000000001'), v2('feedface'), target])).toBe(true)
    })

    test('a v1 int alias is still caught when the wallet also holds v2 ids', () => {
      const storedV1 = v1('00000000000001')
      const colliding = (BigInt(`0x${storedV1}`) + MOD).toString(16).padStart(16, '0')

      expect(isCollidingKeysetId(colliding, [v2('feedface'), storedV1])).toBe(true)
    })
  })
})
