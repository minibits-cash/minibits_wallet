import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import { MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST } from '@env'
import { log } from '../services/logService'

export type ContactData = {    
    [index: string]: any
}

export enum ContactType {
    PRIVATE = 'PRIVATE',
    PUBLIC = 'PUBLIC',
}

export const ContactModel = types
    .model('Contact', {        
        type: types.optional(types.frozen<ContactType>(), ContactType.PRIVATE),        
        npub: types.string,
        pubkey: types.string,
        name: types.maybe(types.string),
        about: types.maybe(types.string),
        display_name: types.maybe(types.string),     
        picture: types.maybe(types.string),
        nip05: types.maybe(types.string),
        lud16: types.maybe(types.string),
        noteToSelf: types.maybe(types.string),
        data: types.maybe(types.string),
        isExternalDomain: types.optional(types.boolean, false),        
        createdAt: types.optional(types.number, Math.floor(Date.now() / 1000)),
    })
    .actions(self => ({
        refreshPicture() {
            const cleaned = MINIBITS_SERVER_API_HOST + '/profile/avatar/' + self.pubkey // remove refresh suffix            
            self.picture = cleaned + '?r=' + Math.floor(Math.random() * 100) // force url refresh            
        },
        setNoteToSelf(note: string) {
            self.noteToSelf = note        
        },
        setLud16(lud16: string) {
            self.lud16 = lud16        
        },
    }))
    .views(self => ({        
        get nip05handle() {
            if(!self.nip05 && self.type === ContactType.PRIVATE) {
                return self.name+MINIBITS_NIP05_DOMAIN
            }

            return self.nip05
        },
    }))

export type Contact = {
    npub: string
    pubkey: string    
    name?: string
    picture?: string
    nip05?: string
    lud16?: string
    data?: string   
    noteToSelf?: string
} & Partial<Instance<typeof ContactModel>>
export interface ContactSnapshotOut
  extends SnapshotOut<typeof ContactModel> {}
export interface ContactSnapshotIn
  extends SnapshotIn<typeof ContactModel> {}
