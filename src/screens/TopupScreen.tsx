import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState, useReducer, useRef, useCallback} from 'react'
import {
  UIManager,
  Platform,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
  LayoutAnimation,
  ScrollView,
  Image,
  ImageStyle,
} from 'react-native'
import {spacing, useThemeColor, colors, typography} from '../theme'
import {
  Button,
  Icon,
  Card,
  Screen,
  Loading,
  InfoModal,
  ErrorModal,
  ListItem,
  BottomModal,
  Text,
  AmountInput,
} from '../components'
import {TransactionStatus, Transaction, TransactionData} from '../models/Transaction'
import {useStores} from '../models'
import {
  HANDLE_PENDING_TOPUP_TASK,
  NostrClient,
  NostrProfile,
  TransactionTaskResult,
  WalletTask,
} from '../services'
import {log} from '../services/logService'
import AppError, {Err} from '../utils/AppError'

import {Mint, MintBalance} from '../models/Mint'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {StackActions, StaticScreenProps, useFocusEffect, useNavigation} from '@react-navigation/native'
import {Contact, ContactType} from '../models/Contact'
import {getImageSource, infoMessage} from '../utils/utils'
import {ReceiveOption} from './ReceiveScreen'
import {LNURLWithdrawParams} from 'js-lnurl'
import {round, roundDown, roundUp, toNumber} from '../utils/number'
import {LnurlClient, LnurlWithdrawResult} from '../services/lnurlService'
import {
  verticalScale,
} from '@gocodingnow/rn-size-matters'

import { CurrencyAmount } from './Wallet/CurrencyAmount'
import {
  CurrencyCode,
  MintUnit,  
  getCurrency,
  convertToFromSats
} from '../services/wallet/currency'
import {MintHeader} from './Mints/MintHeader'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import {MintBalanceSelector} from './Mints/MintBalanceSelector'
import {QRCodeBlock} from './Wallet/QRCode'
import numbro from 'numbro'
import {TranItem} from './TranDetailScreen'
import {translate} from '../i18n'
import { TOPUP_TASK } from '../services/wallet/topupTask'
import FastImage from 'react-native-fast-image'

type Props = StaticScreenProps<{
  unit: MintUnit,
  paymentOption?: ReceiveOption,
  contact?: Contact,
  lnurlParams?: LNURLWithdrawParams,
  mintUrl?: string, 
}>

// ─── State machine ───────────────────────────────────────────────────────────

type TopupState = {
    paymentOption: ReceiveOption
    contactToSendFrom: Contact | undefined
    contactToSendTo: Contact | undefined
    relaysToShareTo: string[]
    lnurlWithdrawParams: LNURLWithdrawParams | undefined
    availableMintBalances: MintBalance[]
    mintBalanceToTopup: MintBalance | undefined
    transactionStatus: TransactionStatus | undefined
    transactionId: number | undefined
    transaction: Transaction | undefined
    invoiceToPay: string
    lnurlWithdrawResult: LnurlWithdrawResult | undefined
    resultModalInfo: { status: TransactionStatus; title?: string; message: string } | undefined
    isLoading: boolean
    isMintSelectorVisible: boolean
    isNostrDMModalVisible: boolean
    isWithdrawModalVisible: boolean
    isTopupTaskSentToQueue: boolean
    isResultModalVisible: boolean
    isNostrDMSending: boolean
    isNostrDMSuccess: boolean
    isWithdrawRequestSending: boolean
    isWithdrawRequestSuccess: boolean
    info: string
    error: AppError | undefined
}

type TopupAction =
    | { type: 'SET_MINT_BALANCE'; balance: MintBalance }
    | { type: 'PREPARE_SEND_TO_CONTACT'; contactFrom: Contact; contactTo: Contact; relays: string[]; paymentOption: ReceiveOption }
    | { type: 'PREPARE_LNURL_WITHDRAW'; lnurlWithdrawParams: LNURLWithdrawParams }
    | { type: 'SHOW_MINT_SELECTOR'; availableMintBalances: MintBalance[]; defaultMint?: MintBalance }
    | { type: 'HIDE_MINT_SELECTOR' }
    | { type: 'TOPUP_START' }
    | { type: 'INVOICE_READY'; transactionId: number; transactionStatus: TransactionStatus; encodedInvoice: string }
    | { type: 'TOPUP_FAILED'; transactionStatus: TransactionStatus; resultModalInfo: { status: TransactionStatus; title?: string; message: string } }
    | { type: 'TOPUP_COMPLETE'; transaction: Transaction; resultModalInfo: { status: TransactionStatus; message: string } }
    | { type: 'DM_SENDING' }
    | { type: 'DM_SENT' }
    | { type: 'WITHDRAW_SENDING' }
    | { type: 'WITHDRAW_SUCCESS'; result: LnurlWithdrawResult }
    | { type: 'WITHDRAW_FAILED'; resultModalInfo: { status: TransactionStatus; message: string } }
    | { type: 'TOGGLE_NOSTR_DM_MODAL' }
    | { type: 'TOGGLE_WITHDRAW_MODAL' }
    | { type: 'TOGGLE_RESULT_MODAL' }
    | { type: 'SET_INFO'; message: string }
    | { type: 'SET_ERROR'; error: AppError }
    | { type: 'RESET' }

const INITIAL_STATE: TopupState = {
    paymentOption: ReceiveOption.SHOW_INVOICE,
    contactToSendFrom: undefined,
    contactToSendTo: undefined,
    relaysToShareTo: [],
    lnurlWithdrawParams: undefined,
    availableMintBalances: [],
    mintBalanceToTopup: undefined,
    transactionStatus: undefined,
    transactionId: undefined,
    transaction: undefined,
    invoiceToPay: '',
    lnurlWithdrawResult: undefined,
    resultModalInfo: undefined,
    isLoading: false,
    isMintSelectorVisible: false,
    isNostrDMModalVisible: false,
    isWithdrawModalVisible: false,
    isTopupTaskSentToQueue: false,
    isResultModalVisible: false,
    isNostrDMSending: false,
    isNostrDMSuccess: false,
    isWithdrawRequestSending: false,
    isWithdrawRequestSuccess: false,
    info: '',
    error: undefined,
}

function topupReducer(state: TopupState, action: TopupAction): TopupState {
    switch (action.type) {

        case 'SET_MINT_BALANCE':
            return { ...state, mintBalanceToTopup: action.balance }

        case 'PREPARE_SEND_TO_CONTACT':
            return {
                ...state,
                paymentOption: action.paymentOption,
                contactToSendFrom: action.contactFrom,
                contactToSendTo: action.contactTo,
                relaysToShareTo: action.relays,
                // open immediately if invoice was already created before contact was selected
                isNostrDMModalVisible: !!state.invoiceToPay,
            }

        case 'PREPARE_LNURL_WITHDRAW':
            return {
                ...state,
                paymentOption: ReceiveOption.LNURL_WITHDRAW,
                lnurlWithdrawParams: action.lnurlWithdrawParams,
            }

        case 'SHOW_MINT_SELECTOR':
            return {
                ...state,
                availableMintBalances: action.availableMintBalances,
                mintBalanceToTopup: action.defaultMint ?? state.mintBalanceToTopup,
                isMintSelectorVisible: true,
            }

        case 'HIDE_MINT_SELECTOR':
            return { ...state, isMintSelectorVisible: false }

        case 'TOPUP_START':
            return { ...state, isLoading: true, isTopupTaskSentToQueue: true }

        case 'INVOICE_READY':
            return {
                ...state,
                isLoading: false,
                transactionId: action.transactionId,
                transactionStatus: action.transactionStatus,
                invoiceToPay: action.encodedInvoice,
                isMintSelectorVisible: false,
                isNostrDMModalVisible: state.paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST,
                isWithdrawModalVisible: state.paymentOption === ReceiveOption.LNURL_WITHDRAW,
            }

        case 'TOPUP_FAILED':
            return {
                ...state,
                isLoading: false,
                transactionStatus: action.transactionStatus,
                resultModalInfo: action.resultModalInfo,
                isResultModalVisible: true,
            }

        case 'TOPUP_COMPLETE':
            return {
                ...state,
                transactionStatus: TransactionStatus.COMPLETED,
                transaction: action.transaction,
                resultModalInfo: action.resultModalInfo,
                isNostrDMModalVisible: false,
                isWithdrawModalVisible: false,
                isResultModalVisible: true,
            }

        case 'DM_SENDING':
            return { ...state, isNostrDMSending: true }

        case 'DM_SENT':
            return { ...state, isNostrDMSending: false, isNostrDMSuccess: true }

        case 'WITHDRAW_SENDING':
            return { ...state, isWithdrawRequestSending: true }

        case 'WITHDRAW_SUCCESS':
            return {
                ...state,
                isWithdrawRequestSending: false,
                isWithdrawRequestSuccess: true,
                lnurlWithdrawResult: action.result,
            }

        case 'WITHDRAW_FAILED':
            return {
                ...state,
                isWithdrawRequestSending: false,
                resultModalInfo: action.resultModalInfo,
                isWithdrawModalVisible: false,
                isResultModalVisible: true,
            }

        case 'TOGGLE_NOSTR_DM_MODAL':
            return { ...state, isNostrDMModalVisible: !state.isNostrDMModalVisible }

        case 'TOGGLE_WITHDRAW_MODAL':
            return { ...state, isWithdrawModalVisible: !state.isWithdrawModalVisible }

        case 'TOGGLE_RESULT_MODAL':
            return { ...state, isResultModalVisible: !state.isResultModalVisible }

        case 'SET_INFO':
            return { ...state, info: action.message }

        case 'SET_ERROR':
            return {
                ...state,
                isLoading: false,
                isTopupTaskSentToQueue: false,
                isNostrDMSending: false,
                isWithdrawRequestSending: false,
                error: action.error,
            }

        case 'RESET':
            return { ...INITIAL_STATE }

        default:
            return state
    }
}

// ─── Component ───────────────────────────────────────────────────────────────

export const TopupScreen = observer(function TopupScreen({ route }: Props) {
    const navigation = useNavigation()
    const isInternetReachable = useIsInternetReachable()

    const {
      proofsStore,
      mintsStore,
      walletProfileStore,
      transactionsStore,
      relaysStore,
      walletStore,
      userSettingsStore
    } = useStores()
    const amountInputRef = useRef<TextInput>(null)
    const memoInputRef = useRef<TextInput>(null)
    const unitRef = useRef<MintUnit>('sat')
    // const tokenInputRef = useRef<TextInput>(null)

    const [state, dispatch] = useReducer(topupReducer, INITIAL_STATE)
    // User-input state kept separate to avoid rebuilding the full state object on every keystroke.
    const [amountToTopup, setAmountToTopup] = useState<string>('0')
    const [memo, setMemo] = useState('')

    const {
        paymentOption,
        contactToSendFrom,
        contactToSendTo,
        relaysToShareTo,
        lnurlWithdrawParams,
        availableMintBalances,
        mintBalanceToTopup,
        transactionStatus,
        transactionId,
        transaction,
        invoiceToPay,
        lnurlWithdrawResult,
        resultModalInfo,
        isLoading,
        isMintSelectorVisible,
        isNostrDMModalVisible,
        isWithdrawModalVisible,
        isTopupTaskSentToQueue,
        isResultModalVisible,
        isNostrDMSending,
        isNostrDMSuccess,
        isWithdrawRequestSending,
        isWithdrawRequestSuccess,
        info,
        error,
    } = state

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
          if (!unit) {
            throw new AppError(
              Err.VALIDATION_ERROR,
              translate('missingMintUnitRouteParamsError')
            )
          }

          unitRef.current = unit

          if (mintUrl) {
            const mintBalance = proofsStore.getMintBalance(mintUrl)
            if (mintBalance) {
              dispatch({ type: 'SET_MINT_BALANCE', balance: mintBalance })
            }
          }
        } catch (e: any) {
          handleError(e)
        }
      }

      setUnitAndMint()
      return () => {}
    }, [])

    // Send to contact and LNURL withdraw topup inititalization
    useFocusEffect(
      useCallback(() => {
        const {paymentOption, contact} = route.params

        const prepareSendToContact = () => {
          try {
            let relays: string[] = []
            log.trace(
              '[prepareSendToContact] selected contact',
              contact,
              paymentOption,
            )

            if (contact?.type === ContactType.PUBLIC) {
              relays = relaysStore.allPublicUrls
            } else {
              relays = relaysStore.allUrls
            }

            if (!relays) {
              throw new AppError(Err.VALIDATION_ERROR, translate("nostr_missingRelaysError"))
            }

            const {pubkey, npub, name, picture} = walletProfileStore

            const contactFrom: Contact = {
              pubkey,
              npub,
              name,
              picture,
            }

            dispatch({
              type: 'PREPARE_SEND_TO_CONTACT',
              paymentOption: paymentOption!,
              contactFrom,
              contactTo: contact!,
              relays,
            })

            // @ts-ignore
            navigation.setParams({
              paymentOption: undefined,
              contact: undefined,
            })
          } catch (e: any) {
            handleError(e)
          }
        }

        const prepareLnurlWithdraw = () => {
          try {
            const {lnurlParams} = route.params
            if (!lnurlParams) {
              throw new AppError(Err.VALIDATION_ERROR, translate("missingLNURLParamsError"))
            }

            const amountSats = roundDown(lnurlParams.maxWithdrawable / 1000, 0)

            setAmountToTopup(`${amountSats}`)
            setMemo(lnurlParams.defaultDescription)
            dispatch({ type: 'PREPARE_LNURL_WITHDRAW', lnurlWithdrawParams: lnurlParams })
          } catch (e: any) {
            handleError(e)
          }
        }

        if (
          paymentOption &&
          contact &&
          paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST
        ) {
          prepareSendToContact()
        }

        if (paymentOption && paymentOption === ReceiveOption.LNURL_WITHDRAW) {
          prepareLnurlWithdraw()
        }
      }, [route.params?.paymentOption]),
    )



    useEffect(() => {
      const handlePendingTopupTaskResult = (result: TransactionTaskResult) => {
        log.trace('[handlePendingTopupTaskResult] event handler triggered')

        if (!transactionId) return
        if (result.transaction?.id !== transactionId) return
        if (result.transaction.status !== TransactionStatus.COMPLETED) return

        log.trace(
          '[handlePendingTopupTaskResult]',
          'Invoice has been paid and new proofs received',
        )

        dispatch({
          type: 'TOPUP_COMPLETE',
          transaction: result.transaction,
          resultModalInfo: {
            status: result.transaction.status,
            message: result.message,
          },
        })
        
      }

      if(transactionId) {
        EventEmitter.on(
          `ev_${HANDLE_PENDING_TOPUP_TASK}_result`,
          handlePendingTopupTaskResult,
        )
      }

      return () => {
        EventEmitter.off(
          `ev_${HANDLE_PENDING_TOPUP_TASK}_result`,
          handlePendingTopupTaskResult,
        )
      }
    }, [transactionId])

    const toggleNostrDMModal = () => dispatch({ type: 'TOGGLE_NOSTR_DM_MODAL' })
    const toggleWithdrawModal = () => dispatch({ type: 'TOGGLE_WITHDRAW_MODAL' })
    const toggleResultModal = () => dispatch({ type: 'TOGGLE_RESULT_MODAL' })

    const onAmountEndEditing = function () {
      log.trace("[onAmountEndEditing] called")
      
      if(isTopupTaskSentToQueue) {
        log.trace('[onAmountEndEditing] Topup task already sent to queue, ignoring further edits')
        return 
      }

      try {
        const precision = getCurrency(unitRef.current).precision
        const mantissa = getCurrency(unitRef.current).mantissa
        const amount = round(toNumber(amountToTopup) * precision, 0)

        log.trace('[onAmountEndEditing]', {amount, unit: unitRef.current})

        if (!isInternetReachable) {
          dispatch({ type: 'SET_INFO', message: translate('commonOfflinePretty') })
        }

        if (!amount || amount === 0) {
          infoMessage(translate('payCommon_amountZeroOrNegative'))
          return
        }

        if (
          lnurlWithdrawParams &&
          amount < roundUp(lnurlWithdrawParams?.minWithdrawable / 1000, 0)
        ) {
          infoMessage(
            translate('payCommon_minimumWithdraw', {
              amount: roundUp(lnurlWithdrawParams?.minWithdrawable / 1000, 0),
              currency: CurrencyCode.SAT,
            }),
          )
          return
        }

        const availableBalances = proofsStore.getMintBalancesWithUnit(unitRef.current)

        if (availableBalances.length === 0) {
          infoMessage(
            translate("topup_missingMintAddFirst"),
            translate("topup_missingMintAddFirstDesc"),
          )
          return
        }

        LayoutAnimation.easeInEaseOut()
        dispatch({
          type: 'SHOW_MINT_SELECTOR',
          availableMintBalances: availableBalances,
          defaultMint: mintBalanceToTopup ? undefined : availableBalances[0],
        })
      } catch (e: any) {
        handleError(e)
      }
    }

    const onMemoEndEditing = function () {
      LayoutAnimation.easeInEaseOut()

      // Show mint selector
      if (availableMintBalances.length > 0) {
        dispatch({ type: 'SHOW_MINT_SELECTOR', availableMintBalances })
      }
    }

    const onMemoDone = function () {
      if (parseInt(amountToTopup) > 0) {
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

    const onMintBalanceConfirm = async function () {
      if (!mintBalanceToTopup) {
        return
      }

      try {
        dispatch({ type: 'TOPUP_START' })

        const amountToTopupInt = round(
          toNumber(amountToTopup) * getCurrency(unitRef.current).precision,
          0,
        )

        const result = await WalletTask.topupQueueAwaitable(
          mintBalanceToTopup as MintBalance,
          amountToTopupInt,
          unitRef.current,
          memo,
          contactToSendTo,
        )

        await handleTopupTaskResult(result)
      } catch (e: any) {
        handleError(e)
      }
    }


    const handleTopupTaskResult = async (result: TransactionTaskResult) => {
      log.trace('handleTopupTaskResult start')

      if (result.error) {
        dispatch({
          type: 'TOPUP_FAILED',
          transactionStatus: result.transaction?.status ?? TransactionStatus.ERROR,
          resultModalInfo: {
            status: result.transaction?.status ?? TransactionStatus.ERROR,
            title: result.error.params?.message
              ? result.error.message
              : translate("topup_failed"),
            message: result.error.params?.message || result.error.message,
          },
        })
        return
      }

      const tx = result.transaction as Transaction

      dispatch({
        type: 'INVOICE_READY',
        transactionId: tx.id,
        transactionStatus: tx.status,
        encodedInvoice: result.encodedInvoice as string,
      })
    }

    const onMintBalanceCancel = async function () {
      dispatch({ type: 'HIDE_MINT_SELECTOR' })
    }

    const sendAsNostrDM = async function () {
      try {
        dispatch({ type: 'DM_SENDING' })
        const senderPubkey = walletProfileStore.pubkey
        const receiverPubkey = contactToSendTo?.pubkey

        // redable message
        const message = translate('topup_nostrDMreceived', {
          npub: walletProfileStore.npub,
          amount: amountToTopup,
          currency: getCurrency(unitRef.current).code
        })
        // invoice
        let content = message + ' \n' + invoiceToPay + ' \n'
        // parsable memo that overrides static default mint invoice description
        if (memo) {
          content = content + `Memo: ${memo}`
        }

        const keys = await walletStore.getCachedWalletKeys()
        const sentEvent = await NostrClient.encryptAndSendDirectMessageNip17(
          receiverPubkey as string,
          content as string,
          relaysToShareTo,
          keys.NOSTR,
          walletProfileStore.nip05
        )

        if (sentEvent) {
          dispatch({ type: 'DM_SENT' })

          const transaction = transactionsStore.findById(
            transactionId as number,
          )

          if (!transaction || !transaction.data) {
            return
          }

          let updated = [] as unknown as TransactionData

          try {
              updated = JSON.parse(transaction.data)
          } catch (e) {}

          if (updated.length > 1) {
            updated[1].sentToRelays = relaysToShareTo

            // status does not change, just add event and relay info to tx.data
            transaction.update({
              status: TransactionStatus.PENDING,
              data: JSON.stringify(updated),
            })
          }
        } else {
          dispatch({ type: 'SET_INFO', message: translate('topup_relayMissingSentEvent') })
        }
      } catch (e: any) {
        handleError(e)
      }
    }

    const gotoContacts = function () {
      //@ts-ignore
      navigation.navigate('ContactsNavigator', {
          screen: 'Contacts',
          params: {
            paymentOption: ReceiveOption.SEND_PAYMENT_REQUEST
          }                  
      })
    }

    const onLnurlWithdraw = async function () {
      try {
        dispatch({ type: 'WITHDRAW_SENDING' })
        const result = await LnurlClient.withdraw(
          lnurlWithdrawParams as LNURLWithdrawParams,
          invoiceToPay,
        )
        log.trace('Withdraw result', result, 'onLnurlWithdraw')

        if (result.status === 'OK') {
          dispatch({ type: 'WITHDRAW_SUCCESS', result })
          return
        }

        const transaction = transactionsStore.findById(transactionId as number)

        if (!transaction) {
          throw new AppError(
            Err.NOTFOUND_ERROR,
            'Could not find transaction in the app state.',
            {transactionId},
          )
        }

        let updated = [] as unknown as TransactionData

        try {
            updated = JSON.parse(transaction.data)
        } catch (e) {}

        updated.push({
          status: TransactionStatus.ERROR,
          error: result,
        })

        transaction.update({
          status: TransactionStatus.ERROR,
          data: JSON.stringify(updated),
        })

        dispatch({
          type: 'WITHDRAW_FAILED',
          resultModalInfo: {
            status: TransactionStatus.ERROR,
            message: JSON.stringify(result),
          },
        })
      } catch (e: any) {
        handleError(e)
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
      setAmountToTopup('')
      setMemo('')
    }

    const handleError = function (e: AppError): void {
      dispatch({ type: 'SET_ERROR', error: e })
    }

    
    

    const getAmountTitle = function () {
      switch (paymentOption) {
        case ReceiveOption.SEND_PAYMENT_REQUEST:
          return translate("amountRequested")
        case ReceiveOption.LNURL_WITHDRAW:
          return translate("amountWithdraw")
        default:
          return translate("amountTopup")
      }
    }
    
    const headerBg = useThemeColor('header')    
    const placeholderTextColor = useThemeColor('textDim')
    const inputText = useThemeColor('text')
    const amountInputColor = useThemeColor('amountInput')
    const convertedAmountColor = useThemeColor('headerSubTitle')    

    const getConvertedAmount = function () {
        if (!walletStore.exchangeRate) {
          return undefined
        }

        const precision = getCurrency(unitRef.current).precision
        return convertToFromSats(
            round(toNumber(amountToTopup) * precision, 0) || 0, 
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
          mint={
            mintBalanceToTopup
              ? mintsStore.findByUrl(mintBalanceToTopup?.mintUrl)
              : undefined
          }
          unit={unitRef.current}          
        />
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <View style={$amountContainer}>
            <AmountInput
                ref={amountInputRef}
                value={amountToTopup}
                onChangeText={amount => setAmountToTopup(amount)}
                unit={unitRef.current}
                onEndEditing={onAmountEndEditing}
                selectTextOnFocus={true}
                editable={
                  transactionStatus === TransactionStatus.PENDING ? false : true
                }
                style={{color: amountInputColor}}
            />
          </View>
          <Text
            size="xs"
            text={getAmountTitle()}
            style={{
              color: amountInputColor, 
              textAlign: 'center',
              marginTop: spacing.extraSmall               
            }}
          />
        </View>
        <View style={$contentContainer}>
          {!invoiceToPay && (
            <Card
              style={$memoCard}
              ContentComponent={
                <View style={$memoContainer}>
                  <TextInput
                    ref={memoInputRef}
                    onChangeText={memo => setMemo(memo)}
                    onEndEditing={onMemoEndEditing}
                    value={`${memo}`}
                    style={[$memoInput, {color: inputText}]}
                    maxLength={200}
                    keyboardType="default"
                    selectTextOnFocus={true}
                    placeholder={translate('payerMemo')}
                    placeholderTextColor={placeholderTextColor}
                    editable={
                      transactionStatus === TransactionStatus.PENDING
                        ? false
                        : true
                    }
                  />
                  <Button
                    preset="secondary"
                    style={$memoButton}
                    tx="topupScreen_done"
                    onPress={onMemoDone}
                    disabled={
                      transactionStatus === TransactionStatus.PENDING
                        ? true
                        : false
                    }
                  />
                </View>
              }
            />
          )}

          {isMintSelectorVisible && (
            <MintBalanceSelector
              mintBalances={availableMintBalances}
              selectedMintBalance={mintBalanceToTopup as MintBalance}
              unit={unitRef.current}
              title={translate("topup_mint")}
              confirmTitle={translate("commonConfirmCreateInvoice")}
              onMintBalanceSelect={onMintBalanceSelect}
              onCancel={onMintBalanceCancel}
              onMintBalanceConfirm={onMintBalanceConfirm}
            />
          )}
          {transactionStatus === TransactionStatus.PENDING &&
            invoiceToPay &&
            paymentOption && (
              <>
                <QRCodeBlock
                  qrCodeData={invoiceToPay as string}
                  titleTx='topupScreen_invoiceToPay'
                  type='Bolt11Invoice'     
                  size={270}
                />
                <InvoiceOptionsBlock
                  toggleNostrDMModal={toggleNostrDMModal}
                  toggleWithdrawModal={toggleWithdrawModal}
                  paymentOption={paymentOption}
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
                    label="topup_to"
                    isFirst={true}
                    value={
                      mintsStore.findByUrl(transaction.mint)
                        ?.shortname as string
                    }
                  />
                  {transaction.memo && (
                    <TranItem
                      label="receiverMemo"
                      value={transaction?.memo as string}
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
          {transactionStatus === TransactionStatus.COMPLETED && (
            <View style={$bottomContainer}>
              <View style={$buttonContainer}>
                <Button
                  preset="secondary"
                  tx='commonClose'
                  onPress={gotoWallet}
                />
              </View>
            </View>
          )}
        </View>
        <BottomModal
          isVisible={isNostrDMModalVisible ? true : false}
          ContentComponent={
            isNostrDMSuccess ? (
              <NostrDMSuccessBlock
                toggleNostrDMModal={toggleNostrDMModal}
                contactToSendFrom={contactToSendFrom as Contact}
                contactToSendTo={contactToSendTo as Contact}
                amountToTopup={amountToTopup}
                onClose={gotoWallet}
              />
            ) : (
              <SendAsNostrDMBlock
                toggleNostrDMModal={toggleNostrDMModal}
                encodedInvoiceToSend={invoiceToPay as string}
                contactToSendFrom={contactToSendFrom as Contact}
                contactToSendTo={contactToSendTo as Contact}
                relaysToShareTo={relaysToShareTo}
                amountToTopup={amountToTopup}
                unit={unitRef.current}
                sendAsNostrDM={sendAsNostrDM}
                isNostrDMSending={isNostrDMSending}
              />
            )
          }
          onBackButtonPress={toggleNostrDMModal}
          onBackdropPress={toggleNostrDMModal}
        />
        <BottomModal
          isVisible={isWithdrawModalVisible ? true : false}
          style={{alignItems: 'stretch'}}
          ContentComponent={
            isWithdrawRequestSuccess ? (
              <LnurlWithdrawSuccessBlock
                toggleWithdrawModal={toggleWithdrawModal}
                amountToTopup={amountToTopup}
                lnurlWithdrawParams={lnurlWithdrawParams as LNURLWithdrawParams}
                lnurlWithdrawResult={lnurlWithdrawResult as LnurlWithdrawResult}
                onClose={gotoWallet}
              />
            ) : (
              <LnurlWithdrawBlock
                toggleWithdrawModal={toggleWithdrawModal}
                amountToTopup={amountToTopup}
                mintBalanceToTopup={mintBalanceToTopup as MintBalance}
                lnurlWithdrawParams={lnurlWithdrawParams as LNURLWithdrawParams}
                memo={memo}
                onLnurlWithdraw={onLnurlWithdraw}
                isWithdrawRequestSending={isWithdrawRequestSending}
              />
            )
          }
          onBackButtonPress={toggleWithdrawModal}
          onBackdropPress={toggleWithdrawModal}
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
                      title={translate('commonSuccess')}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx='commonClose'
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
                      title={resultModalInfo?.title || translate('topup_failed')}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx='commonClose'
                        onPress={toggleResultModal}
                      />
                    </View>
                  </>
                )}
            </>
          }
          onBackButtonPress={toggleResultModal}
          onBackdropPress={toggleResultModal}
        />
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
        {isLoading && <Loading />}
      </Screen>
    )
  },
)

const InvoiceOptionsBlock = observer(function (props: {
  toggleNostrDMModal: any
  toggleWithdrawModal: any
  contactToSendTo?: Contact
  paymentOption: ReceiveOption
  gotoContacts: any
}) {
  return (
    <View style={{flex: 1}}>
      <View style={$bottomContainer}>
        <View style={$buttonContainer}>
          {props.contactToSendTo ? (
            <Button
              text={translate("topup_sendToNip", { 
                sendToNip05: props.contactToSendTo.nip05
              })}
              preset="secondary"
              onPress={props.toggleNostrDMModal}
              style={{maxHeight: 50}}
              LeftAccessory={() => (
                <Icon
                  icon="faPaperPlane"
                  // color="white"
                  size={spacing.medium}
                />
              )}
            />
          ) : (
            <Button
              tx="topup_sendToContact"
              preset="secondary"
              onPress={props.gotoContacts}
              style={{maxHeight: 50}}
              LeftAccessory={() => (
                <Icon
                  icon="faPaperPlane"
                  // color="white"
                  size={spacing.medium}
                />
              )}
            />
          )}
          {props.paymentOption === ReceiveOption.LNURL_WITHDRAW && (
            <Button
              tx="topup_withdraw"
              preset="secondary"
              onPress={props.toggleWithdrawModal}
              style={{marginLeft: spacing.medium}}
              LeftAccessory={() => (
                <Icon
                  icon="faArrowTurnDown"
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
  encodedInvoiceToSend: string
  contactToSendFrom: Contact
  contactToSendTo: Contact
  relaysToShareTo: string[]
  amountToTopup: string
  unit: MintUnit
  sendAsNostrDM: any
  isNostrDMSending: boolean
}) {
  const sendBg = useThemeColor('background')
  const tokenTextColor = useThemeColor('textDim')

  return (
    <View style={$bottomModal}>
      <NostrDMInfoBlock
        contactToSendFrom={props.contactToSendFrom as NostrProfile}
        amountToTopup={props.amountToTopup}
        unit={props.unit}
        contactToSendTo={props.contactToSendTo as NostrProfile}
      />
      <ScrollView
        style={[
          $tokenContainer,
          {backgroundColor: sendBg, marginHorizontal: spacing.small},
        ]}>
        <Text
          selectable
          text={props.encodedInvoiceToSend}
          style={{color: tokenTextColor, paddingBottom: spacing.medium}}
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
            tx="topup_sendRequest"
            onPress={props.sendAsNostrDM}
            style={{marginRight: spacing.medium}}
            LeftAccessory={() => (
              <Icon
                icon="faPaperPlane"
                color="white"
                size={spacing.medium}
                // containerStyle={{marginRight: spacing.small}}
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
  amountToTopup: string
  onClose: any
}) {
  return (
    <View style={$bottomModal}>
      {/* <NostrDMInfoBlock
            contactToSendFrom={props.contactToSendFrom}
            amountToTopup={props.amountToTopup}
            contactToSendTo={props.contactToSendTo}
        /> */}
      <ResultModalInfo
        icon="faCheckCircle"
        iconColor={colors.palette.success200}
        title={translate('commonSuccess')}
        message={translate("walletScreen_paymentSentSuccess")}
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

const NostrDMInfoBlock = observer(function (props: {
  contactToSendFrom: NostrProfile
  amountToTopup: string
  unit: MintUnit
  contactToSendTo: NostrProfile
}) {
  const {walletProfileStore} = useStores()
  const tokenTextColor = useThemeColor('textDim')

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        marginBottom: spacing.medium,
      }}>
      <View style={{flexDirection: 'column', alignItems: 'center', width: 100}}>
        <FastImage
          style={[
            $profileIcon, {
              width: 40,
              height: walletProfileStore.isOwnProfile ? 40 : 43,
              borderRadius: walletProfileStore.isOwnProfile ? 20 : 0,            
          }] as import("react-native-fast-image").ImageStyle}
          source={{
            uri: getImageSource(props.contactToSendFrom.picture as string),
          }}
        />
        <Text
          size="xxs"
          style={{color: tokenTextColor}}
          text={props.contactToSendFrom.name}
        />
      </View>
      <Text
        size="xxs"
        style={{
          color: tokenTextColor,
          textAlign: 'center',
          marginLeft: 30,
          marginBottom: 20,
        }}
        text="..........."
      />
      <View style={{flexDirection: 'column', alignItems: 'center'}}>
        <Text
          size="xxs"
          style={{color: tokenTextColor, marginTop: -20}}
          text={`requests`}
        />
        <Icon
          icon="faPaperPlane"
          size={spacing.medium}
          color={tokenTextColor}
        />
        <Text
          size="xxs"
          style={{color: tokenTextColor, marginBottom: -10}}
          text={`${props.amountToTopup} ${getCurrency(props.unit).code}`}
        />
      </View>
      <Text
        size="xxs"
        style={{
          color: tokenTextColor,
          textAlign: 'center',
          marginRight: 30,
          marginBottom: 20,
        }}
        text="..........."
      />
      <View style={{flexDirection: 'column', alignItems: 'center', width: 100}}>
        {props.contactToSendTo.picture ? (
          <View style={{borderRadius: 20, overflow: 'hidden'}}>
            <FastImage
              style={[
                $profileIcon, {
                  width: 40,
                  height: 40,                
              }] as import("react-native-fast-image").ImageStyle}
              source={{
                uri: getImageSource(props.contactToSendTo.picture as string),
              }}
            />
          </View>
        ) : (
          <Icon icon="faCircleUser" size={38} color={tokenTextColor} />
        )}
        <Text
          size="xxs"
          style={{color: tokenTextColor}}
          text={props.contactToSendTo.name}
        />
      </View>
    </View>
  )
})

const LnurlWithdrawBlock = observer(function (props: {
  toggleWithdrawModal: any
  amountToTopup: string
  mintBalanceToTopup: MintBalance
  lnurlWithdrawParams: any
  memo: string
  onLnurlWithdraw: any
  isWithdrawRequestSending: boolean
}) {
  return (
    <View style={[$bottomModal, {alignItems: 'stretch'}]}>
      <Text
        style={{textAlign: 'center', marginBottom: spacing.small}}
        text={props.lnurlWithdrawParams.domain}
        preset={'subheading'}
      />
      <ListItem
        leftIcon="faCheckCircle"
        leftIconColor={colors.palette.success200}
        tx="topup_withdrawalAvailable"
        subText={translate("topup_withdrawAvailableDesc", {
          amount: roundDown( props.lnurlWithdrawParams.maxWithdrawable / 1000, 0),
          code: CurrencyCode.SAT
        })}
        topSeparator={true}
      />
      <ListItem
        leftIcon="faCheckCircle"
        leftIconColor={colors.palette.success200}
        text={translate("topup_invoiceCreatedParam", {
          amount: props.amountToTopup,
          code: CurrencyCode.SAT
        })}
        subText={translate("topup_invoiceCreatedDescParam", {
          mintUrl: props.mintBalanceToTopup.mintUrl
        })}
        bottomSeparator={true}
      />
      {props.isWithdrawRequestSending ? (
        <View style={[$buttonContainer, {marginTop: spacing.medium}]}>
          <Loading />
        </View>
      ) : (
        <View style={[$buttonContainer, {marginTop: spacing.medium}]}>
          <Button
            tx="topup_withdraw"
            onPress={props.onLnurlWithdraw}
            style={{marginRight: spacing.medium}}
            LeftAccessory={() => (
              <Icon
                icon="faArrowTurnDown"
                color="white"
                size={spacing.medium}
                // containerStyle={{marginRight: spacing.small}}
              />
            )}
          />
          <Button
            preset="tertiary"
            tx='commonCancel'
            onPress={props.toggleWithdrawModal}
          />
        </View>
      )}
    </View>
  )
})

const LnurlWithdrawSuccessBlock = observer(function (props: {
  toggleWithdrawModal: any
  amountToTopup: string
  lnurlWithdrawParams: LNURLWithdrawParams
  lnurlWithdrawResult: LnurlWithdrawResult
  onClose: any
}) {
  return (
    <View style={$bottomModal}>
      <ResultModalInfo
        icon="faCheckCircle"
        iconColor={colors.palette.success200}
        title={translate("commonSuccess")}
        message={`Withdrawal request has been received by ${props.lnurlWithdrawParams.domain}.`}
      />
      <View style={$buttonContainer}>
        <Button
          preset="secondary"
          tx='commonClose'
          onPress={props.onClose}
        />
      </View>
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

const $amountContainer: ViewStyle = {
  // height: spacing.screenHeight * 0.11,
}


const $contentContainer: TextStyle = {
  flex: 1,
  padding: spacing.extraSmall,
  marginTop: -spacing.extraLarge * 1.5,
}

const $memoCard: ViewStyle = {
  marginBottom: spacing.small,
  minHeight: 80,
}

const $memoContainer: ViewStyle = {
  flex: 1,
  flexDirection: 'row',
  justifyContent: 'center',  
}

const $memoInput: TextStyle = {
  flex: 1,
  borderRadius: spacing.small,
  fontSize: 16,
  textAlignVertical: 'center',
  marginRight: spacing.small,
}

const $tokenContainer: ViewStyle = {
  borderRadius: spacing.small,
  alignSelf: 'stretch',
  padding: spacing.small,
  maxHeight: 150,
  marginTop: spacing.small,
  marginBottom: spacing.large,
  // marginHorizontal: spacing.small
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
  marginBottom: spacing.medium,
  alignSelf: 'stretch',
  // opacity: 0,
}
