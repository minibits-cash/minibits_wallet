import {getInstance} from './instance'
import {dbError} from './errors'

// ─────────────────────────────────────────────────────────────────────────────
// Conversation messages (see MESSAGES_COLUMNS in schema.ts).
// ─────────────────────────────────────────────────────────────────────────────

export enum MessageDirection {
  IN = 'IN',
  OUT = 'OUT',
}

export enum MessageTransport {
  NIP17 = 'NIP17',
  NIP04 = 'NIP04',
  /** Never sent anywhere: a payment record in a lightning-address contact's thread. */
  LOCAL = 'LOCAL',
}

export enum MessageStatus {
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export type MessageRecord = {
  id: string
  contactId: string
  direction: MessageDirection
  transport: MessageTransport
  content: string
  transactionId?: number | null
  status?: MessageStatus | null
  isRead?: boolean
  createdAt: number // unix seconds
}

export type ConversationSummary = {
  contactId: string
  lastAt: number
  lastContent: string
  lastDirection: MessageDirection
  unread: number
}

const toRecord = (row: any): MessageRecord => ({...row, isRead: row.isRead === 1})

/**
 * Store a message. Returns false when a message with the same id already exists
 * (our own self-copy echoed back by a relay, or a relay re-delivering) — callers use
 * that to skip side effects such as notifications.
 */
export const addMessage = function (message: MessageRecord): boolean {
  try {
    const {rowsAffected} = getInstance().execute(
      `INSERT OR IGNORE INTO messages (id, contactId, direction, transport, content, transactionId, status, isRead, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.contactId,
        message.direction,
        message.transport,
        message.content,
        message.transactionId ?? null,
        message.status ?? null,
        // our own messages are read by definition
        message.isRead || message.direction === MessageDirection.OUT ? 1 : 0,
        message.createdAt,
      ],
    )
    return rowsAffected > 0
  } catch (e: any) {
    throw dbError('Message could not be saved to the database', e)
  }
}

export const updateMessage = function (
  id: string,
  fields: {status?: MessageStatus; transactionId?: number},
): void {
  try {
    getInstance().execute(
      `UPDATE messages SET status = COALESCE(?, status), transactionId = COALESCE(?, transactionId) WHERE id = ?`,
      [fields.status ?? null, fields.transactionId ?? null, id],
    )
  } catch (e: any) {
    throw dbError('Message could not be updated in the database', e)
  }
}

/** Newest first, ready for an inverted list. */
// ponytail: fixed window, add paging (createdAt < ?) when a thread outgrows it
export const getMessages = function (contactId: string, limit: number = 500): MessageRecord[] {
  try {
    const {rows} = getInstance().execute(
      `SELECT * FROM messages WHERE contactId = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?`,
      [contactId, limit],
    )
    return (rows?._array ?? []).map(toRecord)
  } catch (e: any) {
    throw dbError('Messages could not be retrieved from the database', e)
  }
}

/**
 * One row per contact with its newest message and unread count. Relies on SQLite's
 * documented bare-column rule: with a single MAX() aggregate, the other columns
 * come from the row that holds the maximum.
 */
export const getConversationSummaries = function (): ConversationSummary[] {
  try {
    const {rows} = getInstance().execute(
      `SELECT contactId, MAX(createdAt) AS lastAt, content AS lastContent, direction AS lastDirection,
              (SELECT COUNT(*) FROM messages u WHERE u.contactId = m.contactId AND u.direction = 'IN' AND u.isRead = 0) AS unread
       FROM messages m GROUP BY contactId`,
    )
    return (rows?._array ?? []) as ConversationSummary[]
  } catch (e: any) {
    throw dbError('Conversations could not be retrieved from the database', e)
  }
}

export const markMessagesRead = function (contactId: string): void {
  try {
    getInstance().execute(`UPDATE messages SET isRead = 1 WHERE contactId = ? AND isRead = 0`, [contactId])
  } catch (e: any) {
    throw dbError('Messages could not be marked as read', e)
  }
}

export const deleteMessage = function (id: string): void {
  try {
    getInstance().execute(`DELETE FROM messages WHERE id = ?`, [id])
  } catch (e: any) {
    throw dbError('Message could not be deleted from the database', e)
  }
}

export const deleteMessages = function (contactId: string): void {
  try {
    getInstance().execute(`DELETE FROM messages WHERE contactId = ?`, [contactId])
  } catch (e: any) {
    throw dbError('Messages could not be deleted from the database', e)
  }
}
