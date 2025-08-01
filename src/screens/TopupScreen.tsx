import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState, useRef, useCallback} from 'react'
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
import {TransactionStatus, Transaction} from '../models/Transaction'
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

    const [paymentOption, setPaymentOption] = useState<ReceiveOption>(
      ReceiveOption.SHOW_INVOICE,
    )
    const [amountToTopup, setAmountToTopup] = useState<string>('0')    
    const [contactToSendFrom, setContactToSendFrom] = useState<
      Contact | undefined
    >()
    const [contactToSendTo, setContactToSendTo] = useState<
      Contact | undefined
    >()
    const [relaysToShareTo, setRelaysToShareTo] = useState<string[]>([])
    const [lnurlWithdrawParams, setLnurlWithdrawParams] = useState<
      LNURLWithdrawParams | undefined
    >()
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<
      MintBalance[]
    >([])
    const [mintBalanceToTopup, setMintBalanceToTopup] = useState<
      MintBalance | undefined
    >(undefined)
    const [transactionStatus, setTransactionStatus] = useState<
      TransactionStatus | undefined
    >()
    const [transactionId, setTransactionId] = useState<number | undefined>()
    const [transaction, setTransaction] = useState<Transaction | undefined>()
    const [invoiceToPay, setInvoiceToPay] = useState<string>('')
    const [lnurlWithdrawResult, setLnurlWithdrawResult] = useState<
      LnurlWithdrawResult | undefined
    >()

    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; title?: string; message: string} | undefined
    >()

    const [isLoading, setIsLoading] = useState(false)
    const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
    const [isQRModalVisible, setIsQRModalVisible] = useState(false)
    const [isNostrDMModalVisible, setIsNostrDMModalVisible] = useState(false)
    const [isWithdrawModalVisible, setIsWithdrawModalVisible] = useState(false)
    const [isTopupTaskSentToQueue, setIsTopupTaskSentToQueue] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [isNostrDMSending, setIsNostrDMSending] = useState(false)
    const [isNostrDMSuccess, setIsNostrDMSuccess] = useState(false)
    const [isWithdrawRequestSending, setIsWithdrawRequestSending] =
      useState(false)
    const [isWithdrawRequestSuccess, setIsWithdrawRequestSuccess] =
      useState(false)

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
            setMintBalanceToTopup(mintBalance)
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

            setPaymentOption(paymentOption!)
            setContactToSendFrom(contactFrom)
            setContactToSendTo(contact)
            setRelaysToShareTo(relays)

            if (invoiceToPay) {
              toggleNostrDMModal() // open if we already have an invoice
            }

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
            setLnurlWithdrawParams(lnurlParams)
            setMemo(lnurlParams.defaultDescription)
            setPaymentOption(ReceiveOption.LNURL_WITHDRAW)
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
      const handleTopupTaskResult = async (result: TransactionTaskResult) => {
        log.trace('handleTopupTaskResult event handler triggered')

        setIsLoading(false)

        const {status, id} = result.transaction as Transaction
        setTransactionStatus(status)
        setTransactionId(id)

        if (result.encodedInvoice) {
          setInvoiceToPay(result.encodedInvoice)
        }

        if (result.error) {
          setResultModalInfo({
            status: result.transaction?.status as TransactionStatus,
            title: result.error.params?.message
              ? result.error.message
              : translate("topup_failed"),
            message: result.error.params?.message || result.error.message,
          })
          setIsResultModalVisible(true)
          return
        }

        if (paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST) {
          toggleNostrDMModal()
        }

        if (paymentOption === ReceiveOption.LNURL_WITHDRAW) {
          toggleWithdrawModal()
        }

        setIsMintSelectorVisible(false)
      }

      // Subscribe to the 'sendCompleted' event
      if(isTopupTaskSentToQueue) {
        EventEmitter.on(`ev_${TOPUP_TASK}_result`, handleTopupTaskResult)
      }

      // Unsubscribe from the 'sendCompleted' event on component unmount
      return () => {
        EventEmitter.off(`ev_${TOPUP_TASK}_result`, handleTopupTaskResult)
      }
    }, [isTopupTaskSentToQueue])

    useEffect(() => {
      const handlePendingTopupTaskResult = (result: TransactionTaskResult) => {
        log.trace('[handlePendingTopupTaskResult] event handler triggered')

        if (!transactionId) {
          return
        }

        // Filter and handle events only for this topup transactionId
        if (result.transaction?.id === transactionId) {
          // Show result modal only on completed topup
          if (result.transaction.status !== TransactionStatus.COMPLETED) {
            return
          }

          log.trace(
            '[handlePendingTopupTaskResult]',
            'Invoice has been paid and new proofs received',
          )

          setResultModalInfo({
            status: result.transaction.status,
            message: result.message,
          })

          setTransactionStatus(TransactionStatus.COMPLETED)
          setTransaction(result.transaction)
          setIsQRModalVisible(false)
          setIsNostrDMModalVisible(false)
          setIsWithdrawModalVisible(false)
          setIsResultModalVisible(true)
        }
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

    const toggleNostrDMModal = () =>
      setIsNostrDMModalVisible(previousState => !previousState)
    const toggleWithdrawModal = () =>
      setIsWithdrawModalVisible(previousState => !previousState)
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)

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
          setInfo(translate('commonOfflinePretty'))
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
        
        setAvailableMintBalances(availableBalances)

        // Default mint if not set from route params is the one with the highest balance to topup
        if (!mintBalanceToTopup) {
          setMintBalanceToTopup(availableBalances[0])
        }

        LayoutAnimation.easeInEaseOut()        
        setIsMintSelectorVisible(true)
      } catch (e: any) {
        handleError(e)
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
      setMintBalanceToTopup(balance)
    }

    const onMintBalanceConfirm = async function () {
      if (!mintBalanceToTopup) {
        return
      }

      setIsLoading(true)
      setIsTopupTaskSentToQueue(true)

      const amountToTopupInt = round(
        toNumber(amountToTopup) * getCurrency(unitRef.current).precision,
        0,
      )

      WalletTask.topupQueue(
        mintBalanceToTopup as MintBalance,
        amountToTopupInt,
        unitRef.current,
        memo,
        contactToSendTo,
      )
    }

    const onMintBalanceCancel = async function () {
      setIsMintSelectorVisible(false)
    }

    const sendAsNostrDM = async function () {
      try {
        setIsNostrDMSending(true)
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

        const sentEvent = await NostrClient.encryptAndSendDirectMessageNip17(                
          receiverPubkey as string, 
          content as string,
          relaysToShareTo
        )

        setIsNostrDMSending(false)

        if (sentEvent) {
          setIsNostrDMSuccess(true)

          const transaction = transactionsStore.findById(
            transactionId as number,
          )

          if (!transaction || !transaction.data) {
            return
          }

          let updated = []

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
          setInfo(translate('topup_relayMissingSentEvent'))
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
        setIsWithdrawRequestSending(true) // replace, not working
        const result = await LnurlClient.withdraw(
          lnurlWithdrawParams as LNURLWithdrawParams,
          invoiceToPay,
        )
        log.trace('Withdraw result', result, 'onLnurlWithdraw')

        if (result.status === 'OK') {
          setIsWithdrawRequestSuccess(true)
          setLnurlWithdrawResult(result)
          setIsWithdrawRequestSending(false)
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

        let updated = []

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

        setResultModalInfo({
          status: TransactionStatus.ERROR,
          message: JSON.stringify(result),
        })

        toggleWithdrawModal()
        setIsResultModalVisible(true)
        return
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
      // reset state so it does not interfere next payment
      setAmountToTopup('')
      setMemo('')
      setIsMintSelectorVisible(false)
      setIsNostrDMModalVisible(false)
      setIsWithdrawModalVisible(false)
      setIsWithdrawRequestSending(false)
      setPaymentOption(ReceiveOption.SHOW_INVOICE)
      setResultModalInfo(undefined)
      setIsResultModalVisible(false)
    }

    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
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
                editable={
                  transactionStatus === TransactionStatus.PENDING ? false : true
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
            <Text
              size="xs"
              text={getAmountTitle()}
              style={{
                color: amountInputColor, 
                textAlign: 'center', 
                marginTop: isConvertedAmountVisible() ? -spacing.extraSmall : undefined
              }}
            />
          </View>
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

const $amountContainer: ViewStyle = {}

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
