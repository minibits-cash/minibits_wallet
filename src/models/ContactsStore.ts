import {
    Instance,
    SnapshotOut,
    types,
    destroy,
    isStateTreeNode,
    getSnapshot,
  } from 'mobx-state-tree'
  import {withSetPropAction} from './helpers/withSetPropAction'
  import {
    ContactModel,
    Contact,
    ContactType,
  } from './Contact'
  import {log} from '../services/logService'
import { MINIBITS_NIP05_DOMAIN } from '@env'
  
  // export const maxContactsInModel = 10
  
  export const ContactsStoreModel = types
      .model('ContactsStore', {
          contacts: types.array(ContactModel),
          publicPubkey: types.maybe(types.string),          
          lastPendingReceivedCheck: types.maybe(types.number), // UNIX timestamp
          selectedContact: types.maybe(types.frozen<Contact>())
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
            findByLud16: (lud16: string) => {
                const c = self.contacts.find(c => c.lud16 === lud16)
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

                if(newContact.nip05 && !newContact.nip05.includes(MINIBITS_NIP05_DOMAIN)) {
                    newContact.isExternalDomain = true
                }
                
                newContact.type = ContactType.PRIVATE // reset in case we save from public contacts
                newContact.createdAt = Math.floor(Date.now() / 1000)
    
                const contactInstance = ContactModel.create(newContact)
                self.contacts.push(contactInstance)
    
                log.debug('[addContact]', 'New contact added to the ContactsStore', newContact)
    
                return contactInstance
            },
            /**
             * Fold a backup's contacts into the wallet's own.
             *
             * Same rule as the mints: the LOCAL entry wins, the backup fills gaps.
             * An import used to applySnapshot over this store, which silently threw
             * away every contact the user had added on this device — and unlike
             * ecash, a contact list has no other copy to recover it from.
             *
             * Not addContact: that stamps `createdAt` with now and resets `type`,
             * which would rewrite history the backup is carrying faithfully. It does
             * contribute the two checks worth keeping — a pubkey already present, and
             * a nip05 already claimed by a different pubkey, since the wallet treats
             * a nip05 as an address and two contacts sharing one would be ambiguous.
             */
            mergeFromBackup(snapshot: ContactsStoreSnapshot) {
                let added = 0

                for (const contact of snapshot?.contacts ?? []) {
                    if (!contact?.pubkey || self.alreadyExists(contact.pubkey)) continue

                    if (contact.nip05 && self.nip05AlreadyExists(contact.nip05)) {
                        log.warn('[mergeFromBackup]', 'Skipped a backup contact whose nip05 is already taken', {
                            nip05: contact.nip05,
                        })
                        continue
                    }

                    self.contacts.push(ContactModel.create(contact))
                    added++
                }

                // Wallet-level fields the backup also carries: adopted only where this
                // wallet has nothing, so restoring onto a fresh install gets them and
                // merging into a live wallet leaves its own alone.
                if (!self.publicPubkey && snapshot?.publicPubkey) {
                    self.publicPubkey = snapshot.publicPubkey
                }

                if (!self.lastPendingReceivedCheck && snapshot?.lastPendingReceivedCheck) {
                    self.lastPendingReceivedCheck = snapshot.lastPendingReceivedCheck
                }

                log.info('[mergeFromBackup]', 'Contacts merged from a backup', {
                    added,
                    total: self.contacts.length,
                })
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
                    destroy(contactInstance)
                    log.debug('[removeContact]', 'Contact removed from ContactsStore')
                }
            },
            selectContact(contact: Contact) {
                self.selectedContact = getSnapshot(contact)
            },
            unselectContact() {
                self.selectedContact = undefined
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
                self.lastPendingReceivedCheck = ts2
                log.trace('[setLastPendingReceivedCheck]', {ts2})                
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
  