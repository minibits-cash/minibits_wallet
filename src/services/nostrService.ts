import type { 
    EventTemplate as NostrEventTemplate, 
    Event as NostrEvent, 
    UnsignedEvent as NostrUnsignedEvent 
} from 'nostr-tools/core' 
import type { Filter as NostrFilter } from 'nostr-tools/filter'
import { finalizeEvent, validateEvent } from 'nostr-tools/pure'
import { normalizeURL } from 'nostr-tools/utils'
import { encrypt, decrypt } from 'nostr-tools/nip04'
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip59'
import { neventEncode as nostrNeventEncode, npubEncode, decode as nip19Decode } from 'nostr-tools/nip19'
import {SimplePool} from 'nostr-tools/pool'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { PrivateDirectMessage, Metadata } from 'nostr-tools/kinds'
/*import {
    MINIBITS_RELAY_URL,    
} from '@env'*/
import {NostrKeyPair} from './keyChain'
import {log} from './logService'
import AppError, { Err } from '../utils/AppError'
import { MinibitsClient } from './minibitsService'
import { rootStoreInstance } from '../models'
import { WalletTask } from './walletService'
import { nip19 } from 'nostr-tools'

// refresh

export {     
    NostrEvent, 
    NostrFilter,     
    NostrUnsignedEvent,   
}

export type NostrProfile = {
    pubkey: string
    npub: string
    name: string
    nip05: string
    lud16?: string
    about?: string
    picture?: string
}

export type Nip05VerificationRecord = {
    names: {
        [key: string]: string
    }, 
    relays: {
        [key: string]: string[]
    }
}

// TODO cleanup all this shit, move to RelayStore model
// refresh

const _defaultPublicRelays: string[] = ['wss://relay.primal.net', 'wss://relay.damus.io']
const _minibitsRelays: string[] = ['wss://relay.minibits.cash']

let _pool: any = undefined

const {walletProfileStore, nwcStore, walletStore} = rootStoreInstance

const getRelayPool = function () {
    if(!_pool) {
        _pool = new SimplePool()
        return _pool as SimplePool
    }

    return _pool as SimplePool
}


const getDefaultRelays = function () {
    return _defaultPublicRelays    
}

const getMinibitsRelays = function () {
    return _minibitsRelays    
}

const getAllRelays = function () {
    return [..._minibitsRelays, ..._defaultPublicRelays]
}

const getNostrKeys = async function () {
    const keys = await walletStore.getCachedWalletKeys()
    return keys.NOSTR
}

const reconnectToRelays = async function () {
    const pool = getRelayPool()
    const connections = pool.listConnectionStatus()

    log.trace('[reconnectToRelays] Current statuses', {connections: Object.fromEntries(connections)})

    let isRefreshSubNeeded: boolean = false

    for (const conn of Array.from(connections)) {        
        if(conn[1] === false) {
            pool.ensureRelay(conn[0])
            isRefreshSubNeeded = true
        }
    }  

    // recreate subscriptions if all relays down
    if(isRefreshSubNeeded) {
        log.trace('[reconnectToRelays] Refreshing Nostr subscriptions')
        WalletTask.receiveEventsFromRelaysQueue().catch(e => false)

        if(!walletProfileStore.device) {
            nwcStore.receiveNwcEventsQueue()
        }
    }     
}


const getNpubkey = function (publicKey: string): string {
    return npubEncode(publicKey)      
}


const getHexkey = function (key: string): string {
    try {
        const decoded = nip19Decode(key)

        if(decoded && decoded.type === 'npub') {
            return decoded.data as string
        }

        if(decoded && decoded.type === 'nsec') {
            return bytesToHex(decoded.data) as string
        }
        
        throw new Error('Invalid npub or nsec key.')

    } catch (e: any) {
        throw new AppError(Err.VALIDATION_ERROR, e.message)
    }          
}

const neventEncode = function (eventIdHex: string) : string {
    try {
        return nostrNeventEncode({id: eventIdHex})        
    } catch (e: any) {
        throw new AppError(Err.VALIDATION_ERROR, e.message)
    }  
}


const decodeNprofile = function (nprofile: string) {
    try {
        const decoded = nip19Decode(nprofile)
        log.trace('[decodeNprofile]', {decoded})

        return decoded
    } catch (e: any) {
        throw new AppError(Err.VALIDATION_ERROR, e.message)
    }  
}

/* const maybeConvertNpub = function (key: string) {
    // Check and convert npub to P2PK
    if (key && key.startsWith("npub1")) {
      const { type, data } = nip19Decode(key)
      if (type === "npub" && data.length === 64) {
        key = "02" + data
      }
    }
    return key
}*/


const encryptNip04 = async function (    
    receiverPubkey: string, 
    content: string
): Promise<string> {
    try {
        const keys: NostrKeyPair = await getNostrKeys()
        const encryptedContent = await encrypt(keys.privateKey, receiverPubkey, content)        

        return encryptedContent

    } catch (e: any) {
        throw new AppError(Err.CONNECTION_ERROR, e.message)
    }
}


const decryptNip04 = async function(
    senderPubKey: string,    
    encryptedContent: string
): Promise<string> {

    const  keys: NostrKeyPair = await getNostrKeys()
    const decryptedContent = await decrypt(keys.privateKey, senderPubKey, encryptedContent)

    log.trace('[decryptNip04]', {decryptedContent})

    return decryptedContent
}


const encryptAndSendDirectMessageNip17 = async function (
    recipientPublicKey: string,
    message: string,
    relays: string[]    
) {

    const  keys: NostrKeyPair = await getNostrKeys()
    const directMessageEvent: NostrEventTemplate = {
        created_at: Math.ceil(Date.now() / 1000),
        kind: PrivateDirectMessage,
        tags: [['p', recipientPublicKey], ['from', walletProfileStore.nip05]],
        content: message,
    }

    // log.trace('[sendDirectMessageNip17]', {directMessageEvent})

    // already signed final event
    const wrappedEvent = wrapEvent(
        directMessageEvent, 
        hexToBytes(keys.privateKey), 
        recipientPublicKey
    )

    // log.trace('[sendDirectMessageNip17]', {wrappedEvent})

    const pool = getRelayPool()
    await Promise.any(pool.publish(relays, wrappedEvent))    

    const published = await pool.get(relays, {
        ids: [wrappedEvent.id]
    }) as NostrEvent
    
    if(published) {
        log.trace('[encryptAndSendDirectMessageNip17] NIP17 direct message has been sent.')        
        return published
    }

    log.warn('[encryptAndSendDirectMessageNip17] Could not confirm that NIP17 direct message has been sent.')     
    return undefined 
}


const decryptDirectMessageNip17 = async function (
    wrappedEvent: NostrEvent
) {    
    const  keys: NostrKeyPair = await getNostrKeys()
    
    // log.trace('[decryptDirectMessageNip59]', {keys}) 

    const decryptedEvent = unwrapEvent(
        wrappedEvent,
        hexToBytes(keys.privateKey)
    )

    log.trace('[decryptDirectMessageNip59]', {decryptedEvent})

    return decryptedEvent
}


const publish = async function (
    event: NostrUnsignedEvent,
    relays: string[],    
): Promise<NostrEvent | undefined> {

    const  keys: NostrKeyPair = await getNostrKeys()
    
    const privateKeyBytes = hexToBytes(keys.privateKey)
    const finalEvent = finalizeEvent(event, privateKeyBytes)

    if(!validateEvent(finalEvent)) {
        throw new AppError(Err.VALIDATION_ERROR, 'Event is invalid and could not be published', {finalEvent})
    }
    
    // log.trace('Event to be published', signed, 'publish')

    const pool = getRelayPool()
    await Promise.any(pool.publish(relays, finalEvent))    

    const published = await pool.get(relays, {
        ids: [finalEvent.id]
    }) as NostrEvent
    
    if(published) {
        log.trace('[NostrClient.publish] Event successfully published')        
        return published
    }
    
    return undefined    
}


const getEvent = async function (    
    relays: string[],
    filter: NostrFilter
): Promise<NostrEvent | null> {   
    
    const pool = getRelayPool()    
    const event = await pool.get(relays, filter) as NostrEvent

    if(event) {
        log.trace('[getEvent] Event received', {event})        
        return event
    }

    // pool.close(relays)
    return null    
}


const getEvents = async function (    
    relays: string[],
    filter: NostrFilter
): Promise<NostrEvent[]> {   
    
    const pool = getRelayPool()    
    const events: NostrEvent[] = await pool.querySync(relays, filter)    

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
        
        const nip05Record: Nip05VerificationRecord = await MinibitsClient.fetchApi(url, {
            method,            
            headers,            
        })

        log.trace('[getNip05Record]', `Got response`, nip05Record || null)

        return nip05Record
        
    } catch(e: any) {
        log.trace('Error', e)
        if(e.name === Err.NOTFOUND_ERROR || e.params?.status === 404) {
            e.message = `${nip05Name} could not be found on the ${nip05Domain} address server. Make sure you enter up to date and correct address.`
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



const getProfileFromRelays = async function (pubkey: string, relays: string[]): Promise<NostrProfile | undefined> {

    // get profile from the relays for pubkey linked to nip05
    const filter: NostrFilter = {
        authors: [pubkey],
        kinds: [Metadata],            
    }

    const events = await NostrClient.getEvents(relays, filter)

    
    if(!events || events.length === 0) {
        // do not log as error to save capacity
        log.warn('Could not get profile event from the relays.', {relays})
        return undefined
    }

    const profile: NostrProfile = JSON.parse(events[events.length - 1].content)
    profile.pubkey = events[events.length - 1].pubkey // pubkey might not be in ev.content

    log.trace('[getProfileFromRelays]', {profile})

    return profile
}


const getNormalizedNostrProfile = async function (nip05: string, relays: string[]) {        
    let relaysToConnect: string[] = []
    relaysToConnect.push(...relays)

    // get nip05 record from the .well-known server
    const {nip05Pubkey, nip05Relays} = await getNip05PubkeyAndRelays(nip05)
    
    if(nip05Relays.length > 0) {
        let counter: number = 0
        const maxRelays: number = 5 // do not add dozens of relays on some profiles

        for (const relay of nip05Relays) {
            if(counter <= maxRelays) {
                relaysToConnect.push(relay)                
                counter++
            } else {
                break
            }            
        }        
    }

    const profile: NostrProfile | undefined = await NostrClient.getProfileFromRelays(nip05Pubkey, relaysToConnect)

    if(!profile) {
        throw new AppError(Err.NOTFOUND_ERROR, `Profile could not be found on Nostr relays, visit Settings and add relay that hosts the profile.`, {nip05, relays})
    }

    if(profile.nip05 !== nip05) {        
        throw new AppError(Err.VALIDATION_ERROR, 'Profile from the relay does not match the given nip05 identifier', {nip05, profile})
    }

    if(!profile.name) {
        profile.name = getNameFromNip05(nip05) as string
    }

    if(!profile.pubkey) {
        profile.pubkey = nip05Pubkey
    }            
    
    const npub = NostrClient.getNpubkey(profile.pubkey)

    return {...profile, npub} as NostrProfile
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


const getNormalizedRelayUrl = function (url: string): string {
    try {
        return normalizeURL(url)
    } catch (e: any) {
        throw new AppError(Err.VALIDATION_ERROR, `Invalid relay URL: ${e.message}`)
    }
}


// returns array of values after the first element (tag name)
const getTagsByName = function(tagsArray: string[][], tagName: string): string[] | undefined {
    const tag = tagsArray.find(t => t && t.length >= 2 && t[0] === tagName);
    if (tag) {
        return tag.slice(1) // Return a copy of the array without modifying the original
    }
    return undefined
}

// returns first element after tag name
const getFirstTagValue = function (tagsArray: string[][], tagName: string): string | number | undefined {
    const tag = tagsArray.find(([name]) => name === tagName)
    return tag ? tag[1] : undefined
}


const findMemo = function (message: string): string | undefined {
    // Find the last occurrence of "memo: "
    const lastIndex = message.lastIndexOf("Memo: ")
    
    if (lastIndex !== -1) {        
        const memoAfterLast = message.substring(lastIndex + 6) // skip "memo: " itself
        return memoAfterLast
    } 
        
    return undefined    
}


const findZapRequest = function (message: string): string | undefined {
    // Find the last occurrence of "memo: "
    const lastIndex = message.lastIndexOf("zapRequest:")
    
    if (lastIndex !== -1) {        
        const zapRequestString = message.substring(lastIndex + 11) // skip "zapRequest:" itself
        return zapRequestString
    } 
        
    return undefined    
}


export const NostrClient = { // TODO split helper functions to separate module
    getRelayPool,        
    getDefaultRelays,
    getMinibitsRelays,
    getAllRelays,
    getNostrKeys,
    reconnectToRelays,
    getNpubkey,
    getHexkey,
    neventEncode,
    decodeNprofile,
    // maybeConvertNpub,
    encryptNip04,
    decryptNip04,
    encryptAndSendDirectMessageNip17,
    decryptDirectMessageNip17,
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
    getNormalizedNostrProfile,
    getTagsByName,
    getFirstTagValue,
    findMemo,
    findZapRequest,
}