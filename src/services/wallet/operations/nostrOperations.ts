import {addSeconds} from 'date-fns'
import {GiftWrap, EncryptedDirectMessage} from 'nostr-tools/kinds'
import {UnsignedEvent} from 'nostr-tools'
import {
    PaymentRequestPayload,
    Token,
    getDecodedToken,
    getTokenMetadata,
    decodePaymentRequest,
} from '@cashu/cashu-ts'
import {MINIBITS_NIP05_DOMAIN, MINIBIT_SERVER_NOSTR_PUBKEY} from '@env'
import {log} from '../../logService'
import {Err, ValidationError} from '../../../utils/AppError'
import {rootStoreInstance} from '../../../models'
import {Contact} from '../../../models/Contact'
import {MintBalance} from '../../../models/Mint'
import {
    TransactionData,
    TransactionStatus,
    TransactionType,
} from '../../../models/Transaction'
import {SyncQueue} from '../../syncQueueService'
import {
    NostrClient,
    NostrEvent,
    NostrProfile,
} from '../../nostrService'
import {LightningUtils} from '../../lightning/lightningUtils'
import {IncomingDataType, IncomingParser} from '../../incomingParser'
import {MinibitsClient} from '../../minibitsService'
import {MintUnit} from '../currency'
import {
    receiveTask,
    receiveByCashuPaymentRequestTask,
} from '../receiveTask'
import {WalletUtils} from '../utils'
import {
    HANDLE_CLAIM_TASK,
    HANDLE_RECEIVED_EVENT_TASK,
    TransactionTaskResult,
    WalletTaskResult,
} from '../types'
import {
    sendReceiveNotification,
    sendErrorReceiveNotification,
    sendIncomingInvoiceNotification,
} from '../notifications'

const {
    userSettingsStore,
    walletProfileStore,
    mintsStore,
    proofsStore,
    transactionsStore,
    contactsStore,
    relaysStore,
    walletStore,
    nwcStore,
} = rootStoreInstance

const extractZapSenderData = function (str: string) {
    const match = str.match(/\{[^}]*\}/)
    return match ? match[0] : null
}

const handleClaimQueue = async function (): Promise<void> {
    log.info('[handleClaimQueue] start')
    const {isOwnProfile} = walletProfileStore

    if (isOwnProfile) {
        log.info('[handleClaimQueue] Skipping claim queue, wallet uses own Nostr keys...')
        return
    }

    const {isBatchClaimOn} = userSettingsStore
    const keys = await walletStore.getCachedWalletKeys()

    const claimedTokens = await MinibitsClient.createClaim(
        keys.SEED.seedHash,
        isBatchClaimOn ? 5 : undefined,
    )

    if (claimedTokens.length === 0) {
        log.debug('[handleClaimQueue] No claimed invoices returned from the server...')
        return
    }

    log.debug(`[handleClaimQueue] Claimed ${claimedTokens.length} tokens from the server...`)

    for (const claimedToken of claimedTokens) {
        const now = new Date().getTime()

        SyncQueue.addTask(
            `handleClaimTask-${now}`,
            async () => await handleClaimTask({claimedToken}),
        )
    }
}

const handleClaimTask = async function (params: {
    claimedToken: {
        token: string
        zapSenderProfile?: string
        zapRequest?: string
    }
}): Promise<WalletTaskResult> {
    let decoded: Token | undefined = undefined

    try {
        const {claimedToken} = params

        log.debug('[handleClaimTask] claimed token', {claimedToken})

        if (!claimedToken.token) {
            throw new ValidationError('[handleClaimTask] Missing encodedToken to receive.')
        }

        const encryptedToken = claimedToken.token
        const keys = (await walletStore.getCachedWalletKeys()).NOSTR
        const encodedToken = await NostrClient.decryptNip04(MINIBIT_SERVER_NOSTR_PUBKEY, encryptedToken, keys)

        log.debug('[handleClaimTask] decrypted token', {encodedToken})

        const tokenInfo = getTokenMetadata(encodedToken)
        const mintKeysetIds = mintsStore.findByUrl(tokenInfo.mint)?.keysetIds
        if (!mintKeysetIds || mintKeysetIds.length === 0) {
            throw new ValidationError('Missing keysetIds in the wallet state', {
                mintUrl: tokenInfo.mint,
            }, Err.NOTFOUND_ERROR)
        }

        decoded = getDecodedToken(encodedToken, mintKeysetIds)

        const result: TransactionTaskResult = await receiveTask(
            decoded,
            Number(tokenInfo.amount),
            tokenInfo.memo || 'Received to Lightning address',
            encodedToken,
        )

        if (result && result.transaction) {
            const transaction = transactionsStore.findById(result.transaction.id!)
            const {zapSenderProfile, zapRequest} = claimedToken

            if (transaction) {
                if (zapSenderProfile) {
                    let sentFrom: string = ''
                    try {
                        const profile: NostrProfile = JSON.parse(zapSenderProfile)
                        sentFrom = profile.nip05 ?? profile.name
                    } catch (e: any) {}

                    transaction.update({profile: zapSenderProfile, sentFrom})
                }

                if (zapRequest) {
                    transaction.update({zapRequest})
                }
            }
        }

        return {
            mintUrl: decoded.mint,
            taskFunction: HANDLE_CLAIM_TASK,
            message: result.error ? result.error.message : 'Ecash sent to your lightning address has been received.',
            error: result.error || undefined,
            proofsCount: decoded.proofs.length,
            proofsAmount: result.transaction?.amount,
        } as WalletTaskResult

    } catch (e: any) {
        log.error(e.name, e.message)

        return {
            mintUrl: decoded ? decoded.mint : '',
            taskFunction: HANDLE_CLAIM_TASK,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as WalletTaskResult
    }
}

const handleNwcRequestQueue = async function (params: {requestEvent: NostrEvent}): Promise<void> {
    const {requestEvent} = params
    log.trace('[handleNwcRequestQueue] start')

    const now = new Date().getTime()
    SyncQueue.addTask(
        `handleNwcRequestTask-${now}`,
        async () => await nwcStore.handleNwcRequestTask(requestEvent),
    )
}

/**
 * Checks with NOSTR relays whether there is ecash to be received or an invoice to be paid.
 */
const receiveEventsFromRelaysQueue = async function (): Promise<void> {
    log.trace('[receiveEventsFromRelays] starting listening for events')

    if (!walletProfileStore.pubkey) {
        const message = `No wallet profile created.`
        log.trace('[receiveEventsFromRelays]', message)
        return
    }

    try {
        const {lastPendingReceivedCheck} = contactsStore
        const TWO_DAYS = 2 * 24 * 60 * 60

        const filter = {
            kinds: [GiftWrap, EncryptedDirectMessage],
            "#p": [walletProfileStore.pubkey],
            since: lastPendingReceivedCheck ? lastPendingReceivedCheck - TWO_DAYS : 0,
        }

        log.trace('[receiveEventsFromRelays]', {filter})

        contactsStore.setLastPendingReceivedCheck()
        const pool = NostrClient.getRelayPool()

        if (relaysStore.allRelays.length < 3) {
            relaysStore.addDefaultRelays()
        }

        let relaysToConnect = relaysStore.allUrls
        let eventsBatch: NostrEvent[] = []

        pool.subscribeMany(relaysToConnect, [filter], {
            onevent(event) {
                if (eventsBatch.some(ev => ev.id === event.id)) {
                    log.warn(
                        Err.ALREADY_EXISTS_ERROR,
                        'Duplicate event received by this subscription, skipping...',
                        {id: event.id, created_at: event.created_at},
                    )
                    return
                }

                if (relaysStore.eventAlreadyReceived(event.id)) {
                    log.warn(
                        Err.ALREADY_EXISTS_ERROR,
                        'Event has been processed in the past, skipping...',
                        {id: event.id, created_at: event.created_at},
                    )
                    return
                }

                eventsBatch.push(event)
                relaysStore.addReceivedEventId(event.id)

                const now = new Date().getTime()
                SyncQueue.addTask(
                    `handleReceivedEventTask-${now}`,
                    async () => await handleReceivedEventTask(event),
                )
            },
            oneose() {
                log.trace('[receiveEventsFromRelays]', `Eose: Got ${eventsBatch.length} receive events`)

                const connections = pool.listConnectionStatus()
                for (const conn of Array.from(connections)) {
                    const relayInstance = relaysStore.findByUrl(conn[0])
                    if (conn[1] === true) {
                        log.trace('[receiveEventsFromRelays] Connection is OPEN', {conn: conn[0]})
                        relayInstance?.setStatus(WebSocket.OPEN)
                    } else {
                        log.trace('[receiveEventsFromRelays] Connection is CLOSED', {conn: conn[0]})
                        relayInstance?.setStatus(WebSocket.CLOSED)
                    }
                }
            },
        })

    } catch (e: any) {
        log.error(e.name, e.message)
    }
}

const handleReceivedEventTask = async function (encryptedEvent: NostrEvent): Promise<WalletTaskResult> {
    try {
        let directMessageEvent: NostrEvent | UnsignedEvent | undefined = undefined
        let decryptedMessage: string | undefined = undefined
        const keys = (await walletStore.getCachedWalletKeys()).NOSTR

        if (encryptedEvent.kind === EncryptedDirectMessage) {
            directMessageEvent = encryptedEvent
            decryptedMessage = await NostrClient.decryptNip04(encryptedEvent.pubkey, encryptedEvent.content, keys)
        }

        if (encryptedEvent.kind === GiftWrap) {
            directMessageEvent = await NostrClient.decryptDirectMessageNip17(encryptedEvent, keys)
            decryptedMessage = directMessageEvent.content
        }

        if (!directMessageEvent || !decryptedMessage) {
            throw new ValidationError('Unrecognized direct message kind', {kind: encryptedEvent.kind})
        }

        if (directMessageEvent.created_at < new Date().getTime() / 1000) {
            contactsStore.setLastPendingReceivedCheck(directMessageEvent.created_at)
        }

        log.trace('[handleReceivedEventTask]', 'Received event', {directMessageEvent})

        let sentFromPubkey = directMessageEvent.pubkey
        let sentFrom = NostrClient.getFirstTagValue(directMessageEvent.tags, 'from') as string | undefined
        let sentFromNpub = NostrClient.getNpubkey(sentFromPubkey)

        if (userSettingsStore.isReceiveOnlyFromContactsOn
            && sentFromPubkey !== MINIBIT_SERVER_NOSTR_PUBKEY) {

            const contactInstance = contactsStore.findByPubkey(sentFromPubkey)

            if (!contactInstance) {
                let message = 'Message received over Nostr has been blocked, the sender is not in your contacts.'
                log.error(message, {sentFromPubkey, sentFrom, decryptedMessage})

                return {
                    taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                    message,
                } as WalletTaskResult
            }
        }

        let contactFrom: Contact | undefined = undefined
        let zapSenderProfile: NostrProfile | undefined = undefined
        let sentFromPicture: string | undefined = undefined

        if (sentFrom
            && sentFrom.includes(MINIBITS_NIP05_DOMAIN)
            && userSettingsStore.isReceiveOnlyFromContactsOn === false
        ) {
            try {
                const nostrProfile = await NostrClient.getProfileFromRelays(sentFromPubkey, NostrClient.getMinibitsRelays())

                if (nostrProfile) {
                    log.info('[handleReceivedEventTask]', 'Event sent from Minibits server user, adding to contacts...', {sentFrom, sentFromPubkey})

                    const {nip05, lud16, name, picture} = nostrProfile
                    contactFrom = {
                        pubkey: sentFromPubkey,
                        npub: sentFromNpub,
                        nip05,
                        lud16,
                        name,
                        picture,
                        isExternalDomain: false,
                    } as Contact

                    contactsStore.addContact(contactFrom)
                }
            } catch (e: any) {
                log.error('[handleReceivedEventTask]', 'Failed to get sender profile from Minibits server, skipping adding to contacts...', {sentFrom, sentFromPubkey, message: e.message})
            }
        }

        if (sentFromPubkey === MINIBIT_SERVER_NOSTR_PUBKEY) {
            log.info('[handleReceivedEventTask]', 'Event sent from Minibits server, extracting zap sender profile...')

            const maybeZapSenderString = extractZapSenderData(decryptedMessage)

            if (maybeZapSenderString) {
                try {
                    zapSenderProfile = JSON.parse(maybeZapSenderString)

                    if (zapSenderProfile) {
                        sentFromPubkey = zapSenderProfile.pubkey
                        sentFrom = zapSenderProfile.nip05 ?? zapSenderProfile.name
                        sentFromPicture = zapSenderProfile.picture
                        const sentFromLud16 = zapSenderProfile.lud16

                        const contactInstance = contactsStore.findByPubkey(sentFromPubkey)
                        if (contactInstance && sentFromLud16) {
                            contactInstance.setLud16(sentFromLud16)
                        }
                    }
                } catch (e: any) {
                    log.warn('[handleReceivedEventTask]', 'Could not get sender from zapRequest', {message: e.message, maybeZapSenderString})
                }
            }
        }

        const incoming = IncomingParser.findAndExtract(decryptedMessage)

        log.trace('[handleReceivedEventTask]', 'Incoming data', {incoming})

        // Receive token
        if (incoming.type === IncomingDataType.CASHU) {

            const tokenInfo = getTokenMetadata(incoming.encoded)
            const amountToReceive = Number(tokenInfo.amount)
            const memo = tokenInfo.memo || 'Received over Nostr'
            const {unit, mint: mintUrl} = tokenInfo

            if (!mintsStore.mintExists(mintUrl)) {
                let message = 'Receiving ecash token over Nostr from unknown mint is not allowed.'

                const transactionData: TransactionData[] = []

                transactionData.push({
                    status: TransactionStatus.ERROR,
                    amountToReceive,
                    unit,
                    createdAt: new Date(),
                })

                const newTransaction = {
                    type: TransactionType.RECEIVE,
                    amount: amountToReceive,
                    fee: 0,
                    unit: unit as MintUnit,
                    data: JSON.stringify(transactionData),
                    memo,
                    mint: mintUrl,
                    status: TransactionStatus.DRAFT,
                }

                const transaction = await transactionsStore.addTransaction(newTransaction)
                transaction.update({inputToken: incoming.encoded})

                await sendErrorReceiveNotification(
                    amountToReceive,
                    unit as MintUnit,
                    mintUrl,
                )

                throw new ValidationError(message, {tokenInfo})
            }

            const mintKeysetIds = mintsStore.findByUrl(mintUrl)?.keysetIds
            if (!mintKeysetIds || mintKeysetIds.length === 0) {
                throw new ValidationError('Missing keysetIds in the wallet state', {
                    mintUrl: tokenInfo.mint,
                }, Err.NOTFOUND_ERROR)
            }

            const decoded = getDecodedToken(incoming.encoded, mintKeysetIds)

            const {transaction, receivedAmount} = await receiveTask(
                decoded,
                amountToReceive,
                memo,
                incoming.encoded as string,
            )

            if (transaction && sentFrom) {
                if (contactFrom) {
                    transaction.update({profile: JSON.stringify(contactFrom), sentFrom})
                }

                if (zapSenderProfile) {
                    transaction.update({profile: JSON.stringify(zapSenderProfile), sentFrom})
                }

                const isZap = zapSenderProfile ? true : false

                sendReceiveNotification(
                    transaction.amount,
                    transaction.fee,
                    transaction.unit,
                    isZap,
                    sentFrom,
                    sentFromPicture,
                )
            }

            return {
                mintUrl: decoded.mint,
                taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                message: 'Incoming ecash token has been received.',
                proofsCount: decoded.proofs.length,
                proofsAmount: receivedAmount,
                transaction,
            } as WalletTaskResult
        }

        // Receive bolt11 invoice
        else if (incoming.type === IncomingDataType.INVOICE) {
            const {
                pubkey,
                npub,
                name,
                picture,
            } = walletProfileStore

            const contactTo: Contact = {
                pubkey,
                npub,
                name,
                picture,
            }

            const decoded = LightningUtils.decodeInvoice(incoming.encoded)
            const {
                amount,
                description,
                expiry,
                payment_hash: paymentHash,
                timestamp,
            } = LightningUtils.getInvoiceData(decoded)

            const maybeMemo = NostrClient.findMemo(decryptedMessage)

            const defaultMintBalance: MintBalance | undefined = proofsStore.getMintBalanceWithMaxBalance('sat')

            if (!defaultMintBalance) {
                let message = 'Wallet does not have any mint with SATS unit.'
                throw new ValidationError(message, {decoded})
            }

            const transactionData: TransactionData[] = [
                {
                    status: TransactionStatus.DRAFT,
                    mintBalanceToTransferFrom: defaultMintBalance.mintUrl,
                    amountToTransfer: amount,
                    unit: 'sat',
                    isNwc: false,
                    createdAt: new Date(),
                },
            ]

            const newTransaction = {
                type: TransactionType.TRANSFER,
                amount,
                fee: 0,
                unit: 'sat' as MintUnit,
                data: JSON.stringify(transactionData),
                memo: maybeMemo || description,
                mint: defaultMintBalance.mintUrl,
                status: TransactionStatus.DRAFT,
            }

            const transaction = await transactionsStore.addTransaction(newTransaction)

            transaction.update({
                paymentId: paymentHash,
                paymentRequest: incoming.encoded,
                expiresAt: addSeconds(new Date(timestamp * 1000), expiry),
                profile: JSON.stringify(contactFrom),
                sentTo: contactFrom?.nip05 ?? contactFrom?.name,
                sentFrom: contactTo.nip05 ?? contactTo.name,
            })

            if (contactFrom) sendIncomingInvoiceNotification(amount, 'sat', contactFrom)

            return {
                mintUrl: '',
                taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                message: 'Incoming Lightning payment request been received.',
                proofsCount: 0,
                proofsAmount: amount,
            } as WalletTaskResult
        }

        // Receive cashu payment request to pay
        else if (incoming.type === IncomingDataType.CASHU_PAYMENT_REQUEST) {
            const {
                pubkey,
                npub,
                name,
                picture,
            } = walletProfileStore

            const contactTo: Contact = {
                pubkey,
                npub,
                name,
                picture,
            }

            const decoded = decodePaymentRequest(incoming.encoded)

            if (!decoded.amount || !decoded.unit) {
                let message = 'Cashu payment request is missing amount or unit.'
                throw new ValidationError(message, {decoded})
            }

            const {amount: rawAmount, unit, description, id, mints} = decoded
            const amount = Number(rawAmount)

            const availableBalances: MintBalance[] = []

            if (mints && mints.length > 0) {
                for (const mint of mints) {
                    if (mintsStore.mintExists(mint)) {
                        const mintBalance = proofsStore.getMintBalance(mint)
                        if (mintBalance) {
                            availableBalances.push(mintBalance)
                        }
                    }
                }
            } else {
                const mintBalance = proofsStore.getMintBalanceWithMaxBalance(unit as MintUnit)
                if (!mintBalance) {
                    let message = 'Wallet does not have any mint with this unit.'
                    throw new ValidationError(message, {decoded})
                }
                availableBalances.push(mintBalance)
            }

            if (availableBalances.length === 0) {
                let message = 'Wallet does not have any of the mints accepted by Cashu payment request.'
                throw new ValidationError(message, {decoded})
            }

            const transactionData: TransactionData[] = [{
                status: TransactionStatus.DRAFT,
                mintBalanceToSendFrom: availableBalances[0],
                amountToSend: amount,
                unit,
                createdAt: new Date(),
            }]

            const newTransaction = {
                type: TransactionType.SEND,
                amount,
                fee: 0,
                unit: unit as MintUnit,
                data: JSON.stringify(transactionData),
                memo: description,
                mint: availableBalances[0].mintUrl,
                status: TransactionStatus.DRAFT,
            }

            const transaction = await transactionsStore.addTransaction(newTransaction)
            transaction.update({
                paymentId: id,
                paymentRequest: incoming.encoded,
                profile: JSON.stringify(contactFrom),
                sentTo: contactFrom?.nip05 ?? contactFrom?.name,
                sentFrom: contactTo.nip05 ?? contactTo.name,
            })

            if (contactFrom) sendIncomingInvoiceNotification(amount, unit as MintUnit, contactFrom)

            return {
                mintUrl: '',
                taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                message: 'Incoming Cashu payment request been received.',
                proofsCount: 0,
                proofsAmount: amount,
            } as WalletTaskResult
        }

        // Receive ecash from paid cashu payment request
        else if (incoming.type === IncomingDataType.CASHU_PAYMENT_REQUEST_PAYLOAD) {
            const decoded: PaymentRequestPayload = JSON.parse(incoming.encoded)
            log.trace('[handleReceivedEventTask]', 'Decoded payment request payload', {decoded})

            const {transaction, receivedAmount, message} = await receiveByCashuPaymentRequestTask(
                decoded,
            )

            if (transaction && sentFrom) {
                if (contactFrom) {
                    transaction.update({profile: JSON.stringify(contactFrom), sentFrom})
                }

                transaction.update({paymentId: decoded.id})

                sendReceiveNotification(
                    transaction.amount,
                    transaction.fee,
                    transaction.unit,
                    false,
                    sentFrom,
                    sentFromPicture,
                )
            }

            return {
                mintUrl: decoded.mint,
                taskFunction: HANDLE_RECEIVED_EVENT_TASK,
                message,
                proofsCount: decoded.proofs.length,
                proofsAmount: receivedAmount,
                transaction,
            } as WalletTaskResult
        }
        else if (incoming.type === IncomingDataType.LNURL) {
            throw new ValidationError('LNURL support is not yet implemented.', {caller: HANDLE_RECEIVED_EVENT_TASK}, Err.NOTFOUND_ERROR)
        } else {
            throw new ValidationError('Received unknown event message', {caller: HANDLE_RECEIVED_EVENT_TASK, incoming}, Err.NOTFOUND_ERROR)
        }
    } catch (e: any) {
        // Catch-all error path needs a mintUrl to satisfy the TransactionTaskResult
        // shape registered for ev_handleReceivedEventTask_result. The empty string
        // is fine here — the caller wraps this in a WalletTaskResult-aware UI.
        return {
            mintUrl: '',
            taskFunction: HANDLE_RECEIVED_EVENT_TASK,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}

export const NostrOperationService = {
    handleClaimQueue,
    handleClaimTask,
    handleNwcRequestQueue,
    receiveEventsFromRelaysQueue,
    handleReceivedEventTask,
}
