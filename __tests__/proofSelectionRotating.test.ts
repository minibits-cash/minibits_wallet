/**
 * cashu-ts proof selection: `selectProofsRGLI` vs `selectProofsRotating`.
 *
 * cashu-ts 4.8 (#818) changed the Wallet's DEFAULT selector from `selectProofsRGLI`
 * to `selectProofsRotating`, and 4.10 is the first version the wallet ships with
 * that default. The two differ only in the presence of STALE-keyset proofs, where
 * rotating force-includes whole stale buckets — dust and all — so balances migrate
 * onto the mint's current keyset. On a fee-charging mint that is a real, visible
 * cost: the fee scales with the NUMBER of inputs (NUT-02).
 *
 * This matters to Minibits specifically because the wallet ALREADY has a rotation
 * policy of its own — `CashuUtils.selectProofsToSendWithFeeReserve` is called with
 * `priorityProofs: inactiveProofs` by both SendOperationApi and TransferOperationApi.
 * Under RGLI that intent was silently discarded: cashu-ts re-selected from the
 * proofs the wallet passed and just took the cheapest set. Under rotating the
 * wallet's stated intent is actually honored. So the fee delta below is not the
 * library overriding the wallet — it is the library finally doing what the wallet
 * asked for.
 *
 * These cases are NOT reachable on a device: getting proofs onto an inactive keyset
 * requires the mint to sign with a keyset it has retired. A unit test is the only
 * place the behavior can be pinned, which is why it lives here.
 *
 * Deliberately decision-neutral. It documents BOTH selectors rather than asserting
 * one is correct, so it stays valid whether the wallet keeps the 4.10 default or
 * pins `selectProofs: selectProofsRGLI` in the CashuWallet options.
 *
 * @jest-environment node
 */
import {
  KeyChain,
  deriveKeysetId,
  getPubKeyFromPrivKey,
  selectProofsRGLI,
  selectProofsRotating,
} from '@cashu/cashu-ts'
import type {MintKeys, MintKeyset, Proof} from '@cashu/cashu-ts'
import {bytesToHex} from '@noble/curves/utils.js'

const MINT_URL = 'https://mint.test/sat'
const AMOUNTS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]

/** 1000 ppk = exactly 1 sat per input proof, so fees are legible in assertions. */
const FEE_PPK = 1000

/** A keyset whose id genuinely derives from its keys, at the given id version. */
const makeKeyset = (seedByte: number, active: boolean, versionByte: number) => {
  const keys: Record<string, string> = {}
  for (let i = 0; i < AMOUNTS.length; i++) {
    const priv = new Uint8Array(32)
    priv[31] = seedByte
    priv[30] = i + 1
    keys[String(AMOUNTS[i])] = bytesToHex(getPubKeyFromPrivKey(priv))
  }
  const id = deriveKeysetId(keys, {unit: 'sat', input_fee_ppk: FEE_PPK, versionByte})
  return {
    meta: {id, unit: 'sat', active, input_fee_ppk: FEE_PPK} as MintKeyset,
    keys: {id, unit: 'sat', active, keys} as MintKeys,
  }
}

// The shape a mint migration leaves behind: the old keyset that signed the user's
// existing ecash goes inactive, a new one is issued and becomes active.
const stale = makeKeyset(0x11, false, 0)
const current = makeKeyset(0x22, true, 1)

const keyChain = KeyChain.fromCache(
  MINT_URL,
  'sat',
  KeyChain.mintToCacheDTO(MINT_URL, [stale.meta, current.meta], [stale.keys, current.keys]),
)

let counter = 0
const proof = (keysetId: string, amount: number): Proof => {
  counter++
  return {
    id: keysetId,
    amount,
    secret: `secret-${counter}`,
    C: `02${String(counter).padStart(64, '0')}`,
  } as unknown as Proof
}

const sum = (ps: Proof[]) => ps.reduce((acc, p) => acc + Number(p.amount), 0)
/** NUT-02: fee = ceil(Σ input_fee_ppk / 1000). At 1000 ppk that is one sat per input. */
const feeFor = (ps: Proof[]) => Math.ceil((ps.length * FEE_PPK) / 1000)
const staleCount = (ps: Proof[]) => ps.filter(p => p.id === stale.meta.id).length

describe('when every proof is on the ACTIVE keyset', () => {
  // The overwhelmingly common case, and the one a device test can reach: there is
  // nothing stale to prefer, so the two selectors cannot diverge.
  const pool = [128, 64, 32, 16, 8, 4].map(a => proof(current.meta.id, a))

  test('RGLI and rotating select the same number of inputs', () => {
    const rgli = selectProofsRGLI(pool, 100, keyChain, true, false)
    const rotating = selectProofsRotating(pool, 100, keyChain, true, false)

    expect(rotating.send.length).toBe(rgli.send.length)
    expect(sum(rotating.send as Proof[])).toBe(sum(rgli.send as Proof[]))
  })

  test('so the fee is identical — no upgrade cost for an all-current wallet', () => {
    const rgli = selectProofsRGLI(pool, 100, keyChain, true, false)
    const rotating = selectProofsRotating(pool, 100, keyChain, true, false)

    expect(feeFor(rotating.send as Proof[])).toBe(feeFor(rgli.send as Proof[]))
  })
})

describe('when STALE-keyset proofs are present', () => {
  // 20 dust proofs stranded on the retired keyset, plus usable current denominations.
  const pool = [
    ...Array.from({length: 20}, () => proof(stale.meta.id, 1)),
    ...[64, 32, 16].map(a => proof(current.meta.id, a)),
  ]

  test('RGLI ignores staleness and takes the cheapest set', () => {
    const {send} = selectProofsRGLI(pool, 50, keyChain, true, false)

    // One 64 covers 50 + its own 1 sat fee, so RGLI spends a single input and
    // leaves all 20 dust proofs stranded exactly where they were.
    expect(send.length).toBe(1)
    expect(staleCount(send as Proof[])).toBe(0)
  })

  test('rotating force-includes the whole stale bucket', () => {
    const {send} = selectProofsRotating(pool, 50, keyChain, true, false)

    expect(staleCount(send as Proof[])).toBe(20)
    expect(send.length).toBeGreaterThan(20)
  })

  test('which costs materially more in input fees — the upgrade consequence', () => {
    const rgli = selectProofsRGLI(pool, 50, keyChain, true, false)
    const rotating = selectProofsRotating(pool, 50, keyChain, true, false)

    // 1 sat vs 21. The user buys consolidation of 20 dust proofs for 20 extra sats.
    expect(feeFor(rgli.send as Proof[])).toBe(1)
    expect(feeFor(rotating.send as Proof[])).toBe(21)
  })
})

describe('the invariant both selectors must hold', () => {
  // The regression guard that actually matters. With includeFees=true — which is
  // what cashu-ts's own prepareSwapToSend passes — the selected set must cover the
  // target PLUS the input fee on itself. If this ever breaks, sends fail on
  // fee-charging mints with "Not enough funds available for swap".
  const scenarios: Array<{name: string; target: number; pool: Proof[]}> = [
    {
      name: 'mixed stale dust and current denominations',
      target: 100,
      pool: [
        ...[1, 1, 1, 2, 4, 8].map(a => proof(stale.meta.id, a)),
        ...[128, 64, 32, 16].map(a => proof(current.meta.id, a)),
      ],
    },
    {
      name: 'all current',
      target: 100,
      pool: [128, 64, 32, 16, 8, 4].map(a => proof(current.meta.id, a)),
    },
    {
      name: 'stale bucket alone covers the target',
      target: 12,
      pool: [
        ...[8, 4, 2, 1].map(a => proof(stale.meta.id, a)),
        ...[64, 32].map(a => proof(current.meta.id, a)),
      ],
    },
  ]

  for (const {name, target, pool} of scenarios) {
    for (const [label, select] of [
      ['RGLI', selectProofsRGLI],
      ['rotating', selectProofsRotating],
    ] as const) {
      test(`${label} covers target + its own fee — ${name}`, () => {
        const {send} = select(pool, target, keyChain, true, false)
        const selected = send as Proof[]

        expect(selected.length).toBeGreaterThan(0)
        expect(sum(selected) - feeFor(selected)).toBeGreaterThanOrEqual(target)
      })
    }
  }
})
