import { observer } from 'mobx-react-lite'
import React, { useEffect, useState, useRef } from 'react'
import {
  View,
  ViewStyle,
  TextStyle,
} from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated'
import { spacing, useThemeColor, colors, typography } from '../theme'
import {
  Button,
  Icon,
  Screen,
  Loading,
  InfoModal,
  ErrorModal,
  BottomModal,
  Text,
  NumericKeypad,
} from '../components'
import { TransactionStatus, Transaction } from '../models/Transaction'
import { useStores } from '../models'
import {
  HANDLE_PENDING_TOPUP_TASK,
  TransactionTaskResult,
  WalletTask,
} from '../services'
import { log } from '../services/logService'
import AppError from '../utils/AppError'
import { MintBalance } from '../models/Mint'
import EventEmitter from '../utils/eventEmitter'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'
import { infoMessage } from '../utils/utils'
import { round } from '../utils/number'
import { verticalScale, moderateScale } from '@gocodingnow/rn-size-matters'
import {
  CurrencyCode,
  MintUnit,
  convertToFromSats,
  Currencies,
  formatCurrency,
} from '../services/wallet/currency'
import { MintHeader } from './Mints/MintHeader'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { QRCodeBlock } from './Wallet/QRCode'
import { translate } from '../i18n'

type Props = StaticScreenProps<{
  unit: MintUnit
  mintUrl?: string
}>

export const POSScreen = observer(function POSScreen({ route }: Props) {
  const navigation = useNavigation()
  const isInternetReachable = useIsInternetReachable()

  const {
    proofsStore,
    mintsStore,
    walletStore,
    userSettingsStore,
  } = useStores()

  const unitRef = useRef<MintUnit>('sat')

  // Amount state - stored as integer cents (e.g., 123 = $1.23)
  const [amountCents, setAmountCents] = useState<number>(0)
  const [satsAmount, setSatsAmount] = useState<number>(0)

  // Max digits for amount entry (e.g., 7 = max $99,999.99)
  const MAX_CENTS_DIGITS = 7

  // Mint selection
  const [mintBalanceToTopup, setMintBalanceToTopup] = useState<MintBalance | undefined>()

  // Transaction state
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
  const [transactionId, setTransactionId] = useState<number | undefined>()
  const [transaction, setTransaction] = useState<Transaction | undefined>()
  const [invoiceToPay, setInvoiceToPay] = useState<string>('')

  // UI state
  const [info, setInfo] = useState('')
  const [error, setError] = useState<AppError | undefined>()
  const [isLoading, setIsLoading] = useState(false)

  // Success icon animation
  const iconScale = useSharedValue(0.8)

  // Get fiat currency settings
  const fiatCode = userSettingsStore.exchangeCurrency || CurrencyCode.USD
  const fiatCurrency = Currencies[fiatCode]
  const fiatSymbol = fiatCurrency?.symbol || '$'
  const fiatPrecision = fiatCurrency?.precision ?? 100
  const fiatMantissa = fiatCurrency?.mantissa ?? 2

  // Initialize unit from route params
  useEffect(() => {
    if (route.params?.unit) {
      unitRef.current = route.params.unit
    }
  }, [route.params?.unit])

  // Convert cents to sats whenever amountCents or exchange rate changes
  useEffect(() => {
    if (!walletStore.exchangeRate) {
      setSatsAmount(0)
      return
    }

    const sats = convertToFromSats(amountCents, fiatCode, walletStore.exchangeRate)
    setSatsAmount(round(sats, 0))
  }, [amountCents, walletStore.exchangeRate, fiatCode])

  // Trigger success icon animation when transaction completes
  useEffect(() => {
    if (transactionStatus === TransactionStatus.COMPLETED) {
      iconScale.value = 0.8
      iconScale.value = withDelay(
        300,
        withSequence(
          withTiming(1.15, { duration: 400, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) })
        )
      )
    }
  }, [transactionStatus])

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }))

  // Payment detection via EventEmitter
  useEffect(() => {
    const handlePendingTopupTaskResult = (result: TransactionTaskResult) => {
      log.trace('[POSScreen] handlePendingTopupTaskResult triggered')

      if (!transactionId) return
      if (result.transaction?.id !== transactionId) return
      if (result.transaction.status !== TransactionStatus.COMPLETED) return

      log.trace('[POSScreen] Invoice paid, proofs received')

      setTransactionStatus(TransactionStatus.COMPLETED)
      setTransaction(result.transaction)
    }

    if (transactionId) {
      EventEmitter.on(
        `ev_${HANDLE_PENDING_TOPUP_TASK}_result`,
        handlePendingTopupTaskResult
      )
    }

    return () => {
      EventEmitter.off(
        `ev_${HANDLE_PENDING_TOPUP_TASK}_result`,
        handlePendingTopupTaskResult
      )
    }
  }, [transactionId])

  // Handle keypad input - cents-first entry (each digit shifts left)
  const handleKeyPress = (key: string) => {
    if (transactionStatus === TransactionStatus.PENDING) return

    if (key === 'backspace') {
      // Shift right - remove last digit
      setAmountCents(prev => Math.floor(prev / 10))
    } else {
      // Only process digit keys
      const digit = parseInt(key, 10)
      if (isNaN(digit)) return

      // Check max digits limit
      if (amountCents.toString().length >= MAX_CENTS_DIGITS) return

      // Shift left and add new digit
      setAmountCents(prev => prev * 10 + digit)
    }
  }

  // Clear amount (also used for long-press backspace)
  const onClearAmount = () => {
    setAmountCents(0)
    setSatsAmount(0)
  }

  // Confirm amount and create invoice immediately with default mint
  const onConfirmAmount = async () => {
    if (!isInternetReachable) {
      infoMessage(translate('commonOfflinePretty'))
      return
    }

    if (satsAmount <= 0) {
      infoMessage(translate('payCommon_amountZeroOrNegative'))
      return
    }

    const availableBalances = proofsStore.getMintBalancesWithUnit(unitRef.current)

    if (availableBalances.length === 0) {
      infoMessage(
        translate('topup_missingMintAddFirst'),
        translate('topup_missingMintAddFirstDesc')
      )
      return
    }

    // Use first available mint (highest balance) and create invoice immediately
    const selectedMint = availableBalances[0]
    setMintBalanceToTopup(selectedMint)
    setIsLoading(true)

    const result = await WalletTask.topupQueueAwaitable(
      selectedMint,
      satsAmount,
      unitRef.current,
      '' // empty memo for POS
    )

    await handleTopupTaskResult(result)
  }

  // Handle invoice creation result
  const handleTopupTaskResult = async (result: TransactionTaskResult) => {
    log.trace('[POSScreen] handleTopupTaskResult')

    setIsLoading(false)

    const { status, id } = result.transaction as Transaction
    setTransactionStatus(status)
    setTransactionId(id)

    if (result.encodedInvoice) {
      setInvoiceToPay(result.encodedInvoice)
    }

    if (result.error) {
      setError(result.error)
      return
    }

  }

  // Reset for new transaction
  const resetState = () => {
    setAmountCents(0)
    setSatsAmount(0)
    setTransactionStatus(undefined)
    setTransactionId(undefined)
    setTransaction(undefined)
    setInvoiceToPay('')
    //setMintBalanceToTopup(undefined)
  }


  const gotoWallet = () => {
    resetState()
    navigation.goBack()
  }

  const handleError = (e: AppError) => {
    setError(e)
  }

  // Get colors
  const headerBg = useThemeColor('background')
  const textColor = useThemeColor('text')
  const textDimColor = useThemeColor('textDim')
  const mainButtonColor = useThemeColor('button')

  // Get selected mint info
  const selectedMint = mintBalanceToTopup
    ? mintsStore.findByUrl(mintBalanceToTopup.mintUrl)
    : undefined

  // Format display amount from cents to decimal string (e.g., 123 → "1.23")
  const formatCentsToDisplay = (cents: number): string => {
    const divisor = fiatPrecision // e.g., 100 for USD
    const whole = Math.floor(cents / divisor)
    const fraction = cents % divisor
    return `${whole}.${fraction.toString().padStart(fiatMantissa, '0')}`
  }

  const displayFiatAmount = formatCentsToDisplay(amountCents)

  return (
    <Screen preset="fixed" contentContainerStyle={$screen}>
      <MintHeader
        mint={selectedMint}
        unit={unitRef.current}
        onBackPress={gotoWallet}
        textColor={textColor as string}
        backgroundColor={headerBg as string}
        leftIconColor={textColor as string}
      />

      {/* Amount Display */}
      <View style={[$amountContainer]}>
        <Text
          style={[$fiatAmountText, { color: textColor }]}
          text={`${fiatSymbol} ${displayFiatAmount}`}
        />
        {walletStore.exchangeRate && (
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
            }}
          >
            <Text
              style={[$satsAmountText, { color: textDimColor }]}
              text={`${Currencies[CurrencyCode.SAT]!.symbol} ${formatCurrency(satsAmount, CurrencyCode.SAT, true)}`}
            />
          </View>
        )}
      </View>

      {/* Content Area */}
      <View style={$contentContainer}>
        {/* Show keypad when no invoice yet */}
        {!invoiceToPay && (
          <View style={$keypadContainer}>
            <NumericKeypad
              onKeyPress={handleKeyPress}
              onClear={onClearAmount}
              onLongPressBackspace={onClearAmount}
              disabled={transactionStatus === TransactionStatus.PENDING}
            />
            <View style={$buttonContainer}>
              <Button
                  LeftAccessory={() => (
                      <Icon
                        icon='faCheck'
                        color={'white'}
                        size={spacing.large}                  
                      />
                  )}
                  onPress={onConfirmAmount} 
                  style={$buttonSend}                        
              />
            </View>
          </View>
        )}

        {/* Show QR code when invoice is created */}
        {invoiceToPay && transactionStatus === TransactionStatus.PENDING && (
          <View style={$qrContainer}>
            <QRCodeBlock
              qrCodeData={invoiceToPay}
              title={`Lightning invoice`}
              type="Bolt11Invoice"
              size={spacing.screenWidth - spacing.large * 4}
            />
            <Button
              text={translate('commonCancel')}
              preset="secondary"
              onPress={resetState}
              style={{ marginTop: spacing.medium, minHeight: verticalScale(40), paddingVertical: verticalScale(spacing.tiny) }}  
            />
          </View>
        )}

        {/* Show success when completed */}
        {transactionStatus === TransactionStatus.COMPLETED && (
          <>
          <View style={$successContainer}>
            <Animated.View style={iconAnimatedStyle}>
              <Icon
                icon="faCheckCircle"
                size={80}
                color={mainButtonColor}
              />
            </Animated.View>
            <Text
              style={[$successText, { color: textColor }]}
              text={translate('payCommon_completed')}
            />
          </View>
          <View style={$bottomContainer}>
            <View style={[$buttonContainer]}>
              <Button
                text={translate('pos_newTransaction')}
                preset="default"
                onPress={resetState}
                style={[$buttonSend, { marginTop: spacing.large }]}
              />
            </View>
          </View>
          </>
        )}
      </View>
    

      {/* Error/Info modals */}
      {error && <ErrorModal error={error} />}
      {info && <InfoModal message={info} />}
      {isLoading && <Loading />}
    </Screen>
  )
})

const $screen: ViewStyle = {
  flex: 1,
}

const $amountContainer: ViewStyle = {
  alignItems: 'center',
  paddingVertical: spacing.extraLarge,
  paddingHorizontal: spacing.medium,
}

const $fiatAmountText: TextStyle = {
  fontFamily: typography.primary?.medium,
  fontSize: moderateScale(48),
  lineHeight: moderateScale(56),
}

const $satsAmountText: TextStyle = {
  fontFamily: typography.primary?.normal,
  fontSize: moderateScale(16),
  marginTop: spacing.tiny,
}

const $contentContainer: ViewStyle = {
  flex: 1,
  //paddingTop: spacing.medium,
}

const $keypadContainer: ViewStyle = {
  flex: 1,
  justifyContent: 'center',
}


const $qrContainer: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  paddingHorizontal: spacing.medium,
}

const $waitingText: TextStyle = {
  marginTop: spacing.small,
  textAlign: 'center',
}

const $successContainer: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: spacing.large,
  //paddingTop: spacing.large,
}

const $successText: TextStyle = {
  fontFamily: typography.primary?.medium,
  fontSize: moderateScale(20),
  marginTop: spacing.medium,
  textAlign: 'center',
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
  marginVertical: spacing.medium,
}

const $buttonSend: ViewStyle = {
  borderRadius: verticalScale(60 / 2),
  height: verticalScale(60),
  minWidth: verticalScale(140),  
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
