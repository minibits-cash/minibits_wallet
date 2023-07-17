import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState, useRef} from 'react'
import {
  UIManager,
  Platform,
  Alert,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
  LayoutAnimation,
  ScrollView,
  Share,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import QRCode from 'react-native-qrcode-svg'
import {spacing, useThemeColor, colors} from '../theme'
import {WalletStackScreenProps} from '../navigation'
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
} from '../components'
import {TransactionStatus, Transaction} from '../models/Transaction'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {Wallet} from '../services'
import {log} from '../utils/logger'
import AppError from '../utils/AppError'

import {MintBalance} from '../models/Mint'
import {MintListItem} from './Mints/MintListItem'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {Invoice} from '../models/Invoice'

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const TopupScreen: FC<WalletStackScreenProps<'Topup'>> = observer(
  function TopupScreen({navigation}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {proofsStore, mintsStore} = useStores()
    const amountInputRef = useRef<TextInput>(null)
    const memoInputRef = useRef<TextInput>(null)
    // const tokenInputRef = useRef<TextInput>(null)

    const [amountToTopup, setAmountToTopup] = useState<string>('')
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<
      MintBalance[]
    >([])
    const [mintBalanceToTopup, setMintBalanceToTopup] = useState<
      MintBalance | undefined
    >()
    const [transactionStatus, setTransactionStatus] = useState<
      TransactionStatus | undefined
    >()
    const [transactionId, setTransactionId] = useState<number | undefined>()
    const [invoiceToPay, setInvoiceToPay] = useState<string>('')
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isAmountEndEditing, setIsAmountEndEditing] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; message: string} | undefined
    >()
    const [isSharedAsText, setIsSharedAsText] = useState<boolean>(false)
    const [isSharedAsQRCode, setIsSharedAsQRCode] = useState<boolean>(false)

    const [isMemoEndEditing, setIsMemoEndEditing] = useState<boolean>(false)
    const [isLoading, setIsLoading] = useState(false)

    const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
    const [isShareModalVisible, setIsShareModalVisible] = useState(false)
    const [isQRModalVisible, setIsQRModalVisible] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)

    useEffect(() => {
      const focus = () => {
        amountInputRef && amountInputRef.current
          ? amountInputRef.current.focus()
          : false
      }
      const timer = setTimeout(() => focus(), 500)

      return () => {
        clearTimeout(timer)
      }
    }, [])

    useEffect(() => {
      const handleCompleted = (invoice: Invoice) => {
        log.trace('handleCompleted event handler trigerred')

        if (!transactionId) {
          return
        }
        // Filter and handle events only for this topup transactionId
        if (invoice.transactionId === transactionId) {
          log.trace('Invoice has been paid and new proofs received')

          setResultModalInfo({
            status: TransactionStatus.COMPLETED,
            message: `Payment received! Your wallet has been credited with ${invoice.amount} sats.`,
          })

          setTransactionStatus(TransactionStatus.COMPLETED)
          setIsQRModalVisible(false)
          setIsShareModalVisible(false)
          setIsResultModalVisible(true)
        }
      }

      // Subscribe to the 'tokenEntryAdded' event
      EventEmitter.on('topupCompleted', handleCompleted)

      // Unsubscribe from the 'tokenEntryAdded' event on component unmount
      return () => {
        EventEmitter.off('topupCompleted', handleCompleted)
      }
    }, [transactionId])

    const toggleShareModal = () =>
      setIsShareModalVisible(previousState => !previousState)
    const toggleQRModal = () =>
      setIsQRModalVisible(previousState => !previousState)
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)

    const onAmountEndEditing = function () {
      try {
        const amount = parseInt(amountToTopup)

        if (!amount || amount === 0) {
          setInfo('Amount should be positive number')
          return
        }

        const mintBalances = proofsStore.getBalances().mintBalances

        if (mintBalances.length === 0) {
          setInfo(
            'There is no mint connected to your wallet that you would receive your coins from. Add the mint first.',
          )
          return
        }

        log.trace('onAmountEndEditing() availableBalances', mintBalances.length)

        setAvailableMintBalances(mintBalances)

        // Set mint to send from immediately if only one is available
        if (mintBalances.length === 1) {
          setMintBalanceToTopup(mintBalances[0])
        }

        setIsAmountEndEditing(true)

        memoInputRef && memoInputRef.current
          ? memoInputRef.current.focus()
          : false
      } catch (e: any) {
        handleError(e)
      }
    }

    const onMemoEndEditing = function () {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
      setIsMemoEndEditing(true)
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
    const onShareAsText = async function () {
      // if tx has been already executed, re-open SendModal
      if (transactionStatus === TransactionStatus.PENDING) {
        toggleShareModal() // open
        return
      }

      setIsSharedAsText(true)
      setIsSharedAsQRCode(false)
      // pass share kind directly to avoid delayed state update
      return onShare('TEXT')
    }

    const onShareAsQRCode = async function () {
      // if tx has been already executed, re-open QRCodeModal
      if (transactionStatus === TransactionStatus.PENDING) {
        toggleQRModal() // open
        return
      }

      setIsSharedAsQRCode(true)
      setIsSharedAsText(false)
      // pass share kind directly to avoid delayed state update
      return onShare('QRCODE')
    }

    const onShare = async function (as: 'TEXT' | 'QRCODE'): Promise<void> {
      if (amountToTopup.length === 0) {
        setInfo('Provide the top-up amount')
        return
      }

      // Skip mint modal and send immediately if only one mint is available
      if (availableMintBalances.length === 1) {
        const result = await requestTopup()

        if (result.error) {
          setResultModalInfo({
            status: result.transaction?.status as TransactionStatus,
            message: result.error.message,
          })
          setIsResultModalVisible(true)
          return
        }

        if (as === 'TEXT') {
          toggleShareModal()
        }
        if (as === 'QRCODE') {
          toggleQRModal()
        }
        return
      }

      // Pre-select mint with highest balance and show mint modal to confirm which mint to send from
      setMintBalanceToTopup(availableMintBalances[0])
      setIsMintSelectorVisible(true)
      // toggleMintModal() // open
    }

    const onMintBalanceSelect = function (balance: MintBalance) {
      setMintBalanceToTopup(balance)
    }

    const onMintBalanceConfirm = async function () {
      if (mintBalanceToTopup) {
        const result = await requestTopup()

        if (result.error) {
          setResultModalInfo({
            status: result.transaction?.status as TransactionStatus,
            message: result.error.message,
          })
          setIsResultModalVisible(true)
          return
        }

        isSharedAsText && toggleShareModal() // open
        isSharedAsQRCode && toggleQRModal() // open
      }
      setIsMintSelectorVisible(false)
    }

    const onMintBalanceCancel = async function () {
      setIsMintSelectorVisible(false)
    }

    const requestTopup = async function () {
      setIsLoading(true)

      const result = await Wallet.topup(
        mintBalanceToTopup as MintBalance,
        parseInt(amountToTopup),
        memo,
      )

      const {status, id} = result.transaction as Transaction
      setTransactionStatus(status)
      setTransactionId(id)

      if (result.encodedInvoice) {
        setInvoiceToPay(result.encodedInvoice)
      }

      setIsLoading(false)
      return result
    }

    const onShareToApp = async () => {
      try {
        const result = await Share.share({
          message: invoiceToPay as string,
        })

        if (result.action === Share.sharedAction) {
          toggleShareModal()
          setTimeout(
            () =>
              setInfo(
                'Lightning invoice has been shared, waiting to be paid by receiver',
              ),
            500,
          )
        } else if (result.action === Share.dismissedAction) {
          setInfo('Sharing cancelled')
        }
      } catch (e: any) {
        handleError(e)
      }
    }

    const onCopy = function () {
      try {
        Clipboard.setString(invoiceToPay as string)
      } catch (e: any) {
        setInfo(`Could not copy: ${e.message}`)
      }
    }

    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    // const inputBg = useThemeColor('background')

    return (
      <Screen preset="auto" contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="subheading"
            text="Top-up amount"
            style={{color: 'white'}}
          />
          <View style={$amountContainer}>
            <TextInput
              ref={amountInputRef}
              onChangeText={amount => setAmountToTopup(amount)}
              // onFocus={() => setIsAmountEndEditing(false)}
              onEndEditing={onAmountEndEditing}
              value={amountToTopup}
              style={$amountInput}
              maxLength={9}
              keyboardType="numeric"
              selectTextOnFocus={true}
              editable={
                transactionStatus === TransactionStatus.PENDING ? false : true
              }
            />
          </View>
        </View>
        <View style={$contentContainer}>
          <Card
            style={$memoCard}
            ContentComponent={
              <View style={$memoContainer}>
                <TextInput
                  ref={memoInputRef}
                  onChangeText={memo => setMemo(memo)}
                  onEndEditing={onMemoEndEditing}
                  value={`${memo}`}
                  style={$memoInput}
                  maxLength={200}
                  keyboardType="default"
                  selectTextOnFocus={true}
                  placeholder="Memo for the payer"
                  editable={
                    transactionStatus === TransactionStatus.PENDING
                      ? false
                      : true
                  }
                />
                <Button
                  preset="secondary"
                  style={$memoButton}
                  text="Done"
                  onPress={onMemoDone}
                  disabled={
                    transactionStatus === TransactionStatus.PENDING
                      ? false
                      : true
                  }
                />
              </View>
            }
          />
          {isAmountEndEditing && isMemoEndEditing && !isMintSelectorVisible && (
            <Card
              style={$card}
              ContentComponent={
                <>
                  <ListItem
                    tx="topupScreen.sendInvoiceToContact"
                    subTx="topupScreen.sendInvoiceToContactDescription"
                    leftIcon='faAddressCard'
                    leftIconColor={colors.palette.secondary300}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={() => Alert.alert('Not implemented yet')}
                  />
                  <ListItem
                    tx="topupScreen.showInvoiceQRCode"
                    subTx="topupScreen.showInvoiceQRCodeDescription"
                    leftIcon='faQrcode'
                    leftIconColor={colors.palette.success200}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={onShareAsQRCode}
                  />
                  <ListItem
                    tx="topupScreen.shareInvoiceAsText"
                    subTx="topupScreen.shareInvoiceAsTextDescription"
                    leftIcon='faShareFromSquare'
                    leftIconColor={colors.palette.accent300}
                    leftIconInverse={true}
                    style={$item}
                    onPress={onShareAsText}
                  />
                </>
              }
            />
          )}
          {isMintSelectorVisible &&
            transactionStatus !== TransactionStatus.PENDING && (
              <MintBalanceSelector
                availableMintBalances={availableMintBalances}
                mintBalanceToTopup={mintBalanceToTopup as MintBalance}
                onMintBalanceSelect={onMintBalanceSelect}
                onCancel={onMintBalanceCancel}
                findByUrl={mintsStore.findByUrl}
                onMintBalanceConfirm={onMintBalanceConfirm}
              />
            )}
          {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isShareModalVisible ? true : false}
          top={spacing.screenHeight * 0.367}
          style={{marginHorizontal: spacing.extraSmall}}
          ContentComponent={
            <ShareAsTextBlock
              toggleSendModal={toggleShareModal}
              invoiceToPay={invoiceToPay as string}
              onShareToApp={onShareToApp}
              onCopy={onCopy}
            />
          }
          onBackButtonPress={toggleShareModal}
          onBackdropPress={toggleShareModal}
        />
        <BottomModal
          isVisible={isQRModalVisible ? true : false}
          top={spacing.screenHeight * 0.367}
          style={{marginHorizontal: spacing.extraSmall}}
          ContentComponent={
            <ShareAsQRCodeBlock
              toggleQRModal={toggleQRModal}
              encodedTokenToSend={invoiceToPay as string}
              onCopy={onCopy}
            />
          }
          onBackButtonPress={toggleQRModal}
          onBackdropPress={toggleQRModal}
        />
        <BottomModal
          isVisible={isResultModalVisible ? true : false}
          top={spacing.screenHeight * 0.6}
          style={{paddingHorizontal: spacing.small}}
          ContentComponent={
            <>
              {resultModalInfo &&
                transactionStatus === TransactionStatus.COMPLETED && (
                  <>
                    <ResultModalInfo
                      icon="faCheckCircle"
                      iconColor={colors.palette.success200}
                      title="Success!"
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx={'common.close'}
                        onPress={() => navigation.navigate('Wallet')}
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
                      title="Topup failed"
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx={'common.close'}
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
      </Screen>
    )
  },
)

const MintBalanceSelector = observer(function (props: {
  availableMintBalances: MintBalance[]
  mintBalanceToTopup: MintBalance
  onMintBalanceSelect: any
  onCancel: any
  findByUrl: any
  onMintBalanceConfirm: any
}) {
  const onMintSelect = function (balance: MintBalance) {
    log.trace('onMintBalanceSelect', balance.mint)
    return props.onMintBalanceSelect(balance)
  }

  return (
    <>
      <Card
        style={$card}
        heading={'Select mint to top-up'}
        headingStyle={{textAlign: 'center', padding: spacing.small}}
        ContentComponent={
          <>
            {props.availableMintBalances.map(
              (balance: MintBalance) => (
                <MintListItem
                  key={balance.mint}
                  mint={props.findByUrl(balance.mint)}
                  mintBalance={balance}
                  onMintSelect={() => onMintSelect(balance)}
                  isSelectable={true}
                  isSelected={props.mintBalanceToTopup.mint === balance.mint}
                  separator={'top'}
                />
              ),
            )}
          </>
        }
      />
      <View style={[$buttonContainer, {marginTop: spacing.large}]}>
        <Button
          text="Create invoice"
          onPress={props.onMintBalanceConfirm}
          style={{marginRight: spacing.medium}}
          // LeftAccessory={() => <Icon icon="faCoins" color="white" size={spacing.medium} containerStyle={{marginRight: spacing.small}}/>}
        />
        <Button
          preset="secondary"
          tx={'common.cancel'}
          onPress={props.onCancel}
        />
      </View>
    </>
  )
})

const ShareAsTextBlock = observer(function (props: {
  toggleSendModal: any
  invoiceToPay: string
  onShareToApp: any
  onCopy: any
}) {
  const sendBg = useThemeColor('background')
  const tokenTextColor = useThemeColor('textDim')

  return (
    <View style={$bottomModal}>
      <Text text={'Share lightning invoice'} />
      <ScrollView
        style={[
          $tokenContainer,
          {backgroundColor: sendBg, marginHorizontal: spacing.small},
        ]}>
        <Text
          selectable
          text={props.invoiceToPay}
          style={{color: tokenTextColor, paddingBottom: spacing.medium}}
          size="xxs"
        />
      </ScrollView>
      <View style={$buttonContainer}>
        <Button
          text="Share"
          onPress={props.onShareToApp}
          style={{marginRight: spacing.medium}}
          LeftAccessory={() => (
            <Icon
              icon="faShareFromSquare"
              color="white"
              size={spacing.medium}
              containerStyle={{marginRight: spacing.small}}
            />
          )}
        />
        <Button preset="secondary" text="Copy" onPress={props.onCopy} />
        <Button
          preset="tertiary"
          text="Close"
          onPress={props.toggleSendModal}
        />
      </View>
    </View>
  )
})

const ShareAsQRCodeBlock = observer(function (props: {
  toggleQRModal: any
  encodedTokenToSend: string
  onCopy: any
}) {
  return (
    <View style={[$bottomModal, {marginHorizontal: spacing.small}]}>
      <Text text={'Scan and pay to top-up'} />
      <View style={$qrCodeContainer}>
        <QRCode size={270} value={props.encodedTokenToSend} />
      </View>
      <View style={$buttonContainer}>
        <Button preset="secondary" text="Close" onPress={props.toggleQRModal} />
      </View>
    </View>
  )
})

const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
  padding: spacing.extraSmall,
}

const $amountContainer: ViewStyle = {
  height: 90,
  alignSelf: 'center',
}

const $amountInput: TextStyle = {
  flex: 1,
  borderRadius: spacing.small,
  fontSize: 52,
  fontWeight: '400',
  textAlignVertical: 'center',
  textAlign: 'center',
  color: 'white',
}

const $memoCard: ViewStyle = {
  marginBottom: spacing.small,
}

const $memoContainer: ViewStyle = {
  flex: 1,
  flexDirection: 'row',
  justifyContent: 'center',
  alignItems: 'center',
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
  flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.large,
  // paddingHorizontal: spacing.small,
}

const $qrCodeContainer: ViewStyle = {
  backgroundColor: 'white',
  padding: spacing.small,
  margin: spacing.small,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}
