/**
 * Receiving ecash signed by an INACTIVE keyset (Mint.ts / WalletStore.receive).
 *
 * The wallet only ever fetches ACTIVE keys — `getKeys()` with no keyset id, which by
 * NUT-01 returns only active keysets. That is fine until a proof arrives from an
 * inactive keyset, which is exactly what a mint MIGRATION produces: cdk migrates the
 * nutshell keyset that signed every existing proof (e.g. 00107937…) as INACTIVE and
 * issues a new active v2 keyset. cashu-ts DLEQ-verifies every input proof that carries
 * a DLEQ — regardless of `requireDleq` — and throws
 *
 *     Undefined key for amount N in keyset X
 *
 * when X's keys are not loaded. This test reproduces that precondition at the cashu-ts
 * KeyChain level (the layer WalletStore.getWallet builds) and proves that
 * `ensureKeysetKeys` — which WalletStore.receive now calls for every input proof's
 * keyset — loads the missing keys.
 *
 * Deterministic and offline: keysets are generated with cashu-ts crypto primitives, so
 * the derived ids genuinely verify against their keys (a partial or fake keyset would
 * be wiped by KeyChain's own `verify() || (keys = {})`).
 *
 * @jest-environment node
 */
import {
  deriveKeysetId,
  getPubKeyFromPrivKey,
  KeyChain,
} from '@cashu/cashu-ts'
import type {MintKeys, MintKeyset} from '@cashu/cashu-ts'
import {bytesToHex} from '@noble/curves/utils.js'

const MINT_URL = 'https://mint.test/sat'
const AMOUNTS = [1, 2, 4, 8, 16, 32]

/** A valid v0 keyset whose id genuinely derives from its keys. */
const makeKeyset = (
  seedByte: number,
  active: boolean,
): {meta: MintKeyset; keys: MintKeys} => {
  const keys: Record<string, string> = {}
  for (let i = 0; i < AMOUNTS.length; i++) {
    // Distinct, deterministic private keys → real public keys.
    const priv = new Uint8Array(32)
    priv[31] = seedByte
    priv[30] = i + 1
    keys[String(AMOUNTS[i])] = bytesToHex(getPubKeyFromPrivKey(priv))
  }

  const id = deriveKeysetId(keys, {unit: 'sat', input_fee_ppk: 0, versionByte: 0})

  return {
    meta: {id, unit: 'sat', active, input_fee_ppk: 0},
    keys: {id, unit: 'sat', active, keys},
  }
}

// The keyset that signed the received ecash, now INACTIVE (the migrated one), and the
// mint's new ACTIVE keyset.
const inactive = makeKeyset(0x11, false)
const active = makeKeyset(0x22, true)

describe('a keychain built from active keys only', () => {
  const kc = KeyChain.fromCache(
    MINT_URL,
    'sat',
    // What the wallet loads: every keyset's metadata, but keys for the ACTIVE keyset
    // only. This is `getKeys()` (active) + `getKeySets()` (all).
    KeyChain.mintToCacheDTO(MINT_URL, [inactive.meta, active.meta], [active.keys]),
  )

  test('the inactive keyset ends up with no keys — the "Undefined key" precondition', () => {
    expect(kc.getKeyset(inactive.meta.id).hasKeys).toBe(false)
  })

  test('the active keyset is fine', () => {
    const ks = kc.getKeyset(active.meta.id)
    expect(ks.hasKeys).toBe(true)
    expect(ks.verify()).toBe(true)
    expect(ks.keys['16']).toBeDefined()
  })
})

describe('a keychain that also has the inactive keyset keys', () => {
  const kc = KeyChain.fromCache(
    MINT_URL,
    'sat',
    KeyChain.mintToCacheDTO(
      MINT_URL,
      [inactive.meta, active.meta],
      [inactive.keys, active.keys],
    ),
  )

  test('the inactive keyset verifies and amount 16 is present', () => {
    const ks = kc.getKeyset(inactive.meta.id)
    expect(ks.hasKeys).toBe(true)
    expect(ks.verify()).toBe(true)
    // The exact lookup cashu-ts does during DLEQ verify of an amount-16 input proof.
    expect(ks.keys['16']).toBeDefined()
  })
})

describe('ensureKeysetKeys — the fix WalletStore.receive relies on', () => {
  test('loads keys for an inactive keyset that the active-only cache omitted', async () => {
    // A mint that serves the inactive keyset's keys on the per-id endpoint — cdk does
    // exactly this at /v1/keys/{id}, verified against the live migration mint.
    const fakeMint = {
      mintUrl: MINT_URL,
      getKeys: jest.fn(async (id: string) => ({
        keysets: [id === inactive.meta.id ? inactive.keys : active.keys],
      })),
    }

    const kc = KeyChain.fromCache(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeMint as any,
      'sat',
      KeyChain.mintToCacheDTO(MINT_URL, [inactive.meta, active.meta], [active.keys]),
    )

    // Before: the receive would throw "Undefined key for amount 16".
    expect(kc.getKeyset(inactive.meta.id).hasKeys).toBe(false)

    const loaded = await kc.ensureKeysetKeys(inactive.meta.id)

    expect(loaded.hasKeys).toBe(true)
    expect(loaded.verify()).toBe(true)
    expect(kc.getKeyset(inactive.meta.id).keys['16']).toBeDefined()
    expect(fakeMint.getKeys).toHaveBeenCalledWith(inactive.meta.id)
  })

  test('is a no-op when the keys are already present', async () => {
    const fakeMint = {
      mintUrl: MINT_URL,
      getKeys: jest.fn(async () => ({keysets: [active.keys]})),
    }

    const kc = KeyChain.fromCache(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeMint as any,
      'sat',
      KeyChain.mintToCacheDTO(MINT_URL, [active.meta], [active.keys]),
    )

    await kc.ensureKeysetKeys(active.meta.id)

    expect(fakeMint.getKeys).not.toHaveBeenCalled()
  })
})
