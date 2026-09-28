/**
 * Exact-match proof selection (`CashuUtils.findExactMatch` / `getProofsToSend`).
 *
 * Regression coverage for a transfer that stalled ~50s on the JS thread and got
 * the app killed by the iOS watchdog for memory: the former backtracker searched
 * exhaustively when no exact match existed. Pins that the greedy replacement finds
 * an exact match whenever one exists, and stays fast when none does.
 *
 * @jest-environment node
 */

jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

jest.mock('../src/services/nostrService', () => ({
  NostrClient: {getFirstTagValue: jest.fn()},
}))

import {CashuUtils} from '../src/services/cashu/cashuUtils'
import {Proof} from '../src/models/Proof'

let secretSeq = 0
const mkProof = (amount: number): Proof =>
  ({id: '00aaaaaaaaaaaaaa', amount, secret: `secret-${secretSeq++}`, C: 'C', unit: 'sat'} as unknown as Proof)

const sum = (ps: Proof[]) => ps.reduce((s, p) => s + p.amount, 0)

// Seeded so a failure is reproducible.
let seed = 42
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31

/** A wallet as mints issue it: each receipt split into powers of two, small change optionally thinned out. */
const mkWallet = (receipts: number, maxAmount: number, thinBelow = 0): Proof[] => {
  const proofs: Proof[] = []
  for (let r = 0; r < receipts; r++) {
    const amount = 1 + Math.floor(rnd() * maxAmount)
    for (let b = 0; b < 21; b++) {
      const denom = 1 << b
      if (amount & denom && !(denom < thinBelow && rnd() < 0.85)) proofs.push(mkProof(denom))
    }
  }
  return proofs
}

/** Ground truth: can any subset sum exactly to target? */
const reachable = (proofs: Proof[], target: number) => {
  const dp = new Uint8Array(target + 1)
  dp[0] = 1
  for (const p of proofs) for (let s = target; s >= p.amount; s--) if (dp[s - p.amount]) dp[s] = 1
  return dp[target] === 1
}

describe('findExactMatch', () => {
  test.each([
    ['plenty of change', 60, 20000, 0],
    ['sparse wallet', 5, 100000, 0],
    ['little small change', 40, 20000, 64],
  ])('finds an exact match whenever one exists — %s', (_, receipts, maxAmount, thinBelow) => {
    for (let i = 0; i < 100; i++) {
      const wallet = mkWallet(receipts, maxAmount, thinBelow)
      // Half the targets are a real subset sum, half arbitrary.
      const target = rnd() < 0.5
        ? sum(wallet.filter(() => rnd() < 0.3)) || 1
        : 1 + Math.floor(rnd() * sum(wallet))

      const match = CashuUtils.findExactMatch(target, wallet)

      expect(match !== null).toBe(reachable(wallet, target))
      if (match) expect(sum(match)).toBe(target)
    }
  })

  test('does not reorder the caller\'s array', () => {
    const wallet = [1, 8, 2, 4].map(mkProof)
    const before = wallet.map(p => p.secret)
    CashuUtils.findExactMatch(5, wallet)
    expect(wallet.map(p => p.secret)).toEqual(before)
  })

  test('returns fast on a large wallet with no exact match', () => {
    // 1000 proofs, no denomination below 2: an odd target is unreachable. The
    // former backtracker took ~60s and ~700MB on this in desktop Node.
    const wallet = Array.from({length: 1000}, (_, i) => mkProof(2 ** (1 + (i % 16))))

    const start = Date.now()
    expect(CashuUtils.findExactMatch(187415, wallet)).toBeNull()
    const selected = CashuUtils.getProofsToSend(187415, wallet)
    expect(Date.now() - start).toBeLessThan(200)

    expect(sum(selected)).toBeGreaterThanOrEqual(187415)
  })
})
