/**
 * The backup envelope.
 *
 * A backup is bearer money and the only copy of a wallet's state, so both failure
 * directions matter: a backup that cannot be restored is lost funds, and a backup
 * anyone can read is stolen funds. These pin both, plus the compatibility promise —
 * `minibitsA` plaintext backups, saved in notes and password managers long before
 * encryption existed, must keep restoring.
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {mnemonicToSeedSync} from '@scure/bip39'
import {encodeBackup, decodeBackup} from '../src/services/backup/backupCodec'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow'

const seed = mnemonicToSeedSync(MNEMONIC)
const otherSeed = mnemonicToSeedSync(OTHER_MNEMONIC)

// Shaped like the real thing: the proof secrets are the part worth stealing.
const payload = {
  proofsStore: {
    proofs: [
      {
        id: '009a1f293253e41e',
        amount: 2,
        secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837',
        C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea',
        unit: 'sat',
        tId: 1,
        mintUrl: 'https://mint.test',
        state: 'UNSPENT',
      },
    ],
    pendingByMintSecrets: ['407915bc212be61a'],
  },
  mintsStore: {
    mints: [{id: 'mint1111', mintUrl: 'https://mint.test', keys: [], proofsCounters: [{keyset: '009a1f293253e41e', unit: 'sat', counter: 42}]}],
    blockedMintUrls: [],
  },
  contactsStore: {contacts: []},
}

describe('encoding', () => {
  test('a backup round trips through the seed that made it', () => {
    const encoded = encodeBackup(payload, seed)

    expect(encoded.startsWith('minibitsB')).toBe(true)
    expect(decodeBackup(encoded, seed)).toEqual(payload)
  })

  test('the payload is not readable in the encoded string', () => {
    const encoded = encodeBackup(payload, seed)
    const raw = Buffer.from(encoded.slice('minibitsB'.length), 'base64').toString('latin1')

    expect(encoded).not.toContain(payload.proofsStore.proofs[0].secret)
    expect(raw).not.toContain(payload.proofsStore.proofs[0].secret)
    expect(raw).not.toContain('mint.test')
  })

  // Same wallet, same payload, two exports: no shared key material, and nothing
  // that says the two files belong together.
  test('two backups of the same wallet look unrelated', () => {
    const first = encodeBackup(payload, seed)
    const second = encodeBackup(payload, seed)

    expect(first).not.toEqual(second)
    expect(decodeBackup(first, seed)).toEqual(decodeBackup(second, seed))
  })

  // btoa() threw on anything above U+00FF, so a single emoji in a contact name
  // used to fail the export outright, with no backup produced and only a toast to
  // show for it. The envelope is UTF-8 now.
  test('non-Latin1 text survives — it used to break the export', () => {
    const withUnicode = {
      ...payload,
      contactsStore: {contacts: [{name: '🥜 Ňuž', about: 'Zkoušků'}]},
    }

    expect(decodeBackup(encodeBackup(withUnicode, seed), seed)).toEqual(withUnicode)
  })

  test('refuses to encrypt without a seed', () => {
    expect(() => encodeBackup(payload, new Uint8Array())).toThrow(/Missing the wallet seed/)
  })
})

describe('decoding', () => {
  test('another wallet cannot read the backup', () => {
    const encoded = encodeBackup(payload, seed)

    expect(() => decodeBackup(encoded, otherSeed)).toThrow(/different seed phrase/)
  })

  test('altered ciphertext is rejected, not silently mis-decoded', () => {
    const encoded = encodeBackup(payload, seed)
    const envelope = Buffer.from(encoded.slice('minibitsB'.length), 'base64')

    envelope[envelope.length - 1] ^= 0xff

    expect(() => decodeBackup('minibitsB' + envelope.toString('base64'), seed)).toThrow(
      /Could not decrypt/,
    )
  })

  test('a truncated backup says so', () => {
    const encoded = encodeBackup(payload, seed)

    expect(() => decodeBackup(encoded.slice(0, 20), seed)).toThrow(/incomplete|Could not decrypt/)
  })

  test('a string that is not a backup at all says so', () => {
    expect(() => decodeBackup('not a backup', seed)).toThrow(/starts with 'minibits'/)
    expect(() => decodeBackup('', seed)).toThrow(/starts with 'minibits'/)
  })

  test('a format from a newer app version asks the user to update', () => {
    expect(() => decodeBackup('minibitsZsomething', seed)).toThrow(/newer version/)
  })
})

describe('legacy plaintext backups', () => {
  // Exactly what the old export produced: btoa(JSON.stringify(payload)).
  const legacy = (data: unknown) =>
    'minibitsA' + Buffer.from(JSON.stringify(data), 'latin1').toString('base64')

  test('still restore, with no seed needed', () => {
    expect(decodeBackup(legacy(payload), new Uint8Array())).toEqual(payload)
  })

  // btoa mapped each code unit below 0x100 to one byte, so these backups are
  // latin1, not UTF-8 — reading them as UTF-8 would corrupt every accented name in
  // them. Only characters up to U+00FF can appear: 'š' (U+0161) never made it into
  // a legacy backup, because btoa threw and no backup was produced at all.
  test('and accented names in them are not corrupted', () => {
    const accented = {...payload, contactsStore: {contacts: [{name: 'Tomás Müller'}]}}

    expect(decodeBackup(legacy(accented), new Uint8Array())).toEqual(accented)
  })
})
