import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback, useEffect} from 'react'
import {CommonActions, StackActions, StaticScreenProps, useFocusEffect, useNavigation} from '@react-navigation/native'
import {TextInput, TextStyle, View, ViewStyle} from 'react-native'
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
} from '../components'
import {Mint} from '../models/Mint'
import {Transaction, TransactionStatus} from '../models/Transaction'
import {useStores} from '../models'
import {NostrClient, TransactionTaskResult, WalletTask} from '../services'
import {log} from '../services/logService'
import AppError, { Err } from '../utils/AppError'
import EventEmitter from '../utils/eventEmitter'

import {CashuUtils} from '../services/cashu/cashuUtils'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {MintListItem} from './Mints/MintListItem'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { CurrencyCode, MintUnit, getCurrency } from "../services/wallet/currency"
import { MintHeader } from './Mints/MintHeader'
import { round, toNumber } from '../utils/number'
import numbro from 'numbro'
import { TranItem } from './TranDetailScreen'
import { translate } from '../i18n'
import { Token, getDecodedToken } from '@cashu/cashu-ts'
import { RECEIVE_OFFLINE_PREPARE_TASK, RECEIVE_TASK } from '../services/wallet/receiveTask'

export enum ReceiveOption {  
  SEND_PAYMENT_REQUEST = 'SEND_PAYMENT_REQUEST',
  PASTE_OR_SCAN_TOKEN = 'PASTE_OR_SCAN_TOKEN',
  SHOW_INVOICE = 'SHOW_INVOICE',
  LNURL_WITHDRAW = 'LNURL_WITHDRAW'
}

type Props = StaticScreenProps<{
  encodedToken?: string  
}>

export const ReceiveScreen = observer(function ReceiveScreen({ route }: Props) {
    const navigation = useNavigation()
    const isInternetReachable = useIsInternetReachable()
    const {mintsStore, walletStore} = useStores()

    const [token, setToken] = useState<Token | undefined>()
    const [encodedToken, setEncodedToken] = useState<string | undefined>()
    const [amountToReceive, setAmountToReceive] = useState<string>('0')
    const [unit, setUnit] = useState<MintUnit>('sat')
    const [totalReceived, setTotalReceived] = useState<number>(0)
    const [receivedAmount, setReceivedAmount] = useState<string>('0')
    const [transactionStatus, setTransactionStatus] = useState<
      TransactionStatus | undefined
    >()
    const [transaction, setTransaction] = useState<
    Transaction | undefined
  >()
    const [memo, setMemo] = useState('')
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isP2PKLocked, setIsP2PKLocked] = useState(false)
    const [isP2PKLockedToWallet, setIsP2PKLockedToWallet] = useState(false)
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

            const {error, message, transaction, receivedAmount, mintUrl} = result
            const {status} = transaction as Transaction

            setTransactionStatus(status)
            setTransaction(transaction)
    
            if (error) {
                setResultModalInfo({
                  status,
                  title: error.params?.message ? error.message : translate("transactionCommon.receiveFailed"),
                  message: error.params?.message || error.message,
                })
            } else {
                setResultModalInfo({
                  status,
                  message,
                })
            }
    
            if (receivedAmount && receivedAmount > 0) {
                // accumulate received amount in case of multiple receives in batch
                setTotalReceived(prev => prev + receivedAmount)

                const currency = getCurrency(unit)
                setReceivedAmount(`${numbro(totalReceived / currency.precision).format({thousandSeparated: true, mantissa: currency.mantissa})}`)                
            }    
            
            setIsResultModalVisible(true)            
        }

        
        if(isReceiveTaskSentToQueue) {
          EventEmitter.on(`ev_${RECEIVE_TASK}_result`, handleReceiveTaskResult)
          EventEmitter.on(`ev_${RECEIVE_OFFLINE_PREPARE_TASK}_result`, handleReceiveTaskResult)
        }        

        // Unsubscribe from the 'sendCompleted' event on component unmount
        return () => {
          EventEmitter.off(`ev_${RECEIVE_TASK}_result`, handleReceiveTaskResult)
          EventEmitter.off(`ev_${RECEIVE_OFFLINE_PREPARE_TASK}_result`, handleReceiveTaskResult)
        }
    }, [isReceiveTaskSentToQueue])


    useEffect(() => {
      const updateReceivedAmount = async () => {
          log.trace('[updateTotalReceived] start')

          const currency = getCurrency(unit)
          setReceivedAmount(`${numbro(totalReceived / currency.precision).format({thousandSeparated: true, mantissa: currency.mantissa})}`)                
      }        
      
      if(totalReceived > 0) {
        updateReceivedAmount()
      }
    }, [totalReceived])

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
        
        const decoded = getDecodedToken(encoded)
        const tokenAmount = CashuUtils.getProofsAmount(decoded.proofs)
        const isLocked = CashuUtils.isTokenP2PKLocked(decoded)
        let isLockedToWallet = false        

        if(isLocked) {
          const lockedToPK = CashuUtils.getP2PKPubkeySecret(decoded.proofs[0].secret)
          isLockedToWallet = lockedToPK === '02' + (await NostrClient.getNostrKeys()).publicKey          
        }

        log.trace('decoded token', {decoded, isLocked, isLockedToWallet})
        log.trace('tokenAmount', {tokenAmount})

        if(!decoded.unit) {
          setInfo(translate("decodedMissingCurrencyUnit", { unit: CurrencyCode.SAT }))
          decoded.unit = 'sat'          
        }

        const currency = getCurrency(decoded.unit as MintUnit)

        setToken(decoded)
        setIsP2PKLocked(isLocked)
        setIsP2PKLockedToWallet(isLockedToWallet)
        setAmountToReceive(numbro(tokenAmount / currency.precision).format({thousandSeparated: true, mantissa: currency.mantissa}))
        setUnit(decoded.unit as MintUnit)
        
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
        const proofsCount = token!.proofs.length

        WalletTask.receiveQueue(
          token as Token,
          amountToReceiveInt,
          memo,
          encodedToken as string,
        )
    }


    const increaseProofsCounterAndRetry = async function () {
      try {
        if(!transaction) {
          return
        }

        const {mint} = transaction
        const walletInstance = await walletStore.getWallet(
            mint, 
            unit, 
            {withSeed: true}
        )

        const mintInstance = mintsStore.findByUrl(mint)
        const counter = mintInstance!.getProofsCounterByKeysetId!(walletInstance.keysetId)
        counter!.increaseProofsCounter(20)

        // retry receive
        receiveToken()
      } catch (e: any) {            
          handleError(e)
      } finally {
          toggleResultModal() //close
      }
    }


    const receiveOfflineToken = async function () {
        setIsLoading(true)
        setIsReceiveTaskSentToQueue(true) 

        const amountToReceiveInt = round(toNumber(amountToReceive) * getCurrency(unit).precision, 0)
        
        WalletTask.receiveOfflinePrepareQueue(
            token as Token,
            amountToReceiveInt,
            memo,
            encodedToken as string,
        )
    }


    const gotoWallet = function() {
       resetState()
       navigation.dispatch(                
        StackActions.popToTop()
       )
    }
    

    const handleError = function (e: AppError): void {
      resetState()
      log.error(e.name, e.message)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const amountInputColor = useThemeColor('amountInput')

    return (
      <Screen preset="auto" contentContainerStyle={$screen}>
            <MintHeader 
                mint={undefined}
                unit={unit}                
            />
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>    
            <View style={$amountContainer}>
                <TextInput                                        
                    value={toNumber(receivedAmount) > 0 ? receivedAmount : amountToReceive}                    
                    style={[$amountInput, {color: amountInputColor}]}
                    maxLength={9}                    
                    editable={false}
                />
            </View>
            {isP2PKLocked ? (
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <Icon
                  containerStyle={$iconLockContainer}
                  icon={toNumber(receivedAmount) > 0 ? "faLockOpen" : "faLock"}
                  size={spacing.medium}
                  color={amountInputColor}
                />
                {isP2PKLockedToWallet ? (
                  <Text
                      size='sm'
                      tx={toNumber(receivedAmount) > 0 ? "receiveScreen.received" : "receiveScreen.lockedToWalletPK"}
                      style={{color: amountInputColor, textAlign: 'center'}}
                  />
                ) : (
                  <Text
                      size='sm'
                      tx={toNumber(receivedAmount) > 0 ? "receiveScreen.received" : "receiveScreen.lockedToUnknownPK"}
                      style={{color: amountInputColor, textAlign: 'center'}}
                  />
                )}
              </View>
            ) : (
              <Text
                  size='sm'
                  tx={toNumber(receivedAmount) > 0 ? "receiveScreen.received" : "receiveScreen.toReceive"}
                  style={{color: amountInputColor, textAlign: 'center'}}
              />
            )}

        </View>
        <View style={$contentContainer}>          
          {token && toNumber(amountToReceive) > 0 && (
            <>
              {transactionStatus !== TransactionStatus.COMPLETED && (
                <Card
                  style={$memoCard}
                  ContentComponent={
                    <ListItem
                      text={memo || 'No description'}
                      LeftComponent={
                        <Icon
                          containerStyle={$iconContainer}
                          icon="faPencil"
                          size={spacing.medium}
                          color={iconColor}
                        />
                      }
                      // style={[$item, {marginTop: spacing.small}]}
                    />
                  }
                />
              )}
              {transactionStatus !== TransactionStatus.COMPLETED && (
                <Card
                style={$card}
                label={'Receive to'}                
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
                            RightComponent={<Text size='xs' tx="newMint" style={$newBadge}/>}
                          />
                        )
                      } else {
                        return (
                          <MintListItem
                            key={mintUrl}
                            mint={mint as Mint}                            
                            isSelected={true}                            
                            isSelectable={true}
                          />
                        )
                      }
                    })}
                  </>
                }
              />
              )}              
              {transaction && transactionStatus === TransactionStatus.COMPLETED && (
                <Card
                    style={{padding: spacing.medium}}
                    ContentComponent={
                    <>
                        <TranItem 
                            label="transactionCommon.receivedTo"
                            isFirst={true}
                            value={mintsStore.findByUrl(transaction.mint)?.shortname as string}
                        />
                        {transaction?.memo && (
                        <TranItem
                            label="receiveScreen.memoFromSender"
                            value={transaction.memo as string}
                        />
                        )}
                        <TranItem
                          label="transactionCommon.feePaid"
                          value={transaction.fee || 0}
                          unit={unit}
                          isCurrency={true}
                        />
                        <TranItem
                            label="receiveScreen.status"
                            value={transaction.status as string}
                        />
                    </>
                    }
                />
              )}
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
                                tx='payCommon.receive'
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
                                tx='payCommon.receiveOffline'
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
                        tx='common.cancel'
                        onPress={gotoWallet}
                    />
                    </View>
                </View>
              )}
            </>
          )}
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
              {resultModalInfo?.status === TransactionStatus.PREPARED_OFFLINE && (
                <>
                  <ResultModalInfo
                    icon={'faTriangleExclamation'}
                    iconColor={colors.palette.accent400}
                    title={translate('attention')}
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
              {(resultModalInfo?.status === TransactionStatus.ERROR ||
                resultModalInfo?.status === TransactionStatus.BLOCKED) && (
                <>
                  <ResultModalInfo
                    icon="faTriangleExclamation"
                    iconColor={colors.palette.angry500}
                    title={resultModalInfo?.title as string || translate('transactionCommon.receiveFailed')}
                    message={resultModalInfo?.message as string}
                  />
                  <View style={$buttonContainer}>
                      {resultModalInfo.message.includes('outputs have already been signed before') ? (
                          <Button
                              preset="secondary"
                              text={"Try again"}
                              onPress={increaseProofsCounterAndRetry}
                          />
                      ) : (
                          <Button
                              preset="secondary"
                              tx={'common.close'}
                              onPress={toggleResultModal}
                          />
                      )}
                  </View>
                </>
              )}
            </>
          }
          onBackButtonPress={toggleResultModal}
          onBackdropPress={toggleResultModal}
        />
        {isLoading && <Loading />}
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
  // alignItems: 'center',
}

const $card: ViewStyle = {
  // marginTop: - spacing.extraLarge * 2,
  marginBottom: spacing.small,
  // paddingTop: 0,
}

const $memoCard: ViewStyle = {
  marginBottom: spacing.small,
  minHeight: 80,
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

const $iconLockContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  // marginRight: spacing.extraSmall,
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
