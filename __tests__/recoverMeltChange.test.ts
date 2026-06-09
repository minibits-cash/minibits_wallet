import {
  Amount,
  OutputData,
  blindMessage,
  createBlindSignature,
  createDLEQProof,
  getPubKeyFromPrivKey,
  pointFromBytes,
} from '@cashu/cashu-ts'
import type {SerializedBlindedSignature, HasKeysetKeys} from '@cashu/cashu-ts'
import {bytesToHex, hexToBytes} from '@noble/curves/utils.js'

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

const KEYSET_ID = '00abcdef00abcdef'

// Each denomination is signed by the mint with a distinct private key.
const privkeyForAmount = (amount: number): Uint8Array =>
  hexToBytes((amount + 1).toString(16).padStart(64, '0'))

const pubkeyHexForAmount = (amount: number): string =>
  pointFromBytes(getPubKeyFromPrivKey(privkeyForAmount(amount))).toHex(true)

interface Blank {
  blankIndex: number
  assignedAmount: number
  outputData: OutputData
  sig: SerializedBlindedSignature
}

/**
 * Build a blank output (what the wallet stored at melt time) together with the
 * change signature the mint produces from it. The blank's secret is the human
 * readable label `blank-<index>` so recovered proofs can be traced back to the
 * exact blank that produced them.
 */
const makeBlank = function (blankIndex: number, assignedAmount: number): Blank {
  const secret = new TextEncoder().encode(`blank-${blankIndex}`)
  const r = BigInt('0x' + (blankIndex + 1).toString(16).padStart(64, '0'))
  const bm = blindMessage(secret, r)

  const priv = privkeyForAmount(assignedAmount)
  const blindSig = createBlindSignature(bm.B_, priv, KEYSET_ID)
  const dleq = createDLEQProof(bm.B_, priv)

  const outputData = new OutputData(
    {amount: Amount.from(0), B_: bm.B_.toHex(true), id: KEYSET_ID},
    r,
    secret,
  )

  const sig: SerializedBlindedSignature = {
    id: KEYSET_ID,
    amount: Amount.from(assignedAmount),
    C_: blindSig.C_.toHex(true),
    dleq: {e: bytesToHex(dleq.e), s: bytesToHex(dleq.s)},
  }

  return {blankIndex, assignedAmount, outputData, sig}
}

const keysetFor = (amounts: number[]): HasKeysetKeys => {
  const keys: Record<string, string> = {}
  for (const a of amounts) keys[a.toString()] = pubkeyHexForAmount(a)
  return {id: KEYSET_ID, keys}
}

const secretOf = (proof: {secret: string}) => proof.secret

describe('CashuUtils.recoverMeltChange', () => {
  it('recovers in-order change with full DLEQ verification', () => {
    const blanks = [makeBlank(0, 8), makeBlank(1, 4)]
    const keyset = keysetFor([8, 4])

    const {change, stats} = CashuUtils.recoverMeltChange({
      outputData: blanks.map(b => b.outputData),
      quoteChange: blanks.map(b => b.sig),
      keyset,
    })

    expect(stats).toEqual({recovered: 2, reordered: 0, noDleqFallback: 0, unmatched: 0})
    expect(change.map(p => Number(p.amount))).toEqual([8, 4])
    expect(change.map(secretOf)).toEqual(['blank-0', 'blank-1'])
    expect(change.every(p => p.dleq)).toBe(true)
    expect(CashuUtils.meltChangeRecoveryHasError(stats)).toBe(false)
  })

  it('re-pairs shuffled change to the correct blanks (the nutshell <0.20.1 bug)', () => {
    const blanks = [makeBlank(0, 16), makeBlank(1, 8), makeBlank(2, 4), makeBlank(3, 2)]
    const keyset = keysetFor([16, 8, 4, 2])

    // Mint returns the signatures in a different order than the blanks were sent.
    const shuffled = [blanks[2].sig, blanks[0].sig, blanks[3].sig, blanks[1].sig]

    const {change, stats} = CashuUtils.recoverMeltChange({
      outputData: blanks.map(b => b.outputData),
      quoteChange: shuffled,
      keyset,
    })

    expect(stats.recovered).toBe(4)
    expect(stats.reordered).toBeGreaterThan(0)
    expect(stats.noDleqFallback).toBe(0)
    expect(stats.unmatched).toBe(0)

    // Output order follows the (shuffled) quoteChange order, but each proof must
    // carry the secret + amount of the blank the mint actually signed.
    expect(change.map(p => Number(p.amount))).toEqual([4, 16, 2, 8])
    expect(change.map(secretOf)).toEqual(['blank-2', 'blank-0', 'blank-3', 'blank-1'])
    expect(change.every(p => p.dleq)).toBe(true)
  })

  it('handles fewer returned signatures than blanks (NUT-08 blank overshoot)', () => {
    const blanks = [
      makeBlank(0, 32),
      makeBlank(1, 16),
      makeBlank(2, 8),
      makeBlank(3, 4),
      makeBlank(4, 2),
    ]
    const keyset = keysetFor([32, 16, 8, 4, 2])

    // Only two outputs were actually needed, returned out of order.
    const change = [blanks[3].sig, blanks[1].sig]

    const result = CashuUtils.recoverMeltChange({
      outputData: blanks.map(b => b.outputData),
      quoteChange: change,
      keyset,
    })

    expect(result.stats).toEqual({recovered: 2, reordered: 1, noDleqFallback: 0, unmatched: 0})
    expect(result.change.map(secretOf)).toEqual(['blank-3', 'blank-1'])
    expect(result.change.map(p => Number(p.amount))).toEqual([4, 16])
  })

  it('disambiguates blanks that share the same denomination via DLEQ', () => {
    const blanks = [makeBlank(0, 8), makeBlank(1, 8)]
    const keyset = keysetFor([8])

    const shuffled = [blanks[1].sig, blanks[0].sig]

    const {change, stats} = CashuUtils.recoverMeltChange({
      outputData: blanks.map(b => b.outputData),
      quoteChange: shuffled,
      keyset,
    })

    expect(stats.recovered).toBe(2)
    expect(stats.noDleqFallback).toBe(0)
    // Each signature is matched to the exact blank it was signed from.
    expect(change.map(secretOf)).toEqual(['blank-1', 'blank-0'])
  })

  it('falls back to no-DLEQ recovery when no blank verifies (genuine DLEQ failure)', () => {
    const blanks = [makeBlank(0, 8), makeBlank(1, 4)]
    const keyset = keysetFor([8, 4])

    // Corrupt the first signature's DLEQ so it verifies against no blank.
    const corrupted: SerializedBlindedSignature = {
      ...blanks[0].sig,
      dleq: {e: '00'.repeat(32), s: blanks[0].sig.dleq!.s},
    }

    const {change, stats} = CashuUtils.recoverMeltChange({
      outputData: blanks.map(b => b.outputData),
      quoteChange: [corrupted, blanks[1].sig],
      keyset,
    })

    expect(stats.recovered).toBe(2)
    expect(stats.noDleqFallback).toBe(1)
    expect(stats.unmatched).toBe(0)
    expect(CashuUtils.meltChangeRecoveryHasError(stats)).toBe(true)

    // Funds are still recovered (positional blank), but the proof has no DLEQ.
    expect(change).toHaveLength(2)
    expect(change[0].dleq).toBeUndefined()
    expect(secretOf(change[0])).toBe('blank-0')
    expect(change[1].dleq).toBeTruthy()
  })

  it('reports unmatched signatures when a blank is missing and fallback is exhausted', () => {
    const present = makeBlank(0, 8)
    const missing = makeBlank(1, 4) // signed from a blank we do NOT provide

    const keyset = keysetFor([8, 4])

    const {change, stats} = CashuUtils.recoverMeltChange({
      outputData: [present.outputData],
      quoteChange: [present.sig, missing.sig],
      keyset,
    })

    expect(stats.recovered).toBe(1)
    expect(stats.unmatched).toBe(1)
    expect(CashuUtils.meltChangeRecoveryHasError(stats)).toBe(true)
    expect(change).toHaveLength(1)
    expect(secretOf(change[0])).toBe('blank-0')
  })
})
