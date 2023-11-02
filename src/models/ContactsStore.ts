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
      .actions(self => ({          
          findByPubkey: (pubkey: string) => {
            const c = self.contacts.find(c => c.pubkey === pubkey)
            return c ? c : undefined
          },
          findByNpub: (npub: string) => {
            const c = self.contacts.find(c => c.npub === npub)
            return c ? c : undefined
          },         
      }))
      .actions(self => ({
            addContact(newContact: Contact) {

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
                    contactInstance.noteToSelf = note
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
            setLastPendingReceivedCheck() {    
                const ts: number = Math.floor(Date.now() / 1000)
                log.trace('[setLastPendingReceivedCheck]', {ts})
                self.lastPendingReceivedCheck = ts
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
  