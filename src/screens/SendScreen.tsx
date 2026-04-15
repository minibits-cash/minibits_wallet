import {observer} from 'mobx-react-lite'
import React, {
  useEffect,
  useState,
  useReducer,
  useCallback,
  useRef,
} from 'react'
import {StackActions, StaticScreenProps, useFocusEffect, useNavigation} from '@react-navigation/native'
import {
  TextInput,
  TextStyle,
  View,
  ViewStyle,
  LayoutAnimation,
  ScrollView,
  FlatList,
  ImageStyle,  
  Pressable,
} from 'react-native'
import {spacing, typography, useThemeColor, colors} from '../theme'
import {
  Button,
  Icon,
  Card,
  Screen,
  Loading,
  InfoModal,
  ErrorModal,
  BottomModal,
  Text,
  AmountInput,  
} from '../components'
import {TransactionStatus, Transaction, TransactionData} from '../models/Transaction'
import {useStores} from '../models'
import {NostrClient, SYNC_STATE_WITH_MINT_TASK, SyncStateTaskResult, TransactionTaskResult, WalletTask} from '../services'
import {log} from '../services/logService'
import AppError, {Err} from '../utils/AppError'
import {translate} from '../i18n'
import {MintBalance} from '../models/Mint'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { Proof } from '../models/Proof'
import { Contact, ContactType } from '../models/Contact'
import { getImageSource, infoMessage } from '../utils/utils'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { MintUnit, MintUnits, formatCurrency, getCurrency } from "../services/wallet/currency"
import { MintHeader } from './Mints/MintHeader'
import { MintBalanceSelector } from './Mints/MintBalanceSelector'
import { round, toNumber } from '../utils/number'
import { QRCodeBlock } from './Wallet/QRCode'
import numbro from 'numbro'
import { TranItem } from './TranDetailScreen'
import { MemoInputCard } from '../components/MemoInputCard'
import { PaymentRequest as CashuPaymentRequest, PaymentRequestTransport, PaymentRequestTransportType, decodePaymentRequest, getDecodedToken } from '@cashu/cashu-ts'
import { ProfilePointer } from 'nostr-tools/nip19'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import FastImage from 'react-native-fast-image'
import { CurrencyAmount } from './Wallet/CurrencyAmount'
import { CashuUtils } from '../services/cashu/cashuUtils'
import Clipboard from '@react-native-clipboard/clipboard'
import { getUnixTime } from 'date-fns'
import { MinibitsClient } from '../services/minibitsService'

export enum SendOption {
    SEND_TOKEN = 'SEND_TOKEN',    
    SHOW_TOKEN = 'SHOW_TOKEN',
    PAY_CASHU_PAYMENT_REQUEST = 'PAY_CASHU_PAYMENT_REQUEST',
}

type Props = StaticScreenProps<{
    unit: MintUnit,
    paymentOption?: SendOption,
    encodedCashuPaymentRequest?: string,
    draftTransactionId?: number,
    contact?: Contact,
    mintUrl?: string,
    scannedPubkey?: string 
}>

// ─── State machine ──────────────────────────────────────────────────────────

type ModalVisibility = {
    mintSelector: boolean
    nostrDM: boolean
    post: boolean
    proofSelector: boolean
    pubkeySelector: boolean
    result: boolean
}

type TransportProgress = {
    nostrDM: { sending: boolean; success: boolean }
    post: { sending: boolean; success: boolean }
}

type SendState = {
    // Payment setup
    paymentOption: SendOption
    encodedTokenToSend: string | undefined
    encodedCashuPaymentRequest: string | undefined
    decodedCashuPaymentRequest: CashuPaymentRequest | undefined
    availableMintBalances: MintBalance[]
    mintBalanceToSendFrom: MintBalance | undefined
    selectedProofs: Proof[]
    // Contacts / routing
    contactToSendFrom: Contact | undefined
    contactToSendTo: Contact | undefined
    relaysToShareTo: string[]
    postEndpointUrl: string | undefined
    // Transaction outcome
    transaction: Transaction | undefined
    transactionId: number | undefined
    transactionStatus: TransactionStatus | undefined
    resultModalInfo: { status: TransactionStatus; title?: string; message: string } | undefined
    // UI
    isLoading: boolean
    modals: ModalVisibility
    transport: TransportProgress
    // Feedback
    info: string
    error: AppError | undefined
}

type SendAction =
    | { type: 'PREPARE_SEND_TO_CONTACT'; contactFrom: Contact; contactTo: Contact; relays: string[]; openNostrDM: boolean }
    | { type: 'PREPARE_CASHU_PR'; encoded: string; decoded: CashuPaymentRequest; contactFrom: Contact; contactTo?: Contact; relays: string[]; postUrl?: string; availableBalances: MintBalance[]; defaultBalance?: MintBalance }
    | { type: 'SET_MINT_BALANCE'; balance: MintBalance }
    | { type: 'SET_AVAILABLE_BALANCES'; balances: MintBalance[]; defaultBalance?: MintBalance; showMintSelector?: boolean }
    | { type: 'SET_SELECTED_PROOFS'; proofs: Proof[] }
    | { type: 'SEND_START' }
    | { type: 'SEND_TASK_SUCCESS'; token: string; transaction: Transaction; openTransport: 'nostrDM' | 'post' | 'none' }
    | { type: 'SEND_TASK_ERROR'; status: TransactionStatus; title: string; message: string }
    | { type: 'SYNC_COMPLETED'; title: string; message: string }
    | { type: 'SYNC_ERROR'; message: string }
    | { type: 'OPEN_RESULT_MODAL' }
    | { type: 'TRANSPORT_START'; channel: 'nostrDM' | 'post' }
    | { type: 'TRANSPORT_SUCCESS'; channel: 'nostrDM' | 'post' }
    | { type: 'TRANSPORT_RESET'; channel: 'nostrDM' | 'post' }
    | { type: 'TOGGLE_MODAL'; modal: keyof ModalVisibility }
    | { type: 'OPEN_MODAL'; modal: keyof ModalVisibility }
    | { type: 'CLOSE_MODAL'; modal: keyof ModalVisibility }
    | { type: 'CLEAR_CONTACT_TO' }
    | { type: 'SET_INFO'; message: string }
    | { type: 'CLEAR_INFO' }
    | { type: 'SET_ERROR'; error: AppError }
    | { type: 'RESET' }

const INITIAL_MODALS: ModalVisibility = {
    mintSelector: false,
    nostrDM: false,
    post: false,
    proofSelector: false,
    pubkeySelector: false,
    result: false,
}

const INITIAL_TRANSPORT: TransportProgress = {
    nostrDM: { sending: false, success: false },
    post: { sending: false, success: false },
}

const INITIAL_STATE: SendState = {
    paymentOption: SendOption.SHOW_TOKEN,
    encodedTokenToSend: undefined,
    encodedCashuPaymentRequest: undefined,
    decodedCashuPaymentRequest: undefined,
    availableMintBalances: [],
    mintBalanceToSendFrom: undefined,
    selectedProofs: [],
    contactToSendFrom: undefined,
    contactToSendTo: undefined,
    relaysToShareTo: [],
    postEndpointUrl: undefined,
    transaction: undefined,
    transactionId: undefined,
    transactionStatus: undefined,
    resultModalInfo: undefined,
    isLoading: false,
    modals: INITIAL_MODALS,
    transport: INITIAL_TRANSPORT,
    info: '',
    error: undefined,
}

function sendReducer(state: SendState, action: SendAction): SendState {
    switch (action.type) {

        case 'PREPARE_SEND_TO_CONTACT':
            return {
                ...state,
                paymentOption: SendOption.SEND_TOKEN,
                contactToSendFrom: action.contactFrom,
                contactToSendTo: action.contactTo,
                relaysToShareTo: action.relays,
                modals: { ...state.modals, nostrDM: action.openNostrDM || state.modals.nostrDM },
            }

        case 'PREPARE_CASHU_PR':
            return {
                ...state,
                paymentOption: SendOption.PAY_CASHU_PAYMENT_REQUEST,
                contactToSendFrom: action.contactFrom,
                contactToSendTo: action.contactTo,
                encodedCashuPaymentRequest: action.encoded,
                decodedCashuPaymentRequest: action.decoded,
                relaysToShareTo: action.relays,
                postEndpointUrl: action.postUrl,
                availableMintBalances: action.availableBalances,
                mintBalanceToSendFrom: action.defaultBalance ?? state.mintBalanceToSendFrom,
                modals: { ...state.modals, mintSelector: true },
            }

        case 'SET_MINT_BALANCE':
            return { ...state, mintBalanceToSendFrom: action.balance }

        case 'SET_AVAILABLE_BALANCES':
            return {
                ...state,
                availableMintBalances: action.balances,
                mintBalanceToSendFrom: action.defaultBalance !== undefined
                    ? action.defaultBalance
                    : state.mintBalanceToSendFrom,
                modals: action.showMintSelector !== undefined
                    ? { ...state.modals, mintSelector: action.showMintSelector }
                    : state.modals,
            }

        case 'SET_SELECTED_PROOFS':
            return { ...state, selectedProofs: action.proofs }

        case 'SEND_START':
            return { ...state, isLoading: true }

        case 'SEND_TASK_SUCCESS':
            return {
                ...state,
                isLoading: false,
                encodedTokenToSend: action.token,
                transaction: action.transaction,
                transactionId: action.transaction.id,
                transactionStatus: action.transaction.status,
                modals: {
                    ...state.modals,
                    mintSelector: false,
                    nostrDM: action.openTransport === 'nostrDM',
                    post: action.openTransport === 'post',
                },
            }

        case 'SEND_TASK_ERROR':
            return {
                ...state,
                isLoading: false,
                resultModalInfo: { status: action.status, title: action.title, message: action.message },
                modals: { ...state.modals, result: true },
            }

        case 'SYNC_COMPLETED':
            return {
                ...state,
                transactionStatus: TransactionStatus.COMPLETED,
                resultModalInfo: {
                    status: TransactionStatus.COMPLETED,
                    title: action.title,
                    message: action.message,
                },
                modals: { ...state.modals, nostrDM: false, proofSelector: false },
            }

        case 'SYNC_ERROR':
            return {
                ...state,
                transactionStatus: TransactionStatus.ERROR,
                resultModalInfo: {
                    status: TransactionStatus.ERROR,
                    title: 'Send failed',
                    message: action.message,
                },
                modals: { ...state.modals, nostrDM: false, proofSelector: false },
            }

        case 'OPEN_RESULT_MODAL':
            return { ...state, modals: { ...state.modals, result: true } }

        case 'TRANSPORT_START':
            return {
                ...state,
                transport: { ...state.transport, [action.channel]: { sending: true, success: false } },
            }

        case 'TRANSPORT_SUCCESS':
            return {
                ...state,
                transport: { ...state.transport, [action.channel]: { sending: false, success: true } },
            }

        case 'TRANSPORT_RESET':
            return {
                ...state,
                transport: { ...state.transport, [action.channel]: { sending: false, success: false } },
            }

        case 'TOGGLE_MODAL':
            return { ...state, modals: { ...state.modals, [action.modal]: !state.modals[action.modal] } }

        case 'OPEN_MODAL':
            return { ...state, modals: { ...state.modals, [action.modal]: true } }

        case 'CLOSE_MODAL':
            return { ...state, modals: { ...state.modals, [action.modal]: false } }

        case 'CLEAR_CONTACT_TO':
            return { ...state, contactToSendTo: undefined }

        case 'SET_INFO':
            return { ...state, info: action.message }

        case 'CLEAR_INFO':
            return { ...state, info: '' }

        case 'SET_ERROR':
            return {
                ...state,
                isLoading: false,
                // Reset mint-selection data so stale balances from a prior amount-entry flow
                // can never show through after an error
                availableMintBalances: [],
                mintBalanceToSendFrom: undefined,
                transport: {
                    nostrDM: { sending: false, success: state.transport.nostrDM.success },
                    post: { sending: false, success: state.transport.post.success },
                },
                modals: {
                    ...state.modals,
                    mintSelector: false,
                    nostrDM: false,
                    proofSelector: false,
                    post: false,
                },
                error: action.error,
            }

        case 'RESET':
            return { ...INITIAL_STATE }

        default:
            return state
    }
}

// ────────────────────────────────────────────────────────────────────────────

export const SendScreen = observer(function SendScreen({ route }: Props) {
    const navigation = useNavigation()
    const isInternetReachable = useIsInternetReachable()

    const {
        proofsStore, 
        walletProfileStore, 
        transactionsStore, 
        mintsStore, 
        relaysStore,
        walletStore,
        contactsStore,
    } = useStores()

    const amountInputRef = useRef<TextInput>(null)
    const memoInputRef = useRef<TextInput>(null)
    const pubkeyInputRef = useRef<TextInput>(null) // Initialize pubkeyInputRef
    const unitRef = useRef<MintUnit>('sat')
    const draftTransactionIdRef = useRef<number>(null)
    const isOnlineRef = useRef<boolean>(false)
    const hasBeenOfflineRef = useRef<boolean>(false)

    
    const [state, dispatch] = useReducer(sendReducer, INITIAL_STATE)
    // User-input state kept separate to avoid rebuilding the full state object on every keystroke.
    // isCashuPrWithAmount / isCashuPrWithDesc also live here so they are set atomically with
    // amountToSend / memo in handlePaymentRequest — before any validation that can throw — making
    // the amount and memo inputs read-only immediately even if later validation fails.
    const [amountToSend, setAmountToSend] = useState<string>('0')
    const [memo, setMemo] = useState('')
    const [isCashuPrWithAmount, setIsCashuPrWithAmount] = useState(false)
    const [isCashuPrWithDesc, setIsCashuPrWithDesc] = useState(false)
    const [lockedPubkey, setLockedPubkey] = useState<string | undefined>()
    const [lockTime, setLockTime] = useState<number | undefined>(1)
    const [isOnline, setIsOnline] = useState(false)

    // Destructure for ergonomic access throughout the component.
    // Modal and transport booleans are aliased to preserve the existing variable names
    // used in the JSX and callbacks, so no further renames are needed below.
    const {
        paymentOption,
        encodedTokenToSend,
        encodedCashuPaymentRequest,
        decodedCashuPaymentRequest,
        mintBalanceToSendFrom,
        availableMintBalances,
        selectedProofs,
        contactToSendFrom,
        contactToSendTo,
        relaysToShareTo,
        postEndpointUrl,
        transaction,
        transactionId,
        transactionStatus,
        resultModalInfo,
        isLoading,
        info,
        error,
        modals: {
            mintSelector: isMintSelectorVisible,
            nostrDM: isNostrDMModalVisible,
            post: isPostModalVisible,
            proofSelector: isProofSelectorModalVisible,
            pubkeySelector: isPubkeySelectorModalVisible,
            result: isResultModalVisible,
        },
        transport: {
            nostrDM: { sending: isNostrDMSending, success: isNostrDMSuccess },
            post: { sending: isPostSending, success: isPostSuccess },
        },
    } = state

    /* 
        This ensures that amount input get focus on screen load.
        Delay is needed to make it work reliably.
    */
    useEffect(() => {
        const focus = () => {
            amountInputRef && amountInputRef.current
            ? amountInputRef.current.focus()
            : false
        }        
        const timer = setTimeout(() => focus(), 400)        
        return () => {
            clearTimeout(timer)
        }
    }, [])


    /* 
        Sets unit and mint (if provided) from route params on screen load, as ref variables.
    */
    useEffect(() => {
        const setUnitAndMint = () => {
            try {
                const {unit, mintUrl} = route.params
                if(!unit) {
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing mint unit in route params')
                }

                unitRef.current = unit

                if(mintUrl) {
                    const mintBalance = proofsStore.getMintBalance(mintUrl)
                    dispatch({ type: 'SET_MINT_BALANCE', balance: mintBalance! })
                    log.trace('[setUnitAndMint] mintBalanceToSendFrom', mintBalance)
                }
            } catch (e: any) {
                handleError(e)
            }
        }
        
        setUnitAndMint()
        return () => {}
    }, [])


    const getContactFrom = () => {
        const {
            pubkey,
            npub,
            name,
            picture,
        } = walletProfileStore

        return {
            pubkey,
            npub,
            name,
            picture
        } as Contact
    }


    useFocusEffect(
        useCallback(() => {

            const {paymentOption, contact} = route.params

            /* 
                If screen gets navigated back from contact list (Send to contact) 
                with paymentOption and contact in route params, prepare to send token to the selected contact.
            */
            const prepareSendToContact = () => {
                try {
                    let relays: string[] = []
                    log.trace('[prepareSendToContact] selected contact', contact, paymentOption)

                    if(contact?.type === ContactType.PUBLIC) {
                        relays = relaysStore.allPublicUrls
                    } else {
                        relays = relaysStore.allUrls
                    }

                    if (relays.length === 0) {
                        throw new AppError(Err.VALIDATION_ERROR, 'Missing NOSTR relays')
                    }

                    dispatch({
                        type: 'PREPARE_SEND_TO_CONTACT',
                        contactFrom: getContactFrom(),
                        contactTo: contact!,
                        relays,
                        openNostrDM: !!encodedTokenToSend,
                    })

                    //@ts-ignore
                    navigation.setParams({ paymentOption: undefined, contact: undefined })

                } catch(e: any) {
                    handleError(e)
                }
            }
            
            /* 
                If route params have paymentOption to pay a Cashu payment request, decode it and prepare the send payment.                
            */
            const handlePaymentRequest = async () => {
                try {
                    const {encodedCashuPaymentRequest: encodedPR, draftTransactionId} = route.params

                    if(draftTransactionId) {
                        draftTransactionIdRef.current = draftTransactionId
                    }

                    if (!encodedPR) {
                        throw new AppError(Err.VALIDATION_ERROR, 'Missing encodedCashuPaymentRequest.')
                    }

                    const pr: CashuPaymentRequest = decodePaymentRequest(encodedPR)
                    log.trace('[handlePaymentRequest] decoded payment request', pr)

                    if(!pr.transport || pr.transport.length === 0) {
                        throw new AppError(Err.VALIDATION_ERROR,
                            'Payment request can not be paid as it does not have any transport defined.',
                            {caller: 'handlePaymentRequest', paymentRequest: pr}
                        )
                    }

                    const transports: PaymentRequestTransport[] = pr.transport

                    // Resolve transport: collect into locals, dispatch once at the end
                    let resolvedContactTo: Contact | undefined
                    let resolvedRelays: string[] = []
                    let resolvedPostUrl: string | undefined

                    const nostrTransport = transports.find(t => t.type === PaymentRequestTransportType.NOSTR)
                    if (nostrTransport) {
                        const decoded = NostrClient.decodeNprofile(nostrTransport.target)
                        const pubkey = (decoded.data as ProfilePointer).pubkey
                        const npub = NostrClient.getNpubkey(pubkey)
                        let relays = (decoded.data as ProfilePointer).relays?.slice(0, 5)

                        if(!relays || relays.length === 0) {
                            relays = NostrClient.getAllRelays()
                        }

                        let contactTo = { pubkey, npub } as Contact

                        const existing = contactsStore.findByPubkey(pubkey)
                        if(!existing) {
                            try {
                                const profile = await NostrClient.getProfileFromRelays(pubkey, relays)
                                if(profile) {
                                    contactTo.nip05 = profile.nip05
                                    contactTo.picture = profile.picture
                                    contactTo.lud16 = profile.lud16
                                    contactTo.name = profile.name
                                    contactTo.isExternalDomain = profile.nip05.includes(MINIBITS_NIP05_DOMAIN) ? false : true
                                    contactsStore.addContact(contactTo)
                                }
                            } catch (e:any) {
                                log.warn('[handlePaymentRequest] Could not get the payee profile from relays.')
                            }
                        } else {
                            contactTo = existing
                        }

                        resolvedContactTo = contactTo
                        resolvedRelays = relays
                    } else {
                        const postTransport = transports.find(t => t.type === PaymentRequestTransportType.POST)
                        if (postTransport) {
                            resolvedPostUrl = postTransport.target
                        } else {
                            throw new AppError(Err.VALIDATION_ERROR, 'Payment request only supports NOSTR or POST transports, but neither is available.')
                        }
                    }

                    log.trace('[handlePaymentRequest]', {pr})

                    if(pr.unit && !MintUnits.includes(pr.unit as MintUnit)) {
                        throw new AppError(Err.VALIDATION_ERROR, `Wallet does not support ${pr.unit} unit.`)
                    }

                    if (pr.unit) {
                        unitRef.current = pr.unit as MintUnit
                    }

                    // Set amount and memo from PR before any validation that can throw,
                    // so the inputs are locked read-only even if later validation fails.
                    if (pr.description && pr.description.length > 0) {
                        setMemo(pr.description)
                        setIsCashuPrWithDesc(true)
                    }

                    if (pr.amount) {
                        setAmountToSend(`${numbro(pr.amount / getCurrency(unitRef.current).precision).format({
                            thousandSeparated: true,
                            mantissa: getCurrency(unitRef.current).mantissa,
                        })}`)
                        setIsCashuPrWithAmount(true)
                    }

                    // Resolve available balances
                    let withEnoughBalance: MintBalance[] = []

                    if (pr.mints && pr.mints.length > 0) {
                        const availableBalances: MintBalance[] = []
                        for (const mint of pr.mints) {
                            if (mintsStore.mintExists(mint)) {
                                availableBalances.push(proofsStore.getMintBalance(mint)!)
                            }
                        }

                        if (availableBalances.length === 0) {
                            dispatch({ type: 'SET_INFO', message: 'None of the mints accepted by this payment request are in your wallet.' })
                            //infoMessage('None of the mints accepted by this payment request are in your wallet.')
                            return
                            //throw new AppError(Err.VALIDATION_ERROR, 'None of the mints accepted by this payment request are in your wallet.', {mints: pr.mints})
                        }

                        withEnoughBalance = availableBalances.filter(balance => {
                            const unitBalance = balance.balances[unitRef.current]
                            if(!pr.amount) return balance
                            if(pr.amount > 0 && unitBalance && unitBalance >= pr.amount) return balance
                            return null
                        })

                        if (pr.amount && withEnoughBalance.length === 0) {
                            dispatch({ type: 'SET_INFO', message: `Not enough balance to pay this payment request. Required: ${pr.amount} ${unitRef.current}.`})
                            //infoMessage(`Not enough balance to pay this payment request. Required: ${pr.amount} ${unitRef.current}.`)
                            return
                            //throw new AppError(Err.VALIDATION_ERROR, `Not enough balance to pay this payment request. Required: ${pr.amount} ${unitRef.current}.`)
                        }

                        log.trace('[handlePaymentRequest] available mint balances for this payment request', {availableBalances, withEnoughBalance})
                    } else {
                        withEnoughBalance = (pr.amount && pr.amount > 0)
                            ? proofsStore.getMintBalancesWithEnoughBalance(pr.amount, unitRef.current)
                            : proofsStore.getMintBalancesWithUnit(unitRef.current)
                    }

                    // Single atomic dispatch — replaces ~10 scattered setters
                    dispatch({
                        type: 'PREPARE_CASHU_PR',
                        encoded: encodedPR,
                        decoded: pr,
                        contactFrom: getContactFrom(),
                        contactTo: resolvedContactTo,
                        relays: resolvedRelays,
                        postUrl: resolvedPostUrl,
                        availableBalances: withEnoughBalance,
                        defaultBalance: withEnoughBalance[0],
                    })

                    //@ts-ignore
                    navigation.setParams({ paymentOption: undefined, encodedCashuPaymentRequest: undefined })

                } catch(e: any) {
                    handleError(e)
                }
            }  

            if(paymentOption && contact && paymentOption === SendOption.SEND_TOKEN) {
                prepareSendToContact()
            }

            if(paymentOption && paymentOption === SendOption.PAY_CASHU_PAYMENT_REQUEST) {   
                handlePaymentRequest()
            }
            
        }, [route.params?.paymentOption])
    )

    /* 
        Navigating back to the Send screen from scannning a pubkey to lock ecash token to.
    */
    useEffect(() => {   
        const {scannedPubkey} = route.params
        log.trace('[useEffect]', scannedPubkey)

        const handleScannedPubkey = () => {
            setLockedPubkey(scannedPubkey)
            dispatch({ type: 'OPEN_MODAL', modal: 'pubkeySelector' })
        }

        if(scannedPubkey) {
            handleScannedPubkey()
        }        
    }, [route.params?.scannedPubkey])
    

    /*
        Set ref and state variable based on network connectivity change.
        Reset mint selector to all mints if device is offline, to allow any manual ecash note selection
    */
    useEffect(() => {
        if (isInternetReachable !== null) {
            // Update ref immediately (for use in handlers/async)
            isOnlineRef.current = isInternetReachable

            // Only update state if it's a real change → triggers re-render
            if (isInternetReachable !== isOnline) {
                log.trace('[isOnline] status change', {isInternetReachable})
                setIsOnline(isInternetReachable)

                if(isInternetReachable) {
                    // Only clear info if the user was actually offline — skip the initial null→true mount transition
                    if (hasBeenOfflineRef.current) {
                        dispatch({ type: 'CLEAR_INFO' })
                        hasBeenOfflineRef.current = false
                    }
                } else {
                    hasBeenOfflineRef.current = true
                    const availableBalances = proofsStore.getMintBalancesWithEnoughBalance(1, unitRef.current)

                    if (availableBalances.length === 0) {
                        dispatch({ type: 'SET_INFO', message: 'Not enough funds to send' })
                        return
                    }
                    dispatch({ type: 'SET_AVAILABLE_BALANCES', balances: availableBalances })
                }
            }
        }
    }, [isInternetReachable])

    // ====================== Sync State Result Listener ======================
    /* 
        Reacts to event emitted by the SyncStateWithMintTask that is triggered by web socket or poller check
        on sent proofs state with the mint after a send action, in order
        to detect when the sent tokens were swapped ny the recepient (i.e become spent). Updates UI accordingly.
        
        Event handling is somehow complex as we want to keep listening for the result or to reliably  when needed.
    */
    const handleSyncStateResult = useCallback(
        async (result: SyncStateTaskResult) => {
            log.trace('[SendScreen] handleSyncStateResult triggered', { result, transactionId })

            if (!transactionId) return

            const { completedTransactionIds, errorTransactionIds, transactionStateUpdates } = result

            if (completedTransactionIds?.includes(transactionId)) {
                log.trace('[SendScreen] Ecash claimed successfully', { transactionId })

                const amountSentInt = Math.round(
                    toNumber(amountToSend || '0') * getCurrency(unitRef.current).precision
                )
                const currency = getCurrency(unitRef.current)

                // Close nostrDM modal + set result info atomically; delay result modal for animation
                dispatch({
                    type: 'SYNC_COMPLETED',
                    title: '🚀 That was fast!',
                    message: `${formatCurrency(amountSentInt, currency.code)} ${currency.code} were received by the payee.`,
                })
                setTimeout(() => dispatch({ type: 'OPEN_RESULT_MODAL' }), 500)
                return
            }

            if (errorTransactionIds?.includes(transactionId)) {
                log.trace('[SendScreen] Sync error detected', { transactionId })

                const update = transactionStateUpdates?.find(u => u.tId === transactionId)
                const message = update?.message || 'Transaction failed to complete on the mint.'

                dispatch({ type: 'SYNC_ERROR', message })
                setTimeout(() => dispatch({ type: 'OPEN_RESULT_MODAL' }), 300)
            }
        },
        [transactionId, amountToSend],
    );

    const syncStateListenerRef = useRef<((r: SyncStateTaskResult) => void) | null>(null);

    useEffect(() => {
        // Clean up early if no transactionId
        if (!transactionId) {
            if (syncStateListenerRef.current) {
                EventEmitter.off(`ev_${SYNC_STATE_WITH_MINT_TASK}_result`, syncStateListenerRef.current);
                syncStateListenerRef.current = null;
            }
            return;
        }
    
        const eventName = `ev_${SYNC_STATE_WITH_MINT_TASK}_result`;
    
        // Remove any previous listener (in case deps changed)
        if (syncStateListenerRef.current) {
            EventEmitter.off(eventName, syncStateListenerRef.current);
        }
    
        const handler = (result: SyncStateTaskResult) => {
            handleSyncStateResult(result);
    
            // "keep listening" for poller if our transaction is still pending
            const shouldStaySubscribed = (() => {
                const {transactionStateUpdates} = result

                if(transactionStateUpdates.length === 0) {
                    return true
                } else {
                    return false
                }
            })();
    
            // Only unsubscribe if the condition is NOT met
            if (!shouldStaySubscribed) {
                EventEmitter.off(eventName, handler);
                syncStateListenerRef.current = null;
            }
            // If shouldStaySubscribed === true → we keep the handler attached
        };
    
        syncStateListenerRef.current = handler;
        EventEmitter.on(eventName, handler);
    
        // Cleanup on unmount or when transactionId/handleSyncStateResult changes
        return () => {
            if (syncStateListenerRef.current) {
                EventEmitter.off(eventName, syncStateListenerRef.current);
                syncStateListenerRef.current = null;
            }
        };
    }, [transactionId, handleSyncStateResult]);
       
    const toggleNostrDMModal = () => dispatch({ type: 'TOGGLE_MODAL', modal: 'nostrDM' })
    const toggleProofSelectorModal = () => dispatch({ type: 'TOGGLE_MODAL', modal: 'proofSelector' })
    const toggleResultModal = () => {
        log.warn('[toggleResultModal] start', isResultModalVisible)
        dispatch({ type: 'TOGGLE_MODAL', modal: 'result' })
    }
    const togglePubkeySelectorModal = () => dispatch({ type: 'TOGGLE_MODAL', modal: 'pubkeySelector' })
    const togglePostModal = () => dispatch({ type: 'TOGGLE_MODAL', modal: 'post' })

    /*  
        Amount shown on screen is formatted string, internal currency amounts are integer with precision based on mint unit, 
        so we need to validate and convert the amount string before using it for any logic. 
    */
    const validateAndProcessAmount = function (amountString: string, unit: MintUnit) {
        // Normalize empty string to "0"
        const normalizedAmount = amountString.trim() === "" ? "0" : amountString.trim()

        const precision = getCurrency(unit).precision
        const amount = round(toNumber(normalizedAmount) * precision, 0)

        const isValid = typeof amount === "number" && !Number.isNaN(amount) && amount > 0

        return {
        amount: isValid ? amount : 0,
        amountString: normalizedAmount
        }
    }

    /*  
        Shows mint selector after amount input is validated and processed, 
        to allow user to select mint balance to send from based on the entered amount.
    */
    const onAmountEndEditing = function () {
        try {
        const { amount, amountString } = validateAndProcessAmount(amountToSend, unitRef.current)
        log.trace('[onAmountEndEditing]', amount, amountString)

        if (amount && amount > 0) {

            const availableBalances = proofsStore.getMintBalancesWithEnoughBalance(amount, unitRef.current)

            if (availableBalances.length === 0) {
                log.trace('[onAmountEndEditing] payCommon_insufficientFunds')
                infoMessage(translate('payCommon_insufficientFunds'))
                return
            }

            // Default mint if not set from route params is the one with the highest balance
            dispatch({
                type: 'SET_AVAILABLE_BALANCES',
                balances: availableBalances,
                defaultBalance: mintBalanceToSendFrom ? undefined : availableBalances[0],
                showMintSelector: true,
            })

            LayoutAnimation.easeInEaseOut()

        } else {
            infoMessage(translate('payCommon_amountZeroOrNegative'))
            return
        }
        } catch (e: any) {
        handleError(e)
        }
    }
  

    const onMemoEndEditing = function () {
        LayoutAnimation.easeInEaseOut()
        if (availableMintBalances.length > 0) {
            dispatch({ type: 'OPEN_MODAL', modal: 'mintSelector' })
        }
    }

    /*  
        Deselects amount and memo if amount is already filled in and user confirms the memo input.
    */
    const onMemoDone = function () {
        if (parseInt(amountToSend) > 0) {
        memoInputRef && memoInputRef.current
            ? memoInputRef.current.blur()
            : false
        amountInputRef && amountInputRef.current
            ? amountInputRef.current.blur()
            : false
        onMemoEndEditing()
        } else {
        amountInputRef && amountInputRef.current
            ? amountInputRef.current.focus()
            : false
        }
    }


    const onMintBalanceSelect = function (balance: MintBalance) {
        dispatch({ type: 'SET_MINT_BALANCE', balance })
    }


    const onLockPubkeyStart = function () {
        togglePubkeySelectorModal()
    }

    /*  
        Confirms the selected pubkey to lock the sent tokens to, validates it and prepares the send to contact flow 
        if the key belongs to a known contact in the wallet.
    */
    const onLockPubkeySelect = function () {
        if (!lockedPubkey || lockedPubkey.length === 0) {
            onLockPubkeyCancel()
            return
        }

        if (lockedPubkey.startsWith('nsec')) {
            throw new AppError(Err.VALIDATION_ERROR, 'Invalid key. Please provide public key in NPUB or HEX format.')
        }

        const contact = contactsStore.findByNpub(lockedPubkey) || contactsStore.findByPubkey(lockedPubkey)

        if (contact) {
            log.trace('[onLockPubkeySelect] Provided pubkey belongs to a contact', { contactName: contact.name })
            let relays: string[] = []

            if (contact?.type === ContactType.PUBLIC) {
                relays = relaysStore.allPublicUrls
            } else {
                relays = relaysStore.allUrls
            }

            if (relays.length === 0) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing NOSTR relays')
            }

            dispatch({
                type: 'PREPARE_SEND_TO_CONTACT',
                contactFrom: getContactFrom(),
                contactTo: contact,
                relays,
                openNostrDM: false,
            })
        }

        dispatch({ type: 'CLOSE_MODAL', modal: 'pubkeySelector' })
    }

    const onLockPubkeyCancel = function () {
        dispatch({ type: 'CLOSE_MODAL', modal: 'pubkeySelector' })
        dispatch({ type: 'CLEAR_CONTACT_TO' })
        setLockedPubkey(undefined)
    }

    /*  
        Create token press - validates all inputs, including the optional locked pubkey, 
        prepares proofs to send based on the entered amount and selected mint balance.
        
        Handles proofs selection in offline mode when exact amount match is not available, by showing the proof selector modal.     
    */
    const onMintBalanceConfirm = async function () {
        try {
            if(!mintBalanceToSendFrom) {
                throw new AppError(Err.VALIDATION_ERROR, 'Please select mint balance to send from.')
            }

            const { amount: amountToSendInt } = validateAndProcessAmount(amountToSend, unitRef.current)
            const exactMatchProofs: Proof[] = []

            if(!isOnlineRef.current) {
                const availableProofs = proofsStore.getByMint(mintBalanceToSendFrom.mintUrl, { isPending: false, unit: unitRef.current });
                const autoSelectedProofs = CashuUtils.getProofsToSend(amountToSendInt, availableProofs)
                const autoSelectedAmount = CashuUtils.getProofsAmount(autoSelectedProofs)
                const isExactMatch = autoSelectedAmount === amountToSendInt

                log.trace("[onMintBalanceConfirm]", {isOnline: isOnlineRef.current, amountToSendInt, autoSelectedAmount, isExactMatch})

                if(!isExactMatch) {
                    // TODO need to improve algo auto-selected proofs
                    dispatch({ type: 'SET_SELECTED_PROOFS', proofs: [] })
                    setAmountToSend('0')
                    dispatch({ type: 'OPEN_MODAL', modal: 'proofSelector' })
                    return
                } else {
                    exactMatchProofs.push(...autoSelectedProofs)
                }
            }

            dispatch({ type: 'SEND_START' })

            //@ts-ignore
            const p2pk: {
                pubkey: string;
                locktime?: number;
                refundKeys?: Array<string>
            } = {}

            log.trace('[onMintBalanceConfirm] lockedPubkey', { lockedPubkey })

            if (lockedPubkey && lockedPubkey.length > 0) {
                if (lockedPubkey.startsWith('npub')) {
                    p2pk.pubkey = '02' + NostrClient.getHexkey(lockedPubkey)
                } else {
                    if (lockedPubkey.length === 64) {
                        p2pk.pubkey = '02' + lockedPubkey
                    } else if (lockedPubkey.length === 66) {
                        p2pk.pubkey = lockedPubkey
                    } else {
                        throw new AppError(Err.VALIDATION_ERROR, 'Invalid key. Please provide public key in NPUB or HEX format.')
                    }
                }

                if (lockTime && lockTime > 0) {
                    p2pk.locktime = getUnixTime(new Date(Date.now() + lockTime * 24 * 60 * 60))
                    log.trace('[onMintBalanceConfirm] Locktime', { pubkey: p2pk.pubkey, locktime: p2pk.locktime })
                }
            }

            const result = await WalletTask.sendQueueAwaitable(
                mintBalanceToSendFrom as MintBalance,
                amountToSendInt,
                unitRef.current,
                memo,
                exactMatchProofs.length > 0 ? exactMatchProofs : selectedProofs, // autoSelected proofs are not yet in state
                p2pk,
                draftTransactionIdRef.current || undefined
            )

            await handleSendTaskResult(result)
        } catch (e: any) {
            handleError(e)
        }
    }

    /*
        Token to send is obtained from the  awaitable SendTask result (no event listener needed). Then depending on the flow:
        - For Send Token to contact flow, show NostrDM modal.
        - For Pay Cashu Payment Request flow, if the payment request has a NOSTR transport, 
            show Nostr or POST modal based on pr transport.
        - No modal for standard send (Show token) flow, user can copy the token from the result modal and share it manually.    
    */
    const handleSendTaskResult = async (result: TransactionTaskResult) => {
        log.trace('[SendScreen] handleSendTaskResult start')

        const { transaction: txResult, error, encodedTokenToSend: token } = result

        // ——— Error path ———
        if (error || !txResult) {
            const message = error?.params?.message || error?.message || 'Unknown error'
            dispatch({
                type: 'SEND_TASK_ERROR',
                status: (txResult?.status || TransactionStatus.ERROR) as TransactionStatus,
                title: error?.params?.message ? error.message : 'Send failed',
                message,
            })
            return
        }

        // MobX side-effect: link db transaction to Cashu PR + contacts
        if (
            paymentOption === SendOption.PAY_CASHU_PAYMENT_REQUEST &&
            decodedCashuPaymentRequest?.id &&
            encodedCashuPaymentRequest
        ) {
            txResult.update({
                paymentId: decodedCashuPaymentRequest.id,
                paymentRequest: encodedCashuPaymentRequest,
                profile: contactToSendFrom ? JSON.stringify(contactToSendFrom) : undefined,
                sentTo: contactToSendTo ? contactToSendTo.nip05 || contactToSendTo.name || null : null,
                sentFrom: contactToSendFrom ? contactToSendFrom.nip05 || contactToSendFrom.name || null : null,
            })
        }

        // ——— Success path ———
        let openTransport: 'nostrDM' | 'post' | 'none' = 'none'
        if (paymentOption === SendOption.SEND_TOKEN) {
            openTransport = 'nostrDM'
        } else if (paymentOption === SendOption.PAY_CASHU_PAYMENT_REQUEST) {
            if (relaysToShareTo.length > 0) openTransport = 'nostrDM'
            else if (postEndpointUrl) openTransport = 'post'
        }

        dispatch({
            type: 'SEND_TASK_SUCCESS',
            token: token ?? '',
            transaction: txResult,
            openTransport,
        })
    }

    /* 
        Heal error with proofs counter being out of sync with the mint, by increasing 
        the counter by 10 and retrying the send action.
        TODO: This should be triggered by error codes in modern cashu-ts, not parsed message.
    */
    const increaseProofsCounterAndRetry = async function () {
        try {
            const walletInstance = await walletStore.getWallet(
                mintBalanceToSendFrom?.mintUrl as string, 
                unitRef.current, 
                {withSeed: true}
            )
            const mintInstance = mintsStore.findByUrl(mintBalanceToSendFrom?.mintUrl as string)
            const counter = mintInstance!.getProofsCounterByKeysetId!(walletInstance.keysetId)
            counter!.increaseProofsCounter(10)

            // retry send
            onMintBalanceConfirm()
        } catch (e: any) {            
            handleError(e)
        } finally {
            toggleResultModal() //close
        }
    }

    /* 
        Retry after spent ecash found in the wallet 
        TODO: This should be triggered by error codes in modern cashu-ts, not parsed message.
    */
    const retryAfterSpentCleaned = async function () {
        try {
            // retry send
            onMintBalanceConfirm()
        } catch (e: any) {            
            handleError(e)
        } finally {
            toggleResultModal() //close
        }
    }


    const onMintBalanceCancel = async function () {
        resetState()
        gotoWallet()
    }

    /* 
        Ecash token sending via Nostr DM, triggered when user confirms the send in the Nostr DM modal.
    */
    const sendAsNostrDM = async function () {
        try {
            if(!contactToSendFrom || !contactToSendTo) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing sender or receiver information.')
            }

            if(!encodedTokenToSend) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing token to send.')
            }

            if(!mintBalanceToSendFrom) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mint balance context.')
            }

            dispatch({ type: 'TRANSPORT_START', channel: 'nostrDM' })
            let messageContent: string | undefined = undefined

            if(paymentOption === SendOption.SEND_TOKEN) {
                const message = `nostr:${contactToSendFrom.npub} sent you ${amountToSend} ${getCurrency(unitRef.current).code} from Minibits wallet!`
                messageContent = message + ' \n' + encodedTokenToSend
            }

            if(paymentOption === SendOption.PAY_CASHU_PAYMENT_REQUEST) {   
                if(!decodedCashuPaymentRequest) {
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing payment request to pay.')
                }

                // keysetsV2 support
                const mintKeysetIds = mintsStore.findByUrl(mintBalanceToSendFrom.mintUrl)?.keysetIds
                if(!mintKeysetIds || mintKeysetIds.length === 0) {
                    throw new AppError(Err.NOTFOUND_ERROR, 'Missing keysetIds in the wallet state', {
                        mintUrl: mintBalanceToSendFrom.mintUrl
                    })
                }

                const decodedTokenToSend = getDecodedToken(encodedTokenToSend, mintKeysetIds)

                messageContent = JSON.stringify({
                    id: decodedCashuPaymentRequest.id,
                    mint: decodedTokenToSend.mint,
                    unit: decodedTokenToSend.unit,
                    proofs: decodedTokenToSend.proofs,
                })
            }

            const keys = await walletStore.getCachedWalletKeys()
            const sentEvent = await NostrClient.encryptAndSendDirectMessageNip17(
                contactToSendTo.pubkey,
                messageContent!,
                relaysToShareTo,
                keys.NOSTR,
                walletProfileStore.nip05
            )
            
            if(sentEvent) {
                dispatch({ type: 'TRANSPORT_SUCCESS', channel: 'nostrDM' })

                if(!transactionId) {
                    return
                }

                const transaction = transactionsStore.findById(transactionId)

                if(!transaction || !transaction.data) {
                    return
                }

                let updated = [] as unknown as TransactionData

                try {
                    updated = JSON.parse(transaction.data)
                } catch (e) {}                               

                if(updated.length > 2) {
                    updated[2].sentToRelays = relaysToShareTo
                    updated[2].sentEvent = sentEvent
                    
                    // status does not change, just add event and relay info to tx.data 
                    transaction.update({                    
                        status: TransactionStatus.PENDING,
                        data: JSON.stringify(updated)
                    })
                }

                if(contactToSendTo) {
                    transaction.update({
                        profile: JSON.stringify(contactToSendTo),
                        sentTo: contactToSendTo.nip05handle ?? contactToSendTo.name!
                    })
                }

            } else {
                dispatch({ type: 'TRANSPORT_RESET', channel: 'nostrDM' })
                dispatch({ type: 'SET_INFO', message: 'Nostr relays could not confirm that the message has been sent' })
            }
        } catch (e: any) {
            handleError(e)
        }
    }

    /* 
        Ecash token sending via POST request to the endpoint specified in the payment request, 
        triggered when user confirms the send in the POST modal.
    */
    const sendAsPostRequest = async function () {
        try {
            if (!postEndpointUrl) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing POST endpoint URL.')
            }

            if (!encodedTokenToSend) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing token to send.')
            }

            if (!decodedCashuPaymentRequest) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing payment request to pay.')
            }

            if (!mintBalanceToSendFrom) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mint balance context.')
            }

            dispatch({ type: 'TRANSPORT_START', channel: 'post' })

            // keysetsV2 support
            const mintKeysetIds = mintsStore.findByUrl(mintBalanceToSendFrom.mintUrl)?.keysetIds
            if(!mintKeysetIds || mintKeysetIds.length === 0) {
                throw new AppError(Err.NOTFOUND_ERROR, 'Missing keysetIds in the wallet state', {
                    mintUrl: mintBalanceToSendFrom.mintUrl
                })
            }

            const decodedTokenToSend = getDecodedToken(encodedTokenToSend, mintKeysetIds)

            const payload = {
                id: decodedCashuPaymentRequest.id,
                mint: decodedTokenToSend.mint,
                unit: decodedTokenToSend.unit,
                proofs: decodedTokenToSend.proofs,
                memo: decodedTokenToSend.memo || undefined,
            }

            await MinibitsClient.fetchApi(postEndpointUrl, {
                method: 'POST',
                body: payload,
                jwtAuthRequired: false
            })

            dispatch({ type: 'TRANSPORT_SUCCESS', channel: 'post' })

            if (!transactionId) {
                return
            }

            const transaction = transactionsStore.findById(transactionId)

            if (!transaction || !transaction.data) {
                return
            }

            let updated = [] as unknown as TransactionData

            try {
                updated = JSON.parse(transaction.data)
            } catch (e) {}

            if (updated.length > 2) {
                updated[2].postEndpointUrl = postEndpointUrl

                transaction.update({
                    status: TransactionStatus.PENDING,
                    data: JSON.stringify(updated)
                })
            }
        } catch (e: any) {
            handleError(e)
        }
    }


    /* 
        Offline proofs selection handling - allows user to select which proofs to send when an 
        exact match for the amount is not available, and updates the amount to send based on the selected proofs total. 
    */
    const toggleSelectedProof = function (proof: Proof) {
        const precision = getCurrency(unitRef.current).precision
        const isSelected = selectedProofs.some(p => p.secret === proof.secret)

        // validate amountToSend s.t. it does not crash numbro
        const _amountToSend = (!amountToSend || !amountToSend.trim() || Number.isNaN(parseInt(amountToSend)))
            ? 0
            : parseInt(amountToSend)

        if (isSelected) {
            setAmountToSend(`${numbro(_amountToSend - proof.amount / precision).format({
                thousandSeparated: true,
                mantissa: getCurrency(unitRef.current).mantissa,
            })}`)
            dispatch({ type: 'SET_SELECTED_PROOFS', proofs: selectedProofs.filter(p => p.secret !== proof.secret) })
        } else {
            setAmountToSend(`${numbro(_amountToSend + proof.amount / precision).format({
                thousandSeparated: true,
                mantissa: getCurrency(unitRef.current).mantissa,
            })}`)
            dispatch({ type: 'SET_SELECTED_PROOFS', proofs: [...selectedProofs, proof] })
        }
    }

    const resetSelectedProofs = function () {
        dispatch({ type: 'SET_SELECTED_PROOFS', proofs: [] })
        setAmountToSend('0')
    }

    /* 
        Confirm proof selection in offline mode and proceed with the send, after updating the amount 
        to send to match the total of the selected proofs. 
    */
    const onOfflineSendConfirm = function () {
        // We show selected amount in proof selector modal, so do not trigger various state updates here.
        toggleProofSelectorModal() // close
        // Pass the exact selected amount directly to onMintBalanceConfirm
        onMintBalanceConfirm()
    }

    /* Navigate to contact list */
    const gotoContacts = function () {

        if(encodedTokenToSend && contactToSendTo) {

            toggleNostrDMModal() // open if we already have a token

        } else {
            //@ts-ignore
            navigation.navigate('ContactsNavigator', {
                screen: 'Contacts',
                params: {paymentOption: SendOption.SEND_TOKEN}            
            })
        }
    }


    const gotoWallet = function() {
        resetState()
        navigation.dispatch(                
         StackActions.popToTop()
        )
     }

    const resetState = function () {
        dispatch({ type: 'RESET' })
        setAmountToSend('')
        setMemo('')
        setIsCashuPrWithAmount(false)
        setIsCashuPrWithDesc(false)
        setLockedPubkey(undefined)
        setLockTime(1)
    }

    /* Avoid modals stacked if we have an error */
    const handleError = function(e: AppError): void {
        dispatch({ type: 'SET_ERROR', error: e })
    }

    const headerBg = useThemeColor('header')
    const amountInputColor = useThemeColor('amountInput')
    const hintColor = useThemeColor('textDim')
    const inputText = useThemeColor('text')
    const inputBg = useThemeColor('background')
    const buttonBorder = useThemeColor('card')


    const onPasteLockedPubkey = async function () {
        try {
            const pastedText = await Clipboard.getString()
            setLockedPubkey(pastedText)
        } catch (e: any) {
            handleError(e)
        }
    }

    const gotoScan = async function () {
        log.trace('[onScanLockedPubkey]')
       
        togglePubkeySelectorModal()
        //@ts-ignore
        navigation.navigate('Scan', { 
            unit: unitRef.current,  
            mintUrl: mintBalanceToSendFrom?.mintUrl
        })        
    }


    return (
      <Screen preset="fixed" contentContainerStyle={$screen}>
        <MintHeader 
            mint={mintBalanceToSendFrom ? mintsStore.findByUrl(mintBalanceToSendFrom?.mintUrl) : undefined}
            unit={unitRef.current}            
        />
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>        
            <View style={$amountContainer}>
                <AmountInput
                    ref={amountInputRef}                    
                    value={amountToSend}
                    onChangeText={amount => setAmountToSend(amount)}
                    unit={unitRef.current}
                    onEndEditing={transactionStatus !== TransactionStatus.PENDING ? onAmountEndEditing : undefined}
                    selectTextOnFocus={true}
                    editable={(transactionStatus === TransactionStatus.PENDING || isCashuPrWithAmount)
                        ? false 
                        : true
                    }
                />
            </View>
            {lockedPubkey ? (
                <View
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        //marginTop: isConvertedAmountVisible() ? -spacing.extraSmall : undefined
                    }}
                >
                    <Icon 
                        icon="faLock"
                        size={spacing.small}
                        color={amountInputColor} 
                    />
                    <Text
                        size='xs'
                        tx="sendLocked"
                        style={{color: amountInputColor, marginLeft: spacing.tiny}}
                    />

                </View>
            ) : (
                <Text
                    size='xs'
                    tx='amountSend'
                    style={{
                        color: amountInputColor,
                        textAlign: 'center',
                        //marginTop: spacing.extraSmall                            
                    }}
                />
            )}         
        </View>
        <View style={$contentContainer}>
            {!encodedTokenToSend && (
              <MemoInputCard
                memo={memo}
                ref={memoInputRef}
                setMemo={setMemo}
                disabled={transactionStatus === TransactionStatus.PENDING || isCashuPrWithDesc}
                onMemoDone={onMemoDone}
                onMemoEndEditing={onMemoEndEditing}
              />
            )}
            {isMintSelectorVisible && !encodedTokenToSend && (
                <MintBalanceSelector
                    mintBalances={availableMintBalances}
                    selectedMintBalance={mintBalanceToSendFrom as MintBalance}
                    unit={unitRef.current}
                    title={translate("sendScreen_sendFromMintBalanceSel")}
                    confirmTitle={isOnline 
                      ? translate("sendScreen_createTokenBtn")
                      : translate("sendScreen_sendOfflineBtn") 
                    }                    
                    secondaryConfirmTitle='Lock'                    
                    onMintBalanceSelect={onMintBalanceSelect}
                    onSecondaryMintBalanceSelect={onLockPubkeyStart}
                    onCancel={onMintBalanceCancel}                                           
                    onMintBalanceConfirm={onMintBalanceConfirm}
                />
            )}
            {transactionStatus === TransactionStatus.PENDING && encodedTokenToSend && paymentOption && (
                <>
                    <QRCodeBlock                  
                        qrCodeData={encodedTokenToSend as string}                        
                        title='Ecash token to send'
                        type='EncodedV4Token'
                    />
                    <TokenOptionsBlock                    
                        toggleNostrDMModal={toggleNostrDMModal}
                        contactToSendTo={contactToSendTo}                  
                        gotoContacts={gotoContacts}                    
                    />
                </>
            )}
            {transaction && transactionStatus === TransactionStatus.COMPLETED && (
                <Card
                    style={{padding: spacing.medium}}
                    ContentComponent={
                    <>
                        <TranItem 
                            label="tranDetailScreen_sentTo"
                            isFirst={true}
                            value={mintsStore.findByUrl(transaction.mint)?.shortname as string}
                        />
                        {transaction?.memo && (
                        <TranItem
                            label="receiverMemo"
                            value={transaction.memo as string}
                        />
                        )}
                        <TranItem
                        label="transactionCommon_feePaid"
                        value={transaction.fee || 0}
                        unit={unitRef.current}
                        isCurrency={true}
                        />
                        <TranItem
                            label="tranDetailScreen_status"
                            value={transaction.status as string}
                        />
                    </>
                    }
                />
            )}
            {(transactionStatus === TransactionStatus.COMPLETED)  && (
                <View style={$bottomContainer}>
                    <View style={$buttonContainer}>
                        <Button
                            preset="secondary"
                            tx={'commonClose'}
                            onPress={gotoWallet}
                        />
                    </View>
                </View>
            )}
        </View>
        <BottomModal
          isVisible={isProofSelectorModalVisible}
          ContentComponent={
            <SelectProofsBlock
                mintBalanceToSendFrom={mintBalanceToSendFrom as MintBalance}
                unit={unitRef.current}
                selectedProofs={selectedProofs}
                showNoExactMatchMessage={true}
                toggleProofSelectorModal={toggleProofSelectorModal}
                toggleSelectedProof={toggleSelectedProof} 
                resetSelectedProofs={resetSelectedProofs}           
                onOfflineSendConfirm={onOfflineSendConfirm}                
            />
          }
          onBackButtonPress={toggleProofSelectorModal}
          onBackdropPress={toggleProofSelectorModal}
        />
        <BottomModal
            isVisible={isPubkeySelectorModalVisible}
            ContentComponent={
                <View style={$bottomModal}>
                <Text tx="sendLockEcash" preset="subheading" />
                <Text
                    size="xxs"
                    style={{color: hintColor}}
                    tx="sendLockEcashDesc"
                />
                <View
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: spacing.small,
                    }}>
                    <TextInput
                        ref={pubkeyInputRef}
                        onChangeText={pubkey =>
                            setLockedPubkey(pubkey)
                        }
                        value={lockedPubkey}
                        autoCapitalize="none"
                        keyboardType="default"                  
                        maxLength={66}
                        selectTextOnFocus={true}
                        style={[
                            $pubkeyInput,                    
                            {backgroundColor: inputBg, color: inputText},
                        ]}
                    />
                    <Button
                        preset='secondary'
                        tx='commonPaste'
                        style={{
                            borderRadius: 0,
                            marginLeft: -spacing.small,
                            borderLeftWidth: 1,
                            borderLeftColor: buttonBorder                 
                        }}
                        onPress={onPasteLockedPubkey}
                    />
                    <Button
                        preset='secondary'
                        tx="commonScan"
                        style={{
                            borderTopLeftRadius: 0,
                            borderBottomLeftRadius: 0,  
                            marginHorizontal: 1,                                
                        }}
                        onPress={gotoScan}
                    />
                </View>
                {contactsStore.contacts.length > 0 && (
                    <View
                        style={{
                            flexDirection: 'row',
                            marginTop: spacing.medium,
                            alignItems: 'center',
                            borderBottomWidth: 1,
                            borderBottomColor: inputBg
                        }}
                        >
                        <FlatList
                            data={contactsStore.contacts}
                            renderItem={({ item }) => {
                                return (
                                    <ContactItem 
                                        contact={item}
                                        onPress={() => setLockedPubkey(item.npub)}
                                        containerStyle={{
                                            paddingHorizontal: spacing.small,
                                            borderRadius: spacing.tiny,
                                            backgroundColor: lockedPubkey === item.npub ? inputBg : undefined,
                                        }}                                    
                                    />
                                )
                                }}
                            horizontal={true}
                            keyExtractor={(item) => item.npub}
                            style={{marginBottom: spacing.medium}}
                            contentContainerStyle={{
                                justifyContent: 'center', // Center items horizontally
                                alignItems: 'center',    // Center items vertically
                                flexGrow: 1,
                            }}
                        />
                    </View>
                )}
                <Text
                    size="xxs"
                    style={{color: hintColor, marginTop: spacing.small}}
                    tx="sendLockFor" 
                />
                <View
                    style={[
                        $buttonContainer,
                        {
                            marginVertical: spacing.small, 
                            borderBottomWidth: 1, 
                            borderBottomColor: inputBg,
                            paddingBottom: spacing.small,
                            alignSelf: 'stretch',
                            justifyContent: 'center'
                        }
                    ]}
                >
                    <Button
                        preset={lockTime === 1 ? "secondary" : "tertiary"}
                        text={"1 day"}
                        onPress={() => setLockTime(1)}
                        style={{                    
                            minHeight: verticalScale(40), 
                            paddingVertical: verticalScale(spacing.tiny),
                            marginRight: spacing.small                   
                        }} 
                        textStyle={{fontSize: 14}}
                    />              
                    <Button
                        preset={lockTime === 7 ? "secondary" : "tertiary"}
                        text={"1 week"}
                        onPress={() => setLockTime(7)}
                        style={{                    
                            minHeight: verticalScale(40), 
                            paddingVertical: verticalScale(spacing.tiny),
                            marginRight: spacing.small                   
                        }}  
                        textStyle={{fontSize: 14}}
                    />
                    <Button
                        preset={lockTime ? "tertiary" : "secondary"}
                        text={"forever"}
                        onPress={() => setLockTime(undefined)}
                        style={{                    
                            minHeight: verticalScale(40), 
                            paddingVertical: verticalScale(spacing.tiny),
                            marginRight: spacing.small                   
                        }} 
                        textStyle={{fontSize: 14}}
                        />
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}>
                    <Button
                        tx="sendLock"
                        LeftAccessory={() => (<Icon icon="faLock" color="white" size={spacing.medium}/>)}
                        onPress={onLockPubkeySelect}
                        style={{marginRight: spacing.medium}}
                    />
                    <Button
                        style={{marginRight: spacing.medium}}
                        preset="tertiary"
                        tx="commonCancel"
                        onPress={onLockPubkeyCancel}
                    />
                </View>
            </View>                                             
            }
            onBackButtonPress={togglePubkeySelectorModal}
            onBackdropPress={togglePubkeySelectorModal}
        />
        <BottomModal
          isVisible={isNostrDMModalVisible ? true : false}
          ContentComponent={
            (isNostrDMSuccess ? (
            <NostrDMSuccessBlock
                toggleNostrDMModal={toggleNostrDMModal}
                contactToSendFrom={contactToSendFrom as Contact}
                contactToSendTo={contactToSendTo as Contact}                
                amountToSend={amountToSend}
                onClose={gotoWallet}                
            />
            ) : (
            <SendAsNostrDMBlock
                toggleNostrDMModal={toggleNostrDMModal}
                encodedTokenToSend={encodedTokenToSend as string}
                contactToSendFrom={contactToSendFrom as Contact}
                contactToSendTo={contactToSendTo as Contact}
                relaysToShareTo={relaysToShareTo}
                amountToSend={amountToSend}
                unit={unitRef.current}
                sendAsNostrDM={sendAsNostrDM}
                isNostrDMSending={isNostrDMSending}                
            />
            ))
            
          }
          onBackButtonPress={toggleNostrDMModal}
          onBackdropPress={toggleNostrDMModal}
        />
        <BottomModal
          isVisible={isPostModalVisible}
          ContentComponent={
            isPostSuccess ? (
              <PostSuccessBlock
                togglePostModal={togglePostModal}
                onClose={gotoWallet}
              />
            ) : (
              <SendAsPostRequestBlock
                togglePostModal={togglePostModal}
                encodedTokenToSend={encodedTokenToSend as string}
                postEndpointUrl={postEndpointUrl as string}
                amountToSend={amountToSend}
                unit={unitRef.current}
                sendAsPostRequest={sendAsPostRequest}
                isPostSending={isPostSending}
              />
            )
          }
          onBackButtonPress={togglePostModal}
          onBackdropPress={togglePostModal}
        />
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {resultModalInfo &&
                transactionStatus === TransactionStatus.COMPLETED && (
                  <>
                    <ResultModalInfo
                      icon="faCheckCircle"
                      iconColor={colors.palette.success200}
                      title={resultModalInfo?.title || "Success!"}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx={'commonClose'}
                        onPress={gotoWallet}
                      />
                    </View>
                  </>
                )}
              {resultModalInfo &&
                transactionStatus === TransactionStatus.ERROR && (
                  <>
                    <ResultModalInfo
                      icon="faTriangleExclamation"
                      iconColor={colors.palette.angry500}
                      title={resultModalInfo?.title || "Send failed"}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                        {((/already.*signed|duplicate key/i.test(resultModalInfo.message))) ? (
                            <Button
                                preset="secondary"
                                text={"Retry again"}
                                onPress={increaseProofsCounterAndRetry}
                            />
                        ) : resultModalInfo.message.toLowerCase().includes('token already spent') || resultModalInfo.message.toLowerCase().includes('some spent ecash') ? (
                            <Button
                                preset="secondary"
                                text={"Retry again"}
                                onPress={retryAfterSpentCleaned}
                            />
                        ) : (
                            <Button
                                preset="secondary"
                                tx={'commonClose'}
                                onPress={toggleResultModal}
                            />
                        )}
                    </View>
                  </>
                )}
            </>
          }
          onBackButtonPress={toggleResultModal}
          onBackdropPress={toggleResultModal}
        />
        {isLoading && <Loading />}
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  }
)


/**
 * allows you to manually select the ecash banknotes for offline sending
 */
const SelectProofsBlock = observer(function (props: {
  mintBalanceToSendFrom: MintBalance
  unit: MintUnit
  selectedProofs: Proof[]
  showNoExactMatchMessage?: boolean
  toggleProofSelectorModal: any
  toggleSelectedProof: any
  resetSelectedProofs: any
  onOfflineSendConfirm: any
}) {

  const { proofsStore } = useStores()
  const hintColor = useThemeColor('textDim')
  const statusColor = useThemeColor('header')

  const onCancel = function () {
    props.resetSelectedProofs()
    props.toggleProofSelectorModal()
  }

  const $informStyle: TextStyle = {
    paddingHorizontal: spacing.small,
    textAlign: 'center',
    marginTop: spacing.extraSmall,
    fontWeight: '500'
  }

  return (
    <View style={$bottomModal}>
      <View
        style={[
          {
            alignSelf: 'center',
            marginTop: spacing.tiny,
            paddingHorizontal: spacing.tiny,
            borderRadius: spacing.tiny,
            backgroundColor: colors.palette.primary200,
          },
        ]}>
        <Text
          tx="sendScreen_offlinemode"
          style={[
            {
              color: statusColor,
              fontSize: 10,
              fontFamily: typography.primary?.light,
              padding: 0,
              lineHeight: 16,
            }
          ]}
        />
      </View>
      <Text tx='sendCreateToken' style={{ marginTop: spacing.large }} />
      {props.showNoExactMatchMessage && (<Text
        tx="sendOfflineApproxMatch"
        style={$informStyle}
        size='xs'
      />)}
      <Text
        tx='sendOfflineExactDenoms'
        style={{ color: hintColor, paddingHorizontal: spacing.tiny, marginTop: spacing.extraSmall, textAlign: 'center' }}
        size='xs'
      />
      <CurrencyAmount
        amount={CashuUtils.getProofsAmount(props.selectedProofs)}
        mintUnit={props.unit}
        size='extraLarge'
        containerStyle={{ marginTop: spacing.large, marginBottom: spacing.small, alignItems: 'center' }}
      />
      <View style={{
        maxHeight: spacing.screenHeight * 0.45,
        borderWidth: 1,
        borderColor: hintColor,
        borderRadius: spacing.medium,
        marginTop: spacing.small
      }}>
        <FlatList<Proof>
          data={proofsStore.getByMint(props.mintBalanceToSendFrom.mintUrl, { isPending: false, unit: props.unit })}
          renderItem={({ item }) => {
            const isSelected = props.selectedProofs.some(
              p => p.secret === item.secret
            )

            return (
              <Button
                preset={isSelected ? 'default' : 'secondary'}
                onPress={() => props.toggleSelectedProof(item)}
                text={`${item.amount}`}
                style={{ minWidth: 80, margin: spacing.small }}
              />
            )
          }}
          numColumns={3}
          keyExtractor={(item) => item.secret}
        />
      </View>
      <Text tx="sendOffline_usageHint" style={{ color: hintColor, marginVertical: spacing.extraSmall, textAlign: 'center' }} size="xs" />
      <View style={[$bottomContainer, { marginTop: spacing.extraLarge }]}>
        <View style={[$buttonContainer]}>
          <Button
            tx="sendCreateToken"
            onPress={props.onOfflineSendConfirm}
            style={{ marginRight: spacing.medium }}
          />
          <Button
            preset="secondary"
            tx="commonCancel"
            onPress={onCancel}
          />
        </View>
      </View>
    </View>
  )

})


const TokenOptionsBlock = observer(function (props: {
    toggleNostrDMModal: any
    contactToSendTo?: Contact   
    gotoContacts: any
}) {

    return (
        <View style={{flex: 1}}>               
            <View style={$bottomContainer}>
                <View style={$buttonContainer}>
                  {props.contactToSendTo ? (
                    <Button
                        text={`Send to ${props.contactToSendTo.nip05}`}
                        preset='tertiary'
                        onPress={props.toggleNostrDMModal}                        
                        style={{
                            minHeight: verticalScale(40), 
                            paddingVertical: verticalScale(spacing.tiny),
                        }}
                        LeftAccessory={() => (
                            <Icon
                            icon='faPaperPlane'
                            // color="white"
                            size={spacing.medium}              
                            />
                        )} 
                    />
                  ) : (
                    <Button
                        tx='sendToContact'
                        preset='tertiary'
                        onPress={props.gotoContacts}                        
                        style={{
                            minHeight: verticalScale(40), 
                            paddingVertical: verticalScale(spacing.tiny),
                        }}
                        LeftAccessory={() => (
                            <Icon
                            icon='faPaperPlane'
                            // color="white"
                            size={spacing.medium}              
                            />
                        )} 
                    />
                  )}
                </View>
            </View>  
        </View>
    )
})


const SendAsNostrDMBlock = observer(function (props: {
    toggleNostrDMModal: any
    encodedTokenToSend: string
    contactToSendFrom: Contact
    contactToSendTo: Contact
    relaysToShareTo: string[]
    amountToSend: string
    unit: MintUnit
    sendAsNostrDM: any 
    isNostrDMSending: boolean   
  }) {
    const sendBg = useThemeColor('background')
    const tokenTextColor = useThemeColor('textDim')    
      
    return (
      <View style={$bottomModal}>
        <Text text={'Send to contact'} />
        <NostDMInfoBlock
            contactToSendFrom={props.contactToSendFrom}
            amountToSend={props.amountToSend}
            unit={props.unit}
            contactToSendTo={props.contactToSendTo}
        />
        <ScrollView
          style={[
            $tokenContainer,
            {backgroundColor: sendBg, marginHorizontal: spacing.small},
          ]}>
          <Text
            selectable
            text={props.encodedTokenToSend}
            style={{color: tokenTextColor, paddingBottom: spacing.medium, fontFamily: typography.code?.normal}}
            size="xxs"
          />
        </ScrollView>
        {props.isNostrDMSending ? (
            <View style={[$buttonContainer, {minHeight: verticalScale(55)}]}>
                <Loading />
            </View>            
        ) : (
            <View style={$buttonContainer}>            
                <Button
                    tx="commonSend"
                    onPress={props.sendAsNostrDM}
                    style={{marginRight: spacing.medium}}
                    LeftAccessory={() => (
                    <Icon
                        icon="faPaperPlane"
                        color="white"
                        size={spacing.medium}
                        //containerStyle={{marginRight: spacing.small}}
                    />
                    )}
                />          
                <Button
                    preset="tertiary"
                    tx="commonClose"
                    onPress={props.toggleNostrDMModal}
                />           
            </View>
        )}        
      </View>
    )
  })


  const NostrDMSuccessBlock = observer(function (props: {
    toggleNostrDMModal: any
    contactToSendFrom: Contact
    contactToSendTo: Contact
    amountToSend: string
    onClose: any   
  }) {
  
    return (
      <View style={$bottomModal}>
        {/*<NostDMInfoBlock
            contactToSendFrom={props.contactToSendFrom}
            amountToSend={props.amountToSend}
            contactToSendTo={props.contactToSendTo}
        />*/}
        <ResultModalInfo
            icon="faCheckCircle"
            iconColor={colors.palette.success200}
            title="Success!"
            message="Ecash has been successfully sent."
        />
        <View style={$buttonContainer}>
            <Button
            preset="secondary"
            tx={'commonClose'}
            onPress={props.onClose}
            />
        </View>
      </View>
    )
})

const SendAsPostRequestBlock = observer(function (props: {
    togglePostModal: any
    encodedTokenToSend: string
    postEndpointUrl: string
    amountToSend: string
    unit: MintUnit
    sendAsPostRequest: any
    isPostSending: boolean
  }) {
    const sendBg = useThemeColor('background')
    const tokenTextColor = useThemeColor('textDim')

    return (
      <View style={$bottomModal}>
        <Text text={'Send payment request'} />
        <Text
          text={props.postEndpointUrl}
          style={{color: tokenTextColor, textAlign: 'center', marginVertical: spacing.small}}
          size="xs"
        />
        <CurrencyAmount
          amount={round(toNumber(props.amountToSend) * getCurrency(props.unit).precision, 0)}
          mintUnit={props.unit}
          size='large'
          containerStyle={{alignItems: 'center', marginBottom: spacing.small}}
        />
        <ScrollView
          style={[
            $tokenContainer,
            {backgroundColor: sendBg, marginHorizontal: spacing.small},
          ]}>
          <Text
            selectable
            text={props.encodedTokenToSend}
            style={{color: tokenTextColor, paddingBottom: spacing.medium, fontFamily: typography.code?.normal}}
            size="xxs"
          />
        </ScrollView>
        {props.isPostSending ? (
            <View style={[$buttonContainer, {minHeight: verticalScale(55)}]}>
                <Loading />
            </View>
        ) : (
            <View style={$buttonContainer}>
                <Button
                    tx="commonSend"
                    onPress={props.sendAsPostRequest}
                    style={{marginRight: spacing.medium}}
                    LeftAccessory={() => (
                    <Icon
                        icon="faPaperPlane"
                        color="white"
                        size={spacing.medium}
                    />
                    )}
                />
                <Button
                    preset="tertiary"
                    tx="commonClose"
                    onPress={props.togglePostModal}
                />
            </View>
        )}
      </View>
    )
  })

const PostSuccessBlock = observer(function (props: {
    togglePostModal: any
    onClose: any
  }) {

    return (
      <View style={$bottomModal}>
        <ResultModalInfo
            icon="faCheckCircle"
            iconColor={colors.palette.success200}
            title="Success!"
            message="Payment successfully sent"
        />
        <View style={$buttonContainer}>
            <Button
            preset="secondary"
            tx={'commonClose'}
            onPress={props.onClose}
            />
        </View>
      </View>
    )
})

const ContactItem = function (props: {
    contact: Contact
    onPress: any
    containerStyle?: ViewStyle
}) {
    const textColor = useThemeColor('textDim')
    const tokenTextColor = useThemeColor('textDim')

    return (
        <Pressable 
            style={[{flexDirection: 'column', alignItems: 'center'}, props.containerStyle]}
            onPress={props.onPress}
        >
            {props.contact && props.contact.picture ? (
                <View style={{borderRadius: 20, overflow: 'hidden'}}>
                    <FastImage style={[
                        $profileIcon, {
                        width: 40, 
                        height: props.contact.isExternalDomain ? 40 :  43,
                        borderRadius: props.contact.isExternalDomain ? 20 :  0,
                        }] as import("react-native-fast-image").ImageStyle}
                        source={{
                            uri: getImageSource(props.contact.picture as string) 
                        }} 
                    />
                </View>
            ) : (
                <Icon
                    icon='faCircleUser'                                
                    size={38}                    
                    color={tokenTextColor}                
                />
            )}
            <Text 
                size='xxs' 
                ellipsizeMode='tail'
                numberOfLines={1}
                style={{color: tokenTextColor, maxWidth: 50}} 
                text={props.contact.name|| props.contact.npub}
            />
        </Pressable>
    )
}

const NostDMInfoBlock = observer(function (props: {
    contactToSendFrom: Contact
    amountToSend: string
    unit: MintUnit
    contactToSendTo: Contact
}) {

    
    const tokenTextColor = useThemeColor('textDim')
    const amountToSendInt = round(toNumber(props.amountToSend) * getCurrency(props.unit).precision, 0)
    const amountToSendDisplay = formatCurrency(amountToSendInt, getCurrency(props.unit).code)
    

    return(
        <View style={{flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: spacing.medium}}>
            <ContactItem
                contact={props.contactToSendFrom}
                onPress={undefined}
                containerStyle={{height: 60}}
            />
            <Text size='xxs' style={{color: tokenTextColor, textAlign: 'center', marginLeft: 30,  marginBottom: 20}} text='...........' />
            <View style={{flexDirection: 'column', alignItems: 'center'}}>                
                <Icon
                        icon='faPaperPlane'                                         
                        size={spacing.medium}                    
                        color={tokenTextColor}                
                />
                <Text size='xxs' style={{color: tokenTextColor, marginBottom: -10}} text={`${amountToSendDisplay} ${getCurrency(props.unit).code}`} />
            </View>
            <Text size='xxs' style={{color: tokenTextColor, textAlign: 'center', marginRight: 30, marginBottom: 20}} text='...........' />
            <ContactItem
                contact={props.contactToSendTo}
                onPress={undefined}
                containerStyle={{height: 60}}
            />
        </View>
    )

})


const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.extraSmall,
  paddingTop: 0,
  height: spacing.screenHeight * 0.20,

}

const $pubkeyInput: TextStyle = {
    flex: 1,
    // borderRadius: 0,
    borderRadius: spacing.extraSmall,    
    fontSize: verticalScale(16),
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
// borderWidth: 1,
}

const $amountContainer: ViewStyle = {
    //height: spacing.screenHeight * 0.11,
}


const $contentContainer: TextStyle = {
    flex: 1,
    padding: spacing.extraSmall,
    marginTop: -spacing.extraLarge * 1.5
}


const $tokenContainer: ViewStyle = {
  borderRadius: spacing.small,
  alignSelf: 'stretch',
  padding: spacing.small,
  maxHeight: 114,
  marginTop: spacing.small,
  marginBottom: spacing.large,
}

const $memoButton: ViewStyle = {
  maxHeight: 50,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  paddingTop: 0,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $bottomModal: ViewStyle = {  
  alignItems: 'center',
  paddingVertical: spacing.large,  
}

const $qrCodeContainer: ViewStyle = {
    backgroundColor: 'white',
    paddingHorizontal: spacing.small,    
    marginHorizontal: spacing.small,
    marginBottom: spacing.small,
    borderRadius: spacing.small,
    alignItems: 'center',
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}

const $profileIcon: ImageStyle = {
    padding: spacing.medium,
}

const $bottomContainer: ViewStyle = {
    // position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.tiny,
    alignSelf: 'stretch',
    // opacity: 0,
  }
