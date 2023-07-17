import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback} from 'react'
import {useFocusEffect} from '@react-navigation/native'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
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
import {Mint} from '../models/Mint'
import {Token} from '../models/Token'
import {Transaction, TransactionStatus} from '../models/Transaction'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {Wallet} from '../services'
import {log} from '../utils/logger'
import AppError from '../utils/AppError'

import {
  decodeToken,
  getTokenAmounts,
  getMintsFromToken,
} from '../services/cashuHelpers'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {MintListItem} from './Mints/MintListItem'

export const ReceiveScreen: FC<WalletStackScreenProps<'Receive'>> = observer(
  function ReceiveScreen({route, navigation}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {mintsStore} = useStores()

    const [token, setToken] = useState<Token | undefined>()
    const [encodedToken, setEncodedToken] = useState<string | undefined>()
    const [amountToReceive, setAmountToReceive] = useState<number>(0)
    const [receivedAmount, setReceivedAmount] = useState<number>(0)
    const [transactionStatus, setTransactionStatus] = useState<
      TransactionStatus | undefined
    >()
    const [memo, setMemo] = useState('')
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; message: string} | undefined
    >()

    useFocusEffect(
      useCallback(() => {
        if (!route.params?.scannedEncodedToken) {
            log.trace('nothing scanned')
            return
        }

        const encoded = route.params?.scannedEncodedToken
        setEncodedToken(encoded)
        onEncodedToken(encoded)
        
      }, [route.params?.scannedEncodedToken]),
    )

    const resetState = function () {
      setToken(undefined)
      setEncodedToken(undefined)
      setAmountToReceive(0)
      setReceivedAmount(0)
      setTransactionStatus(undefined)
      setMemo('')
      setInfo('')
      setError(undefined)
      setIsLoading(false)
      setIsResultModalVisible(false)
      setResultModalInfo(undefined)
      // setIsQRCodeModalVisible(false)
    }

    const gotoScan = function () {
      navigation.navigate('Scan')
    }

    // const toggleQRCodeModal = () => setIsQRCodeModalVisible(previousState => !previousState)
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)

    const onPasteEncodedToken = async function () {
      const encoded = await Clipboard.getString()
      if (!encoded) {
        setInfo('Copy received token first, then paste')
        return
      }

      setEncodedToken(encoded)
      return onEncodedToken(encoded)
    }

    const onEncodedToken = async function (encoded: string) {
      try {
        navigation.setParams({scannedEncodedToken: undefined})
        
        const decoded: Token = decodeToken(encoded)
        const tokenAmounts = getTokenAmounts(decoded)

        log.trace('decoded token', decoded)
        log.trace('tokenAmounts', tokenAmounts)

        setToken(decoded)
        setAmountToReceive(tokenAmounts.totalAmount)

        if (decoded.memo && decoded.memo.length > 0) {
          setMemo(decoded.memo as string)
        }
      } catch (e: any) {
        handleError(e)
      }
    }

    const receiveToken = async function () {
      setIsLoading(true)

      const {transaction, message, error, receivedAmount} =
        await Wallet.receive(
          token as Token,
          amountToReceive,
          memo,
          encodedToken as string,
        )

      const {status} = transaction as Transaction
      setTransactionStatus(status)

      if (error) {
        setResultModalInfo({
          status,
          message: error.message,
        })
      } else {
        setResultModalInfo({
          status,
          message,
        })
      }

      if (receivedAmount) {
        setReceivedAmount(receivedAmount)
      }

      setIsLoading(false)
      toggleResultModal()
    }

    const handleError = function (e: AppError): void {
      resetState()
      log.error(e.name, e.message)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')

    return (
      <Screen preset="auto" contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          {token && amountToReceive > 0 ? (
            <View style={$amountContainer}>
              {receivedAmount > 0 ? (
                <>
                  <Text
                    preset="subheading"
                    tx="receiveScreen.received"
                    style={{color: 'white'}}
                  />
                  <Text
                    style={$amountToReceive}
                    text={receivedAmount.toLocaleString()}
                  />
                </>
              ) : (
                <>
                  <Text
                    preset="subheading"
                    tx="receiveScreen.toReceive"
                    style={{color: 'white'}}
                  />
                  <Text
                    style={$amountToReceive}
                    text={amountToReceive.toLocaleString()}
                  />
                </>
              )}
            </View>
          ) : (
            <Text
              preset="heading"
              tx="receiveScreen.title"
              style={{color: 'white'}}
            />
          )}
        </View>
        <View style={$contentContainer}>
          {!token && amountToReceive === 0 && (
            <Card
              style={$optionsCard}
              ContentComponent={
                <>
                  <ListItem
                    tx="receiveScreen.sharePaymentRequest"
                    subTx="receiveScreen.sharePaymentRequestDescription"
                    leftIcon='faAddressCard'
                    leftIconColor={colors.palette.secondary300}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={() => Alert.alert('Not yet implemented')}
                  />
                  <ListItem
                    tx="receiveScreen.scanQRCodeToReceive"
                    subTx="receiveScreen.scanQRCodeToReceiveDescription"
                    leftIcon='faQrcode'
                    leftIconColor={colors.palette.success200}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoScan}
                  />
                  <ListItem
                    tx="receiveScreen.pasteFromClipboard"
                    subTx="receiveScreen.pasteFromClipboardDescription"
                    leftIcon='faClipboard'
                    leftIconColor={colors.palette.accent300}
                    leftIconInverse={true}
                    style={$item}
                    onPress={onPasteEncodedToken}
                  />
                </>
              }
            />
          )}
          {token && amountToReceive > 0 && (
            <>
              {memo && (
                <Card
                  style={[$card, {minHeight: 0}]}
                  ContentComponent={
                    <ListItem
                      text={memo}
                      LeftComponent={
                        <Icon
                          containerStyle={$iconContainer}
                          icon="faPencil"
                          size={spacing.medium}
                          color={iconColor}
                        />
                      }
                      style={$item}
                    />
                  }
                />
              )}
              <Card
                style={$card}
                heading={
                  transactionStatus === TransactionStatus.COMPLETED
                    ? 'Received from'
                    : 'Receive from'
                }
                headingStyle={{textAlign: 'center', padding: spacing.small}}
                ContentComponent={
                  <>
                    {getMintsFromToken(token).map((mintUrl, index) => {
                      const mint = mintsStore.findByUrl(mintUrl)
                      if (!mint) {
                        return (
                          <ListItem
                            key={mintUrl}
                            text={new URL(mintUrl).hostname}
                            topSeparator={true}
                            RightComponent={<Text text='New' style={{alignSelf: 'center', color: colors.palette.accent300}}/>}
                          />
                        )
                      } else {
                        return (
                          <MintListItem
                            key={mintUrl}
                            mint={mint as Mint}
                            separator={'top'}
                            isSelectable={false}
                          />
                        )
                      }
                    })}
                  </>
                }
              />
              {transactionStatus === TransactionStatus.COMPLETED ? (
                <View style={$buttonContainer}>
                  <Button
                    preset="secondary"
                    tx={'common.close'}
                    onPress={() => navigation.navigate('Wallet', {})}
                  />
                </View>
              ) : (
                <View style={$buttonContainer}>
                  <Button
                    tx={'receiveScreen.receive'}
                    onPress={receiveToken}
                    style={{marginRight: spacing.medium}}
                    LeftAccessory={() => (
                      <Icon
                        icon="faArrowDown"
                        color="white"
                        size={spacing.medium}
                        containerStyle={{marginRight: spacing.small}}
                      />
                    )}
                  />
                  <Button
                    preset="secondary"
                    tx={'common.cancel'}
                    onPress={resetState}
                  />
                </View>
              )}
            </>
          )}
          {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isResultModalVisible ? true : false}
          top={spacing.screenHeight * 0.6}
          ContentComponent={
            <>
              {resultModalInfo?.status === TransactionStatus.COMPLETED && (
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
                      onPress={() => navigation.navigate('Wallet', {})}
                    />
                  </View>
                </>
              )}
              {(resultModalInfo?.status === TransactionStatus.ERROR ||
                resultModalInfo?.status === TransactionStatus.BLOCKED) && (
                <>
                  <ResultModalInfo
                    icon="faTriangleExclamation"
                    iconColor={colors.palette.angry500}
                    title="Receive failed"
                    message={resultModalInfo?.message as string}
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

const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
  // flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $optionsCard: ViewStyle = {
  marginTop: -spacing.extraLarge * 2,
  marginBottom: spacing.small,
  paddingTop: 0,
}

const $card: ViewStyle = {
  // marginTop: - spacing.extraLarge * 2,
  marginBottom: spacing.small,
  paddingTop: 0,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $iconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}

const $amountContainer: ViewStyle = {
  alignItems: 'center',
  justifyContent: 'center',
}

const $amountToReceive: TextStyle = {
  flex: 1,
  paddingTop: spacing.extraLarge + 10,
  fontSize: 52,
  fontWeight: '400',
  textAlignVertical: 'center',
  color: 'white',
}
