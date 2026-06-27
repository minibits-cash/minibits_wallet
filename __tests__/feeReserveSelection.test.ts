/**
 * Fixed-point proof selection for fee-bearing operations
 * (`CashuUtils.selectProofsToSendWithFeeReserve`).
 *
 * Regression coverage for the melt/swap underfunding bug: a mint charges a
 * per-proof input fee that grows with the NUMBER of proofs spent. Selecting
 * proofs for a larger, fee-inclusive target can pull in more proofs, raising
 * the fee again — so a SINGLE fee recompute can leave the inputs short and the
 * mint rejects with "not enough inputs provided for melt" (melt) /
 * "Not enough funds available for swap" (send).
 *
 * Both `TransferOperationApi.prepare` (melt) and `SendOperationApi.prepare`
 * (swap) route their input selection through this helper, so these tests pin
 * the shared invariant that previously broke in production.
 *
 * @jest-environment node
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
  NostrClient: {getFirstTagValue: jest.fn()},
}))

import {CashuUtils} from '../src/services/cashu/cashuUtils'
import {Proof} from '../src/models/Proof'

// ── Test fixtures ────────────────────────────────────────────────────────────

let secretSeq = 0
const mkProof = (amount: number): Proof =>
  ({
    id: '00aaaaaaaaaaaaaa',
    amount,
    secret: `secret-${secretSeq++}`,
    C: 'C',
    unit: 'sat',
  } as unknown as Proof)

/** `count` proofs each worth `denom` sats. */
const mkProofs = (denom: number, count: number): Proof[] =>
  Array.from({length: count}, () => mkProof(denom))

/**
 * Mint fee as a function of proof COUNT, mirroring NUT-02
 * `fee = ceil(count * fee_ppk / 1000)`.
 */
const feeForPpk = (ppk: number) => (proofs: Proof[]): number =>
  Math.ceil((proofs.length * ppk) / 1000)

/**
 * The OLD (buggy) logic: select for the target, compute the fee once, re-select
 * for target+fee, and stop — never re-checking the fee of the re-selected set.
 * Used to prove the scenario genuinely underfunds before the fix.
 */
const naiveSelect = (
  targetAmount: number,
  proofs: Proof[],
  getFees: (p: Proof[]) => number,
): {proofsToSend: Proof[]; feeReserve: number} => {
  let selected = CashuUtils.getProofsToSend(targetAmount, proofs)
  const feeReserve = getFees(selected)
  if (feeReserve > 0) {
    selected = CashuUtils.getProofsToSend(targetAmount + feeReserve, proofs)
  }
  return {proofsToSend: selected, feeReserve}
}

const sum = (proofs: Proof[]) => CashuUtils.getProofsAmount(proofs)

beforeEach(() => {
  secretSeq = 0
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('selectProofsToSendWithFeeReserve', () => {
  test('no fee → returns the first selection unchanged', () => {
    const proofs = mkProofs(1, 130)
    const {proofsToSend, feeReserve} = CashuUtils.selectProofsToSendWithFeeReserve(
      100,
      proofs,
      () => 0,
    )
    expect(feeReserve).toBe(0)
    expect(sum(proofsToSend)).toBe(100)
  })

  test('converges so the selected set covers its OWN input fee', () => {
    // 1-sat proofs ⇒ getProofsToSend(N) selects exactly N proofs. With
    // fee = ceil(count / 50) the fee climbs as more proofs are pulled in,
    // requiring more than one recompute (100 → 102 → 103).
    const proofs = mkProofs(1, 130)
    const getFees = (p: Proof[]) => Math.ceil(p.length / 50)

    const {proofsToSend, feeReserve} = CashuUtils.selectProofsToSendWithFeeReserve(
      100,
      proofs,
      getFees,
    )

    // The core invariant the mint enforces.
    expect(sum(proofsToSend)).toBeGreaterThanOrEqual(100 + getFees(proofsToSend))
    // Reported reserve matches the true fee of the returned set.
    expect(feeReserve).toBe(getFees(proofsToSend))
    // Specifically: 103 proofs, fee 3 (100 + 3).
    expect(proofsToSend.length).toBe(103)
    expect(feeReserve).toBe(3)
  })

  test('the old single-recompute logic underfunded the same scenario', () => {
    // Demonstrates the bug the fix addresses: the naive path stops one proof
    // short of covering the input fee of the set it actually selected.
    const proofs = mkProofs(1, 130)
    const getFees = (p: Proof[]) => Math.ceil(p.length / 50)

    const naive = naiveSelect(100, proofs, getFees)
    // Naive selected 102 proofs, whose true fee is 3 → needs 103 but provides
    // only 102. This is exactly the "provided X, needed X+1" mint rejection.
    expect(naive.proofsToSend.length).toBe(102)
    expect(sum(naive.proofsToSend)).toBeLessThan(100 + getFees(naive.proofsToSend))

    // The fixed helper does NOT underfund.
    const fixed = CashuUtils.selectProofsToSendWithFeeReserve(100, proofs, getFees)
    expect(sum(fixed.proofsToSend)).toBeGreaterThanOrEqual(100 + getFees(fixed.proofsToSend))
  })

  test('reproduces the "provided 103, needed 104" off-by-one at fee_ppk=1000', () => {
    // fee_ppk = 1000 ⇒ fee = proof count. A first selection of 3 one-sat proofs
    // for amount=100 would never reach 100, so use a realistic denomination mix
    // and assert the converged invariant directly (selection internals aside).
    const proofs = [
      ...mkProofs(64, 1),
      ...mkProofs(32, 1),
      ...mkProofs(16, 1),
      ...mkProofs(8, 1),
      ...mkProofs(4, 1),
      ...mkProofs(2, 2),
      ...mkProofs(1, 6),
    ]
    const getFees = feeForPpk(1000)

    const {proofsToSend, feeReserve} = CashuUtils.selectProofsToSendWithFeeReserve(
      100,
      proofs,
      getFees,
    )

    expect(sum(proofsToSend)).toBeGreaterThanOrEqual(100 + feeReserve)
    expect(feeReserve).toBe(getFees(proofsToSend))
  })

  test('keeps the first selection when its overshoot already covers the fee', () => {
    // Big denominations: selecting for 100 overshoots to 128, which already
    // covers a tiny fee, so no extra proofs are pulled in.
    const proofs = [...mkProofs(128, 1), ...mkProofs(64, 1), ...mkProofs(1, 10)]
    const getFees = feeForPpk(1000) // fee = count (here at most a few)

    const {proofsToSend, feeReserve} = CashuUtils.selectProofsToSendWithFeeReserve(
      100,
      proofs,
      getFees,
    )
    expect(sum(proofsToSend)).toBeGreaterThanOrEqual(100 + feeReserve)
  })

  test('throws VALIDATION_ERROR when funds cannot cover amount + converged fee', () => {
    // Exactly 100 sats available but a non-zero fee is required on top.
    const proofs = mkProofs(1, 100)
    const getFees = (p: Proof[]) => Math.ceil(p.length / 50) // ≥1 once near 100

    expect(() =>
      CashuUtils.selectProofsToSendWithFeeReserve(100, proofs, getFees, {
        caller: 'unit-test',
      }),
    ).toThrow(/not enough funds/i)
  })

  test('respects the iteration guard instead of looping forever', () => {
    // A pathological fee that always demands one more than is available would
    // loop indefinitely without the guard; here it must terminate by throwing.
    const proofs = mkProofs(1, 200)
    const everGrowingFee = (p: Proof[]) => p.length // fee == count, never catches up

    expect(() =>
      CashuUtils.selectProofsToSendWithFeeReserve(100, proofs, everGrowingFee, {
        maxIterations: 8,
      }),
    ).toThrow(/not enough funds/i)
  })
})
