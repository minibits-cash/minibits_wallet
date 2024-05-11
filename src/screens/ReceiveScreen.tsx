import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback, useEffect} from 'react'
import {useFocusEffect} from '@react-navigation/native'
import {TextInput, TextStyle, View, ViewStyle} from 'react-native'
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
import {TransactionTaskResult, WalletTask} from '../services'
import {log} from '../services/logService'
import AppError, { Err } from '../utils/AppError'
import EventEmitter from '../utils/eventEmitter'

import {CashuUtils} from '../services/cashu/cashuUtils'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {MintListItem} from './Mints/MintListItem'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { moderateVerticalScale } from '@gocodingnow/rn-size-matters'
import { CurrencyCode, MintUnit, getCurrency } from "../services/wallet/currency"
import { MintHeader } from './Mints/MintHeader'
import { round, toNumber } from '../utils/number'
import numbro from 'numbro'

export const ReceiveScreen: FC<WalletStackScreenProps<'Receive'>> = observer(
  function ReceiveScreen({route, navigation}) {
    const isInternetReachable = useIsInternetReachable()
    const {mintsStore} = useStores()

    const [token, setToken] = useState<Token | undefined>()
    const [encodedToken, setEncodedToken] = useState<string | undefined>()
    const [amountToReceive, setAmountToReceive] = useState<string>('0')
    const [unit, setUnit] = useState<MintUnit>('sat')
    const [receivedAmount, setReceivedAmount] = useState<string>('0')
    const [transactionStatus, setTransactionStatus] = useState<
      TransactionStatus | undefined
    >()
    const [memo, setMemo] = useState('')
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isReceiveTaskSentToQueue, setIsReceiveTaskSentToQueue] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; title?: string, message: string} | undefined
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


    useEffect(() => {
        const handleReceiveTaskResult = async (result: TransactionTaskResult) => {
            log.trace('handleReceiveTaskResult event handler triggered')
            
            setIsLoading(false)

            const {error, message, transaction, receivedAmount} = result
            const {status} = transaction as Transaction

            setTransactionStatus(status)
    
            if (error) {
                setResultModalInfo({
                    status,
                    title: error.params?.message ? error.message : 'Receive failed',
                    message: error.params?.message || error.message,
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
            
            setIsResultModalVisible(true)            
        }

        // Subscribe to the 'sendCompleted' event
        EventEmitter.on('ev_receiveTask_result', handleReceiveTaskResult)
        EventEmitter.on('ev_receiveOfflinePrepareTask_result', handleReceiveTaskResult)

        // Unsubscribe from the 'sendCompleted' event on component unmount
        return () => {
            EventEmitter.off('ev_receiveTask_result', handleReceiveTaskResult)
            EventEmitter.off('ev_receiveOfflinePrepareTask_result', handleReceiveTaskResult)
        }
    }, [isReceiveTaskSentToQueue])

    const resetState = function () {
        setToken(undefined)
        setEncodedToken(undefined)
        setAmountToReceive('0')
        setReceivedAmount('0')
        setTransactionStatus(undefined)
        setMemo('')
        setInfo('')
        setError(undefined)
        setIsLoading(false)
        setIsResultModalVisible(false)
        setResultModalInfo(undefined)
        setIsReceiveTaskSentToQueue(false)        
    }

    
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)


    const onEncodedToken = async function (encoded: string) {
      try {
        navigation.setParams({encodedToken: undefined})
        
        const decoded: Token = CashuUtils.decodeToken(encoded)
        const tokenAmounts = CashuUtils.getTokenAmounts(decoded)

        log.trace('decoded token', {decoded})
        log.trace('tokenAmounts', {tokenAmounts})

        

        if(!decoded.unit) {
          setInfo(`Currency unit is missing in the received token. Wallet will assume token amount is in Bitcoin ${CurrencyCode.SATS}. Do not continue if your are not sure this is correct.`)
        }

        const currency = getCurrency(decoded.unit)

        setToken(decoded)
        setAmountToReceive(numbro(tokenAmounts.totalAmount / currency.precision).format({thousandSeparated: true, mantissa: currency.mantissa}))
        
        if(decoded.unit) {
          log.trace('Token unit', decoded.unit)
          setUnit(decoded.unit)
        }
        
        if (decoded.memo && decoded.memo.length > 0) {
          setMemo(decoded.memo as string)
        }
      } catch (e: any) {
        handleError(e)
      }
    }


    const receiveToken = async function () {
        setIsLoading(true)       
        setIsReceiveTaskSentToQueue(true) 

        const amountToReceiveInt = round(toNumber(amountToReceive) * getCurrency(unit).precision, 0)

        WalletTask.receive(
            token as Token,
            amountToReceiveInt,
            memo,
            encodedToken as string,
        )        
    }


    const receiveOfflineToken = async function () {
        setIsLoading(true)
        setIsReceiveTaskSentToQueue(true) 

        const amountToReceiveInt = round(toNumber(amountToReceive) * getCurrency(unit).precision, 0)
        
        WalletTask.receiveOfflinePrepare(
            token as Token,
            amountToReceiveInt,
            memo,
            encodedToken as string,
        )
  

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
            <MintHeader 
                mint={undefined}
                unit={unit}
                navigation={navigation}
            />
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            {toNumber(receivedAmount) > 0 ? (
            <View style={$amountContainer}>
                <TextInput                                        
                    value={receivedAmount}
                    style={$amountToReceive}
                    maxLength={9}                    
                    editable={false}
                />
            </View>
            ) : (
            <View style={$amountContainer}>
                <TextInput                                        
                    value={amountToReceive}
                    style={$amountToReceive}
                    maxLength={9}                    
                    editable={false}
                />
            </View>
           )}
            <Text
                size='sm'
                tx={toNumber(receivedAmount) > 0 ? "receiveScreen.received" : "receiveScreen.toReceive"}
                style={{color: 'white', textAlign: 'center'}}
            />
        </View>
        <View style={$contentContainer}>          
          {token && toNumber(amountToReceive) > 0 && (
            <>
              {memo && (
                <Card
                  style={[$card, {minHeight: 0, paddingBottom: 0}]}
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
                    ? 'Received to'
                    : 'Receive to'
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
                            RightComponent={<Text size='xs' text='New mint' style={$newBadge}/>}
                          />
                        )
                      } else {
                        return (
                          <MintListItem
                            key={mintUrl}
                            mint={mint as Mint}
                            separator={'top'}
                            isSelected={true}                            
                            isSelectable={true}
                          />
                        )
                      }
                    })}
                  </>
                }
              />
              {transactionStatus === TransactionStatus.COMPLETED ? (
                <View style={$bottomContainer}>
                    <View style={$buttonContainer}>
                    <Button
                        preset="secondary"
                        tx={'common.close'}
                        onPress={gotoWallet}
                    />
                    </View>
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
                    title={resultModalInfo?.title as string || 'Receive failed'}
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
    paddingTop: 0,
    height: spacing.screenHeight * 0.20,
}

const $amountContainer: ViewStyle = {
}

const $amountToReceive: TextStyle = {    
    borderRadius: spacing.small,
    margin: 0,
    padding: 0,
    fontSize: moderateVerticalScale(48),
    fontFamily: typography.primary?.medium,
    textAlign: 'center',
    color: 'white',    
}

const $contentContainer: TextStyle = {
  flex: 1,
  padding: spacing.extraSmall,
  marginTop: -spacing.extraLarge * 2,
  // alignItems: 'center',
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

const $newBadge: TextStyle = {
    paddingHorizontal: spacing.small,
    borderRadius: spacing.tiny,
    alignSelf: 'center',
    marginVertical: spacing.small,
    lineHeight: spacing.medium,    
    backgroundColor: colors.palette.orange400,
    color: 'white',
}
