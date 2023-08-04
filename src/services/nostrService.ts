import * as nostrTools from 'nostr-tools'
import {KeyChain, KeyPair} from './keyChain'
import {log} from '../utils/logger'



const getOrCreateKeyPair = async function (): Promise<KeyPair> {

    let keypair: KeyPair | null = null

    keypair = await KeyChain.loadNostrKeyPair() as KeyPair

    if (!keypair) {
      keypair = KeyChain.generateNostrKeyPair() as KeyPair
      await KeyChain.saveNostrKeyPair(keypair)

      log.info('Created and saved new NOSTR keypair','','getOrCreateKeyPair',)
    }

    return keypair
}


const getNPubKey = function (publicKey: string): string {
   return nostrTools.nip19.npubEncode(publicKey)      
}


export const NostrClient = {
    getOrCreateKeyPair,
    getNPubKey
}