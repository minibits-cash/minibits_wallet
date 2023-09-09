import {Instance, SnapshotOut, types, flow, SnapshotIn} from 'mobx-state-tree'
import {MinibitsClient, NostrClient, NostrUnsignedEvent} from '../services'
import {log} from '../utils/logger'


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

                const defaultRelays = NostrClient.getDefaultRelays()
                const minibitsRelays = NostrClient.getMinibitsRelays()

                const publishedEvent: Event | undefined = yield NostrClient.publish(
                    profileEvent,
                    [ ...defaultRelays, ...minibitsRelays]                    
                )
                
                return publishedEvent
                
            } catch (e: any) {       
                log.error(e.name, e.message)         
                return false // silent
            }                    
        }),
    }))   
    .actions(self => ({  
        create: flow(function* create(pubkey: string, walletId: string) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.createWalletProfile(pubkey, walletId)

            const {nip05, name, avatar} = profileRecord
            
            self.pubkey = pubkey            
            self.name = name // default name is set on server side, equals walletId
            self.nip05 = nip05 // default is name@minibits.cash set on server side
            self.picture = avatar // default picture is set on server side
            
            const publishedEvent = yield self.publishToRelays()
            
            log.trace('Wallet profile saved in WalletProfileStore', {self, publishedEvent})
            return self           
        }),      
        updateName: flow(function* update(name: string) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.updateWalletProfileName(
                self.pubkey, 
                {                    
                    name                   
                }
            )           
                           
            self.name = profileRecord.name
            self.nip05 = profileRecord.nip05
            const publishedEvent = yield self.publishToRelays()
            
            log.trace('Wallet name updated in the WalletProfileStore', {self, publishedEvent})
            return self         
        }),
        updatePicture: flow(function* update(picture: string) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.updateWalletProfileAvatar(
                self.pubkey, 
                {   
                    avatar: picture
                }
            )   

            self.picture = profileRecord.avatar + '?r=' + Math.floor(Math.random() * 100) // force refresh as image URL stays the same

            const publishedEvent = yield self.publishToRelays()
            
            log.trace('Wallet picture updated in the WalletProfileStore', {self, publishedEvent})
            return self         
        }),
        updateNip05: flow(function* update(newPubkey: string, nip05: string, name: string, picture: string, isOwnProfile: boolean) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.updateWalletProfileNip05(
                self.pubkey, 
                { 
                    newPubkey,
                    nip05,
                    name,
                    avatar: picture
                }
            )   

            self.pubkey = newPubkey
            self.nip05 = profileRecord.nip05
            self.name = profileRecord.name
            self.picture = profileRecord.avatar
            self.isOwnProfile = isOwnProfile
            
            // can't publish to relay as the keys have not yet been updated
            
            log.trace('Wallet nip05 updated in the WalletProfileStore', {self})
            return self         
        }),
        setNip05(nip05: string) {   // used in migration to v3 model         
            self.nip05 = nip05             
        },
        setWalletId(walletId: string) {   // used in migration to v4 model         
            self.walletId = walletId             
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
