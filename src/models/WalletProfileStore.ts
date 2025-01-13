import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import { Metadata } from 'nostr-tools/kinds'
import {KeyChain, MinibitsClient, NostrClient, NostrUnsignedEvent, WalletTask} from '../services'
import {log} from '../services/logService'
import { Err } from '../utils/AppError'
import { getRandomUsername } from '../utils/usernames'
import { getRootStore } from './helpers/getRootStore'


export type WalletProfile = {    
    pubkey: string
    walletId: string   
    name: string
    nip05: string
    picture: string
    lud16?: string | null    
    device?: string | null
    seedHash?: string | null
    isOwnProfile: boolean
    // isBatchClaimOn: boolean
}

export type WalletProfileRecord = {  
    id: number  
    pubkey: string    
    walletId: string
    name: string
    nip05: string
    lud16?: string | null  
    device?: string | null
    avatar: string
    createdAt: string    
}

export const WalletProfileStoreModel = types
    .model('WalletProfileStore', {        
        pubkey: types.optional(types.string, ''),
        walletId: types.optional(types.string, ''),
        name: types.optional(types.string, ''),
        nip05: types.optional(types.string, ''),        
        picture: types.optional(types.string, ''),
        lud16: types.maybe(types.maybeNull(types.string)),
        device: types.maybe(types.maybeNull(types.string)),
        seedHash: types.maybe(types.maybeNull(types.string)),
        isOwnProfile: types.optional(types.boolean, false),
        // isBatchClaimOn: types.maybe(types.boolean), // legacy, not used
    })
    .actions(self => ({  
        publishToRelays: flow(function* publishToRelays() {
            try {
                const {pubkey, name, picture, nip05, lud16} = self

                // announce to minibits relay + default public relays with replaceable event           
                const profileEvent: NostrUnsignedEvent = {
                    kind: Metadata,
                    pubkey,
                    tags: [],                        
                    content: JSON.stringify({
                        name,                            
                        picture,
                        nip05,
                        lud16,                       
                    }),
                    created_at: Math.floor(Date.now() / 1000)                              
                }

                const rootStore = getRootStore(self)
                const {relaysStore} = rootStore                
                
                // new wallet profile has not yet the relays
                if(relaysStore.allUrls.length === 0) {
                    // saves default relays and creates subscription for incoming nostr messages
                    WalletTask.receiveEventsFromRelays()
                }
                
                const relaysToPublish: string[]  = relaysStore.allUrls

                log.debug('[publishToRelays]', 'Publish profile to relays', {profileEvent, relaysToPublish})

                const publishedEvent: Event | undefined = yield NostrClient.publish(
                    profileEvent,
                    relaysToPublish                    
                )
                
                return publishedEvent
                
            } catch (e: any) {       
                log.error(e.name, e.message)         
                return false // silent
            }                    
        }),
        migrateToNewRelay: flow(function* migrateToNewRelay() {
            try {
                const {pubkey, name, picture, nip05, lud16} = self

                // announce to new minibits relay
                const profileEvent: NostrUnsignedEvent = {
                    kind: Metadata,
                    pubkey,
                    tags: [],                        
                    content: JSON.stringify({
                        name,                            
                        picture,
                        nip05,
                        lud16,                       
                    }),
                    created_at: Math.floor(Date.now() / 1000)                              
                }

                const rootStore = getRootStore(self)
                const relaysToPublish: string[]  = NostrClient.getMinibitsRelays()

                log.debug('[publishToRelays]', 'Migrate profile to new relay', {profileEvent, relaysToPublish})

                const publishedEvent: Event | undefined = yield NostrClient.publish(
                    profileEvent,
                    relaysToPublish                    
                )
                
                return publishedEvent
                
            } catch (e: any) {       
                log.error(e.name, e.message)         
                return false // silent
            }                    
        }),
    }))
    .actions(self => ({        
        hydrate: flow(function* hydrate(profileRecord: WalletProfileRecord) {
            const {name, nip05, lud16, avatar, pubkey, walletId} = profileRecord
            
            self.pubkey = pubkey                
            self.walletId = walletId
            self.name = name // default name is set on server side, equals walletId
            self.nip05 = nip05 // default is name@minibits.cash set on server side
            self.lud16 = lud16 // equals for all @minibits.cash addresses
            self.picture = avatar // default picture is set on server side  
            
            const userSettingsStore = getRootStore(self).userSettingsStore
            userSettingsStore.setWalletId(walletId)
            
            const publishedEvent = yield self.publishToRelays()
        })
    }))   
    .actions(self => ({  
        create: flow(function* create(publicKey: string, walletId: string, seedHash: string) {
       
            let profileRecord: WalletProfileRecord
            self.seedHash = seedHash

            log.trace('[create]', {seedHash, publicKey})

            try {
                // creates new profile. If all params equal existing one, it is returned
                profileRecord = yield MinibitsClient.createWalletProfile(publicKey, walletId, seedHash)        
            } catch (e: any) {
                // Unlikely we might hit the same walletId so we retry with another one
                if(e.name === Err.ALREADY_EXISTS_ERROR) {
                    // recreate walletId + default name
                    const name = getRandomUsername()
                    const userSettingsStore = getRootStore(self).userSettingsStore
                    userSettingsStore.setWalletId(name)
                    // attempt to create new unique profile again                    
                    profileRecord = yield MinibitsClient.createWalletProfile(publicKey, name, seedHash) 
                    
                    log.error('[create]', 'Profile reset executed to resolve duplicate walletId on the server.', {caller: 'create', walletId, newWalletId: name})
                    self.hydrate(profileRecord)
                    return
                }

                throw e
            }

            self.hydrate(profileRecord)
            
            log.info('[create]', 'Wallet profile saved in WalletProfileStore', {self})
            return self           
        }),     
        updateName: flow(function* updateName(name: string) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.updateWalletProfile(
                self.pubkey, 
                {                    
                    name,      
                }
            )           
                           
            self.hydrate(profileRecord)
            
            log.debug('[updateName]', 'Wallet name updated in the WalletProfileStore', {self})
            return self         
        }),
        updatePicture: flow(function* updatePicture(picture: string) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.updateWalletProfile(
                self.pubkey,
                {   
                    avatar: picture, // this is png in base64
                }
            )   

            self.picture = profileRecord.avatar + '?r=' + Math.floor(Math.random() * 100) // force refresh as image URL stays the same

            const publishedEvent = yield self.publishToRelays()
            
            log.debug('[updatePicture]', 'Wallet picture updated in the WalletProfileStore', {self, publishedEvent})
            return self         
        }),
        updateNip05: flow(function* updateNip05(newPubkey: string, name: string, nip05: string, lud16: string, picture: string, isOwnProfile: boolean) {

            log.trace('[updateNip05]', {currentPubkey: self.pubkey, newPubkey})

            let profileRecord: WalletProfileRecord = yield MinibitsClient.updateWalletProfileNip05(
                self.pubkey, 
                { 
                    newPubkey,
                    nip05,
                    lud16,
                    name,
                    avatar: picture
                }
            )

            log.trace('[updateNip05]', 'profileRecord', {profileRecord})

            self.hydrate(profileRecord)
            
            log.info('[updateNip05]', 'Wallet nip05 updated in the WalletProfileStore', {self})
            return self         
        }),
        recover: flow(function* recover(seedHash: string, currentPubkey: string, isAddressOnly: boolean) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.recoverProfile(
                seedHash, 
                { 
                    currentPubkey
                }
            )           
            
            // rotate the wallet seed to the provided one only on fresh install recovery from seed or import backup
            if(!isAddressOnly) {
                self.seedHash = seedHash
            }

            self.hydrate(profileRecord)

            log.info('[recover]', 'Wallet profile recovered in WalletProfileStore', {self})
            return self         
        }),
        setDevice: flow(function* setDevice(device: string) {  
            try {
                yield MinibitsClient.updateDeviceToken(self.pubkey, {deviceToken: device}) 
                self.device = device          
            } catch (e: any) {
                log.error('[setDevice]', e.message)
            }
        }),
        setNip05(nip05: string) {   // used in migration to v3 model         
            self.nip05 = nip05             
        },
        setWalletId(walletId: string) {   // used in migration to v4 model         
            self.walletId = walletId             
        },
        setSeedHash(seedHash: string) {   // used in migration to v8 model         
            self.seedHash = seedHash             
        }
    }))
    .views(self => ({        
        get npub() {
            return NostrClient.getNpubkey(self.pubkey)
        },
    }))
    
    export interface WalletProfileStore
    extends Instance<typeof WalletProfileStoreModel> {}
    export interface WalletProfileStoreSnapshot
    extends SnapshotOut<typeof WalletProfileStoreModel> {}
