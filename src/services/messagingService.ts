import {log} from './logService'
import {NostrClient, NostrEvent} from './nostrService'
import {Database, MessageDirection, MessageRecord, MessageStatus, MessageTransport} from './db'
import {rootStoreInstance} from '../models'
import AppError, {Err} from '../utils/AppError'

/**
 * The one way the wallet sends a message to a contact, payments included: every
 * message sent is also a row in the contact's conversation.
 */

const {contactsStore, relaysStore, walletProfileStore, walletStore} = rootStoreInstance

const unique = (urls: string[]) => Array.from(new Set(urls))

/**
 * Sends a NIP-17 message to `recipientPubkey` (also wrapped to ourselves) and
 * records it in the conversation. Delivered to the recipient's DM relays (kind
 * 10050) plus `relays` — the wallet's own by default, which is where other
 * Minibits wallets listen.
 *
 * Returns the recipient's wrap as read back from a relay, or undefined when no
 * relay returned it — same contract the payment screens relied on before.
 * Throws when no relay accepted the message.
 */
const sendMessage = async function (params: {
    recipientPubkey: string
    content: string
    relays?: string[]
    transactionId?: number
}): Promise<{messageId: string, sentEvent?: NostrEvent}> {
    const {recipientPubkey, content, transactionId} = params
    const ownRelays = params.relays && params.relays.length > 0 ? params.relays : relaysStore.allUrls
    const keys = (await walletStore.getCachedWalletKeys()).NOSTR

    const {rumor, toRecipient, toSelf} = NostrClient.createDirectMessageNip17(
        recipientPubkey,
        content,
        keys,
        walletProfileStore.nip05,
    )

    Database.addMessage({
        id: rumor.id,
        contactId: recipientPubkey,
        direction: MessageDirection.OUT,
        transport: MessageTransport.NIP17,
        content,
        transactionId,
        status: MessageStatus.SENDING,
        createdAt: rumor.created_at,
    })
    contactsStore.refreshConversations()

    try {
        let dmRelays: string[] = []
        try {
            dmRelays = await NostrClient.getDirectMessageRelays(recipientPubkey, unique([...ownRelays, ...relaysStore.allPublicUrls]))
        } catch (e: any) {
            log.warn('[sendMessage] Could not get recipient DM relays, using wallet relays', {message: e.message})
        }

        const recipientRelays = unique([...dmRelays, ...ownRelays])
        const pool = NostrClient.getRelayPool()

        await Promise.any(pool.publish(recipientRelays, toRecipient))
        // the self-copy only matters for other clients of the same keys, never block on it
        Promise.any(pool.publish(relaysStore.allUrls, toSelf)).catch(() => {
            log.warn('[sendMessage] Self-copy was not accepted by any relay')
        })

        Database.updateMessage(rumor.id, {status: MessageStatus.SENT})
        contactsStore.refreshConversations()

        const sentEvent = await pool.get(recipientRelays, {ids: [toRecipient.id]}) as NostrEvent | null
        log.trace('[sendMessage] Message sent', {messageId: rumor.id, confirmed: !!sentEvent})

        return {messageId: rumor.id, sentEvent: sentEvent ?? undefined}
    } catch (e: any) {
        Database.updateMessage(rumor.id, {status: MessageStatus.FAILED})
        contactsStore.refreshConversations()
        // Promise.any rejects with an AggregateError of every relay's refusal
        throw new AppError(Err.NETWORK_ERROR, 'Message could not be delivered to any relay.', {
            caller: 'sendMessage',
            message: e.message,
        })
    }
}

/** Resends a failed message as a new one (new rumor, same content and payment link). */
const retryMessage = async function (message: MessageRecord) {
    Database.deleteMessage(message.id)
    return sendMessage({
        recipientPubkey: message.contactId,
        content: message.content,
        transactionId: message.transactionId ?? undefined,
    })
}

/** A payment to or request from a lightning-address contact, recorded in its thread. */
const addLocalMessage = function (contactId: string, content: string, transactionId?: number) {
    const now = Date.now()
    Database.addMessage({
        id: `local-${now}-${Math.random().toString(36).slice(2, 8)}`,
        contactId,
        direction: MessageDirection.OUT,
        transport: MessageTransport.LOCAL,
        content,
        transactionId,
        status: MessageStatus.SENT,
        createdAt: Math.floor(now / 1000),
    })
    contactsStore.refreshConversations()
}

export const MessagingService = {
    sendMessage,
    retryMessage,
    addLocalMessage,
}
