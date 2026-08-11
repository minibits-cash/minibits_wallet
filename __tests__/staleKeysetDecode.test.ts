/**
 * Decoding a token whose v2 keyset the wallet has not seen yet
 * (services/wallet/decodeToken.ts).
 *
 * A NUT-02 v2 keyset id is 33 bytes, but a v4 token carries only its first 8 — so
 * cashu-ts can hand a proof its real id only by matching that prefix against ids the
 * wallet already holds for the mint, and throws when none match. That is precisely
 * what a mint rotating keysets produces (nutshell -> cdk migrates the old `00…`
 * keysets as inactive and signs with a new `01…` one): every wallet that has not
 * touched the mint since holds a list that cannot decode the ecash now arriving,
 * including background lightning-address claims and nostr receives.
 *
 * These tests use REAL cashu-ts encoding — the truncation under test is its own — and
 * prove the decode heals itself by re-pulling the keysets exactly once, and only when
 * a decode has actually failed on an unmappable id.
 *
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

// `mock`-prefixed so jest's hoisting of the factory below can reach them.
const mockMintsStore = {findByUrl: jest.fn()}
const mockWalletStore = {refreshKeysetsNow: jest.fn()}

jest.mock('../src/models', () => ({
  rootStoreInstance: {
    get mintsStore() {
      return mockMintsStore
    },
    get walletStore() {
      return mockWalletStore
    },
  },
}))

import {deriveKeysetId, getDecodedToken, getEncodedToken} from '@cashu/cashu-ts'
import {decodeTokenWithKeysets} from '../src/services/wallet/decodeToken'

const MINT_URL = 'https://mint.test/Bitcoin'
const AMOUNTS = [1, 2, 4, 8]

/** The keyset that signed every proof before the migration — a v0 id, 8 bytes. */
const LEGACY_KEYSET_ID = '00107937db0cc865'

/** The mint's new v2 keyset id, genuinely derived so it carries the `01` version. */
const V2_KEYSET_ID = deriveKeysetId(
  Object.fromEntries(
    AMOUNTS.map((amount, i) => [
      String(amount),
      `02${String(i + 1).padStart(2, '0').repeat(31)}`,
    ]),
  ),
  {unit: 'sat', input_fee_ppk: 0, versionByte: 1},
)

const encodeTokenFromKeyset = (keysetId: string): string =>
  getEncodedToken({
    mint: MINT_URL,
    unit: 'sat',
    proofs: [
      {
        id: keysetId,
        amount: 2,
        secret: 'a'.repeat(64),
        C: `02${'11'.repeat(32)}`,
      } as any,
    ],
  })

/** Point the store at a mint holding exactly these keyset ids. */
const setStoredKeysetIds = (keysetIds: string[]) => {
  mockMintsStore.findByUrl.mockReturnValue({mintUrl: MINT_URL, keysetIds})
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('the failure being healed', () => {
  test('a v2 keyset id is truncated to 8 bytes by v4 encoding', () => {
    expect(V2_KEYSET_ID).toMatch(/^01[0-9a-f]{64}$/)

    // Decoding against the FULL id works, which is the whole mechanism: the short id
    // in the token is a prefix of it.
    const decoded = getDecodedToken(encodeTokenFromKeyset(V2_KEYSET_ID), [V2_KEYSET_ID])
    expect(decoded.proofs[0].id).toBe(V2_KEYSET_ID)
  })

  test('cashu-ts throws when the wallet holds only the pre-migration keyset', () => {
    expect(() =>
      getDecodedToken(encodeTokenFromKeyset(V2_KEYSET_ID), [LEGACY_KEYSET_ID]),
    ).toThrow(/short keyset id/i)
  })
})

describe('decodeTokenWithKeysets', () => {
  test('refreshes the keysets and retries when the id cannot be mapped', async () => {
    setStoredKeysetIds([LEGACY_KEYSET_ID])
    // The refresh is what teaches the wallet about the rotated-in keyset.
    mockWalletStore.refreshKeysetsNow.mockImplementation(async () => {
      setStoredKeysetIds([LEGACY_KEYSET_ID, V2_KEYSET_ID])
    })

    const token = await decodeTokenWithKeysets(encodeTokenFromKeyset(V2_KEYSET_ID), MINT_URL)

    // The proof carries the FULL id, not the 8-byte prefix — everything downstream
    // (counters, keys, DLEQ) is keyed by it.
    expect(token.proofs[0].id).toBe(V2_KEYSET_ID)
    expect(mockWalletStore.refreshKeysetsNow).toHaveBeenCalledTimes(1)
    expect(mockWalletStore.refreshKeysetsNow).toHaveBeenCalledWith(MINT_URL)
  })

  test('costs nothing when the keyset is already known', async () => {
    setStoredKeysetIds([LEGACY_KEYSET_ID, V2_KEYSET_ID])

    const token = await decodeTokenWithKeysets(encodeTokenFromKeyset(V2_KEYSET_ID), MINT_URL)

    expect(token.proofs[0].id).toBe(V2_KEYSET_ID)
    expect(mockWalletStore.refreshKeysetsNow).not.toHaveBeenCalled()
  })

  test('does not touch the mint for a v0 keyset, which needs no mapping', async () => {
    // A stale list cannot break a `00…` id: it travels whole.
    setStoredKeysetIds([])

    const token = await decodeTokenWithKeysets(encodeTokenFromKeyset(LEGACY_KEYSET_ID), MINT_URL)

    expect(token.proofs[0].id).toBe(LEGACY_KEYSET_ID)
    expect(mockWalletStore.refreshKeysetsNow).not.toHaveBeenCalled()
  })

  test('propagates an unrelated decode failure without calling the mint', async () => {
    setStoredKeysetIds([LEGACY_KEYSET_ID])

    await expect(decodeTokenWithKeysets('not-a-cashu-token', MINT_URL)).rejects.toThrow()
    expect(mockWalletStore.refreshKeysetsNow).not.toHaveBeenCalled()
  })

  test('surfaces a refresh failure rather than a confusing decode error', async () => {
    setStoredKeysetIds([LEGACY_KEYSET_ID])
    mockWalletStore.refreshKeysetsNow.mockRejectedValue(new Error('Mint is offline'))

    await expect(
      decodeTokenWithKeysets(encodeTokenFromKeyset(V2_KEYSET_ID), MINT_URL),
    ).rejects.toThrow('Mint is offline')
  })

  test('still fails if the mint does not know the keyset either', async () => {
    setStoredKeysetIds([LEGACY_KEYSET_ID])
    // Refresh succeeds but brings nothing new — a token from a different mint, say.
    mockWalletStore.refreshKeysetsNow.mockResolvedValue(undefined)

    await expect(
      decodeTokenWithKeysets(encodeTokenFromKeyset(V2_KEYSET_ID), MINT_URL),
    ).rejects.toThrow(/short keyset id/i)
    expect(mockWalletStore.refreshKeysetsNow).toHaveBeenCalledTimes(1)
  })
})
