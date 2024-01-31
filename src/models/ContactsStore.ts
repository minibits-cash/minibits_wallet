import {
    Instance,
    SnapshotOut,
    types,
    flow,
    destroy,
    isStateTreeNode,
    detach,
  } from 'mobx-state-tree'
  import {withSetPropAction} from './helpers/withSetPropAction'
  import {
    ContactModel,
    Contact,
  } from './Contact'
  import {log} from '../services/logService'
  
  // export const maxContactsInModel = 10
  
  export const ContactsStoreModel = types
      .model('ContactsStore', {
          contacts: types.array(ContactModel),
          publicPubkey: types.maybe(types.string),          
          lastPendingReceivedCheck: types.maybe(types.number), // UNIX timestamp
          receivedEventIds: types.optional(types.array(types.string), [])
      })
      .actions(withSetPropAction)
      .views(self => ({          
            findByPubkey: (pubkey: string) => {
                const c = self.contacts.find(c => c.pubkey === pubkey)
                return c ? c : undefined
            },
            findByNpub: (npub: string) => {
                const c = self.contacts.find(c => c.npub === npub)
                return c ? c : undefined
            },
            alreadyExists(pubkey: string) {
                return self.contacts.some(m => m.pubkey === pubkey) ? true : false
            },
            nip05AlreadyExists(nip05: string) {
                return self.contacts.some(m => m.nip05 === nip05) ? true : false
            },         
      }))
      .actions(self => ({
            addContact(newContact: Contact) {
                if(self.alreadyExists(newContact.pubkey)) {
                    log.warn('[addContact]', 'Contact already exists', newContact)
                    return
                }

                if(self.nip05AlreadyExists(newContact.nip05 as string)) {
                    log.warn('[addContact]', 'Contact NIP05 already exists with different pubkey', newContact)
                    return
                }

                newContact.createdAt = Math.floor(Date.now() / 1000)                      
    
                const contactInstance = ContactModel.create(newContact)
                self.contacts.push(contactInstance)
    
                log.debug('[addContact]', 'New contact added to the ContactsStore', newContact)
    
                return contactInstance
            },
            refreshPicture(pubkey: string) {
                const contactInstance = self.findByPubkey(pubkey)
                if (contactInstance) {
                    contactInstance.refreshPicture()
                    log.debug('[refreshPicture]', 'Contact picture refreshed in ContactsStore')
                }

                return contactInstance
            },
            saveNote (pubkey: string, note: string) {              
                const contactInstance = self.findByPubkey(pubkey)
                if (contactInstance) {
                    contactInstance.setNoteToSelf(note)
                    log.debug('[saveNote]', 'Contact note updated in ContactsStore')
                }
            },
            removeContact(contactToBeRemoved: Contact) {
                let contactInstance: Contact | undefined            

                if (isStateTreeNode(contactToBeRemoved)) {
                    contactInstance = contactToBeRemoved
                } else {
                    contactInstance = self.findByNpub((contactToBeRemoved as Contact).npub)
                }

                if (contactInstance) {
                    detach(contactInstance) // needed
                    destroy(contactInstance)
                    log.debug('[removeContact]', 'Contact removed from MintsStore')
                }
            },
            removeAllContacts() {            
                self.contacts.clear()
                log.debug('[removeAllContacts]', 'Removed all Contacts from ContactsStore')
            },
            setPublicPubkey(publicPubkey: string) {            
                self.publicPubkey = publicPubkey
                log.debug('[setPublicPubkey]', publicPubkey)
            },           
            setLastPendingReceivedCheck(ts?: number) {    
                if(ts) {
                    self.lastPendingReceivedCheck = ts
                    log.trace('[setLastPendingReceivedCheck]', {ts})
                    return
                }
                
                const ts2: number = Math.floor(Date.now() / 1000)
                log.trace('[setLastPendingReceivedCheck]', {ts2})                
            },
            addReceivedEventId(id: string) {            
                self.receivedEventIds.push(id)
            },
            eventAlreadyReceived(id: string) {            
                return self.receivedEventIds.includes(id)
            },
      }))
      .views(self => ({
            get count() {
                return self.contacts.length
            },
            /* get recent(): Contact[] {
                return this.all.slice(0, maxContactsInModel) // Return the first 3 Contacts
            },*/
            get all() {
                return self.contacts
                    .slice()
                    .sort((a, b) => {
                    // Sort by createdAt timestamp
                    if (a.createdAt && b.createdAt) {
                    return b.createdAt - a.createdAt
                    }
                })
            }                
      }))
  
  
  export interface ContactsStore
    extends Instance<typeof ContactsStoreModel> {}
  export interface ContactsStoreSnapshot
    extends SnapshotOut<typeof ContactsStoreModel> {}
  