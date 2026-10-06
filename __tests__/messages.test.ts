/**
 * Conversation messages (messages), against the real repo and a real database.
 *
 * The rumor id primary key is what dedups our own NIP-17 self-copy against the row
 * written at send time, and the summary query drives contact ordering and unread
 * badges, so both are pinned here.
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {Database, MessageDirection, MessageTransport, MessageStatus} from '../src/services/db'

const msg = (id: string, contactId: string, direction: MessageDirection, createdAt: number, content = id) => ({
  id,
  contactId,
  direction,
  transport: MessageTransport.NIP17,
  content,
  createdAt,
})

beforeEach(() => {
  Database.getInstance().executeBatch([['DELETE FROM messages']])
})

describe('messages', () => {
  test('a duplicate id is ignored and reported as not inserted', () => {
    expect(Database.addMessage({...msg('r1', 'alice', MessageDirection.OUT, 10), status: MessageStatus.SENDING})).toBe(true)
    // the self-copy coming back from a relay carries the same rumor id
    expect(Database.addMessage(msg('r1', 'alice', MessageDirection.OUT, 10, 'echo'))).toBe(false)

    const [only] = Database.getMessages('alice')
    expect(only.content).toBe('r1')
    expect(only.status).toBe(MessageStatus.SENDING)
  })

  test('summaries carry the newest message and count only unread incoming', () => {
    Database.addMessage(msg('a1', 'alice', MessageDirection.IN, 10))
    Database.addMessage(msg('a2', 'alice', MessageDirection.OUT, 30, 'newest'))
    Database.addMessage(msg('a3', 'alice', MessageDirection.IN, 20))
    Database.addMessage(msg('b1', 'bob', MessageDirection.IN, 5))

    const byId = Object.fromEntries(Database.getConversationSummaries().map(s => [s.contactId, s]))
    expect(byId.alice).toMatchObject({lastAt: 30, lastContent: 'newest', lastDirection: 'OUT', unread: 2})
    expect(byId.bob).toMatchObject({lastAt: 5, unread: 1})

    Database.markMessagesRead('alice')
    expect(Database.getConversationSummaries().find(s => s.contactId === 'alice')!.unread).toBe(0)
  })

  test('update keeps fields it is not given, delete is per contact', () => {
    Database.addMessage({...msg('x', 'alice', MessageDirection.OUT, 1), status: MessageStatus.SENDING})
    Database.updateMessage('x', {transactionId: 7})
    Database.updateMessage('x', {status: MessageStatus.SENT})
    expect(Database.getMessages('alice')[0]).toMatchObject({transactionId: 7, status: 'SENT'})

    Database.addMessage(msg('y', 'bob', MessageDirection.IN, 1))
    Database.deleteMessages('alice')
    expect(Database.getMessages('alice')).toHaveLength(0)
    expect(Database.getMessages('bob')).toHaveLength(1)
  })
})
