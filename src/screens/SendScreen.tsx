import {observer} from 'mobx-react-lite'
import React, {  
  useEffect,
  useState,
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
import {TransactionStatus, Transaction} from '../models/Transaction'
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
import { CurrencyCode, MintUnit, MintUnits, convertToFromSats, formatCurrency, getCurrency } from "../services/wallet/currency"
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
import { SEND_TASK } from '../services/wallet/sendTask'
import FastImage from 'react-native-fast-image'
import { CurrencyAmount } from './Wallet/CurrencyAmount'
import { CashuUtils } from '../services/cashu/cashuUtils'
import Clipboard from '@react-native-clipboard/clipboard'
import { getUnixTime } from 'date-fns'

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
        userSettingsStore
    } = useStores()

    const amountInputRef = useRef<TextInput>(null)
    const memoInputRef = useRef<TextInput>(null)
    const pubkeyInputRef = useRef<TextInput>(null) // Initialize pubkeyInputRef
    const unitRef = useRef<MintUnit>('sat')
    const draftTransactionIdRef = useRef<number>(null)
    
    const [paymentOption, setPaymentOption] = useState<SendOption>(SendOption.SHOW_TOKEN)
    const [encodedTokenToSend, setEncodedTokenToSend] = useState<string | undefined>()
    const [encodedCashuPaymentRequest, setEncodedCashuPaymentRequest] = useState<string | undefined>()
    const [decodedCashuPaymentRequest, setDecodedCashuPaymentRequest] = useState<CashuPaymentRequest | undefined>()
    const [amountToSend, setAmountToSend] = useState<string>('0')    
    const [contactToSendFrom, setContactToSendFrom] = useState<Contact| undefined>()    
    const [contactToSendTo, setContactToSendTo] = useState<Contact| undefined>()        
    const [relaysToShareTo, setRelaysToShareTo] = useState<string[]>([])
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<MintBalance[]>([])
    const [mintBalanceToSendFrom, setMintBalanceToSendFrom] = useState<MintBalance | undefined>()
    const [selectedProofs, setSelectedProofs] = useState<Proof[]>([])
    const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
    const [transaction, setTransaction] = useState<Transaction | undefined>()
    const [transactionId, setTransactionId] = useState<number | undefined>()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()        
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, title?: string, message: string} | undefined>()    
    const [isLoading, setIsLoading] = useState(false)

    const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
    const [isOfflineSend, setIsOfflineSend] = useState(false)
    const [isCashuPrWithAmount, setIsCashuPrWithAmount] = useState(false)
    const [isCashuPrWithDesc, setIsCashuPrWithDesc] = useState(false)   
    const [isNostrDMModalVisible, setIsNostrDMModalVisible] = useState(false)
    const [isProofSelectorModalVisible, setIsProofSelectorModalVisible] = useState(false) // offline mode
    const [isSendTaskSentToQueue, setIsSendTaskSentToQueue] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [isNostrDMSending, setIsNostrDMSending] = useState(false)
    const [isNostrDMSuccess, setIsNostrDMSuccess] = useState(false)
    
    const [isPubkeySelectorModalVisible, setIsPubkeySelectorModalVisible] = useState(false)
    const [lockedPubkey, setLockedPubkey] = useState<string | undefined>() // Added lockedPubkey state
    const [lockTime, setLockTime] = useState<number | undefined>(1)

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
                    setMintBalanceToSendFrom(mintBalance)
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

    // Send to contact
    useFocusEffect(
        useCallback(() => {

            const {paymentOption, contact} = route.params

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
                    
                    setPaymentOption(SendOption.SEND_TOKEN)
                    setContactToSendFrom(getContactFrom())                
                    setContactToSendTo(contact)                
                    setRelaysToShareTo(relays)

                    if(encodedTokenToSend) {
                        toggleNostrDMModal() // open if we already have a token
                    }

                    //reset
                    //@ts-ignore
                    navigation.setParams({
                        paymentOption: undefined,
                        contact: undefined
                    })
                    
                } catch(e: any) {
                    handleError(e)
                }
            }
            
            
            const handlePaymentRequest = async () => {
                try {
                    setPaymentOption(SendOption.PAY_CASHU_PAYMENT_REQUEST)
                    setContactToSendFrom(getContactFrom())                   

                    const {encodedCashuPaymentRequest, draftTransactionId} = route.params

                    if(draftTransactionId) {
                        draftTransactionIdRef.current = draftTransactionId
                    }

                    if (!encodedCashuPaymentRequest) {                    
                        throw new AppError(Err.VALIDATION_ERROR, 'Missing encodedCashuPaymentRequest.')
                    }
            
                    const pr: CashuPaymentRequest = decodePaymentRequest(encodedCashuPaymentRequest)

                    setDecodedCashuPaymentRequest(pr)
                    setEncodedCashuPaymentRequest(encodedCashuPaymentRequest)

                    const transports: PaymentRequestTransport[] = pr.transport
                    
                    for (const transport of transports) {

                        if (transport.type == PaymentRequestTransportType.NOSTR) {

                            const decoded = NostrClient.decodeNprofile(transport.target)
                            const pubkey = (decoded.data as ProfilePointer).pubkey                            
                            const npub = NostrClient.getNpubkey(pubkey)
                            let relays = (decoded.data as ProfilePointer).relays?.slice(0, 5)

                            if(!relays || relays.length === 0) {
                                relays = NostrClient.getAllRelays()
                            }

                            let contactTo = {                        
                                pubkey,
                                npub,                                                       
                            } as Contact

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
                            
                            setContactToSendTo(contactTo)
                            setRelaysToShareTo(relays)
                        }

                        if (transport.type == PaymentRequestTransportType.POST) {
                            throw new AppError(Err.VALIDATION_ERROR, 'Payment requests with POST transport are not supported yet.')
                        }                        
                    }

                    log.trace('[handlePaymentRequest]', {pr})

                    if(pr.unit && !MintUnits.includes(pr.unit as MintUnit)) {
                        throw new AppError(Err.NOTFOUND_ERROR, `Wallet does not support ${pr.unit} unit.`)
                    }
                    
                    if (pr.unit) {
                        unitRef.current = pr.unit as MintUnit
                    }

                    if (pr.description && pr.description.length > 0) {
                        setMemo(pr.description)
                        setIsCashuPrWithDesc(true)
                    }

                    if (pr.amount) {
                        setAmountToSend(`${numbro(pr.amount / getCurrency(unitRef.current).precision)
                        .format({
                          thousandSeparated: true, 
                          mantissa: getCurrency(unitRef.current).mantissa
                        })}`)

                        setIsCashuPrWithAmount(true)
                    }

                    const availableBalances: MintBalance[] = []

                    if (pr.mints && pr.mints.length > 0) {                        

                        for (const mint of pr.mints) {
                            if (mintsStore.mintExists(mint)) {
                                const mintBalance = proofsStore.getMintBalance(mint)   
                                availableBalances.push(mintBalance!)
                            }
                        }

                        if (availableBalances.length === 0) {
                            throw new AppError(Err.NOTFOUND_ERROR, 'Wallet does not have any of the mints accepted by Cashu payment request.', {mints: pr.mints})
                        }
                        
                        const withEnoughBalance = availableBalances.filter(balance => {
                            const unitBalance = balance.balances[unitRef.current]

                            if(!pr.amount) {
                                return balance
                            }
                            
                            if(pr.amount && pr.amount > 0 && unitBalance && unitBalance >= pr.amount) {
                                return balance
                            }

                            return null                             
                        })
                        
                        setAvailableMintBalances(withEnoughBalance)
                        setMintBalanceToSendFrom(withEnoughBalance[0])  

                    } else {
                        let withEnoughBalance: MintBalance[] = []

                        if(pr.amount && pr.amount > 0) {
                            withEnoughBalance = proofsStore.getMintBalancesWithEnoughBalance(pr.amount, unitRef.current)
                            setAvailableMintBalances(withEnoughBalance)
                        } else {
                            withEnoughBalance = proofsStore.getMintBalancesWithUnit(unitRef.current)
                            setAvailableMintBalances(withEnoughBalance)
                        }

                        setMintBalanceToSendFrom(withEnoughBalance[0])
                    }
                    
                    setIsMintSelectorVisible(true)

                    //reset
                    //@ts-ignore
                    navigation.setParams({
                        paymentOption: undefined,
                        encodedCashuPaymentRequest: undefined
                    })
                    
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

    // Scan pubkey to lock to
    useEffect(() => {   
        const {scannedPubkey} = route.params
        log.trace('[useEffect]', scannedPubkey)

        const handleScannedPubkey = () => {
            setLockedPubkey(scannedPubkey)
            setIsPubkeySelectorModalVisible(true)
        }

        if(scannedPubkey) {
            handleScannedPubkey()
        }        
    }, [route.params?.scannedPubkey])
    

    
    // Offline send
    useEffect(() => {        
        if(isInternetReachable) return
        log.trace('[Offline send]')

        // if offline we set all non-zero mint balances as available to allow ecash selection
        const availableBalances = proofsStore.getMintBalancesWithEnoughBalance(1, unitRef.current)

        if (availableBalances.length === 0) {
            setInfo('There are not enough funds to send')
            return
        }
        
        log.trace('Setting availableBalances')

        setIsOfflineSend(true)
        setAvailableMintBalances(availableBalances)
        setMintBalanceToSendFrom(availableBalances[0])        
        setIsMintSelectorVisible(true)      
    }, [isInternetReachable])


    useEffect(() => {
        const handleSendTaskResult = async (result: TransactionTaskResult) => {
            log.trace('handleSendTaskResult event handler triggered')
            
            setIsLoading(false)

            const {transaction} = result

            setTransactionStatus(transaction?.status)
            setTransaction(transaction)
            setTransactionId(transaction?.id)
    
            if (result.encodedTokenToSend) {
                setEncodedTokenToSend(result.encodedTokenToSend)
            }

            if(paymentOption === SendOption.PAY_CASHU_PAYMENT_REQUEST) {  
                if(decodedCashuPaymentRequest && decodedCashuPaymentRequest.id) {

                    transaction.update({
                        paymentId: decodedCashuPaymentRequest.id,
                        paymentRequest: encodedCashuPaymentRequest,
                        profile: JSON.stringify(contactToSendFrom),
                        sentTo: contactToSendTo.nip05 || contactToSendTo.name,        // payee
                        sentFrom: contactToSendFrom.nip05 || contactToSendFrom.name   // payer
                    })
                }
            }

            if (result.error) {
                setResultModalInfo({
                    status: result.transaction?.status as TransactionStatus,
                    title: result.error.params?.message ? result.error.message : 'Send failed',
                    message: result.error.params?.message || result.error.message,
                })
                setIsResultModalVisible(true)
                return
            }
    
            setIsMintSelectorVisible(false)   
    
            if (paymentOption === SendOption.SEND_TOKEN) {
                toggleNostrDMModal()
            }
            
            if (paymentOption === SendOption.PAY_CASHU_PAYMENT_REQUEST) {
                toggleNostrDMModal()
            }
        }

        // Subscribe to the 'sendCompleted' event
        if(isSendTaskSentToQueue) {
            EventEmitter.on(`ev_${SEND_TASK}_result`, handleSendTaskResult)
        }        

        // Unsubscribe from the 'sendCompleted' event on component unmount
        return () => {
            EventEmitter.off(`ev_${SEND_TASK}_result`, handleSendTaskResult)
        }
    }, [isSendTaskSentToQueue])


    useEffect(() => {
        const handleSendCompleted = async (result: SyncStateTaskResult) => {
            log.trace('handleSendCompleted event handler triggered')

            if (!transactionId) return
            // Filter and handle event related only to this transactionId
            if (result.completedTransactionIds && result.completedTransactionIds.includes(transactionId)) {
                log.trace(
                    'Sent ecash has been claimed by the receiver for tx',
                    transactionId,
                )

                const amountSentInt = round(toNumber(amountToSend) * getCurrency(unitRef.current).precision, 0)                

                setIsNostrDMModalVisible(false)
                setIsProofSelectorModalVisible(false)
                setResultModalInfo({
                    status: TransactionStatus.COMPLETED,
                    title:  '🚀 That was fast!',                   
                    message: `${formatCurrency(amountSentInt, getCurrency(unitRef.current).code)} ${getCurrency(unitRef.current).code} were received by the payee.`,
                })                
                setTransactionStatus(TransactionStatus.COMPLETED)
                setIsResultModalVisible(true)
            }

            // sync check might end with error in case tx proofs spentAmount !== tx amount
            if (result.errorTransactionIds && 
                result.errorTransactionIds.includes(transactionId)) {

                log.trace(
                    'Error when completing the send tx',
                    {transactionId},
                )

                const statusUpdate = result.transactionStateUpdates.find(update => update.tId === transactionId)                
                const message = statusUpdate?.message || 'Error when completing the transaction.'

                setIsNostrDMModalVisible(false)
                setIsProofSelectorModalVisible(false)
                setResultModalInfo({
                    status: TransactionStatus.ERROR,
                    title:  'Send failed',                   
                    message,
                })                
                setTransactionStatus(TransactionStatus.ERROR)
                setIsResultModalVisible(true)
            }            
        }

        // Subscribe to the '_syncStateWithMintTask' event
        if(transactionId) {
            EventEmitter.on(`ev_${SYNC_STATE_WITH_MINT_TASK}_result`, handleSendCompleted)
        }

        // Unsubscribe from the '_syncStateWithMintTask' event on component unmount
        return () => {
            EventEmitter.off(`ev_${SYNC_STATE_WITH_MINT_TASK}_result`, handleSendCompleted)
        }
    }, [transactionId])
       
    const toggleNostrDMModal = () => setIsNostrDMModalVisible(previousState => !previousState)
    const toggleProofSelectorModal = () => setIsProofSelectorModalVisible(previousState => !previousState)
    const toggleResultModal = () => setIsResultModalVisible(previousState => !previousState)
    // const toggleIsLockedToPubkey = () => setIsLockedToPubkey(previousState => !previousState)
    const togglePubkeySelectorModal = () => setIsPubkeySelectorModalVisible(previousState => !previousState)

  const onAmountEndEditing = function () {
    try {
      if (amountToSend.trim() === "") { setAmountToSend("0"); }

      const precision = getCurrency(unitRef.current).precision
      const amount = round(toNumber(amountToSend) * precision, 0)

      log.trace('[onAmountEndEditing]', amount)

      if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
        infoMessage(translate('payCommon_amountZeroOrNegative'))
        return;
      }

      if (isInternetReachable) {
        handleOnlineEndEdit(amount)
      } else {
        const availableProofs = proofsStore.getByMint(mintBalanceToSendFrom.mintUrl, { isPending: false, unit: unitRef.current });
        handleOfflineEndEdit(amount, availableProofs);
      }
    } catch (e: any) {
      handleError(e)
    }
  }

  const handleOnlineEndEdit = (amount: number) => {
    try {
      const availableBalances = proofsStore.getMintBalancesWithEnoughBalance(amount, unitRef.current)

      if (availableBalances.length === 0) {
        infoMessage(translate('payCommon_insufficientFunds'))
        return
      }

      LayoutAnimation.easeInEaseOut()
      setAvailableMintBalances(availableBalances)

      // Default mint if not set from route params is the one with the highest balance
      if (!mintBalanceToSendFrom) {
        setMintBalanceToSendFrom(availableBalances[0])
      }

      LayoutAnimation.easeInEaseOut()
      setIsMintSelectorVisible(true)
    } catch (e: any) {
      handleError(e);
    }
  }

  const handleOfflineEndEdit = (amount: number, availableProofs: Proof[]) => {
    try {
      const proofsToSend = CashuUtils.getProofsToSend(amount, availableProofs)
      const isExactMatch = CashuUtils.getProofsAmount(proofsToSend) === amount;

      // Clear current selection and set the new proofs
      resetSelectedProofs();
      proofsToSend.forEach(proof => toggleSelectedProof(proof))

      log.trace("requested amount:", amount)
      log.trace("best match:", CashuUtils.getProofsAmount(proofsToSend));
      log.trace({ isExactMatch })

      if (!isExactMatch) {
        setIsProofSelectorModalVisible(true);
      }
    } catch (error: any) {
      // If CashuUtils.getProofsToSend throws an error (insufficient funds) -> show it
      infoMessage(translate('payCommon_insufficientFunds'))
    }
  }

  const onMemoEndEditing = function () {
    LayoutAnimation.easeInEaseOut()

    // Show mint selector
    if (availableMintBalances.length > 0) {
      setIsMintSelectorVisible(true)
    }
  }


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
    setMintBalanceToSendFrom(balance)
  }


  const onLockPubkeyStart = function () {
    togglePubkeySelectorModal()
  }

    const onLockPubkeySelect = function () {
        if(!lockedPubkey || lockedPubkey.length === 0) {
            onLockPubkeyCancel()
            return
        }

        if(lockedPubkey.startsWith('nsec')) {
            throw new AppError(Err.VALIDATION_ERROR, 'Invalid key. Please provide public key in NPUB or HEX format.')
        }

        const contact = contactsStore.findByNpub(lockedPubkey) || contactsStore.findByPubkey(lockedPubkey)

        if(contact) {
            log.trace('[onLockPubkeySelect] Provided pubkey belongs to a contact', {contactName: contact.name})
            let relays: string[] = []                           

            if(contact?.type === ContactType.PUBLIC) {
                relays = relaysStore.allPublicUrls
            } else {
                relays = relaysStore.allUrls
            }
    
            if (relays.length === 0) {                    
                throw new AppError(Err.VALIDATION_ERROR, 'Missing NOSTR relays')
            }
            
            setPaymentOption(SendOption.SEND_TOKEN)
            setContactToSendFrom(getContactFrom())                
            setContactToSendTo(contact)                
            setRelaysToShareTo(relays)
        }
        
        togglePubkeySelectorModal()
    }

    const onLockPubkeyCancel = function () { 
        togglePubkeySelectorModal()
        setLockedPubkey(undefined)
        setContactToSendTo(undefined)
    }


    const onMintBalanceConfirm = async function () {
        if (!mintBalanceToSendFrom) {
            return
        }       

        setIsLoading(true)       
        const amountToSendInt = round(toNumber(amountToSend) * getCurrency(unitRef.current).precision, 0)

        //@ts-ignore
        const p2pk: { 
            pubkey: string; 
            locktime?: number; 
            refundKeys?: Array<string> 
        } | undefined = undefined

        log.trace('[onMintBalanceConfirm] lockedPubkey', {lockedPubkey})

        if(lockedPubkey && lockedPubkey.length > 0) {
            if(lockedPubkey.startsWith('npub')) {
                p2pk.pubkey = '02' + NostrClient.getHexkey(lockedPubkey)
            } else {
                if(lockedPubkey.length === 64) {
                    p2pk.pubkey = '02' + lockedPubkey
                } else if(lockedPubkey.length === 66) {
                    p2pk.pubkey = lockedPubkey
                } else {
                    throw new AppError(Err.VALIDATION_ERROR, 'Invalid key. Please provide public key in NPUB or HEX format.')
                }    
            }
            
            if(lockTime && lockTime > 0) {
                p2pk.locktime = getUnixTime(new Date(Date.now() + lockTime * 24 * 60 * 60))
                log.trace('[onMintBalanceConfirm] Locktime', {pubkey: p2pk.pubkey, locktime: p2pk.locktime})
            }
        }

        setIsSendTaskSentToQueue(true)

        WalletTask.sendQueue(
            mintBalanceToSendFrom as MintBalance,
            amountToSendInt,
            unitRef.current,
            memo,
            selectedProofs,
            p2pk,
            draftTransactionIdRef.current
        )
    }


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


    const onSelectProofsOffline = async function () {
        if (!mintBalanceToSendFrom) {
            return
        }       

        setIsProofSelectorModalVisible(true)
    }


    const onMintBalanceCancel = async function () {
        resetState()
        gotoWallet()
    }


    const sendAsNostrDM = async function () {
        try {
            if(!contactToSendFrom || !contactToSendTo) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing sender or receiver information.')
            }

            if(!encodedTokenToSend) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing token to send.')
            }

            setIsNostrDMSending(true)
            let messageContent: string | undefined = undefined

            if(paymentOption === SendOption.SEND_TOKEN) {
                const message = `nostr:${contactToSendFrom.npub} sent you ${amountToSend} ${getCurrency(unitRef.current).code} from Minibits wallet!`
                messageContent = message + ' \n' + encodedTokenToSend
            }

            if(paymentOption === SendOption.PAY_CASHU_PAYMENT_REQUEST) {   
                if(!decodedCashuPaymentRequest) {
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing payment request to pay.')
                }

                const decodedTokenToSend = getDecodedToken(encodedTokenToSend)
                
                messageContent = JSON.stringify({
                    id: decodedCashuPaymentRequest.id,
                    mint: decodedTokenToSend.mint,
                    unit: decodedTokenToSend.unit,
                    proofs: decodedTokenToSend.proofs,
                })
            }

            const sentEvent = await NostrClient.encryptAndSendDirectMessageNip17(                
                contactToSendTo.pubkey, 
                messageContent!,
                relaysToShareTo
            )
            
            setIsNostrDMSending(false)

            if(sentEvent) {                
                setIsNostrDMSuccess(true)

                if(!transactionId) {
                    return
                }

                const transaction = transactionsStore.findById(transactionId)

                if(!transaction || !transaction.data) {
                    return
                }

                let updated = []

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
                setInfo('Nostr relays could not confirm that the message has been sent')
            }
        } catch (e: any) {
            handleError(e)
        }
    }


    const toggleSelectedProof = function (proof: Proof) {
        setSelectedProofs(prevSelectedProofs => {
          const isSelected = prevSelectedProofs.some(
            p => p.secret === proof.secret
          )
  
          if (isSelected) {
            // If the proof is already selected, remove it from the array            
            setAmountToSend(`${parseInt(amountToSend) - proof.amount}`)
            return prevSelectedProofs.filter(p => p.secret !== proof.secret)
          } else {
            // If the proof is not selected, add it to the array            
            setAmountToSend(`${(parseInt(amountToSend) || 0) + proof.amount}`)
            return [...prevSelectedProofs, proof]
          }
        })
    }

    const resetSelectedProofs = function () {
        setSelectedProofs([])
        setAmountToSend('0')
    }


    const onOfflineSendConfirm = function () {
        toggleProofSelectorModal() // close
        onMintBalanceConfirm()
    }

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
        // reset state so it does not interfere next payment
        setAmountToSend('')
        setMemo('')                
        setIsMintSelectorVisible(false)
        setIsNostrDMModalVisible(false)        
        setIsNostrDMSending(false)
        setIsNostrDMModalVisible(false)
        setIsProofSelectorModalVisible(false)
        setIsLoading(false)
        setResultModalInfo(undefined)
        setIsResultModalVisible(false)
        setLockTime(undefined)        
        setLockedPubkey(undefined)
    }


    const handleError = function(e: AppError): void {
        // TODO resetState() on all tx data on error? Or save txId to state and allow retry / recovery?
        setIsNostrDMSending(false)
        setIsProofSelectorModalVisible(false)
        setIsNostrDMModalVisible(false)
        setIsLoading(false)
        setError(e)
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
            mintUrl: mintBalanceToSendFrom.mintUrl
        })        
    }

    const convertedAmountColor = useThemeColor('headerSubTitle')    

    const getConvertedAmount = function () {
        if (!walletStore.exchangeRate) {
            return undefined
        }

        const precision = getCurrency(unitRef.current).precision
        return convertToFromSats(
            round(toNumber(amountToSend) * precision, 0) || 0, 
            getCurrency(unitRef.current).code,
            walletStore.exchangeRate
        )
    }

    const isConvertedAmountVisible = function () {
        return (
        walletStore.exchangeRate &&
        (userSettingsStore.exchangeCurrency === getCurrency(unitRef.current).code ||
        unitRef.current === 'sat') &&
        getConvertedAmount() !== undefined
        )
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
                    onEndEditing={onAmountEndEditing}
                    editable={(transactionStatus === TransactionStatus.PENDING || isCashuPrWithAmount)
                        ? false 
                        : true
                    }
                    style={{color: amountInputColor}}
                />
                {isConvertedAmountVisible() && ( 
                    <CurrencyAmount
                        amount={getConvertedAmount() ?? 0}
                        currencyCode={unitRef.current === 'sat' ? userSettingsStore.exchangeCurrency : CurrencyCode.SAT}
                        symbolStyle={{color: convertedAmountColor, marginTop: spacing.tiny, fontSize: verticalScale(10)}}
                        amountStyle={{color: convertedAmountColor, lineHeight: spacing.small}}                        
                        size='small'
                        containerStyle={{justifyContent: 'center'}}
                    />
                )}
                {lockedPubkey ? (
                    <View
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: isConvertedAmountVisible() ? -spacing.extraSmall : undefined
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
                            marginTop: isConvertedAmountVisible() ? -spacing.extraSmall : undefined
                        }}
                    />
                )}
            </View>          
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
                    title='Send from mint'
                    confirmTitle={isOfflineSend ? 'Send offline' : 'Create token'}                    
                    secondaryConfirmTitle='Lock'                    
                    onMintBalanceSelect={onMintBalanceSelect}
                    onSecondaryMintBalanceSelect={onLockPubkeyStart}
                    onCancel={onMintBalanceCancel}                                           
                    onMintBalanceConfirm={isOfflineSend ? onSelectProofsOffline : onMintBalanceConfirm}
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
                // isLockedToPubkey={isLockedToPubkey}          
                // toggleIsLockedToPubkey={toggleIsLockedToPubkey}    
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
                        {resultModalInfo.message.includes('outputs have already been signed before') ? (
                            <Button
                                preset="secondary"
                                text={"Retry again"}
                                onPress={increaseProofsCounterAndRetry}
                            />
                        ) : resultModalInfo.message.includes('Token already spent') || resultModalInfo.message.includes('Some spent ecash') ? (
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
  // isLockedToPubkey: boolean
  toggleProofSelectorModal: any
  toggleSelectedProof: any
  // toggleIsLockedToPubkey: any
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
          text={'OFFLINE MODE'}
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
      <Text
        tx='sendOfflineExactDenoms'
        style={{ color: hintColor, paddingHorizontal: spacing.small, textAlign: 'center' }}
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
                        preset='secondary'
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
                        preset='secondary'
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

    const {walletProfileStore} = useStores()
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
}

const $amountInput: TextStyle = {    
   borderRadius: spacing.small,
    margin: 0,
    padding: 0,
    fontSize: verticalScale(48),
    fontFamily: typography.primary?.medium,
    textAlign: 'center',
    color: 'white',    
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


