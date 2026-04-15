import React, { useRef, useState, useEffect, useReducer } from "react"
import { observer } from "mobx-react-lite"
import { StackActions, StaticScreenProps, useNavigation } from "@react-navigation/native"
import { View, TextInput, LayoutAnimation, Keyboard, ViewStyle, TextStyle } from "react-native"
import { spacing, useThemeColor, typography, colors } from "../theme"
import { useStores } from "../models"
import { MintBalanceSelector } from "./Mints/MintBalanceSelector"
import EventEmitter from '../utils/eventEmitter'
import { getCurrency, MintUnit } from "../services/wallet/currency"
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
  AmountInput,
} from "../components"
import {HANDLE_RECEIVED_EVENT_TASK, log, TransactionTaskResult, WalletTask } from "../services"
import { QRCodeBlock } from "./Wallet/QRCode"
import { TranItem } from "./TranDetailScreen"
import { Transaction, TransactionStatus } from "../models/Transaction"
import { MintBalance } from "../models/Mint"
import { ResultModalInfo } from "./Wallet/ResultModalInfo"
import { MintHeader } from "./Mints/MintHeader"
import { MemoInputCard } from "../components/MemoInputCard"

type Props = StaticScreenProps<{
  unit: MintUnit,
  mintUrl?: string,
}>

type CashuPaymentRequestState = {
  availableMintBalances: MintBalance[]
  mintBalanceToReceiveTo: MintBalance | undefined
  transactionStatus: TransactionStatus | undefined
  transactionId: number | undefined
  transaction: Transaction | undefined
  isCashuPaymentRequestTaskSentToQueue: boolean
  isMintSelectorVisible: boolean
  isLoading: boolean
  error: AppError | undefined
  info: string
  encodedPaymentRequest: string | undefined
  resultModalInfo: { status: TransactionStatus; title?: string; message: string } | undefined
  isResultModalVisible: boolean
}

type CashuPaymentRequestAction =
  | { type: 'SET_MINT_BALANCE'; balance: MintBalance }
  | { type: 'SHOW_MINT_SELECTOR'; balances: MintBalance[]; defaultBalance?: MintBalance }
  | { type: 'HIDE_MINT_SELECTOR' }
  | { type: 'REQUEST_START' }
  | { type: 'REQUEST_READY'; transactionId: number; transactionStatus: TransactionStatus; encodedPaymentRequest?: string }
  | { type: 'REQUEST_FAILED'; status: TransactionStatus; title?: string; message: string }
  | { type: 'REQUEST_COMPLETE'; transaction: Transaction; message: string }
  | { type: 'TOGGLE_RESULT_MODAL' }
  | { type: 'SET_INFO'; message: string }
  | { type: 'SET_ERROR'; error: AppError }
  | { type: 'RESET' }

const INITIAL_STATE: CashuPaymentRequestState = {
  availableMintBalances: [],
  mintBalanceToReceiveTo: undefined,
  transactionStatus: undefined,
  transactionId: undefined,
  transaction: undefined,
  isCashuPaymentRequestTaskSentToQueue: false,
  isMintSelectorVisible: false,
  isLoading: false,
  error: undefined,
  info: '',
  encodedPaymentRequest: undefined,
  resultModalInfo: undefined,
  isResultModalVisible: false,
}

function cashuPaymentRequestReducer(
  state: CashuPaymentRequestState,
  action: CashuPaymentRequestAction,
): CashuPaymentRequestState {
  switch (action.type) {
    case 'SET_MINT_BALANCE':
      return { ...state, mintBalanceToReceiveTo: action.balance }
    case 'SHOW_MINT_SELECTOR':
      return {
        ...state,
        availableMintBalances: action.balances,
        mintBalanceToReceiveTo: action.defaultBalance ?? state.mintBalanceToReceiveTo ?? action.balances[0],
        isMintSelectorVisible: true,
      }
    case 'HIDE_MINT_SELECTOR':
      return { ...state, isMintSelectorVisible: false }
    case 'REQUEST_START':
      return { ...state, isLoading: true, isCashuPaymentRequestTaskSentToQueue: true }
    case 'REQUEST_READY':
      return {
        ...state,
        isLoading: false,
        isMintSelectorVisible: false,
        transactionId: action.transactionId,
        transactionStatus: action.transactionStatus,
        encodedPaymentRequest: action.encodedPaymentRequest ?? state.encodedPaymentRequest,
      }
    case 'REQUEST_FAILED':
      return {
        ...state,
        isLoading: false,
        isMintSelectorVisible: false,
        isCashuPaymentRequestTaskSentToQueue: false,
        transactionStatus: action.status,
        resultModalInfo: { status: action.status, title: action.title, message: action.message },
        isResultModalVisible: true,
      }
    case 'REQUEST_COMPLETE':
      return {
        ...state,
        transactionStatus: TransactionStatus.COMPLETED,
        transaction: action.transaction,
        resultModalInfo: {
          status: TransactionStatus.COMPLETED,
          message: action.message,
        },
        isResultModalVisible: true,
      }
    case 'TOGGLE_RESULT_MODAL':
      return { ...state, isResultModalVisible: !state.isResultModalVisible }
    case 'SET_INFO':
      return { ...state, info: action.message }
    case 'SET_ERROR':
      return {
        ...state,
        isLoading: false,
        isCashuPaymentRequestTaskSentToQueue: false,
        error: action.error,
      }
    case 'RESET':
      return INITIAL_STATE
    default:
      return state
  }
}

export const CashuPaymentRequestScreen = observer(function CashuPaymentRequestScreen({ route }: Props) {
  //const isInternetReachable = useIsInternetReachable()
  const navigation = useNavigation()
  const {
    proofsStore,
    mintsStore,
  } = useStores()

  const amountInputRef = useRef<TextInput>(null)
  const memoInputRef = useRef<TextInput>(null)
  const unitRef = useRef<MintUnit>('sat')

  const [amountToRequest, setAmountToRequest] = useState<string>("0")
  const [memo, setMemo] = useState("")
  const [state, dispatch] = useReducer(cashuPaymentRequestReducer, INITIAL_STATE)
  const {
    availableMintBalances,
    mintBalanceToReceiveTo,
    transactionStatus,
    transactionId,
    transaction,
    isCashuPaymentRequestTaskSentToQueue,
    isMintSelectorVisible,
    isLoading,
    error,
    info,
    encodedPaymentRequest,
    resultModalInfo,
    isResultModalVisible,
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
        if (mintBalance) dispatch({ type: 'SET_MINT_BALANCE', balance: mintBalance })
      }
    } catch (e: any) {
      handleError(e)
    }
  }

  setUnitAndMint()
  return () => {}
}, [])


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

      dispatch({
        type: 'REQUEST_COMPLETE',
        transaction: result.transaction,
        message: result.message,
      })
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


const toggleResultModal = () => dispatch({ type: 'TOGGLE_RESULT_MODAL' })

const onAmountEndEditing = () => {
  log.trace("[onAmountEndEditing] called")

  if(isCashuPaymentRequestTaskSentToQueue) {
    log.trace('[onAmountEndEditing] Request task already sent to queue, ignoring further edits')
    return 
  }

  try {
    const precision = getCurrency(unitRef.current).precision
    const mantissa = getCurrency(unitRef.current).mantissa
    const amountNum = round(toNumber(amountToRequest) * precision, 0)

    if (!amountNum || amountNum <= 0) {
      infoMessage(translate("payCommon_amountZeroOrNegative"))
      return
    }

    const balances = proofsStore.getMintBalancesWithUnit(unitRef.current)
    if (balances.length === 0) {
      infoMessage(
        translate("topup_missingMintAddFirst"),
        translate("topup_missingMintAddFirstDesc"),
      )
      return
    }

    setAmountToRequest(
      `${numbro(amountToRequest).format({
        thousandSeparated: true,
        mantissa,
      })}`,
    )
    LayoutAnimation.easeInEaseOut()
    dispatch({
      type: 'SHOW_MINT_SELECTOR',
      balances,
      defaultBalance: mintBalanceToReceiveTo,
    })

  } catch (e: any) {
    dispatch({ type: 'SET_ERROR', error: e })
  }
}

const onMemoEndEditing = () => {
  log.trace("[onMemoEndEditing] called")
  LayoutAnimation.easeInEaseOut()
  if (availableMintBalances.length > 0) {
    dispatch({ type: 'SHOW_MINT_SELECTOR', balances: availableMintBalances })
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

const onMintBalanceSelect = (balance: MintBalance) => {
  dispatch({ type: 'SET_MINT_BALANCE', balance })
}

const onMintBalanceCancel = () => {
  dispatch({ type: 'HIDE_MINT_SELECTOR' })
}

const onMintBalanceConfirm = async () => {
  if (!mintBalanceToReceiveTo) return
  try {
    const mintUrl = mintBalanceToReceiveTo.mintUrl
    const mint = mintsStore.findByUrl(mintUrl)
    if (!mint) throw new AppError(Err.NOTFOUND_ERROR, "Mint not found")

    dispatch({ type: 'REQUEST_START' })

    const amountInt = round(
      toNumber(amountToRequest) * getCurrency(unitRef.current).precision,
      0,
    )

    const result = await WalletTask.cashuPaymentRequestQueueAwaitable(
      mintBalanceToReceiveTo,
      amountInt,
      unitRef.current,
      memo,
    )

    await handlePayReqTaskResult(result)

  } catch (e: any) {
    dispatch({ type: 'SET_ERROR', error: e })
  }
}


const handlePayReqTaskResult = async (result: TransactionTaskResult) => {
  log.trace('handlePayReqTaskResult event handler triggered')

  if (result.error) {
    dispatch({
      type: 'REQUEST_FAILED',
      status: result.transaction?.status ?? TransactionStatus.ERROR,
      title: result.error.params?.message ? result.error.message : 'Error',
      message: result.error.params?.message || result.error.message,
    })
    return
  }

  const { status, id } = result.transaction as Transaction
  dispatch({
    type: 'REQUEST_READY',
    transactionId: id,
    transactionStatus: status,
    encodedPaymentRequest: result.encodedCashuPaymentRequest,
  })
}

const resetState = () => {
  setAmountToRequest("0")
  setMemo("")
  dispatch({ type: 'RESET' })
}

const gotoWallet = () => {
  resetState()
  navigation.dispatch(
    StackActions.popToTop()
  )
}

const handleError = function (e: AppError): void {
  dispatch({ type: 'SET_ERROR', error: e })
}

const headerBg = useThemeColor("header")
const placeholderTextColor = useThemeColor("textDim")
const amountInputColor = useThemeColor("amountInput")
const inputText = useThemeColor("text")


return (
  <Screen preset="fixed" contentContainerStyle={$screen}>
    <MintHeader
      mint={
        mintBalanceToReceiveTo
          ? mintsStore.findByUrl(mintBalanceToReceiveTo?.mintUrl)
          : undefined
      }
      unit={unitRef.current}          
    />
    <View style={[$headerContainer, { backgroundColor: headerBg }]}>
      <View style={$amountContainer}>
        <AmountInput
            ref={amountInputRef}
            value={amountToRequest}
            onChangeText={amount => setAmountToRequest(amount)}
            unit={unitRef.current}
            onEndEditing={onAmountEndEditing}
            selectTextOnFocus={true}
            editable={
              transactionStatus === TransactionStatus.PENDING ? false : true
            }
        />
      </View>
      <Text
          size="xs"
          text={translate("amountRequested")}
          style={{
            color: amountInputColor,
            textAlign: "center",
            marginTop: spacing.extraSmall
          }}
        />
    </View>
    <View style={$contentContainer}>
      {!encodedPaymentRequest && (
        <MemoInputCard
          memo={memo}
          ref={memoInputRef}
          setMemo={setMemo}          
          onMemoDone={onMemoDone}
          onMemoEndEditing={onMemoEndEditing}
        />        
      )}
      {isMintSelectorVisible && (
        <MintBalanceSelector
          mintBalances={availableMintBalances}
          selectedMintBalance={mintBalanceToReceiveTo}
          unit={unitRef.current}
          title={translate('cashuPaymentRequestTitle')}
          confirmTitle={translate("cashuPaymentRequest_create")}
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
              titleTx='cashuPaymentRequestQRTitle'
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
                  label="cashuPaymentRequest_to"
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
          <View style={$bottomContainer}>
            <View style={$buttonContainer}>
              <Button
                preset="secondary"
                tx='commonClose'
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