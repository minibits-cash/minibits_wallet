import {KeyChain} from '../src/services/keyChain'

// NIP-06 test vector (nostr-tools' own): the derivation the wallet uses to turn a
// seed phrase into the user's nostr identity. This is the only place in the app
// that runs nostr-tools crypto, so it also guards the library upgrade itself.
const MNEMONIC = 'leader monkey parrot ring guide accident before fence cannon height naive bean'
const NPUB_HEX = '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917'
const NSEC_HEX = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a'

describe('deriveNostrKeyPair', () => {
    it('derives the NIP-06 account 0 keypair from a mnemonic', () => {
        expect(KeyChain.deriveNostrKeyPair(MNEMONIC)).toEqual({
            publicKey: NPUB_HEX,
            privateKey: NSEC_HEX,
        })
    })

    it('derives a different keypair for another account index', () => {
        expect(KeyChain.deriveNostrKeyPair(MNEMONIC, 1).publicKey).not.toBe(NPUB_HEX)
    })
})
