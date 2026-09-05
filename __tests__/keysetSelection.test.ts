/**
 * Which keyset a new wallet binds to (`WalletStore.getOptimalKeysetId`).
 *
 * The wallet used to mirror cashu-ts's KeyChain.getCheapestKeyset by hand: filter to
 * active hex-id keysets for the unit, sort by input fee, break ties on id. It now
 * delegates to the library, which is a deliberate BEHAVIOUR change, not just dedup —
 * the two orderings had diverged:
 *
 *     old (wallet)   fee ASC, then id (version) as a tiebreak
 *     new (cashu-ts) version DESC, then fee ASC, then final_expiry DESC   (#836)
 *
 * They disagree exactly when a mint prices its newer keyset ABOVE an older one. The
 * old rule kept minting on the cheaper, older keyset; the new one moves to the
 * current keyset and accepts the higher fee. That is the intended direction — a
 * keyset the mint has superseded is one it can retire, stranding ecash on it — but
 * it does mean a user can pay more per input after this upgrade.
 *
 * These tests pin that ordering against the real library, so the choice is explicit
 * and a future cashu-ts change to it fails here rather than silently altering which
 * keyset the wallet mints on.
 *
 * @jest-environment node
 */
import {KeyChain, deriveKeysetId, getPubKeyFromPrivKey} from '@cashu/cashu-ts'
import type {MintKeys, MintKeyset} from '@cashu/cashu-ts'
import {bytesToHex} from '@noble/curves/utils.js'

const MINT_URL = 'https://mint.test'
const AMOUNTS = [1, 2, 4, 8, 16, 32]

/** A keyset whose id genuinely derives from its keys, at a chosen version and fee. */
const makeKeyset = (
  seedByte: number,
  opts: {active: boolean; versionByte: number; fee: number},
) => {
  const keys: Record<string, string> = {}
  for (let i = 0; i < AMOUNTS.length; i++) {
    const priv = new Uint8Array(32)
    priv[31] = seedByte
    priv[30] = i + 1
    keys[String(AMOUNTS[i])] = bytesToHex(getPubKeyFromPrivKey(priv))
  }
  const id = deriveKeysetId(keys, {
    unit: 'sat',
    input_fee_ppk: opts.fee,
    versionByte: opts.versionByte,
  })
  return {
    meta: {id, unit: 'sat', active: opts.active, input_fee_ppk: opts.fee} as MintKeyset,
    keys: {id, unit: 'sat', active: opts.active, keys} as MintKeys,
  }
}

/** What WalletStore.getOptimalKeysetId does, minus the AppError wrapping. */
const choose = (entries: Array<{meta: MintKeyset; keys?: MintKeys}>) => {
  const metas = entries.map(e => e.meta)
  const keys = entries.flatMap(e => (e.keys ? [e.keys] : []))
  return KeyChain.fromCache(
    MINT_URL,
    'sat',
    KeyChain.mintToCacheDTO(MINT_URL, metas, keys),
  )
    .getCheapestKeyset().id
}

describe('keyset id VERSION outranks fee — the behaviour change', () => {
  // A v2 keyset that charges MORE than an older v0 one. Under the wallet's old
  // fee-first rule the v0 keyset won; cashu-ts picks the v2.
  const oldCheap = makeKeyset(0x11, {active: true, versionByte: 0, fee: 0})
  const newExpensive = makeKeyset(0x22, {active: true, versionByte: 1, fee: 250})

  test('the newer keyset is chosen even though it costs more', () => {
    expect(choose([oldCheap, newExpensive])).toBe(newExpensive.meta.id)
  })

  test('order of the input does not matter', () => {
    expect(choose([newExpensive, oldCheap])).toBe(newExpensive.meta.id)
  })

  test('the old fee-first rule would have chosen differently', () => {
    // Pins the divergence itself, so this file explains a real difference rather
    // than restating the library.
    const byFeeThenId = [oldCheap.meta, newExpensive.meta].sort(
      (a, b) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0) || b.id.localeCompare(a.id),
    )[0]

    expect(byFeeThenId.id).toBe(oldCheap.meta.id)
    expect(choose([oldCheap, newExpensive])).not.toBe(byFeeThenId.id)
  })
})

describe('within one version, the cheaper keyset still wins', () => {
  const cheap = makeKeyset(0x33, {active: true, versionByte: 0, fee: 0})
  const pricey = makeKeyset(0x44, {active: true, versionByte: 0, fee: 500})

  test('lowest input fee is chosen', () => {
    expect(choose([pricey, cheap])).toBe(cheap.meta.id)
  })
})

describe('candidates the selection must exclude', () => {
  const active = makeKeyset(0x55, {active: true, versionByte: 0, fee: 100})

  test('inactive keysets, even when cheaper', () => {
    const inactiveCheaper = makeKeyset(0x66, {active: false, versionByte: 1, fee: 0})

    expect(choose([active, inactiveCheaper])).toBe(active.meta.id)
  })

  test('keysets whose keys are missing — they cannot create outputs', () => {
    // The old wallet rule could not express this: it selected on keyset metadata
    // and only discovered the absent keys afterwards, as a separate error.
    const keyless = makeKeyset(0x77, {active: true, versionByte: 1, fee: 0})

    expect(choose([active, {meta: keyless.meta}])).toBe(active.meta.id)
  })

  test('throws when nothing is selectable', () => {
    const inactive = makeKeyset(0x88, {active: false, versionByte: 0, fee: 0})

    expect(() => choose([inactive])).toThrow()
  })
})
