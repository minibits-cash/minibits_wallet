/**
 * NWC encryption negotiation (NIP-47): a request without an `encryption` tag is a
 * legacy NIP-04 client and must keep working; `nip44_v2` requests are decrypted
 * and answered with NIP-44, interoperable with a client using plain nostr-tools.
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))
// nostrService -> minibitsService / walletService -> models -> native modules.
jest.mock('../src/services/minibitsService', () => ({MinibitsClient: {}}))
jest.mock('../src/services/walletService', () => ({WalletTask: {}}))

import {generateSecretKey, getPublicKey} from 'nostr-tools/pure'
import {bytesToHex} from '@noble/hashes/utils.js'
import * as nip04 from 'nostr-tools/nip04'
import {v2 as nip44} from 'nostr-tools/nip44'
import {NostrClient} from '../src/services/nostrService'

const {getNwcEncryption, NWC_ENCRYPTION_SCHEMES} = NostrClient

const keyPair = () => {
  const sk = generateSecretKey()
  return {sk, keys: {privateKey: bytesToHex(sk), publicKey: getPublicKey(sk)}}
}
const event = (tags: string[][]) => ({tags} as any)

describe('nwc encryption', () => {
  test('scheme comes from the encryption tag, absent means legacy nip04', () => {
    expect(getNwcEncryption(event([['p', 'aa']]))).toBe('nip04')
    expect(getNwcEncryption(event([['encryption', '']]))).toBe('nip04')
    expect(getNwcEncryption(event([['encryption', 'nip44_v2']]))).toBe('nip44_v2')
    expect(getNwcEncryption(event([['encryption', 'nip04']]))).toBe('nip04')
    expect(getNwcEncryption(event([['encryption', 'foo nip44_v2']]))).toBe('nip44_v2')
    const unknown = getNwcEncryption(event([['encryption', 'nip99']]))
    expect(NWC_ENCRYPTION_SCHEMES.includes(unknown)).toBe(false)
  })

  test('nip44 request from a plain nostr-tools client decrypts, and the reply decrypts back', () => {
    const wallet = keyPair()
    const client = keyPair()
    const request = JSON.stringify({method: 'get_balance', params: {}})

    const sent = nip44.encrypt(request, nip44.utils.getConversationKey(client.sk, wallet.keys.publicKey))
    expect(NostrClient.decryptNip44(client.keys.publicKey, sent, wallet.keys)).toBe(request)

    const reply = NostrClient.encryptNip44(client.keys.publicKey, '{"result_type":"get_balance"}', wallet.keys)
    expect(nip44.decrypt(reply, nip44.utils.getConversationKey(client.sk, wallet.keys.publicKey)))
      .toBe('{"result_type":"get_balance"}')
  })

  test('legacy nip04 round trip still works', async () => {
    const wallet = keyPair()
    const client = keyPair()

    const sent = nip04.encrypt(client.sk, wallet.keys.publicKey, 'hello')
    expect(await NostrClient.decryptNip04(client.keys.publicKey, sent, wallet.keys)).toBe('hello')

    const reply = await NostrClient.encryptNip04(client.keys.publicKey, 'world', wallet.keys)
    expect(nip04.decrypt(client.sk, wallet.keys.publicKey, reply)).toBe('world')
  })
})
