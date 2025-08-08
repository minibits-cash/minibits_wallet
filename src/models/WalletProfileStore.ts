import {Instance, SnapshotOut, types, flow} from 'mobx-state-tree'
import { Metadata } from 'nostr-tools/kinds'
import {KeyChain, MinibitsClient, NostrClient, NostrKeyPair, NostrUnsignedEvent, WalletTask} from '../services'
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
    isOwnProfile: boolean    
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
        isOwnProfile: types.optional(types.boolean, false),        
    })
    .actions(self => ({  
        publishToRelays: flow(function* publishToRelays() {
            try {
                const hasKeys = yield KeyChain.hasWalletKeys()
                
                if(!hasKeys) {
                    log.debug('[publishToRelays] Profile will not be published to relays, wallet keys not yet available.')
                }

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
                    WalletTask.receiveEventsFromRelaysQueue()
                }
                
                const relaysToPublish: string[]  = relaysStore.allUrls

                log.debug('[publishToRelays]', 'Publish profile to relays', {profileEvent, relaysToPublish})

                const publishedEvent: Event | undefined = yield NostrClient.publish(
                    profileEvent,
                    relaysToPublish                    
                )
                
                return publishedEvent
                
            } catch (e: any) {     
                // on profile creation / recovery this fails at first as nostr keys are not yet saved  
                log.warn(e.name, e.message)         
                return false // silent
            }                    
        })        
    }))
    .actions(self => ({        
        hydrate: flow(function* hydrate(profileRecord: WalletProfileRecord) {
            const {name, nip05, lud16, avatar, pubkey, walletId} = profileRecord
            
            self.name = name // default name is set on server side, equals walletId
            self.nip05 = nip05 // default is name@minibits.cash set on server side
            self.lud16 = lud16 // equals to nip05 for all @minibits.cash addresses, set on server side
            self.picture = avatar // default picture is set on server side              
            self.pubkey = pubkey                
            self.walletId = walletId

            yield self.publishToRelays()
        })
    }))   
    .actions(self => ({  
        create: flow(function* create(nostrPublicKey: string, walletId: string, seedHash: string) {
       
            let profileRecord: WalletProfileRecord            

            log.trace('[create]', {seedHash, nostrPublicKey, walletId})

            try {
                // Use retrieved jwt token to authenticate and creates new profile. If all params equal existing one, it is returned
                profileRecord = yield MinibitsClient.createWalletProfile(nostrPublicKey, walletId, seedHash)                
                self.hydrate(profileRecord)
            
                log.info('[create]', 'Wallet profile saved in WalletProfileStore', {self})
                return self 
            } catch (e: any) {
                // Unlikely we might hit the same walletId so we retry with another one
                if(e.name.includes(Err.ALREADY_EXISTS_ERROR)) {
                    // recreate walletId + default name
                    const name = getRandomUsername()
                    // attempt to create new unique profile again                    
                    profileRecord = yield MinibitsClient.createWalletProfile(nostrPublicKey, name, seedHash) 
                    
                    log.error('[create]', 'Profile reset executed to resolve duplicate walletId on the server.', {caller: 'create', walletId, newWalletId: name})
                    self.hydrate(profileRecord)

                    return self
                }
                throw e
            }          
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
            self.isOwnProfile = isOwnProfile
            
            log.info('[updateNip05]', 'Wallet nip05 updated in the WalletProfileStore', {self})
            return self         
        }),
        recover: flow(function* recover(nostrPublicKey: string, walletId: string, seedHash: string) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.recoverProfile(
                nostrPublicKey, walletId, seedHash
            )            
            
            self.hydrate(profileRecord)

            log.info('[recover]', 'Wallet profile recovered in WalletProfileStore', {self})
            return self         
        }),
        setDevice: flow(function* setDevice(device: string) {  
            try {
                if(!self.pubkey) {
                    // skip call for new installs without a profile
                    return
                }

                yield MinibitsClient.updateDeviceToken(self.pubkey, {deviceToken: device}) 
                self.device = device          
            } catch (e: any) {
                log.error('[setDevice]', e.message)
            }
        })
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
