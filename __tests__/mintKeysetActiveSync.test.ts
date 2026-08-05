/**
 * Mint.setIsActive keeps the `keys` array's active flag in lockstep with `keysets`.
 *
 * A mint carries two parallel arrays: `keysets` (metadata, the authority on active)
 * and `keys` (the amount→pubkey maps, which ALSO carry MintKeys.active). getKeys()
 * only ever returns ACTIVE keysets, so a keyset going inactive is never re-fetched —
 * and before this fix its `keys` entry kept a stale active:true forever. That surfaces
 * after a mint migration flips the formerly-active keyset inactive: the keysets array
 * updates, the keys array does not.
 *
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
  LogLevel: {ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG', TRACE: 'TRACE'},
}))
jest.mock('../src/services', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
  Database: {},
}))
jest.mock('../src/theme', () => ({
  colors: {palette: {iconBlue200: '#4dabf7'}},
  getRandomIconColor: () => '#4dabf7',
}))
jest.mock('../src/services/wallet/currency', () => ({
  MintUnits: ['btc', 'sat', 'msat', 'usd', 'eur'],
}))
jest.mock('../src/utils/utils', () => ({
  generateId: () => 'testmint',
}))
jest.mock('../src/services/cashu/cashuUtils', () => ({
  CashuUtils: {},
}))

import {MintModel} from '../src/models/Mint'

const KEYSET_ID = '00107937db0cc865'

const buildMint = () =>
  MintModel.create({
    mintUrl: 'https://mint.test/sat',
    keysets: [{id: KEYSET_ID, unit: 'sat', active: true, input_fee_ppk: 0} as any],
    keys: [{id: KEYSET_ID, unit: 'sat', active: true, keys: {'1': 'aa', '2': 'bb'}} as any],
  })

describe('Mint.setIsActive', () => {
  test('flips the keys entry inactive alongside the keyset', () => {
    const mint = buildMint()

    mint.setIsActive({id: KEYSET_ID, unit: 'sat', active: false} as any)

    expect(mint.keysets.find(k => k.id === KEYSET_ID)?.active).toBe(false)
    // The regression: this used to stay true because getKeys() never re-fetches an
    // inactive keyset, so nothing else would ever correct it.
    expect((mint.keys.find(k => k.id === KEYSET_ID) as any)?.active).toBe(false)
  })

  test('flips back to active symmetrically', () => {
    const mint = buildMint()

    mint.setIsActive({id: KEYSET_ID, unit: 'sat', active: false} as any)
    mint.setIsActive({id: KEYSET_ID, unit: 'sat', active: true} as any)

    expect(mint.keysets.find(k => k.id === KEYSET_ID)?.active).toBe(true)
    expect((mint.keys.find(k => k.id === KEYSET_ID) as any)?.active).toBe(true)
  })

  test('does not choke when only the keyset is present (no keys entry yet)', () => {
    const mint = MintModel.create({
      mintUrl: 'https://mint.test/sat',
      keysets: [{id: KEYSET_ID, unit: 'sat', active: true, input_fee_ppk: 0} as any],
      keys: [],
    })

    expect(() => mint.setIsActive({id: KEYSET_ID, unit: 'sat', active: false} as any)).not.toThrow()
    expect(mint.keysets.find(k => k.id === KEYSET_ID)?.active).toBe(false)
  })
})
