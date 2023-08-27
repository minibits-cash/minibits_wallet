import {
    nip19,
    getEventHash,
    getSignature,
    SimplePool,
    Filter as NostrFilter,    
    Event as NostrEvent,
    validateEvent
} from 'nostr-tools'
import QuickCrypto from 'react-native-quick-crypto'
import {secp256k1} from '@noble/curves/secp256k1'
import {
    MINIBITS_RELAY_URL,    
} from '@env'
import {KeyChain, KeyPair} from './keyChain'
import {log} from '../utils/logger'
import AppError, { Err } from '../utils/AppError'

export {     
    Event as NostrEvent, 
    Filter as NostrFilter, 
    Kind as NostrKind,  
    UnsignedEvent as NostrUnsignedEvent,   
} from 'nostr-tools'

import { NostrUnsignedEvent } from '.'

// refresh

export type NostrProfile = {
    pubkey: string
    npub: string
    name?: string
    about?: string
    picture?: string
    nip05?: string
}



const _defaultPublicRelays: string[] = ['wss://relay.damus.io']
const _minibitsRelays: string[] = [MINIBITS_RELAY_URL]
let _pool: any = undefined

const getRelayPool = function () {
    if(!_pool) {
        _pool = new SimplePool()
        return _pool
    }

    return _pool
}

const getDefaultRelays = function () {
    return _defaultPublicRelays    
}

const getMinibitsRelays = function () {
    return _minibitsRelays    
}

const getRandom = function(list: string[]) {
    return list[Math.floor((Math.random()*list.length))]
}

const getOrCreateKeyPair = async function (): Promise<KeyPair> {
    let keyPair: KeyPair | null = null
    keyPair = await KeyChain.loadNostrKeyPair() as KeyPair

    if (!keyPair) {
        keyPair = KeyChain.generateNostrKeyPair() as KeyPair
      await KeyChain.saveNostrKeyPair(keyPair)

      log.info('Created and saved new NOSTR keypair','','getOrCreateKeyPair',)
    }
     
    return keyPair
}


const getNpubkey = function (publicKey: string): string {
    return nip19.npubEncode(publicKey)      
}


const getHexkey = function (npubkey: string): string {
    try {
        const decoded = nip19.decode(npubkey)

        if(decoded && decoded.type === 'npub') {
            return decoded.data as string
        }
        
        throw new Error('Invalid npub key.')

    } catch (e: any) {
        throw new AppError(Err.VALIDATION_ERROR, e.message)
    }          
}


const encryptNip04 = async function (    
    receiverPubkey: string, 
    content: string
): Promise<string> {
    try {
        const  keys: KeyPair = await getOrCreateKeyPair()

        const key = secp256k1.getSharedSecret(keys.privateKey, '02' + receiverPubkey)
        const normalizedKey = getNormalizedX(key)  
        const iv = QuickCrypto.randomFillSync(new Uint8Array(16))    
    
        const cipher = QuickCrypto.createCipheriv(
            'aes-256-cbc',
            Buffer.from(normalizedKey),
            iv
        )

        let encryptedMessage = cipher.update(content, 'utf8', 'base64')
        encryptedMessage += cipher.final('base64')
        let ivBase64 = Buffer.from(iv.buffer).toString('base64')  
    
        return encryptedMessage + '?iv=' + ivBase64
    } catch (e: any) {
        throw new AppError(Err.KEYCHAIN_ERROR, e.message)
    }
}


const decryptNip04 = async function(
    senderPubKey: string,    
    encryptedContent: string
): Promise<string> {

    const  keys: KeyPair = await getOrCreateKeyPair()
    const key = secp256k1.getSharedSecret(keys.privateKey, '02' + senderPubKey)
    const normalizedKey = getNormalizedX(key)
  
    const parts = encryptedContent.split('?')
    if (parts.length !== 2) {
        throw new Error('Invalid encrypted content format')
    }
  
    const ciphertext = Buffer.from(parts[0], 'base64')
    const iv = Buffer.from(parts[1].substring(3), 'base64') // remove 'iv='
  
    const decipher = QuickCrypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(normalizedKey),
        iv
    )
  
    let decryptedText = decipher.update(ciphertext, 'base64', 'utf8')
    decryptedText += decipher.final('utf8')
    
    return decryptedText as string
  }


const publish = async function (
    event: NostrUnsignedEvent,
    relays: string[],    
): Promise<Event | undefined> {

    const  keys: KeyPair = await getOrCreateKeyPair()    
    
    event.created_at = Math.floor(Date.now() / 1000)    
    event.id = getEventHash(event)    
    event.sig = getSignature(event, keys.privateKey)

    if(!validateEvent(event)) {
        throw new AppError(Err.VALIDATION_ERROR, 'Event is invalid and could not be published', event)
    }    

    const pool = getRelayPool()
    await pool.publish(relays, event)
    await delay(1000)

    const published: NostrEvent = await pool.get(relays, {
        ids: [event.id]
    })

    
    if(published) {
        log.trace('Event successfully published', published, 'NostrClient.publish')
        pool.close(relays)
        return published
    }

    pool.close(relays)
    return undefined    
}


const getMessages = async function (    
    relays: string[],
    filter: NostrFilter
): Promise<Event[]> {   

    const pool = getRelayPool()    

    const messages: Event[] = await pool.get(relays, filter)

    if(messages && messages.length > 0) {
        log.trace('Messages received', messages, 'getMessages')
        pool.close(relays)
        return messages
    }

    pool.close(relays)
    return []    
}

const delay = function (ms: number) {
    return new Promise(resolve => {
        setTimeout(() => { resolve('') }, ms);
    })
}


const getNormalizedX = function (key: Uint8Array): Uint8Array {
    return key.slice(1, 33)
}


const deleteKeyPair = async function (): Promise<void> {
    await KeyChain.removeNostrKeypair()
}


export const NostrClient = {
    getRelayPool,
    getDefaultRelays,
    getMinibitsRelays,
    getOrCreateKeyPair,
    getNpubkey,
    getHexkey,
    encryptNip04,
    decryptNip04,
    publish,   
    getMessages,
    deleteKeyPair
}