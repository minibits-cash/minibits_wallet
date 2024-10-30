import type { Event as NostrEvent, UnsignedEvent as NostrUnsignedEvent } from 'nostr-tools/core' 
import { validateEvent, finalizeEvent } from 'nostr-tools'
import type { Filter as NostrFilter } from 'nostr-tools/filter'
import { nip19 } from 'nostr-tools'
import { nip04 } from 'nostr-tools'
import { utils as NostrUtils } from 'nostr-tools'
import { SimplePool } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils'
import { kinds as NostrKinds } from 'nostr-tools'
import {
    MINIBITS_RELAY_URL,    
} from '@env'
import {KeyChain, KeyPair} from './keyChain'
import {log} from './logService'
import AppError, { Err } from '../utils/AppError'
import { MinibitsClient } from './minibitsService'
import { rootStoreInstance } from '../models'
import { WalletTask } from './walletService'

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

const _defaultPublicRelays: string[] = ['wss://relay.primal.net', 'wss://relay.damus.io']
const _minibitsRelays: string[] = [MINIBITS_RELAY_URL]

let _pool: any = undefined

const {walletProfileStore, nwcStore} = rootStoreInstance

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


const reconnectToRelays = async function () {
    const pool = getRelayPool()
    const connections = pool.listConnectionStatus()

    log.trace('[reconnectToRelays] Current statuses', {connections: Object.fromEntries(connections)})

    let isRefreshSubNeeded: boolean = false

    for (const conn of connections) {        
        if(conn[1] === false) {
            pool.ensureRelay(conn[0])
            isRefreshSubNeeded = true
        }
    }  

    // recreate subscriptions if all relays down
    if(isRefreshSubNeeded) {
        log.trace('[reconnectToRelays] Refreshing Nostr subscriptions')
        WalletTask.receiveEventsFromRelays().catch(e => false)

        if(!walletProfileStore.device) {
            nwcStore.receiveNwcEvents()
        }
    }     
}


const getOrCreateKeyPair = async function (): Promise<KeyPair> {
    let keyPair: KeyPair | null = null
    keyPair = await KeyChain.loadNostrKeyPair() as KeyPair

    if (!keyPair) {
        keyPair = KeyChain.generateNostrKeyPair() as KeyPair
        await KeyChain.saveNostrKeyPair(keyPair)

        log.trace('[getOrCreateKeyPair]', 'Created and saved new NOSTR keypair')
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

const neventEncode = function (eventIdHex: string) : string {
    try {
        return nip19.neventEncode({id: eventIdHex})        
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
        const encryptedContent = await nip04.encrypt(keys.privateKey, receiverPubkey, content)        

        return encryptedContent

    } catch (e: any) {
        throw new AppError(Err.CONNECTION_ERROR, e.message)
    }
}


const decryptNip04 = async function(
    senderPubKey: string,    
    encryptedContent: string
): Promise<string> {

    const  keys: KeyPair = await getOrCreateKeyPair()
    const decryptedContent = await nip04.decrypt(keys.privateKey, senderPubKey, encryptedContent)

    log.trace('[decryptNip04]', {decryptedContent})

    return decryptedContent
}


const publish = async function (
    event: NostrUnsignedEvent,
    relays: string[],    
): Promise<NostrEvent | undefined> {

    const  keys: KeyPair = await getOrCreateKeyPair()    
    
    /* const signed = {...event} as NostrEvent
    signed.created_at = Math.floor(Date.now() / 1000) 
    signed.id = getEventHash(signed)    
    signed.sig = getSignature(signed, keys.privateKey) */
    
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
        kinds: [NostrKinds.Metadata],            
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
        return NostrUtils.normalizeURL(url)
    } catch (e: any) {
        throw new AppError(Err.VALIDATION_ERROR, `Invalid relay URL: ${e.message}`)
    }
}


// returns array of values after the first element (tag name)
const getTagsByName = function(tagsArray: string[][], tagName: string) {
    let tagValues = tagsArray.find(t => t && t.length && t.length >= 2 && t[0] === tagName)
    if(tagValues && tagValues.length > 1) {
        tagValues.shift() // remove tag name
        return tagValues
    }

    return undefined
}

// returns first element after tag name
const getFirstTagValue = function (tagsArray: string[][], tagName: string): string | undefined {
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
    reconnectToRelays,
    getOrCreateKeyPair,
    getNpubkey,
    getHexkey,
    neventEncode,
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
    getNormalizedNostrProfile,
    deleteKeyPair,
    getTagsByName,
    getFirstTagValue,
    findMemo,
    findZapRequest,
}