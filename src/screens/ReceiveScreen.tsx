import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback, useEffect, useRef} from 'react'
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
  AmountInput,
} from '../components'
import {Mint} from '../models/Mint'
import {Transaction, TransactionStatus} from '../models/Transaction'
import {useStores} from '../models'
import {TransactionTaskResult, WalletTask} from '../services'
import {log} from '../services/logService'
import AppError, { Err } from '../utils/AppError'

import {CashuUtils} from '../services/cashu/cashuUtils'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {MintListItem} from './Mints/MintListItem'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { CurrencyCode, MintUnit, getCurrency } from "../services/wallet/currency"
import { MintHeader } from './Mints/MintHeader'
import numbro from 'numbro'
import { TranItem } from './TranDetailScreen'
import { translate } from '../i18n'
import { TokenMetadata, getTokenMetadata } from '@cashu/cashu-ts'
import { toNumber } from '../utils/number'

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

    const amountInputRef = useRef<TextInput>(null)
    
    const {mintsStore, walletStore} = useStores()

    const [tokenInfo, setTokenInfo] = useState<TokenMetadata | undefined>()
    const [encodedToken, setEncodedToken] = useState<string | undefined>()
    const [amountToReceive, setAmountToReceive] = useState<string>('0')
    const [unit, setUnit] = useState<MintUnit>('sat')
    const [mintUrl, setMintUrl] = useState<string | undefined>(undefined)
    const [mint, setMint] = useState<Mint | undefined>(undefined)
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
    const [isNewMint, setIsNewMint] = useState(false)
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
        setTokenInfo(undefined)
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
        //@ts-ignore
        navigation.setParams({encodedToken: undefined})

        // keysetsV2 support
        const tokenInfo = getTokenMetadata(encoded)
        const {amount, unit, memo, mint: mintUrl} = tokenInfo

        if(!unit) {
          throw new AppError(Err.VALIDATION_ERROR, translate("decodedMissingCurrencyUnit", { unit: CurrencyCode.SAT }))        
        }

        if(!mintUrl) {
          throw new AppError(Err.VALIDATION_ERROR, 'Decoded token is missing mint url')
        }
        
        const isLocked = CashuUtils.isTokenP2PKLocked(tokenInfo)
        let isLockedToWallet = false        

        if(isLocked) {
          const lockedToPK = CashuUtils.getP2PKPubkeySecret(tokenInfo.incompleteProofs[0].secret)
          const keys = await walletStore.getCachedWalletKeys()
          isLockedToWallet = lockedToPK === '02' + keys.NOSTR.publicKey
        }

        log.trace('decoded tokenMetadata', {tokenInfo, isLocked, isLockedToWallet})
        log.trace('tokenAmount', {amount, unit})  

        const currency = getCurrency(unit as MintUnit)

        setMintUrl(mintUrl)
        setTokenInfo(tokenInfo)
        setIsP2PKLocked(isLocked)
        setIsP2PKLockedToWallet(isLockedToWallet)
        setAmountToReceive(numbro(amount / currency.precision).format({thousandSeparated: true, mantissa: currency.mantissa}))
        setUnit(unit as MintUnit)
        if (memo && memo.length > 0) {
          setMemo(memo as string)
        }

        const mintExists = mintsStore.mintExists(tokenInfo.mint)

        if(!mintExists) {
          setIsNewMint(true)
        } else {          
          setIsNewMint(false)
          const mintInstance = mintsStore.findByUrl(tokenInfo.mint)
          setMint(mintInstance)
        }

      } catch (e: any) {
        handleError(e)
      }
    }

    const receiveToken = async function () {
        try {
            setIsLoading(true)
            setIsReceiveTaskSentToQueue(true)

            if(!mintUrl) {
                throw new AppError(Err.VALIDATION_ERROR, 'Mint url is not set')
            }

            if(!tokenInfo) {
                throw new AppError(Err.VALIDATION_ERROR, 'Token info is not set')
            }

            let mintInstance = mint
            if(!mintInstance) {
                try {
                    mintInstance = await mintsStore.addMint(mintUrl)
                } catch(e: any) {
                    return handleError(e)
                }
            }

            if(!mintInstance) {
                return handleError(new AppError(Err.VALIDATION_ERROR, 'Could not establish mint instance'))
            }

            const result = await WalletTask.receiveQueueAwaitable(
                mintInstance,
                tokenInfo,
                encodedToken as string,
            )

            await handleReceiveTaskResult(result)
        } catch(e: any) {
            handleError(e)
        }
    }

    const handleReceiveTaskResult = async (result: TransactionTaskResult) => {
      log.trace('handleReceiveTaskResult start')
      
      setIsLoading(false)

      const {error, message, transaction, receivedAmount} = result

      if(!transaction) {
        setIsResultModalVisible(true)
        return
      }

      const {status} = transaction

      setTransactionStatus(status)
      setTransaction(transaction)

      if (error) {
          setResultModalInfo({
            status,
            title: error.params?.message ? error.message : translate("transactionCommon_receiveFailed"),
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
          // display is updated reactively by the useEffect on [totalReceived]
          setTotalReceived(prev => prev + receivedAmount)
      }    
      
      setIsResultModalVisible(true)            
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
        try {
            setIsLoading(true)
            setIsReceiveTaskSentToQueue(true)

            if(!encodedToken) {
                throw new AppError(Err.VALIDATION_ERROR, 'Encoded token is not set')
            }

            if(!tokenInfo) {
                throw new AppError(Err.VALIDATION_ERROR, 'Token info is not set')
            }

            const result = await WalletTask.receiveOfflinePrepareQueueAwaitable(
                tokenInfo,
                encodedToken as string,
            )

            await handleReceiveTaskResult(result)
        } catch(e: any) {
            handleError(e)
        }
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
                <AmountInput
                    ref={amountInputRef}                                               
                    value={amountToReceive}                    
                    onChangeText={() => {}}
                    unit={unit}
                    editable={false}
                />
            </View>
            {isP2PKLocked ? (
              <View style={{
                flexDirection: 'row', 
                alignItems: 'center',
                marginTop: spacing.extraSmall,
              }}>
                <Icon
                  containerStyle={$iconLockContainer}
                  icon={toNumber(receivedAmount) > 0 ? "faLockOpen" : "faLock"}
                  size={spacing.medium}
                  color={amountInputColor}
                />
                {isP2PKLockedToWallet ? (
                  <Text
                      size='xs'
                      tx={toNumber(receivedAmount) > 0 ? "receiveScreen_received" : "receiveScreen_lockedToWalletPK"}
                      style={{
                        color: amountInputColor, 
                        textAlign: 'center',
                      }}
                  />
                ) : (
                  <Text
                      size='xs'
                      tx={toNumber(receivedAmount) > 0 ? "receiveScreen_received" : "receiveScreen_lockedToUnknownPK"}
                      style={{
                        color: amountInputColor, 
                        textAlign: 'center',
                      }}
                  />
                )}
              </View>
            ) : (
              <Text
                  size='xs'
                  tx={toNumber(receivedAmount) > 0 ? "receiveScreen_received" : "receiveScreen_toReceive"}
                  style={{
                    color: amountInputColor, 
                    textAlign: 'center',
                    marginTop: spacing.extraSmall                   
                  }}
              />
            )}
        </View>
        <View style={$contentContainer}>          
          {toNumber(amountToReceive) > 0 && mintUrl && (
            <>
              {transactionStatus !== TransactionStatus.COMPLETED && (
                <Card
                  style={$memoCard}
                  ContentComponent={
                    <ListItem
                      text={memo || translate('commonNoDescPlaceholder')}
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
                    {isNewMint ? (
                        <ListItem
                          key={mintUrl}
                          text={new URL(mintUrl).hostname}
                          //topSeparator={true}
                          RightComponent={<Text size='xs' tx="newMint" style={$newBadge}/>}
                        />
                        
                     ) : (  
                        <MintListItem
                          key={mintUrl}
                          mint={mint as Mint}                            
                          isSelected={true}                            
                          isSelectable={true}
                        />
                     )}
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
                            label="transactionCommon_receivedTo"
                            isFirst={true}
                            value={mintsStore.findByUrl(transaction.mint)?.shortname as string}
                        />
                        {transaction?.memo && (
                        <TranItem
                            label="receiveScreen_memoFromSender"
                            value={transaction.memo as string}
                        />
                        )}
                        <TranItem
                          label="transactionCommon_feePaid"
                          value={transaction.fee || 0}
                          unit={unit}
                          isCurrency={true}
                        />
                        <TranItem
                            label="receiveScreen_status"
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
                        tx={'commonClose'}
                        onPress={gotoWallet}
                    />
                    </View>
                </View>
              ) : (
                <View style={$bottomContainer}>
                    <View style={$buttonContainer}>
                        {isInternetReachable ? (
                            <Button
                                tx='payCommon_receive'
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
                                tx='payCommon_receiveOffline'
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
                        tx='commonCancel'
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
                      tx='commonClose'
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
                    title={resultModalInfo?.title as string || translate('transactionCommon_receiveFailed')}
                    message={resultModalInfo?.message as string}
                  />
                  <View style={$buttonContainer}>
                  {((/already.*signed|duplicate key/i.test(resultModalInfo.message))) ? (
                          <Button
                              preset="secondary"
                              tx="commonTryAgain"
                              onPress={increaseProofsCounterAndRetry}
                          />
                      ) : (
                          <Button
                              preset="secondary"
                              tx={'commonClose'}
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
  //height: spacing.screenHeight * 0.11,
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
