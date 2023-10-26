import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback} from 'react'
import {CommonActions, useFocusEffect} from '@react-navigation/native'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import {spacing, useThemeColor, colors, typography} from '../theme'
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

import {CashuUtils} from '../services/cashu/cashuUtils'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {MintListItem} from './Mints/MintListItem'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { resolveTxt } from 'dns'

export const ReceiveScreen: FC<WalletStackScreenProps<'Receive'>> = observer(
  function ReceiveScreen({route, navigation}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const isInternetReachable = useIsInternetReachable()
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
            if (!route.params?.encodedToken) {
                log.trace('nothing scanned')
                return
            }

            const encoded = route.params?.encodedToken
            setEncodedToken(encoded)
            onEncodedToken(encoded)
            
        }, [route.params?.encodedToken]),
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
    }

    
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)


    const onEncodedToken = async function (encoded: string) {
      try {
        navigation.setParams({encodedToken: undefined})
        
        const decoded: Token = CashuUtils.decodeToken(encoded)
        const tokenAmounts = CashuUtils.getTokenAmounts(decoded)

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


    const receiveOfflineToken = async function () {
        setIsLoading(true)
  
        const {transaction, message, error} =
            await Wallet.receiveOfflinePrepare(
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
  
        setIsLoading(false)
        toggleResultModal()
    }


    const gotoWallet = function() {
       resetState()
       navigation.popToTop()
    }

    const handleError = function (e: AppError): void {
      resetState()
      log.error(e.name, e.message)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const satsColor = colors.palette.primary200

    return (
      <Screen preset="auto" contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          
            <View style={$amountContainer}>
                {amountToReceive > 0 && receivedAmount === 0 && (
                <>
                    <Text
                        preset="subheading"
                        tx="receiveScreen.toReceive"
                        style={{color: 'white'}}
                    />
                    <Text 
                        text='SATS' 
                        size='xxs' 
                        style={{color: satsColor, fontFamily: typography.primary?.light}}
                    />
                    <Text
                        style={$amountToReceive}
                        text={amountToReceive.toLocaleString()}
                    />
                </>
                )}
                {receivedAmount > 0 && (
                <>
                    <Text
                        preset="subheading"
                        tx="receiveScreen.received"
                        style={{color: 'white'}}
                    />
                    <Text 
                        text='SATS' 
                        size='xxs' 
                        style={{color: satsColor, fontFamily: typography.primary?.light}}
                    />
                    <Text
                        style={$amountToReceive}
                        text={receivedAmount.toLocaleString()}
                    />
                </>
                )} 
              
            </View>          
        </View>
        <View style={$contentContainer}>          
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
                    {CashuUtils.getMintsFromToken(token).map((mintUrl, index) => {
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
                            // mintBalance={mintBalance}
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
                    onPress={gotoWallet}
                  />
                </View>
              ) : (
                <View style={$bottomContainer}>
                    <View style={$buttonContainer}>
                        {isInternetReachable ? (
                            <Button
                                tx={'receiveScreen.receive'}
                                onPress={receiveToken}
                                style={{marginRight: spacing.medium}}
                                LeftAccessory={() => (
                                <Icon
                                    icon="faArrowDown"
                                    color="white"
                                    size={spacing.medium}                                
                                />
                                )}
                            />
                        ) : (
                            <Button
                                tx={'receiveScreen.receiveOffline'}
                                onPress={receiveOfflineToken}
                                style={{marginRight: spacing.medium}}
                                LeftAccessory={() => (
                                <Icon
                                    icon="faArrowDown"
                                    color="white"
                                    size={spacing.medium}                                
                                />
                            )}
                        />
                        )}                  
                    <Button
                        preset="secondary"
                        tx={'common.cancel'}
                        onPress={gotoWallet}
                    />
                    </View>
                </View>
              )}
            </>
          )}
          {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {resultModalInfo?.status === TransactionStatus.COMPLETED && (
                <>
                  <ResultModalInfo
                    icon={'faCheckCircle'}
                    iconColor={colors.palette.success200}
                    title="Success!"
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx={'common.close'}
                      onPress={gotoWallet}
                    />
                  </View>
                </>
              )}
              {resultModalInfo?.status === TransactionStatus.PREPARED_OFFLINE && (
                <>
                  <ResultModalInfo
                    icon={'faTriangleExclamation'}
                    iconColor={colors.palette.accent400}
                    title="Attention!"
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx={'common.close'}
                      onPress={gotoWallet}
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
  padding: spacing.extraSmall,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
  flex: 1,
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
    paddingTop: spacing.large,
    fontSize: 52,
    fontWeight: '400',
    textAlignVertical: 'center',
    color: 'white',
}

const $bottomContainer: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.medium,
    alignSelf: 'stretch',
    // opacity: 0,
  }
