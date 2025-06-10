import React, { useRef, useState, useEffect } from "react"
import { observer } from "mobx-react-lite"
import { StackActions, StaticScreenProps, useNavigation } from "@react-navigation/native"
import QuickCrypto from 'react-native-quick-crypto'
import { View, TextInput, LayoutAnimation, Keyboard, ViewStyle, TextStyle } from "react-native"
import { spacing, useThemeColor, typography, colors } from "../theme"
import { useStores } from "../models"
import { MintBalanceSelector } from "./Mints/MintBalanceSelector"
import { CurrencyAmount } from "./Wallet/CurrencyAmount"
import EventEmitter from '../utils/eventEmitter'
import { getCurrency, MintUnit, CurrencyCode } from "../services/wallet/currency"
import { round, toNumber } from "../utils/number"
import { translate } from "../i18n"
import AppError, { Err } from "../utils/AppError"
import { infoMessage } from "../utils/utils"
import numbro from "numbro"
import {
  Screen,
  Card,
  Button,
  Loading,
  InfoModal,
  ErrorModal,
  BottomModal,
  Text,
} from "../components"
import useIsInternetReachable from "../utils/useIsInternetReachable"
import { PaymentRequest} from "@cashu/cashu-ts"
import {HANDLE_RECEIVED_EVENT_TASK, log, TransactionTaskResult, WalletTask } from "../services"
import { QRCodeBlock } from "./Wallet/QRCode"
import { TranItem } from "./TranDetailScreen"
import { Transaction, TransactionStatus } from "../models/Transaction"
import { CASHU_PAYMENT_REQUEST_TASK } from "../services/wallet/cashuPaymentRequestTask"
import { ResultModalInfo } from "./Wallet/ResultModalInfo"
import { MintHeader } from "./Mints/MintHeader"

type Props = StaticScreenProps<{
  unit: MintUnit,
  mintUrl?: string, 
}>

export const CashuPaymentRequestScreen = observer(function CashuPaymentRequestScreen({ route }: Props) {
  const isInternetReachable = useIsInternetReachable()
  const navigation = useNavigation()
  const {
    proofsStore,
    mintsStore,
    walletStore,
    userSettingsStore,
  } = useStores()

  const amountInputRef = useRef<TextInput>(null)
  const memoInputRef = useRef<TextInput>(null)

  const [amountToRequest, setAmountToRequest] = useState<string>("0")
  const [unit, setUnit] = useState<MintUnit>("sat")
  const [memo, setMemo] = useState("")
  const [availableMintBalances, setAvailableMintBalances] = useState<any[]>([])
  const [mintBalanceToReceiveTo, setMintBalanceToReceiveTo] = useState<any | undefined>(undefined)
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
  const [transactionId, setTransactionId] = useState<number | undefined>()
  const [transaction, setTransaction] = useState<Transaction | undefined>()
  const [isCashuPaymentRequestTaskSentToQueue, setIsCashuPaymentRequestTaskSentToQueue] = useState(false)
  const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<AppError | undefined>()
  const [info, setInfo] = useState("")
  const [encodedPaymentRequest, setEncodedPaymentRequest] = useState<string | undefined>()
  const [resultModalInfo, setResultModalInfo] = useState<
    {status: TransactionStatus; title?: string; message: string} | undefined
  >()
  const [isResultModalVisible, setIsResultModalVisible] = useState(false)

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

      setUnit(unit)

      if (mintUrl) {
        const mintBalance = proofsStore.getMintBalance(mintUrl)
        setMintBalanceToReceiveTo(mintBalance)
      }
    } catch (e: any) {
      handleError(e)
    }
  }

  setUnitAndMint()
  return () => {}
}, [])


useEffect(() => {
  const handlePayReqTaskResult = async (result: TransactionTaskResult) => {
    log.trace('handlePayReqTaskResult event handler triggered')

    setIsLoading(false)
    setIsMintSelectorVisible(false)

    const {status, id} = result.transaction as Transaction
    setTransactionStatus(status) // Should be PENDING
    setTransactionId(id)

    if (result.encodedCashuPaymentRequest) {
      setEncodedPaymentRequest(result.encodedCashuPaymentRequest)
    }

    if (result.error) {
      setResultModalInfo({
        status: result.transaction?.status as TransactionStatus,
        title: result.error.params?.message
          ? result.error.message
          : 'Error',
        message: result.error.params?.message || result.error.message,
      })
      setIsResultModalVisible(true)
      return
    }

    
  }

  // Subscribe to the payment request creation event
  if( isCashuPaymentRequestTaskSentToQueue) {
    EventEmitter.on(`ev_${CASHU_PAYMENT_REQUEST_TASK}_result`, handlePayReqTaskResult)
  }

  // Unsubscribe on component unmount
  return () => {
    EventEmitter.off(`ev_${CASHU_PAYMENT_REQUEST_TASK}_result`, handlePayReqTaskResult)
  }
}, [isCashuPaymentRequestTaskSentToQueue])


useEffect(() => {
  const handleReceivedPayReqPayloadTaskResult = (result: TransactionTaskResult) => {
    log.trace('[handleReceivedPayReqPayloadTaskResult] event handler triggered', {transactionId, result})

    if (!transactionId) {
      return
    }

    // Filter and handle events only for this cashuPaymentRequest transactionId
    if (result.transaction?.id === transactionId) {
      // Show result modal only on completed payment
      if (result.transaction.status !== TransactionStatus.COMPLETED) {
        return
      }

      log.trace(
        '[handleReceivedPayReqPayloadTaskResult]',
        'Payment request has been paid and new proofs received',
      )

      setResultModalInfo({
        status: result.transaction.status,
        message: result.message,
      })

      setTransactionStatus(TransactionStatus.COMPLETED)
      setTransaction(result.transaction)
      setIsResultModalVisible(true)
    }
  }

  if(transactionId) {
    EventEmitter.on(
      `ev_${HANDLE_RECEIVED_EVENT_TASK}_result`,
      handleReceivedPayReqPayloadTaskResult,
    )
  }

  return () => {
    EventEmitter.off(
      `ev_${HANDLE_RECEIVED_EVENT_TASK}_result`,
      handleReceivedPayReqPayloadTaskResult,
    )
  }
}, [transactionId])


const toggleResultModal = () =>
  setIsResultModalVisible(previousState => !previousState)

const onAmountEndEditing = () => {
  log.trace("[onAmountEndEditing] called")

  if(isCashuPaymentRequestTaskSentToQueue) {
    log.trace('[onAmountEndEditing] Request task already sent to queue, ignoring further edits')
    return 
  }

  try {
    const precision = getCurrency(unit).precision
    const mantissa = getCurrency(unit).mantissa
    const amountNum = round(toNumber(amountToRequest) * precision, 0)

    if (!amountNum || amountNum <= 0) {
      infoMessage(translate("payCommon.amountZeroOrNegative"))
      return
    }

    const balances = proofsStore.getMintBalancesWithUnit(unit)
    if (balances.length === 0) {
      infoMessage(
        translate("topup.missingMintAddFirst"),
        translate("topup.missingMintAddFirstDesc"),
      )
      return
    }

    setAmountToRequest(
      `${numbro(amountToRequest).format({
        thousandSeparated: true,
        mantissa,
      })}`,
    )
    setAvailableMintBalances(balances)
    if (!mintBalanceToReceiveTo) setMintBalanceToReceiveTo(balances[0])
    LayoutAnimation.easeInEaseOut()

    setIsMintSelectorVisible(true)
          
  } catch (e: any) {
    setError(e)
  }
}

const onMemoEndEditing = () => {
  log.trace("[onMemoEndEditing] called")
  LayoutAnimation.easeInEaseOut()
  if (availableMintBalances.length > 0) {
    setIsMintSelectorVisible(true)
  }
}

const onMemoDone = () => {
  if (parseInt(amountToRequest) > 0) {
    memoInputRef.current?.blur()
    amountInputRef.current?.blur()
    onMemoEndEditing()
  } else {
    amountInputRef.current?.focus()
  }
}

const onMintBalanceSelect = (balance: any) => {
  setMintBalanceToReceiveTo(balance)
}

const onMintBalanceCancel = () => {
  setIsMintSelectorVisible(false)
}

const onMintBalanceConfirm = async () => {
  if (!mintBalanceToReceiveTo) return
  setIsLoading(true)
  try {
    const mintUrl = mintBalanceToReceiveTo.mintUrl
    const mint = mintsStore.findByUrl(mintUrl)
    if (!mint) throw new AppError(Err.NOTFOUND_ERROR, "Mint not found")

    setIsCashuPaymentRequestTaskSentToQueue(true)

    const amountInt = round(
      toNumber(amountToRequest) * getCurrency(unit).precision,
      0,
    )

    WalletTask.cashuPaymentRequestQueue(
      mintBalanceToReceiveTo,
      amountInt,
      unit,
      memo,      
    )
    
  } catch (e: any) {
    setError(e)
  } finally {
    setIsLoading(false)
    setIsMintSelectorVisible(false)
  }
}

const resetState = () => {
  setAmountToRequest("0")
  setMemo("")
  setMintBalanceToReceiveTo(undefined)
  setEncodedPaymentRequest(undefined)
  setIsResultModalVisible(false)
}

const gotoWallet = () => {
  resetState()
  navigation.dispatch(                
    StackActions.popToTop()
  )
}

const handleError = function (e: AppError): void {
  setIsLoading(false)
  setError(e)
}

const headerBg = useThemeColor("header")
const placeholderTextColor = useThemeColor("textDim")
const amountInputColor = useThemeColor("amountInput")
const inputText = useThemeColor("text")
const convertedAmountColor = useThemeColor("headerSubTitle")

const getConvertedAmount = () => {
  if (!walletStore.exchangeRate) return undefined
  const precision = getCurrency(unit).precision
  return (
    round(toNumber(amountToRequest) * precision, 0) &&
    walletStore.exchangeRate &&
    walletStore.exchangeRate[getCurrency(unit).code]
      ? round(
          (toNumber(amountToRequest) * precision * walletStore.exchangeRate[userSettingsStore.exchangeCurrency]) /
            walletStore.exchangeRate[getCurrency(unit).code],
          2,
        )
      : undefined
  )
}

const isConvertedAmountVisible = () => {
  return (
    walletStore.exchangeRate &&
    (userSettingsStore.exchangeCurrency === getCurrency(unit).code ||
      unit === "sat") &&
    getConvertedAmount() !== undefined
  )
}

return (
  <Screen preset="fixed" contentContainerStyle={$screen}>
    <MintHeader
      mint={
        mintBalanceToReceiveTo
          ? mintsStore.findByUrl(mintBalanceToReceiveTo?.mintUrl)
          : undefined
      }
      unit={unit}          
    />
    <View style={[$headerContainer, { backgroundColor: headerBg }]}>
      <View style={$amountContainer}>
        <TextInput
          ref={amountInputRef}
          onChangeText={setAmountToRequest}
          onEndEditing={onAmountEndEditing}
          value={amountToRequest}
          style={[$amountInput, { color: amountInputColor }]}
          maxLength={9}
          keyboardType="numeric"
          editable={
            transactionStatus === TransactionStatus.PENDING ? false : true
          }
          selectTextOnFocus={true}
          returnKeyType={"done"}
        />
        {isConvertedAmountVisible() && (
          <CurrencyAmount
            amount={getConvertedAmount() ?? 0}
            currencyCode={
              unit === "sat"
                ? userSettingsStore.exchangeCurrency
                : CurrencyCode.SAT
            }
            symbolStyle={{
              color: convertedAmountColor,
              marginTop: spacing.tiny,
              fontSize: 10,
            }}
            amountStyle={{
              color: convertedAmountColor,
              lineHeight: spacing.small,
            }}
            size="small"
            containerStyle={{ justifyContent: "center" }}
          />
        )}
        <Text
          size="xs"
          text={translate("amount.requested")}
          style={{
            color: amountInputColor,
            textAlign: "center",
            marginTop: isConvertedAmountVisible()
              ? -spacing.extraSmall
              : undefined,
          }}
        />
      </View>
    </View>
    <View style={$contentContainer}>
      {!encodedPaymentRequest && (
        <Card
          style={$memoCard}
          ContentComponent={
            <View style={$memoContainer}>
              <TextInput
                ref={memoInputRef}
                onChangeText={setMemo}
                onEndEditing={onMemoEndEditing}
                value={memo}
                style={[$memoInput, { color: inputText }]}
                maxLength={200}
                keyboardType="default"
                selectTextOnFocus={true}
                placeholder={translate("payerMemo")}
                placeholderTextColor={placeholderTextColor}
              />
              <Button
                preset="secondary"
                style={$memoButton}
                text="Done"
                onPress={onMemoDone}
              />
            </View>
          }
        />
      )}
      {isMintSelectorVisible && (
        <MintBalanceSelector
          mintBalances={availableMintBalances}
          selectedMintBalance={mintBalanceToReceiveTo}
          unit={unit}
          title={'Mint to receive'}
          confirmTitle={translate("cashuPaymentRequest.create")}
          onMintBalanceSelect={onMintBalanceSelect}
          onCancel={onMintBalanceCancel}
          onMintBalanceConfirm={onMintBalanceConfirm}
        />
      )}
      {transactionStatus === TransactionStatus.PENDING &&
        encodedPaymentRequest && (
          <>
            <QRCodeBlock
              qrCodeData={encodedPaymentRequest}
              title='Cashu Payment request'
              type='PaymentRequest'     
              size={270}
            />
          </>
      )}
      {transaction && transactionStatus === TransactionStatus.COMPLETED && (
        <>
          <Card
            style={{padding: spacing.medium}}
            ContentComponent={
              <>
                <TranItem
                  label="cashuPaymentRequest.to"
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
                  label="transactionCommon.feePaid"
                  value={transaction.fee || 0}
                  unit={unit}
                  isCurrency={true}
                />
                <TranItem
                  label="tranDetailScreen.status"
                  value={transaction.status as string}
                />
              </>
            }
          />
          <View style={$bottomContainer}>
            <View style={$buttonContainer}>
              <Button
                preset="secondary"
                tx='common.close'
                onPress={gotoWallet}
              />
            </View>
          </View>
        </>
      )}
    </View>
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
                  title={translate('common.success')}
                  message={resultModalInfo?.message}
                />
                <View style={$buttonContainer}>
                  <Button
                    preset="secondary"
                    tx='common.close'
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
                  title={resultModalInfo?.title || translate('topup.failed')}
                  message={resultModalInfo?.message}
                />
                <View style={$buttonContainer}>
                  <Button
                    preset="secondary"
                    tx='common.close'
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
})

const $screen: ViewStyle = {
flex: 1,
}

const $headerContainer: TextStyle = {
alignItems: "center",
padding: spacing.extraSmall,
paddingTop: 0,
height: spacing.screenHeight * 0.2,
}

const $amountContainer: ViewStyle = {}

const $amountInput: TextStyle = {
borderRadius: spacing.small,
margin: 0,
padding: 0,
fontSize: 48,
fontFamily: typography.primary?.medium,
textAlign: "center",
color: "white",
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
flexDirection: "row",
justifyContent: "center",
}

const $memoInput: TextStyle = {
flex: 1,
borderRadius: spacing.small,
fontSize: 16,
textAlignVertical: "center",
marginRight: spacing.small,
}

const $memoButton: ViewStyle = {
maxHeight: 50,
}

const $bottomModal: ViewStyle = {
alignItems: "center",
paddingVertical: spacing.large,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
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