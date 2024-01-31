import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import {KeyChain, MinibitsClient, NostrClient, NostrUnsignedEvent, Wallet} from '../services'
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
    device?: string | null
    isOwnProfile: boolean
}

export type WalletProfileRecord = {  
    id: number  
    pubkey: string    
    walletId: string
    name: string
    nip05: string    
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
        device: types.maybe(types.maybeNull(types.string)),
        seedHash: types.maybe(types.maybeNull(types.string)),
        isOwnProfile: types.optional(types.boolean, false),       
    })
    .actions(self => ({  
        publishToRelays: flow(function* publishToRelays() {
            try {
                const {pubkey, name, picture, nip05} = self

                // announce to minibits relay + default public relays with replaceable event           
                const profileEvent: NostrUnsignedEvent = {
                    kind: 0,
                    pubkey,
                    tags: [],                        
                    content: JSON.stringify({
                        name,                            
                        picture,
                        nip05,                       
                    }),                              
                }

                const rootStore = getRootStore(self)
                const {relaysStore} = rootStore                
                
                // new wallet profile has not yet the relays
                if(relaysStore.allUrls.length === 0) {
                    // saves default relays and creates subscription for incoming nostr messages
                    Wallet.checkPendingReceived()
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
    }))
    .actions(self => ({        
        hydrate: flow(function* hydrate(profileRecord: WalletProfileRecord) {
            const {nip05, name, avatar, pubkey, walletId} = profileRecord
            
            self.pubkey = pubkey                
            self.walletId = walletId
            self.name = name // default name is set on server side, equals walletId
            self.nip05 = nip05 // default is name@minibits.cash set on server side
            self.picture = avatar // default picture is set on server side
            
            const publishedEvent = yield self.publishToRelays()
        })
    }))   
    .actions(self => ({  
        create: flow(function* create(walletId: string) {

            const {publicKey} = yield NostrClient.getOrCreateKeyPair()
            const seedHash: string = yield KeyChain.loadSeedHash() // used to recover wallet address            
            let profileRecord: WalletProfileRecord

            self.seedHash = seedHash

            log.trace('[create]', {seedHash, publicKey})

            try {
                profileRecord = yield MinibitsClient.createWalletProfile(publicKey, walletId, seedHash)        
            } catch (e: any) {
                // Unlikely we might hit the same walletId or loose walletProfile state while keeping keys in the Keychain. In such cases we do full reset.
                if(e.name === Err.ALREADY_EXISTS_ERROR) {
                    
                    // clean and recreate Nostr keys
                    yield KeyChain.removeNostrKeypair()                    
                    const {publicKey} = yield NostrClient.getOrCreateKeyPair()
                    // recreate walletId + default name
                    const name = getRandomUsername()
                    const userSettingsStore = getRootStore(self).userSettingsStore
                    userSettingsStore.setWalletId(name)
                    // attempt to create new unique profile again
                    profileRecord = yield MinibitsClient.createWalletProfile(publicKey, name, seedHash) // this removes abandoned profile with the same seedHash if any
                    
                    log.error('[create]', 'Profile reset executed to resolve duplicate profile on the server.', {caller: 'create', newWalletId: name})
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

            let profileRecord: WalletProfileRecord = yield MinibitsClient.updateWalletProfileName(
                self.pubkey, 
                {                    
                    name                   
                }
            )           
                           
            self.name = profileRecord.name
            self.nip05 = profileRecord.nip05
            const publishedEvent = yield self.publishToRelays()
            
            log.debug('[updateName]', 'Wallet name updated in the WalletProfileStore', {self, publishedEvent})
            return self         
        }),
        updatePicture: flow(function* updatePicture(picture: string) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.updateWalletProfileAvatar(
                self.pubkey, 
                {   
                    avatar: picture
                }
            )   

            self.picture = profileRecord.avatar + '?r=' + Math.floor(Math.random() * 100) // force refresh as image URL stays the same

            const publishedEvent = yield self.publishToRelays()
            
            log.debug('[updatePicture]', 'Wallet picture updated in the WalletProfileStore', {self, publishedEvent})
            return self         
        }),
        updateNip05: flow(function* updateNip05(newPubkey: string, nip05: string, name: string, picture: string, isOwnProfile: boolean) {

            log.trace('[updateNip05]', {currentPubkey: self.pubkey, newPubkey})

            let profileRecord: WalletProfileRecord = yield MinibitsClient.updateWalletProfileNip05(
                self.pubkey, 
                { 
                    newPubkey,
                    nip05,
                    name,
                    avatar: picture
                }
            )

            log.trace('[updateNip05]', 'profileRecord', {profileRecord})
            
            self.pubkey = newPubkey
            self.walletId = profileRecord.walletId
            self.nip05 = profileRecord.nip05
            self.name = profileRecord.name
            self.picture = profileRecord.avatar
            self.isOwnProfile = isOwnProfile
            
            // do not publish to relay as this is external 
            
            log.info('[updateNip05]', 'Wallet nip05 updated in the WalletProfileStore', {self})
            return self         
        }),
        recover: flow(function* recover(seedHash: string, newPubkey: string) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.recoverProfile(
                seedHash, 
                { 
                    newPubkey
                }
            )           
            
            self.pubkey = newPubkey
            self.seedHash = seedHash
            self.walletId = profileRecord.walletId
            self.nip05 = profileRecord.nip05
            self.name = profileRecord.name
            self.picture = profileRecord.avatar                        
            
            const publishedEvent = yield self.publishToRelays()
            log.info('[recover]', 'Wallet profile recovered in WalletProfileStore', {self, publishedEvent})
            return self         
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
        /* setPicture(picture: string) {            
            self.picture = picture             
        }*/
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
