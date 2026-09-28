/**
 * A swap's output counter range must be known BEFORE its request is sent.
 *
 * If the process dies (or the response is lost) after the mint executed a swap, its
 * outputs exist only at the mint. The wallet advances its stored counter only on
 * success, and anything else using the keyset afterwards reuses that range — so the
 * range is recorded on the reservation from cashu-ts's onCountersReserved, and
 * recovery restores the outputs from it (NUT-09).
 *
 * That only works if cashu-ts fires onCountersReserved before it POSTs /v1/swap.
 * This pins that ordering against the real library, so an upgrade that moves the
 * callback after the request fails here rather than silently on a device.
 *
 * @jest-environment node
 */
import {deriveKeysetId, getPubKeyFromPrivKey, KeyChain, Wallet} from '@cashu/cashu-ts'
import type {MintKeys, MintKeyset, OperationCounters} from '@cashu/cashu-ts'
import {bytesToHex} from '@noble/curves/utils.js'

const MINT_URL = 'https://mint.test/sat'
const AMOUNTS = [1, 2, 4, 8, 16, 32, 64]

const MINT_INFO = {
  name: 'test mint',
  pubkey: '02'.padEnd(66, 'a'),
  version: 'test/1.0',
  description: '',
  contact: [],
  nuts: {'4': {methods: [], disabled: false}, '5': {methods: [], disabled: false}},
} as any

const keys: Record<string, string> = {}
AMOUNTS.forEach((_, i) => {
  const priv = new Uint8Array(32)
  priv[31] = 0x33
  priv[30] = i + 1
  keys[String(AMOUNTS[i])] = bytesToHex(getPubKeyFromPrivKey(priv))
})
const keysetId = deriveKeysetId(keys, {unit: 'sat', input_fee_ppk: 0, versionByte: 0})
const meta: MintKeyset = {id: keysetId, unit: 'sat', active: true, input_fee_ppk: 0}
const mintKeys: MintKeys = {id: keysetId, unit: 'sat', keys} as MintKeys

test('onCountersReserved fires before the swap request is sent', async () => {
  const events: string[] = []
  let reserved: OperationCounters | undefined

  const fakeMint = {
    mintUrl: MINT_URL,
    getInfo: jest.fn(async () => MINT_INFO),
    setMintInfo: jest.fn(),
    // The response never arrives — the case recovery exists for.
    swap: jest.fn(async () => {
      events.push('swap-request')
      throw new Error('Network request failed')
    }),
  } as any

  const wallet = new Wallet(fakeMint, {unit: 'sat', bip39seed: new Uint8Array(64).fill(7)})
  wallet.loadMintFromCache(MINT_INFO, KeyChain.mintToCacheDTO(MINT_URL, [meta], [mintKeys]))
  await wallet.counters.advanceToAtLeast(keysetId, 42)

  const proofs = [{id: keysetId, amount: 64, secret: 'input-1', C: '02' + '11'.repeat(32)}] as any

  await expect(
    wallet.send(5, proofs, {
      includeFees: false,
      onCountersReserved: info => {
        events.push('counters-reserved')
        reserved = info
      },
    }),
  ).rejects.toThrow()

  expect(events).toEqual(['counters-reserved', 'swap-request'])
  // The range starts at the wallet's counter and covers every output of the swap.
  expect(reserved).toMatchObject({keysetId, start: 42})
  expect(reserved!.count).toBeGreaterThan(0)
  expect(reserved!.next).toBe(42 + reserved!.count)
})
