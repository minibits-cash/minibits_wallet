/**
 * The receive path recognizes our own NIP-17 self-copy by the rumor's author and
 * dedups it by rumor id. Both rest on these nostr-tools invariants: the copy sealed
 * to ourselves unwraps with our pubkey as author, and both copies carry the same
 * rumor id. If either broke, the wallet would treat a token it sent as incoming.
 *
 * @jest-environment node
 */
import {generateSecretKey, getPublicKey, getEventHash} from 'nostr-tools/pure'
import {createRumor, createSeal, createWrap, unwrapEvent} from 'nostr-tools/nip59'

test('self-copy unwraps as ours with the same rumor id as the recipient copy', () => {
  const me = generateSecretKey()
  const them = generateSecretKey()
  const mePub = getPublicKey(me)
  const themPub = getPublicKey(them)

  const rumor = createRumor({kind: 14, tags: [['p', themPub]], content: 'cashuB...'}, me)
  const toThem = createWrap(createSeal(rumor, me, themPub), themPub)
  const toSelf = createWrap(createSeal(rumor, me, mePub), mePub)

  const received = unwrapEvent(toThem, them)
  const echoed = unwrapEvent(toSelf, me)

  expect(echoed.pubkey).toBe(mePub)
  expect(getEventHash(echoed)).toBe(rumor.id)
  expect(getEventHash(received)).toBe(getEventHash(echoed))
  expect(toThem.id).not.toBe(toSelf.id) // distinct wraps, one rumor
})
