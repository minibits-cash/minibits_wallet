import {
    Instance,
    SnapshotOut,
    types,
    destroy,
  } from 'mobx-state-tree'
  import {withSetPropAction} from './helpers/withSetPropAction'
  import {
    ContactModel,
    Contact,
    ContactKind,
    getContactId,
    getContactName,
  } from './Contact'
  import {log} from '../services/logService'
  import {Database, ConversationSummary} from '../services/db'
  import { MINIBITS_NIP05_DOMAIN } from '@env'

  export const ContactsStoreModel = types
      .model('ContactsStore', {
          contacts: types.array(ContactModel),
          publicPubkey: types.maybe(types.string),
          lastPendingReceivedCheck: types.maybe(types.number), // UNIX timestamp
      })
      // Derived from the messages table, never persisted (see refreshConversations).
      .volatile(() => ({
          conversations: {} as Record<string, ConversationSummary>,
      }))
      .actions(withSetPropAction)
      .views(self => ({
            findById: (id: string) => {
                return self.contacts.find(c => c.id === id)
            },
            findByPubkey: (pubkey: string) => {
                return self.contacts.find(c => c.pubkey === pubkey)
            },
            findByNpub: (npub: string) => {
                return self.contacts.find(c => c.npub === npub)
            },
            findByLud16: (lud16: string) => {
                const lower = lud16.toLowerCase()
                return self.contacts.find(c => c.lud16?.toLowerCase() === lower)
            },
            alreadyExists(id: string) {
                return self.contacts.some(c => c.id === id)
            },
            nip05AlreadyExists(nip05: string) {
                return self.contacts.some(m => m.nip05 === nip05)
            },
            /** An accepted contact: what "Receive only from contacts" lets through. */
            isAcceptedContact(pubkey: string) {
                return self.contacts.some(c => c.pubkey === pubkey && !c.isRequest)
            },
      }))
      .actions(self => ({
            /**
             * Adds a contact, or returns the existing one with the same id. Adding a
             * contact that is pending as a message request accepts it — unless the new
             * one is itself a request.
             */
            addContact(newContact: Contact) {
                const id = newContact.id ?? getContactId(newContact)

                if(!id) {
                    log.warn('[addContact]', 'Contact has neither pubkey nor lightning address', {name: newContact.name})
                    return
                }

                const existing = self.findById(id)

                if(existing) {
                    if(existing.isRequest && !newContact.isRequest) {
                        existing.setIsRequest(false)
                    }
                    return existing
                }

                if(newContact.nip05 && self.nip05AlreadyExists(newContact.nip05)) {
                    log.warn('[addContact]', 'Contact NIP05 already exists with different pubkey', {nip05: newContact.nip05})
                    return
                }

                const contactInstance = ContactModel.create({
                    ...newContact,
                    id,
                    kind: newContact.kind ?? ContactKind.NOSTR,
                    isExternalDomain: !!newContact.nip05 && !newContact.nip05.includes(MINIBITS_NIP05_DOMAIN),
                    createdAt: Math.floor(Date.now() / 1000),
                } as any)

                self.contacts.push(contactInstance)

                log.debug('[addContact]', 'New contact added to the ContactsStore', {id, kind: contactInstance.kind})

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
             * Not addContact: that stamps `createdAt` with now, which would rewrite
             * history the backup is carrying faithfully. It does contribute the two
             * checks worth keeping — an id already present, and a nip05 already
             * claimed by a different pubkey, since the wallet treats a nip05 as an
             * address and two contacts sharing one would be ambiguous.
             */
            mergeFromBackup(snapshot: ContactsStoreSnapshot) {
                let added = 0

                for (const raw of snapshot?.contacts ?? []) {
                    if (!raw) continue
                    // backups made before the redesign carry no id/kind
                    const contact = ContactModel.create(raw as any)
                    if (self.alreadyExists(contact.id)) continue

                    if (contact.nip05 && self.nip05AlreadyExists(contact.nip05)) {
                        log.warn('[mergeFromBackup]', 'Skipped a backup contact whose nip05 is already taken', {
                            nip05: contact.nip05,
                        })
                        continue
                    }

                    self.contacts.push(contact)
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
            saveNote (id: string, note: string) {
                const contactInstance = self.findById(id)
                if (contactInstance) {
                    contactInstance.setNoteToSelf(note)
                    log.debug('[saveNote]', 'Contact note updated in ContactsStore')
                }
            },
            refreshConversations() {
                try {
                    const summaries = Database.getConversationSummaries()
                    self.conversations = Object.fromEntries(summaries.map(s => [s.contactId, s]))
                } catch (e: any) {
                    log.error('[refreshConversations]', e.message)
                }
            },
      }))
      .actions(self => ({
            markConversationRead(id: string) {
                if (!self.conversations[id]?.unread) return
                Database.markMessagesRead(id)
                self.refreshConversations()
            },
            /** Removes the contact together with its conversation. */
            removeContact(contact: Contact) {
                const id = contact.id ?? getContactId(contact)
                const contactInstance = id ? self.findById(id) : undefined

                if (contactInstance) {
                    Database.deleteMessages(contactInstance.id)
                    destroy(contactInstance)
                    self.refreshConversations()
                    log.debug('[removeContact]', 'Contact removed from ContactsStore')
                }
            },
            removeAllContacts() {
                self.contacts.clear()
                log.debug('[removeAllContacts]', 'Removed all Contacts from ContactsStore')
            },
            setPublicPubkey(publicPubkey?: string) {
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
            /** Accepted contacts, Signal-style: unread first, then recent conversations, then by name. */
            get sorted() {
                const conv = self.conversations
                return self.contacts
                    .filter(c => !c.isRequest)
                    .sort((a, b) => {
                        const ca = conv[a.id], cb = conv[b.id]
                        const ua = ca?.unread ? 1 : 0, ub = cb?.unread ? 1 : 0
                        if (ua !== ub) return ub - ua
                        const la = ca?.lastAt ?? 0, lb = cb?.lastAt ?? 0
                        if (la !== lb) return lb - la
                        return getContactName(a).localeCompare(getContactName(b))
                    })
            },
            get requests() {
                const conv = self.conversations
                return self.contacts
                    .filter(c => c.isRequest)
                    .sort((a, b) => (conv[b.id]?.lastAt ?? 0) - (conv[a.id]?.lastAt ?? 0))
            },
      }))


  export interface ContactsStore
    extends Instance<typeof ContactsStoreModel> {}
  export interface ContactsStoreSnapshot
    extends SnapshotOut<typeof ContactsStoreModel> {}
