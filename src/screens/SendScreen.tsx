import {observer} from 'mobx-react-lite'
import {getSnapshot} from 'mobx-state-tree'
import React, {
  FC,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import {useFocusEffect} from '@react-navigation/native'
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
import {spacing, typography, useThemeColor, colors} from '../theme'
import {useSafeAreaInsetsStyle} from '../utils/useSafeAreaInsetsStyle'
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
import {MintKeys, MintKeySets, MintClient, Wallet} from '../services'
import {log} from '../utils/logger'
import AppError, {Err} from '../utils/AppError'
import {translate} from '../i18n'

import {MintBalance} from '../models/Mint'
import {MintListItem} from './Mints/MintListItem'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const SendScreen: FC<WalletStackScreenProps<'Send'>> = observer(
  function SendScreen({route, navigation}) {

  useHeader({
    leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {proofsStore, mintsStore} = useStores()
    const amountInputRef = useRef<TextInput>(null)
    const memoInputRef = useRef<TextInput>(null)
    // const tokenInputRef = useRef<TextInput>(null)


  const [encodedTokenToSend, setEncodedTokenToSend] = useState<string | undefined>()
    const [amountToSend, setAmountToSend] = useState<string>('')
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<
      MintBalance[]
    >([])
    const [mintBalanceToSendFrom, setMintBalanceToSendFrom] = useState<
      MintBalance | undefined
    >()
    const [transactionStatus, setTransactionStatus] = useState<
      TransactionStatus | undefined
    >()
    const [transactionId, setTransactionId] = useState<number | undefined>()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isAmountEndEditing, setIsAmountEndEditing] = useState<boolean>(false)
    const [isSharedAsText, setIsSharedAsText] = useState<boolean>(false)
    const [isSharedAsQRCode, setIsSharedAsQRCode] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, message: string} | undefined>()
    const [isMemoEndEditing, setIsMemoEndEditing] = useState<boolean>(false)
    const [isLoading, setIsLoading] = useState(false)

  const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
    const [isSendModalVisible, setIsSendModalVisible] = useState(false)
    const [isQRModalVisible, setIsQRModalVisible] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)


  useEffect(() => {
      const focus = () => {
        amountInputRef && amountInputRef.current
          ? amountInputRef.current.focus()
          : false
      }


    const timer = setTimeout(() => focus(), 100)

      return () => {
        clearTimeout(timer)
      }
    }, [])

    useEffect(() => {
      const handleSendCompleted = (transactionIds: number[]) => {
        log.trace('handleSendCompleted event handler trigerred')

        if (!transactionId) return
        // Filter and handle events for a specific transactionId
        if (transactionIds.includes(transactionId)) {
          log.trace(
            'Sent coins have been claimed by receiver for tx',
            transactionId,
          )

          setResultModalInfo({
            status: TransactionStatus.COMPLETED,
            message: `Done! ${amountToSend} sats were received by the payee.`,
          })

          setTransactionStatus(TransactionStatus.COMPLETED)
          setIsQRModalVisible(false)
          setIsSendModalVisible(false)
          setIsResultModalVisible(true)
        }
      }

      // Subscribe to the 'sendCompleted' event
      EventEmitter.on('sendCompleted', handleSendCompleted)

      // Unsubscribe from the 'sendCompleted' event on component unmount
      return () => {
        EventEmitter.off('sendCompleted', handleSendCompleted)
      }
    }, [transactionId])

    const toggleSendModal = () =>
      setIsSendModalVisible(previousState => !previousState)
    const toggleQRModal = () =>
      setIsQRModalVisible(previousState => !previousState)
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)


  const onAmountEndEditing = function () {
      try {
        const amount = parseInt(amountToSend)

        if (!amount || amount === 0) {
          setInfo('Amount should be positive number')
          return
        }

        const availableBalances =
          proofsStore.getMintBalancesWithEnoughBalance(amount)

        if (availableBalances.length === 0) {
          setInfo('There is not enough funds to send this amount')
          return
        }

        log.trace(
          'availableBalances',
          availableBalances.length          
        )

        setAvailableMintBalances(availableBalances)

        // Set mint to send from immediately if only one is available
        if (availableBalances.length === 1) {
          setMintBalanceToSendFrom(availableBalances[0])
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
    const onShareAsText = function () {
      // if tx has been already executed, re-open SendModal
      if (transactionStatus === TransactionStatus.PENDING) {
        toggleSendModal() // open
        return
      }

      setIsSharedAsText(true)
      setIsSharedAsQRCode(false)
      // pass share kind directly to avoid delayed state update
      return onShare('TEXT')
    }

    const onShareAsQRCode = function () {
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
      if (amountToSend.length === 0) {
        setInfo('Provide the amount you want to send')
        return
      }

      // Skip mint modal and send immediately if only one mint is available
      if (availableMintBalances.length === 1) {

      const result = await send()

        if (result.error) {
          setResultModalInfo({
            status: result.transaction?.status as TransactionStatus,
            message: result.error.message,
          })
          setIsResultModalVisible(true)
          return
        }

        if (as === 'TEXT') {
          toggleSendModal()
        }
        if (as === 'QRCODE') {
          toggleQRModal()
        }
        return
      }

      // Pre-select mint with highest balance and show mint modal to confirm which mint to send from
      setMintBalanceToSendFrom(availableMintBalances[0])
      setIsMintSelectorVisible(true)
      // toggleMintModal() // open
    }

    const onMintBalanceSelect = function (balance: MintBalance) {
      setMintBalanceToSendFrom(balance)
    }

    const onMintBalanceConfirm = async function () {
      if (!mintBalanceToSendFrom) return

      const result = await send()

      if (result.error) {
        setResultModalInfo({
          status: result.transaction?.status as TransactionStatus,
          message: result.error.message,
        })
        setIsResultModalVisible(true)
        return
      }

      isSharedAsText && toggleSendModal() // open
      isSharedAsQRCode && toggleQRModal() // open

    setIsMintSelectorVisible(false)
  }

    const onMintBalanceCancel = async function () {
      setIsMintSelectorVisible(false)
    }

    const send = async function () {
      setIsLoading(true)

      const result = await Wallet.send(
        mintBalanceToSendFrom as MintBalance,
        parseInt(amountToSend),
        memo,
      )

      const {status, id} = result.transaction as Transaction
      setTransactionStatus(status)
      setTransactionId(id)

      if (result.encodedTokenToSend) {
        setEncodedTokenToSend(result.encodedTokenToSend)
      }

    setIsLoading(false)
      return result
    }

    const onShareToApp = async () => {
      try {
        const result = await Share.share({
          message: encodedTokenToSend as string,
        })

        if (result.action === Share.sharedAction) {
          toggleSendModal()
          setTimeout(
            () =>
              setInfo(
                'Coins have been shared, waiting to be claimed by receiver',
              ),
            500,
          )
        } else if (result.action === Share.dismissedAction) {
          setInfo(
            'Sharing cancelled, coins are waiting to be claimed by receiver',
          )
        }
      } catch (e: any) {
        handleError(e)
      }
    }

    const onCopy = function () {
      try {
        Clipboard.setString(encodedTokenToSend as string)
      } catch (e: any) {
        setInfo(`Could not copy: ${e.message}`)
      }
    }


  const handleError = function(e: AppError): void {
      // TODO resetState() on all tx data on error? Or save txId to state and allow retry / recovery?
      setIsSendModalVisible(false)
      setIsQRModalVisible(false)
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
            text="Amount to send"
            style={{color: 'white'}}
          />
          <View style={$amountContainer}>
            <TextInput
              ref={amountInputRef}
              onChangeText={amount => setAmountToSend(amount)}
              // onFocus={() => setIsAmountEndEditing(false)}
              onEndEditing={onAmountEndEditing}
              value={amountToSend}
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
                  placeholder="Memo for recipient"
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
                    tx="sendScreen.sendToContact"
                    subTx="sendScreen.sendToContactDescription"
                    LeftComponent={
                      <Icon
                        icon="faAddressCard"
                        size={spacing.medium}
                        color={colors.palette.secondary300}
                        inverse={true}
                      />
                    }
                    style={$item}
                    bottomSeparator={true}
                    onPress={() => Alert.alert('Not implemented yet')}
                  />
                  <ListItem
                    tx="sendScreen.showAsQRCode"
                    subTx="sendScreen.showAsQRCodeDescription"
                    LeftComponent={
                      <Icon
                        icon="faQrcode"
                        size={spacing.medium}
                        color={colors.palette.success200}
                        inverse={true}
                      />
                    }
                    style={$item}
                    bottomSeparator={true}
                    onPress={onShareAsQRCode}
                  />
                  <ListItem
                    tx="sendScreen.shareAsText"
                    subTx="sendScreen.shareAsTextDescription"
                    LeftComponent={
                      <Icon
                        icon="faShareFromSquare"
                        size={spacing.medium}
                        color={colors.palette.accent300}
                        inverse={true}
                      />
                    }
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
                mintBalanceToSendFrom={mintBalanceToSendFrom as MintBalance}
                onMintBalanceSelect={onMintBalanceSelect}
                onCancel={onMintBalanceCancel}
                findByUrl={mintsStore.findByUrl}
                onMintBalanceConfirm={onMintBalanceConfirm}
              />
            )}
          {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isSendModalVisible ? true : false}
          top={spacing.screenHeight * 0.367}
          style={{marginHorizontal: spacing.extraSmall}}
          ContentComponent={
            <SendAsTextBlock
              toggleSendModal={toggleSendModal}
              encodedTokenToSend={encodedTokenToSend as string}
              onShareToApp={onShareToApp}
              onCopy={onCopy}
            />
          }
          onBackButtonPress={toggleSendModal}
          onBackdropPress={toggleSendModal}
        />
        <BottomModal
          isVisible={isQRModalVisible ? true : false}
          top={spacing.screenHeight * 0.367}
          style={{marginHorizontal: spacing.extraSmall}}
          ContentComponent={
            <SendAsQRCodeBlock
              toggleQRModal={toggleQRModal}
              encodedTokenToSend={encodedTokenToSend as string}
              onCopy={onCopy}
            />
          }
          onBackButtonPress={toggleQRModal}
          onBackdropPress={toggleQRModal}
        />
        <BottomModal
          isVisible={isResultModalVisible ? true : false}
          top={spacing.screenHeight * 0.6}
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
                      title="Send failed"
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
  }
)

const MintBalanceSelector = observer(function (props: {
  availableMintBalances: MintBalance[]
  mintBalanceToSendFrom: MintBalance
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
        heading={'Pay from'}
        headingStyle={{textAlign: 'center', padding: spacing.small}}
        ContentComponent={
          <>
            {props.availableMintBalances.map(
              (balance: MintBalance, index: number) => (
                <MintListItem
                  key={balance.mint}
                  mint={props.findByUrl(balance.mint)}
                  mintBalance={balance}
                  onMintSelect={() => onMintSelect(balance)}
                  isSelectable={true}
                  isSelected={props.mintBalanceToSendFrom.mint === balance.mint}
                  separator={'top'}
                />
              )
            )}
          </>
        }
      />
      <View style={[$buttonContainer, {marginTop: spacing.large}]}>
        <Button
          text="Send now"
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

const SendAsTextBlock = observer(function (props: {
  toggleSendModal: any
  encodedTokenToSend: string
  onShareToApp: any
  onCopy: any
}) {
  const sendBg = useThemeColor('background')
  const tokenTextColor = useThemeColor('textDim')
  const $bottomContainerInsets = useSafeAreaInsetsStyle(['bottom'])

  return (
    <View style={$bottomModal}>
      <Text
        text={'Share coins'}
      />
      <ScrollView
        style={[
          $tokenContainer,
          {backgroundColor: sendBg, marginHorizontal: spacing.small},
        ]}>
        <Text
          selectable
          text={props.encodedTokenToSend}
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

const SendAsQRCodeBlock = observer(function (props: {
  toggleQRModal: any
  encodedTokenToSend: string
  onCopy: any
}) {

    const sendBg = useThemeColor('background')
  const tokenTextColor = useThemeColor('textDim')
  const $bottomContainerInsets = useSafeAreaInsetsStyle(['bottom'])

  return (
    <View style={[$bottomModal, {marginHorizontal: spacing.small}]}>
      <Text text={'Scan to receive'} />
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

const $receiveMsg: ViewStyle = {
  flexDirection: 'row',
  borderRadius: spacing.large,
  justifyContent: 'flex-start',
  padding: spacing.small,
}

