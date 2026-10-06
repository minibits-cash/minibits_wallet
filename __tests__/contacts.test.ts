/**
 * Contacts after the redesign: legacy snapshots still load, lightning-only contacts
 * are keyed by their address, a message request is accepted by adding it, and the
 * list orders unread → recent → by name.
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {ContactsStoreModel} from '../src/models/ContactsStore'
import {ContactKind} from '../src/models/Contact'
import {Database, MessageDirection, MessageTransport} from '../src/services/db'

beforeEach(() => {
  Database.getInstance().executeBatch([['DELETE FROM messages']])
})

describe('contacts', () => {
  test('a pre-redesign snapshot loads as nostr contacts keyed by pubkey', () => {
    const store = ContactsStoreModel.create({
      contacts: [{type: 'PRIVATE', pubkey: 'aa', npub: 'npub-aa', name: 'alice'}],
    } as any)

    expect(store.contacts[0]).toMatchObject({id: 'aa', kind: ContactKind.NOSTR, isRequest: false})
    expect((store.contacts[0] as any).type).toBeUndefined()
  })

  test('a lightning contact is keyed by its lowercased address', () => {
    const store = ContactsStoreModel.create({})
    const c = store.addContact({kind: ContactKind.LIGHTNING, lud16: 'Bob@Example.com', name: 'Bob'})

    expect(c?.id).toBe('bob@example.com')
    expect(store.findByLud16('bob@example.com')?.name).toBe('Bob')
  })

  test('adding a pending request accepts it; a new request does not', () => {
    const store = ContactsStoreModel.create({})
    store.addContact({pubkey: 'cc', npub: 'npub-cc', isRequest: true})
    expect(store.isAcceptedContact('cc')).toBe(false)

    store.addContact({pubkey: 'cc', npub: 'npub-cc', isRequest: true})
    expect(store.isAcceptedContact('cc')).toBe(false)

    store.addContact({pubkey: 'cc', npub: 'npub-cc'})
    expect(store.isAcceptedContact('cc')).toBe(true)
    expect(store.count).toBe(1)
  })

  test('sorted: unread first, then most recent conversation, then by name; requests apart', () => {
    const store = ContactsStoreModel.create({})
    for (const [pubkey, name] of [['a', 'Zed'], ['b', 'Amy'], ['c', 'Bob'], ['d', 'Cid']]) {
      store.addContact({pubkey, npub: 'npub-' + pubkey, name})
    }
    store.addContact({pubkey: 'r', npub: 'npub-r', name: 'Stranger', isRequest: true})

    const add = (id: string, contactId: string, direction: MessageDirection, createdAt: number) =>
      Database.addMessage({id, contactId, direction, transport: MessageTransport.NIP17, content: 'x', createdAt})

    add('m1', 'c', MessageDirection.OUT, 100) // read, older
    add('m2', 'd', MessageDirection.OUT, 200) // read, newer
    add('m3', 'a', MessageDirection.IN, 50)   // unread, oldest of all
    store.refreshConversations()

    expect(store.sorted.map(c => c.name)).toEqual(['Zed', 'Cid', 'Bob', 'Amy'])
    expect(store.requests.map(c => c.name)).toEqual(['Stranger'])
  })

  test('removing a contact deletes its conversation', () => {
    const store = ContactsStoreModel.create({})
    const c = store.addContact({pubkey: 'e', npub: 'npub-e'})!
    Database.addMessage({id: 'x', contactId: 'e', direction: MessageDirection.IN, transport: MessageTransport.NIP17, content: 'hi', createdAt: 1})

    store.removeContact(c)
    expect(store.count).toBe(0)
    expect(Database.getMessages('e')).toHaveLength(0)
  })
})
