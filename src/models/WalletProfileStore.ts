import {Instance, SnapshotOut, types, flow, SnapshotIn} from 'mobx-state-tree'
import {MinibitsClient, NostrClient} from '../services'
import {log} from '../utils/logger'


export type WalletProfile = {    
    pubkey: string    
    name: string
    nip05: string
    picture: string
    device?: string | null
}

export type WalletProfileRecord = {  
    id: number  
    pubkey: string    
    walletId: string
    nip05: string
    device?: string | null
    avatar: string
    createdAt: string
    
}

export const WalletProfileStoreModel = types
    .model('WalletProfileStore', {        
        pubkey: types.optional(types.string, ''),                 
        name: types.optional(types.string, ''),
        nip05: types.optional(types.string, ''),
        picture: types.optional(types.string, ''),
        device: types.maybe(types.maybeNull(types.string)),         
    })    
    .actions(self => ({  
        create: flow(function* create(pubkey: string, name: string) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.createWalletProfile(pubkey, name)
            
            self.pubkey = profileRecord.pubkey                    
            self.name = profileRecord.walletId
            self.nip05 = profileRecord.nip05
            self.picture = profileRecord.avatar
            // self.device = profileRecord.device 
            log.trace('Wallet profile saved in WalletProfileStore', self)
            return self           
        }),      
        update: flow(function* update(name: string, picture: string) {

            let profileRecord: WalletProfileRecord = yield MinibitsClient.updateWalletProfile(self.pubkey, name, picture)           
                           
            self.name = profileRecord.walletId
            self.nip05 = profileRecord.nip05
            self.picture = profileRecord.avatar // server returns public URL instead of png            
            // self.device = profileRecord.device 
            log.trace('Wallet profile updated in the WalletProfileStore', self)
            return self         
        }),
        setNip05(nip05: string) {            
            self.nip05 = nip05             
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
