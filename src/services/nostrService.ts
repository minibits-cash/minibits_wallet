import {
    nip19,    
    getEventHash,
    getSignature,
    SimplePool,
    Filter as NostrFilter,    
    Event as NostrEvent,
    validateEvent,
    UnsignedEvent as NostrUnsignedEvent,
    utils
} from 'nostr-tools'
import QuickCrypto from 'react-native-quick-crypto'
import {secp256k1} from '@noble/curves/secp256k1'
import {
    MINIBITS_RELAY_URL,    
} from '@env'
import {KeyChain, KeyPair} from './keyChain'
import {log} from './logService'
import AppError, { Err } from '../utils/AppError'
import { MinibitsClient } from './minibitsService'

export {     
    Event as NostrEvent, 
    Filter as NostrFilter, 
    Kind as NostrKind,  
    UnsignedEvent as NostrUnsignedEvent,   
} from 'nostr-tools'

// refresh
export type NostrProfile = {
    pubkey: string
    npub: string
    name?: string
    about?: string
    picture?: string
    nip05?: string
}

export type Nip05VerificationRecord = {
    names: {
        [key: string]: string
    }, 
    relays: {
        [key: string]: string[]
    }
}

// TODO cleanup
const _defaultPublicRelays: string[] = ['wss://relay.damus.io', 'wss://nostr.mom']
const _minibitsRelays: string[] = [MINIBITS_RELAY_URL]

let _pool: any = undefined

const getRelayPool = function () {
    if(!_pool) {
        _pool = new SimplePool({eoseSubTimeout: 10000})
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

/* const getRandom = function(list: string[]) {
    return list[Math.floor((Math.random()*list.length))]
} */

const getOrCreateKeyPair = async function (): Promise<KeyPair> {
    let keyPair: KeyPair | null = null
    keyPair = await KeyChain.loadNostrKeyPair() as KeyPair

    if (!keyPair) {
        keyPair = KeyChain.generateNostrKeyPair() as KeyPair
        await KeyChain.saveNostrKeyPair(keyPair)

        log.trace('Created and saved new NOSTR keypair','','getOrCreateKeyPair',)
    }
     
    return keyPair
}


const getNpubkey = function (publicKey: string): string {
    return nip19.npubEncode(publicKey)      
}


const getHexkey = function (key: string): string {
    try {
        const decoded = nip19.decode(key)

        if(decoded) {
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
    
    log.trace('Event to be published', event, 'publish')

    const pool = getRelayPool()
    let pubs = pool.publish(relays, event)
    await delay(1000)
    // await Promise.all(pubs)

    const published: NostrEvent = await pool.get(relays, {
        ids: [event.id]
    })

    
    if(published) {
        log.trace('Event successfully published', published, 'NostrClient.publish')
        // pool.close(relays)
        return published
    }

    // pool.close(relays)
    return undefined    
}


const getEvent = async function (    
    relays: string[],
    filter: NostrFilter
): Promise<Event | null> {   
    
    const pool = getRelayPool()    
    const event: Event = await pool.get(relays, filter)    

    if(event) {
        log.trace('Event received', event, 'getEvent')        
        return event
    }

    // pool.close(relays)
    return null    
}


const getEvents = async function (    
    relays: string[],
    filters: NostrFilter[]
): Promise<Event[]> {   
    
    const pool = getRelayPool()    
    const events: Event[] = await pool.list(relays, filters)    

    if(events && events.length > 0) {       
        return events
    }

    // pool.close(relays)
    return []    
}


const getNip05Record = async function (nip05: string) {    
    const nip05Domain = NostrClient.getDomainFromNip05(nip05)
    const nip05Name = NostrClient.getNameFromNip05(nip05)  

    try {
        if(!nip05Domain || !nip05Name) {
            throw new AppError(Err.VALIDATION_ERROR, 'Contact does not have a valid nip05 identifier.', {nip05})
        }

        const url = `https://${nip05Domain}/.well-known/nostr.json?name=${nip05Name}`
        const method = 'GET'        
        const headers = MinibitsClient.getPublicHeaders()

        log.trace(`Sending request`, {method, url}, 'getNip05Record')

        const nip05Record: Nip05VerificationRecord = await MinibitsClient.fetchApi(url, {
            method,            
            headers,            
        })

        log.trace(`Got response`, nip05Record || null, 'getNip05Record')

        return nip05Record
        
    } catch(e: any) {
        log.trace('Error', e)
        if(e.name === Err.NOTFOUND_ERROR) {
            e.message = `${nip05Name} could not be found on the ${nip05Domain} address server. Your contact might have changed the profile name, please get in touch.`
            throw e
        } else {
            throw e // Propagate other errors upstream
        }
    }
}



const verifyNip05 = async function (nip05: string, pubkey: string) {

    const nip05Record = await getNip05Record(nip05) // throws
    const nip05Name = getNameFromNip05(nip05)

    if (nip05Record && nip05Record.names[nip05Name as string] === pubkey) {
        return true
    }
    
    throw new AppError(
        Err.VALIDATION_ERROR, 
        `${nip05} is no longer linked to the same public key as in your contacts. Please get in touch with the intended recipient to make sure the address is valid. Then, remove the contact and add it again.`)
}


const getNip05PubkeyAndRelays = async function (nip05: string) {

    const nip05Record = await getNip05Record(nip05) // throws
    const nip05Name = getNameFromNip05(nip05)

    let nip05Pubkey: string = ''
    let nip05Relays: string[] = []

    if (nip05Record && nip05Record.names[nip05Name as string]) {
        nip05Pubkey = nip05Record.names[nip05Name as string]
    } else {
        throw new AppError(
            Err.VALIDATION_ERROR, 
            `Could not get public key from NOSTR address verification server`, {nip05, nip05Record})   
    }

    // retrieve recommended relays
    if(nip05Record.relays && nip05Record.relays[nip05Pubkey].length > 0) {
        nip05Relays = nip05Record.relays[nip05Pubkey]
        log.trace('Got relays from server', nip05Relays, 'getNip05PubkeyAndRelays')
    } 
    
    return {nip05Pubkey, nip05Relays}
}



const getProfileFromRelays = async function (pubkey: string, relays: string[]) {

    // get profile from the relays for pubkey linked to nip05
    const filters: NostrFilter[] = [{
        authors: [pubkey],
        kinds: [0],            
    }]

    const events: NostrEvent[] = await NostrClient.getEvents(relays, filters)

    if(!events || events.length === 0) {
        throw new AppError(Err.SERVER_ERROR, 'Could not get profile event from the relays.', {relays})
    }

    const profile: NostrProfile = JSON.parse(events[events.length - 1].content)
    profile.pubkey = events[events.length - 1].pubkey // pubkey might not be in ev.content

    return profile
}


const getDomainFromNip05 = function(nip05: string) {
    const atIndex = nip05.lastIndexOf('@')

    if (atIndex !== -1) {
        const domain = nip05.slice(atIndex + 1)
        return domain      
    }
    // Invalid email or no domain found
    return null
}


const getNameFromNip05 = function(nip05: string) {
    const atIndex = nip05.indexOf('@')
    
    if (atIndex !== -1) {
        const name = nip05.slice(0, atIndex);
        return name
    }
    
    // Invalid email or no "@" symbol found
    return null
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


const getNormalizedRelayUrl = function (url: string): string {
    try {
        return utils.normalizeURL(url)
    } catch (e: any) {
        throw new AppError(Err.VALIDATION_ERROR, `Invalid relay URL: ${e.message}`)
    }
}


export const NostrClient = { // TODO split helper functions to separate module
    getRelayPool,    
    getDefaultRelays,
    getMinibitsRelays,
    getOrCreateKeyPair,
    getNpubkey,
    getHexkey,
    encryptNip04,
    decryptNip04,
    getDomainFromNip05,
    getNameFromNip05,
    publish,   
    getEvent,
    getEvents,
    getNip05Record,
    verifyNip05,
    getNip05PubkeyAndRelays,
    getProfileFromRelays,
    getNormalizedRelayUrl,
    deleteKeyPair,    
}