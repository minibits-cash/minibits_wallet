import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useRef, useState} from 'react'
import {
  Alert,
  Image,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,  
  ScrollView,  
  TextInput,
  TextStyle,
  UIManager,
  View,
  ViewStyle,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import JSONTree from 'react-native-json-tree'
import {colors, spacing, typography, useThemeColor} from '../theme'
import EventEmitter from '../utils/eventEmitter'
import {
  Button,
  Icon,
  ListItem,
  Screen,
  Text,
  Card,
  ErrorModal,
  BottomModal,
  InfoModal,
  Loading,
  Header,
} from '../components'
import {useStores} from '../models'
import {translate, TxKeyPath} from '../i18n'
import {
  Transaction,
  TransactionData,
  TransactionStatus,
  TransactionType,
} from '../models/Transaction'
import AppError, {Err} from '../utils/AppError'
import {log} from '../services/logService'
import {isArray} from 'lodash'
import {HANDLE_PENDING_TOPUP_TASK, NostrClient, NostrEvent, NostrProfile, TransactionTaskResult, WalletTask} from '../services'
import {Proof} from '../models/Proof'
import useColorScheme from '../theme/useThemeColor'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import { CashuUtils } from '../services/cashu/cashuUtils'
import { Mint, MintStatus } from '../models/Mint'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { MintUnit, formatCurrency, getCurrency } from "../services/wallet/currency"
import { pollerExists } from '../utils/poller'
import { CommonActions, StaticScreenProps, useFocusEffect, useNavigation } from '@react-navigation/native'
import { QRCodeBlock } from './Wallet/QRCode'
import { MintListItem } from './Mints/MintListItem'
import { Token, getDecodedToken } from '@cashu/cashu-ts'
import { RECEIVE_OFFLINE_COMPLETE_TASK, RECEIVE_TASK } from '../services/wallet/receiveTask'
import { REVERT_TASK } from '../services/wallet/revertTask'
import FastImage from 'react-native-fast-image'
import { MintHeader } from './Mints/MintHeader'
import { TransferOption } from './TransferScreen'
import { WalletUtils } from '../services/wallet/utils'

type ProofsByStatus = {
  isSpent: Proof[]
  isPending: Proof[]
  isReceived: Proof[]
}

type Props = StaticScreenProps<{
  id: number,
  prevScreen: 'Wallet' | 'TranHistory'
}>

export const TranDetailScreen = observer(function TranDetailScreen({ route }: Props) {
    const navigation = useNavigation()
    const {id, prevScreen} = route.params
    const {transactionsStore, mintsStore} = useStores()
    
    const noteInputRef = useRef<TextInput>(null)

    const [transaction, setTransaction] = useState<Transaction>()
    const [error, setError] = useState<AppError | undefined>()
    const [isNoteEditing, setIsNoteEditing] = useState(transaction?.noteToSelf ? false : true)
    const [isDataParsable, setIsDataParsable] = useState<boolean>(true)    
    const [info, setInfo] = useState('')
    const [note, setNote] = useState<string>('')    
    const [mint, setMint] = useState<Mint | undefined>()
    const [isAuditTrailVisible, setIsAuditTrailVisible] = useState<boolean>(false)
    const [isTokenTrackingVisible, setIsTokenTrackingVisible] = useState<boolean>(false)

    const toggleAuditTrail = () => {
      LayoutAnimation.easeInEaseOut()
      setIsAuditTrailVisible(!isAuditTrailVisible)
    }

    const toggleTokenTracking = () => {
      LayoutAnimation.easeInEaseOut()
      setIsTokenTrackingVisible(!isTokenTrackingVisible)
    }

    useFocusEffect(useCallback(() => {
      try {        
        const tx = transactionsStore.findById(id, true) // load full tokens
        log.trace('Transaction loaded', {tx})

      if (!tx) {
          throw new AppError(
            Err.VALIDATION_ERROR,
            'Could not retrieve transaction from transactionsStore',
          )
      }

      try {
          JSON.parse(tx.data)
      } catch (e: any) {
        setIsDataParsable(false)
      }

      const mintInstance = mintsStore.findByUrl(tx.mint)
      if (mintInstance) {
        setMint(mintInstance)
      }

      if(tx.noteToSelf) {
        setNote(tx.noteToSelf)
      }
      
      setTransaction(tx as Transaction)
      } catch (e: any) {
        handleError(e)
      }
    }, [route]))


    const onNoteSave = async function () {
      try {        
        transaction && transaction.update({noteToSelf: note})
        setIsNoteEditing(false)        
      } catch (e: any) {
        handleError(e)
      }
    }

    const onNoteEdit = function () {        
      setIsNoteEditing(true)

      setTimeout(() => {
          noteInputRef && noteInputRef.current
          ? noteInputRef.current.focus()
          : false
      }, 100)
    }

    const copyAuditTrail = function () {
      try {        
        if(transaction) Clipboard.setString(JSON.stringify(getAuditTrail(transaction)))
      } catch (e: any) {
        setInfo(translate("commonCopyFailParam", { param: e.message }))
      }
    }

    const copyInputToken = function () {
      try {        
        if(transaction && transaction.inputToken) Clipboard.setString(transaction.inputToken)
      } catch (e: any) {
        setInfo(translate("commonCopyFailParam", { param: e.message }))
      }
    }

    const copyOutputToken = function () {
      try {        
        if(transaction && transaction.outputToken) Clipboard.setString(transaction.outputToken)
      } catch (e: any) {
        setInfo(translate("commonCopyFailParam", { param: e.message }))
      }
    }

    const onBack = function () {
        if(transaction && transaction.inputToken &&  transaction.inputToken.length > 40) {
            transaction.pruneInputToken(transaction.inputToken)
        }

        if(transaction && transaction.outputToken && transaction.outputToken.length > 40) {
            transaction.pruneOutputToken(transaction.outputToken)
        }

        log.trace('[onBack]', {prevScreen})

        if(prevScreen === 'TranHistory') {
            navigation.goBack()
        } else {
            navigation.dispatch(                
                CommonActions.reset({
                    index: 1,
                    routes: [{
                        name: 'WalletNavigator'
                    }]
                })
            )
        }
    }

    const handleError = function (e: AppError): void {      
      setError(e)      
    }


    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const inputBg = useThemeColor('background')
    const placeholderTextColor = useThemeColor('textDim')
        
    const getFormattedAmount = function(): string {
        if (!transaction) { return '' }

        switch (transaction?.type) {
            case TransactionType.RECEIVE || TransactionType.RECEIVE_OFFLINE || TransactionType.RECEIVE_BY_PAYMENT_REQUEST:
            return `+${formatCurrency(transaction.amount, getCurrency(transaction.unit).code)}`
            case TransactionType.SEND:
            return `-${formatCurrency(transaction.amount, getCurrency(transaction.unit).code)}`
            case TransactionType.TOPUP:
            return `+${formatCurrency(transaction.amount, getCurrency(transaction.unit).code)}`
            case TransactionType.TRANSFER:
            return `-${formatCurrency(transaction.amount, getCurrency(transaction.unit).code)}`
            default:
            return `${formatCurrency(transaction.amount, getCurrency(transaction.unit).code)}`
        }
        }
        
    const colorScheme = useColorScheme()
    const headerTitle = useThemeColor('headerTitle')
    const inputText = useThemeColor('text')
    const statusColor = useThemeColor('header')

  return (
      <Screen contentContainerStyle={$screen} preset="fixed">        
        {transaction && (
          <>
            <MintHeader 
                mint={mint}
                unit={transaction.unit}
                hideBalance={true} 
                onBackPress={onBack}           
            />
            <View style={[$headerContainer, {
                backgroundColor: headerBg, 
                justifyContent: 'space-around', 
                paddingBottom: spacing.huge
              }]}
            >              
              <Text
                  preset="heading"
                  text={getFormattedAmount()}
                  style={[$tranAmount, {color: headerTitle}]}
              />
              {transaction.status !== TransactionStatus.COMPLETED && (
                  <View
                    style={[
                      {
                        alignSelf: 'center',
                        marginTop: spacing.tiny,
                        paddingHorizontal: spacing.tiny,
                        borderRadius: spacing.tiny,
                        backgroundColor: colors.palette.primary200,
                      },
                    ]}>
                    <Text
                      text={transaction.status as string}
                      style={[
                        {
                          color: statusColor,
                          fontSize: 10,
                          fontFamily: typography.primary?.light,
                          padding: 0,
                          lineHeight: 16,
                        }
                      ]}
                    />
                  </View>
              )}           
            </View>
            <ScrollView style={$contentContainer}>
              <Card
                style={$actionCard}
                ContentComponent={
                    <View style={$noteContainer}>    
                        <TextInput
                            ref={noteInputRef}
                            onChangeText={note => setNote(note)}                                    
                            value={`${note}`}
                            style={[$noteInput, {color: inputText}]}
                            onEndEditing={onNoteSave}
                            maxLength={200}
                            keyboardType="default"
                            selectTextOnFocus={true}
                            placeholder={translate("privateNotePlaceholder")}
                            placeholderTextColor={placeholderTextColor}
                            editable={
                                isNoteEditing
                                ? true
                                : false
                            }
                        />
                        {isNoteEditing ? (
                            <Button
                                preset="secondary"
                                style={$noteButton}
                                tx="commonSave"
                                onPress={onNoteSave}
                                
                            />
                        ) : (
                            <Button
                                preset="secondary"
                                style={$noteButton}
                                tx="commonEdit"
                                onPress={onNoteEdit}
                                
                            />
                        )}
                    
                    </View>
                }
              />
              {(transaction.type === TransactionType.RECEIVE || transaction.type === TransactionType.RECEIVE_BY_PAYMENT_REQUEST) && (
                <ReceiveInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  mint={mint}
                  colorScheme={colorScheme as 'dark' | 'light'}
                  navigation={navigation}
                />
              )}
              {transaction.type === TransactionType.RECEIVE_OFFLINE && (
                <ReceiveOfflineInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  mint={mint}
                  colorScheme={colorScheme as 'dark' | 'light'}
                  navigation={navigation}
                />
              )}
              {transaction.type === TransactionType.SEND && (
                <SendInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}                  
                  mint={mint}
                  colorScheme={colorScheme as 'dark' | 'light'}
                />
              )}
              {transaction.type === TransactionType.TOPUP && (
                <TopupInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  mint={mint}
                  colorScheme={colorScheme as 'dark' | 'light'}
                  navigation={navigation}
                />
              )}
              {transaction.type === TransactionType.TRANSFER && (
                <TransferInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  mint={mint}
                  colorScheme={colorScheme as 'dark' | 'light'}
                />
              )}
              {isDataParsable && (
                <Card
                  labelTx='tranDetailScreen_auditTrail'
                  style={$dataCard}   
                  ContentComponent={
                    <>
                      <ListItem
                        tx='tranDetailScreen_auditTrailDesc'
                        RightComponent={
                          <View style={$rightContainer}>
                            <Button
                              onPress={toggleAuditTrail}
                              text={isAuditTrailVisible ? translate("commonHide") : translate("commonShow")}
                              preset="secondary"
                            />
                          </View>
                        }
                      />
                      {isAuditTrailVisible && (
                        <>
                          <JSONTree
                            hideRoot
                            data={getAuditTrail(transaction)}
                            theme={{
                              scheme: 'default',
                              base00: '#eee',
                            }}
                            invertTheme={colorScheme === 'light' ? false : true}
                          />
                          <Button
                            preset="tertiary"
                            onPress={copyAuditTrail}
                            tx="commonCopy"
                            style={{
                              minHeight: 50,
                              paddingVertical: spacing.extraSmall,
                              marginTop: spacing.small,
                              alignSelf: 'center',
                            }}
                            textStyle={{fontSize: 14}}
                          />
                        </>
                    )}
                  </>
                  }
                />
              )}
              {(
                transaction.inputToken || 
                transaction.outputToken) && 
              (![
                  TransactionStatus.REVERTED, 
                  //TransactionStatus.COMPLETED
                ].includes(transaction.status)
              ) && (
                <Card
                  labelTx='tranDetailScreen_tokenTracking'
                  style={$dataCard}   
                  ContentComponent={
                    <>
                    <ListItem
                        tx='tranDetailScreen_tokenTrackingDesc'
                        RightComponent={
                          <View style={$rightContainer}>
                            <Button
                              onPress={toggleTokenTracking}
                              text={isTokenTrackingVisible ? translate("commonHide") : translate("commonShow")}
                              preset="secondary"
                            />
                          </View>
                        }
                    />
                    {isTokenTrackingVisible && (
                      <>
                        {transaction.inputToken && (
                          <ListItem
                            tx='tranDetailScreen_inputs'
                            subText={transaction.inputToken}
                            subTextEllipsizeMode='middle'
                            subTextStyle={{fontFamily: typography.code?.normal}}
                            RightComponent={
                              <View style={$rightContainer}>
                                <Button
                                  onPress={copyInputToken}
                                  text={translate("commonCopy")}
                                  preset="secondary"
                                />
                              </View>
                            }
                        />
                        )}
                        {transaction.outputToken && (
                          <ListItem
                            tx='tranDetailScreen_outputs'
                            subText={transaction.outputToken}
                            subTextEllipsizeMode='middle'
                            subTextStyle={{fontFamily: typography.code?.normal}}
                            RightComponent={
                              <View style={$rightContainer}>
                                <Button
                                  onPress={copyOutputToken}
                                  text={translate("commonCopy")}
                                  preset="secondary"
                                />
                              </View>
                            }
                        />
                        )}
                      </> 
                    )}                      
                  </>
                  }
                />
              )}              
            </ScrollView>
          </>
        )}        
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  })

const ReceiveInfoBlock = function (props: {
    transaction: Transaction
    isDataParsable: boolean
    mint?: Mint  
    colorScheme: 'light' | 'dark'
    navigation: any
}) {
    const {
        transaction, 
        navigation,
        mint
    } = props
    
    const {transactionsStore, mintsStore, walletStore} = useStores()
    const [sentFromUrl, setSentFromUrl] = useState<string | undefined>()
    const [eventUrl, setEventUrl] = useState<string | undefined>()
    const [profilePicture, setProfilePicture] = useState<string | undefined>()
    const [isRetriable, setIsRetriable] = useState(false)
    const [isCounterIncreaseNeeded, setIsCounterIncreaseNeeded] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; message: string} | undefined
    >()    
    const [isLoading, setIsLoading] = useState(false)
    const urlPrefix: string = 'https://njump.me/'

    useEffect(() => {
      const extractZapUrls = async () => {        
        if(!transaction || !transaction.zapRequest) {
          return
        }

        if(transaction.sentFrom) {
          setSentFromUrl(`${urlPrefix}${transaction.sentFrom}`)
        }

        try {
          const zapRequestData: NostrEvent = JSON.parse(transaction.zapRequest)
          const eventIdHex = NostrClient.getFirstTagValue(zapRequestData.tags, 'e')

          if(eventIdHex) {

            const nevent = NostrClient.neventEncode(eventIdHex as string)
            setEventUrl(`${urlPrefix}${nevent}`)

            log.trace('[extractZapUrls]', {eventIdHex, nevent})
          }
        } catch(e: any) {
          return
        }
        
        
      }     
      
      extractZapUrls()
    }, [])

    useEffect(() => {
      const extractPicture = async () => {        
        if(!transaction || !transaction.profile) {
          return
        }        

        try {
          const profile: NostrProfile = JSON.parse(transaction.profile)

          log.trace(profile)

          if(profile && profile.picture) {
            setProfilePicture(profile.picture)
          }
        } catch(e: any) {
          return
        }
      }     
      
      extractPicture()
    }, [])

    useEffect(() => {
      const canRetry = async () => {                 
        if(![
          TransactionStatus.ERROR, 
          TransactionStatus.DRAFT, 
          TransactionStatus.BLOCKED
        ].includes(transaction.status)) {
          return
        }

        // Make sure mint exists and is online
                 
        const {mint} = transaction
        const mintInstance = mintsStore.findByUrl(mint)
        if(!mintInstance || mintInstance.status === MintStatus.OFFLINE) {
            return
        }

        // make sure we have token to retry the receive
        if(!transaction.inputToken) {
          return
        }

        // In case of error status, allow the retry for specific error messages
        if(transaction.status === TransactionStatus.ERROR) {
          let auditTrail = getAuditTrail(transaction)
          
          const errorRecord = auditTrail.find(
            (record: any) => record.status === 'ERROR',
          )              
                    
        
          if(errorRecord) {
              const error: {message: string} = errorRecord.error
              
              if(error.message && ['network', 'gateway', 'outputs'].some(word => error.message.toLowerCase().includes(word))) {                    
                  setIsRetriable(true)
                  
                  if(error.message.toLowerCase().includes('outputs')) {
                    setIsCounterIncreaseNeeded(true)
                  }
              } else {
                return
              }
          }
        }
        // Allow the retry for other defined statuses
        setIsRetriable(true)
      }
      canRetry()
    }, [])


    const toggleResultModal = () =>
    setIsResultModalVisible(previousState => !previousState)


    const increaseProofsCounter = async function (tokenToRetry: Token) {      
        const {mint} = transaction
        const walletInstance = await walletStore.getWallet(
            mint, 
            tokenToRetry.unit as MintUnit, 
            {withSeed: true}
        )

        const mintInstance = mintsStore.findByUrl(mint)
        const counter = mintInstance!.getProofsCounterByKeysetId!(walletInstance.keysetId)
        counter!.increaseProofsCounter(20)
    }

    const onRetryToReceive = async function () {                
        if(!isRetriable || !transaction.inputToken) {
            return
        }
        
        setIsLoading(true)     

        try {    
            const tokenToRetry = getDecodedToken(transaction.inputToken)              
            const amountToReceive = CashuUtils.getProofsAmount(tokenToRetry.proofs)
            const memo = tokenToRetry.memo || ''

            if(isCounterIncreaseNeeded) {              
              increaseProofsCounter(tokenToRetry)
            }

            const result = await WalletTask.receiveQueueAwaitable(
                tokenToRetry,
                amountToReceive,
                memo,
                transaction.inputToken
            ) 

            await handleReceiveTaskResult(result)

        } catch (e: any) {
            setResultModalInfo({
                status: TransactionStatus.ERROR,
                message: e.message,
            })
        } finally {
            setIsLoading(false)
            toggleResultModal()
        }
    }

    const handleReceiveTaskResult = async (result: TransactionTaskResult) => {
      log.trace('[handleReceiveTaskResult] start')
      
      setIsLoading(false)

      if (result.error) {
          setResultModalInfo({
              status: result.transaction?.status as TransactionStatus,
              message: result.error.params?.message || result.error.message,
          })
      } else {

          const transactionDataUpdate = {
              status: TransactionStatus.EXPIRED,                    
              message: translate("tranDetailScreen_successRetrieveEcashAfterRetry"),
              createdAt: new Date(),
          }
  
          await transactionsStore.updateStatuses(
              [transaction.id as number],
              TransactionStatus.EXPIRED,
              JSON.stringify(transactionDataUpdate),
          )

          const modalInfo = {
              status: result.transaction?.status as TransactionStatus,
              message: result.message,
          }               

          setResultModalInfo(modalInfo)
      }
      
  }

    const onGoBack = () => {
        navigation.goBack()
    }
    
    
    return (
    <>
        <Card
            style={$dataCard}
            label='Transaction data'
            ContentComponent={
                <>
                    <TranItem
                        label="tranDetailScreen_amount"
                        value={transaction.amount}
                        unit={transaction.unit}
                        isCurrency={true}
                        isFirst={true}
                    />
                    {transaction.memo && (
                    <TranItem
                        label="tranDetailScreen_memoFromSender"
                        value={transaction.memo as string}
                    />
                    )}
                    {transaction.sentFrom && (
                      <>
                      {profilePicture ? (
                        <View
                          style={{flexDirection: 'row', justifyContent: 'space-between'}}
                        >
                          <TranItem
                              label="tranDetailScreen_sentFrom"
                              value={transaction.sentFrom}
                              url={sentFromUrl}
                          />
                          <View style={$pictureContainer}>
                          {profilePicture ? (
                            <FastImage 
                              style={
                                {
                                  width: verticalScale(40),
                                  height: verticalScale(40),
                                  borderRadius: verticalScale(40) / 2,
                                }
                              } 
                              source={{uri: profilePicture}}
                              // defaultSource={require('../../assets/icons/nostr.png')}
                            /> 
                          ):(
                            <FastImage 
                              style={
                                {
                                  width: verticalScale(40),
                                  height: verticalScale(40),
                                  borderRadius: verticalScale(40) / 2,
                                }
                              } 
                              source={require('../../assets/icons/nostr.png')}                              
                            /> 
                          )} 
                          </View> 
                        </View>
                      ) : (
                        <TranItem
                            label="tranDetailScreen_sentFrom"
                            value={transaction.sentFrom}
                            url={sentFromUrl}
                        />
                      )}

                      </>
                    )} 
                    {eventUrl && (
                        <TranItem
                            label="tranDetailScreen_eventUrl"
                            value={`${eventUrl.substring(0,30)}...`}
                            url={eventUrl}
                        />
                    )}                   
                    <TranItem
                        label="tranDetailScreen_type"
                        value={transaction.type as string}
                    />
                    <TranItem
                      label="tranDetailScreen_fee"
                      value={transaction.fee}
                      unit={transaction.unit}
                      isCurrency={true}
                    />
                    {isRetriable ? (
                        <View
                        style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                        <TranItem
                            label="tranDetailScreen_status"
                            value={transaction.status as string}
                        />
                        <Button
                            style={{marginTop: spacing.medium}}
                            // preset="secondary"
                            tx="tranDetailScreen_retryToReceive"
                            onPress={onRetryToReceive}
                        />
                        </View>
                    ) : (
                        <TranItem
                            label="tranDetailScreen_status"
                            value={transaction.status as string}
                        />
                    )}
                    {transaction.status === TransactionStatus.COMPLETED && (
                      <TranItem
                          label="tranDetailScreen_balanceAfter"
                          value={transaction.balanceAfter || 0}
                          unit={transaction.unit}
                          isCurrency={true}
                      />
                    )}
                    <TranItem
                        label="tranDetailScreen_createdAt"
                        value={(transaction.createdAt as Date).toLocaleString()}
                    />
                    {transaction.paymentId && (
                      <TranItem
                          label="tranDetailScreen_paymentId"
                          value={transaction.paymentId as string}
                      />
                    )}
                    <TranItem label="tranDetailScreen_id" value={`${transaction.id}`} />
                </>
            }
        />
        <Card
            labelTx='transactionCommon_receivedTo'
            style={$dataCard}
            ContentComponent={
              mint ? (
                <MintListItem
                  mint={mint}
                  isSelectable={false}
                  isUnitVisible={false}
                />
              ) : (                
                  <Text text={transaction.mint} />
              )              
            }
        />        
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {resultModalInfo?.status === TransactionStatus.COMPLETED && (
                <>
                  <ResultModalInfo
                    icon="faCheckCircle"
                    iconColor={colors.palette.success200}
                    title={translate("tranDetailScreen_modalSuccess")}
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx={'commonClose'}
                      onPress={onGoBack}
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
                    title={translate('transactionCommon_receiveFailed')}
                    message={resultModalInfo?.message as string}
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
        {isLoading && <Loading />}
    </>
    )
}


const ReceiveOfflineInfoBlock = function (props: {
    transaction: Transaction
    isDataParsable: boolean
    mint?: Mint
    colorScheme: 'light' | 'dark'
    navigation: any
}) {
    const {
        transaction, 
        navigation,
        mint
    } = props
    
    const isInternetReachable = useIsInternetReachable()

    const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; message: string} | undefined
    >()
    const [isLoading, setIsLoading] = useState(false)


    // MVP implementaition
    const toggleResultModal = () =>
    setIsResultModalVisible(previousState => !previousState)

    const receiveOfflineComplete = async function () {
        setIsLoading(true)   
        const result = await WalletTask.receiveOfflineCompleteQueueAwaitable(transaction.id!) 
        await handleReceiveOfflineCompleteTaskResult(result)            
    }

    const handleReceiveOfflineCompleteTaskResult = async (result: TransactionTaskResult) => {
      log.trace('handleReceiveOfflineCompleteTaskResult start')
      
      setIsLoading(false)

      if (result.error) {
          setResultModalInfo({
              status: result.transaction?.status as TransactionStatus,
              message: result.error.message,
          })
      } else {
          setResultModalInfo({
              status: result.transaction?.status as TransactionStatus,
              message: result.message,
          })
      }
      setIsLoading(false)
      toggleResultModal() 
  }

    const onGoBack = () => {
        navigation.goBack()
    }

    const labelColor = useThemeColor('textDim')

    return (
    <>
        <Card
            label='Transaction data'
            style={$dataCard}
            ContentComponent={
                <>
                    {transaction.status === TransactionStatus.PREPARED_OFFLINE ? (
                        <View
                        style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                        <TranItem
                            label="tranDetailScreen_amount"
                            value={transaction.amount}
                            unit={transaction.unit}
                            isCurrency={true}
                            isFirst={true}
                        />
                        {isInternetReachable ? (
                            <Button
                                style={{maxHeight: 10, marginTop: spacing.medium}}
                                preset="default"
                                tx="tranDetailScreen_receiveOfflineComplete"
                                onPress={receiveOfflineComplete}
                            />
                        ) : (
                            <Button
                                style={{maxHeight: 10, marginTop: spacing.medium}}
                                preset="secondary"
                                tx="tranDetailScreen_isOffline"                                
                            />
                        )}
                        </View>
                    ) : (
                        <TranItem
                            label="tranDetailScreen_amount"
                            value={transaction.amount}
                            isFirst={true}
                        />
                    )}                    
                    <TranItem
                        label="tranDetailScreen_memoFromSender"
                        value={transaction.memo as string}
                    />
                    {transaction.sentFrom && (
                        <TranItem
                            label="tranDetailScreen_sentFrom"
                            value={transaction.sentFrom}
                        />
                    )} 
                    <TranItem
                        label="tranDetailScreen_type"
                        value={transaction.type as string}
                    />
                    <TranItem
                      label="tranDetailScreen_fee"
                      value={transaction.fee}
                      unit={transaction.unit}
                      isCurrency={true}
                    />
                    <TranItem
                        label="tranDetailScreen_status"
                        value={transaction.status as string}
                    />
                    {transaction.status === TransactionStatus.COMPLETED && (
                        <TranItem
                            label="tranDetailScreen_balanceAfter"
                            value={transaction.balanceAfter || 0}
                            unit={transaction.unit}
                            isCurrency={true}
                        />
                    )}
                    <TranItem
                        label="tranDetailScreen_createdAt"
                        value={(transaction.createdAt as Date).toLocaleString()}
                    />
                    {transaction.paymentId && (
                      <TranItem
                          label="tranDetailScreen_paymentId"
                          value={transaction.paymentId as string}
                      />
                    )}
                    <TranItem label="tranDetailScreen_id" value={`${transaction.id}`} />
                </>
            }
        />
        <Card
            labelTx='transactionCommon_receivedTo'
            style={$dataCard}
            ContentComponent={
              mint ? (
                <MintListItem
                  mint={mint}
                  isSelectable={false}
                  isUnitVisible={false}
                />
              ) : (                
                  <Text text={transaction.mint} />
              )              
            }
        />        
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {(resultModalInfo?.status === TransactionStatus.COMPLETED ||
                resultModalInfo?.status === TransactionStatus.PREPARED_OFFLINE ) && (
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
                      onPress={onGoBack}
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
                    title={translate('transactionCommon_receiveFailed')}
                    message={resultModalInfo?.message as string}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx='commonClose'
                      onPress={onGoBack}
                    />
                  </View>
                </>
              )}
            </>
          }
          onBackButtonPress={toggleResultModal}
          onBackdropPress={toggleResultModal}
        />
        {isLoading && <Loading />}
    </>
    )
}

const SendInfoBlock = function (props: {
    transaction: Transaction
    isDataParsable: boolean    
    mint?: Mint
    colorScheme: 'light' | 'dark'
}) {
    const {transaction, mint} = props
    const {proofsStore} = useStores()

    const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; message: string} | undefined
    >()
    const [isLoading, setIsLoading] = useState(false)  
    
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)    


    const onRevertPendingSend = async function () {
      try {
        log.trace('[onRevertPendingSend]', {tId: transaction.id})

        if(!mint) {
          const message = 'Could not get the mint.'
          throw new AppError(Err.VALIDATION_ERROR, message)          
        }
        
        const pendingProofs = proofsStore.getByTransactionId(transaction.id)

        if(pendingProofs.length === 0) {
          const message = 'Could not get proofs related to the transaction from wallet state.'
          throw new AppError(Err.VALIDATION_ERROR, message)          
        }

        const pendingProofsAmount = CashuUtils.getProofsAmount(pendingProofs)
        
        if(pendingProofsAmount !== transaction.amount) {
          log.warn('[onRevertPendingSend]', 'pendingProofs amount is not equal transaction amount.', {
            tId: transaction.id, 
            pendingProofsAmount,
            amount: transaction.amount
          })         
        }

        const result = await WalletTask.revertQueueAwaitable(transaction)
        await handleRevertTaskResult(result)
        setIsLoading(true)

      } catch (e: any) {
        setResultModalInfo({status: TransactionStatus.ERROR, message: e.message})
        toggleResultModal()
      }
    }

    const handleRevertTaskResult = async (result: TransactionTaskResult) => {
      log.trace('[handleRevertTaskResult] start')
      
      setIsLoading(false)

      if (result.error) {
          setResultModalInfo({
              status: result.transaction?.status as TransactionStatus,
              message: result.error.message,
          })
      } else {
          setResultModalInfo({
              status: result.transaction?.status as TransactionStatus,
              message: result.message,
          })
      }
      setIsLoading(false)
      toggleResultModal() 
  }
    
    return (
        <>
            <Card
                label='Transaction data'
                style={$dataCard}
                ContentComponent={
                    <>
                        <TranItem
                            label="tranDetailScreen_amount"
                            value={transaction.amount}
                            unit={transaction.unit}
                            isCurrency={true}
                            isFirst={true}
                        />
                        {transaction.memo && (
                        <TranItem
                            label="receiverMemo"
                            value={transaction.memo as string}
                        />
                        )}
                        {transaction.sentTo && (
                            <TranItem
                                label="tranDetailScreen_sentTo"
                                value={transaction.sentTo}
                            />
                        )}
                        <TranItem
                            label="tranDetailScreen_type"
                            value={transaction.type as string}
                        />
                        <TranItem
                          label="tranDetailScreen_fee"
                          value={transaction.fee}
                          unit={transaction.unit}
                          isCurrency={true}
                        />
                        {transaction.status === TransactionStatus.PENDING ? (
                            <View
                            style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                            <TranItem
                                label="tranDetailScreen_status"
                                value={transaction.status as string}
                            />
                            <Button
                                style={{marginVertical: spacing.small}}
                                preset="secondary"
                                tx="tranDetailScreen_revert"
                                onPress={onRevertPendingSend}
                            />
                            </View>
                        ) : (
                            <TranItem
                              label="tranDetailScreen_status"
                              value={transaction.status as string}
                            />
                        )}
                        {transaction.status !== TransactionStatus.ERROR && (
                            <TranItem
                              label="tranDetailScreen_balanceAfter"
                              value={transaction.balanceAfter || 0}
                              unit={transaction.unit}
                              isCurrency={true}
                            />
                        )}
                        <TranItem
                            label="tranDetailScreen_createdAt"
                            value={(transaction.createdAt as Date).toLocaleString()}
                        />
                        <TranItem label="tranDetailScreen_id" value={`${transaction.id}`} />
                    </>
                }
            />
            <Card
                labelTx='tranDetailScreen_sentFrom'
                style={$dataCard}
                ContentComponent={
                  mint ? (
                    <MintListItem
                      mint={mint}
                      isSelectable={false}
                      isUnitVisible={false}
                    />
                  ) : (                
                      <Text text={transaction.mint} />
                  )              
                }
            />            
          <BottomModal
            isVisible={isResultModalVisible ? true : false}          
            ContentComponent={
              <>
                {resultModalInfo?.status === TransactionStatus.REVERTED && (
                  <>
                    <ResultModalInfo
                      icon="faCheckCircle"
                      iconColor={colors.palette.success200}
                      title={'Transaction reverted'}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx={'commonClose'}
                        onPress={toggleResultModal}
                      />
                    </View>
                  </>
                )}
                {resultModalInfo?.status === TransactionStatus.ERROR && (
                  <>
                    <ResultModalInfo
                      icon="faTriangleExclamation"
                      iconColor={colors.palette.angry500}
                      title={"Error"}
                      message={resultModalInfo?.message as string}
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
          {isLoading && <Loading />}
      </>
      
  )
}

const TopupInfoBlock = function (props: {
    transaction: Transaction
    isDataParsable: boolean
    mint?: Mint
    colorScheme: 'dark' | 'light'
    navigation: any
}) {
  const {transaction, navigation, mint} = props
  const {mintsStore, walletStore} = useStores()
  const isInternetReachable = useIsInternetReachable()
  const [isPendingTopupRetriable, setIsPendingTopupRetriable] = useState<boolean>(false)
  const [isPendingTopupTaskSentToQueue, setIsPendingTopupTaskSentToQueue] = useState<boolean>(false)
  const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
  const [resultModalInfo, setResultModalInfo] = useState<
    {status: TransactionStatus; message: string} | undefined
  >()
  const [isLoading, setIsLoading] = useState(false)
  
  useFocusEffect(useCallback(() => {      
    log.trace('[TopupInfoBlock] useFocusEffect start')

    if ([
        TransactionStatus.ERROR, 
        TransactionStatus.PENDING,
        TransactionStatus.EXPIRED
      ].includes(transaction.status)) {
        setIsPendingTopupRetriable(true)
    }     
  }, []))

  useFocusEffect(useCallback(() => {
      const handlePendingTopupTaskResult = async (result: TransactionTaskResult) => {
          log.trace('[handlePendingTopupTaskResult] event handler triggered')
          setIsLoading(false)

          // do not react to an active poller :)
          if(pollerExists(`handlePendingTopupPoller-${result.paymentHash}`)) {
              return false            
          }

          if(mint && WalletUtils.shouldHealOutputsError(result.error)) {
            const walletInstance = await walletStore.getWallet(
              mint.mintUrl as string, 
              transaction.unit, 
              {withSeed: true}
            )
            const mintInstance = mintsStore.findByUrl(mint.mintUrl as string)
            const counter = mintInstance!.getProofsCounterByKeysetId!(walletInstance.keysetId)
            counter!.increaseProofsCounter(10)
          }

          if (result.error) {
              setResultModalInfo({
                  status: result.transaction?.status as TransactionStatus,
                  message: result.error.params?.message || result.error.message,
              })
          } else {
              setResultModalInfo({
                  status: result.transaction?.status as TransactionStatus,
                  message: result.message,
              })
          }

          toggleResultModal()            
      }

      // Subscribe to the event
      EventEmitter.on(`ev_${HANDLE_PENDING_TOPUP_TASK}_result`, handlePendingTopupTaskResult)

      // Unsubscribe from the event on component unmount
      return () => {
          EventEmitter.off(`ev_${HANDLE_PENDING_TOPUP_TASK}_result`, handlePendingTopupTaskResult)
      }
  }, [isPendingTopupTaskSentToQueue]))

  
  const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)


  const onRetryToHandlePendingTopup = async function () {                
      if(!isInternetReachable || !mint) {
          return
      }

      setIsLoading(true)

      setIsPendingTopupTaskSentToQueue(true)
      WalletTask.handlePendingQueue()
  }

  const onGoBack = () => {
      navigation.goBack()
  }

  const labelColor = useThemeColor('textDim')

  return (
    <>
        <Card
            label='Transaction data'
            style={$dataCard}
            ContentComponent={
                <>
                    <TranItem
                        label="tranDetailScreen_amount"
                        value={transaction.amount}
                        unit={transaction.unit}
                        isCurrency={true}
                        isFirst={true}
                    />
                    {transaction.memo && transaction.memo.length > 0 && (
                      <TranItem
                          label="receiverMemo"
                          value={transaction.memo as string}
                      />
                    )}
                    {transaction.sentFrom && (
                        <TranItem
                            label="tranDetailScreen_sentFrom"
                            value={transaction.sentFrom}
                        />
                    )}                    
                    <TranItem
                        label="tranDetailScreen_type"
                        value={transaction.type as string}
                    />
                    <TranItem
                      label="tranDetailScreen_fee"
                      value={transaction.fee}
                      unit={transaction.unit}
                      isCurrency={true}
                    />
                    {isPendingTopupRetriable && isInternetReachable ? (
                        <View
                        style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                        <TranItem
                            label="tranDetailScreen_status"
                            value={transaction.status as string}
                        />
                        <Button
                            style={{marginTop: spacing.medium}}
                            preset="secondary"
                            tx="tranDetailScreen_retryToComplete"
                            onPress={onRetryToHandlePendingTopup}
                        />
                        </View>
                    ) : (
                        <TranItem
                            label="tranDetailScreen_status"
                            value={transaction.status as string}
                        />
                    )}
                    {transaction.status === TransactionStatus.COMPLETED && (
                        <TranItem
                            label="tranDetailScreen_balanceAfter"
                            value={transaction.balanceAfter || 0}
                            unit={transaction.unit}
                            isCurrency={true}
                        />
                    )}
                    <TranItem
                        label="tranDetailScreen_createdAt"
                        value={(transaction.createdAt as Date).toLocaleString()}
                    />
                    {transaction.expiresAt && transaction.status !== TransactionStatus.COMPLETED && (
                      <TranItem
                        label="tranDetailScreen_expiresAt"
                        value={(new Date(transaction.expiresAt!)).toLocaleString()}
                      />
                    )}
                    {transaction.paymentId && (
                      <TranItem
                          label="tranDetailScreen_paymentId"
                          value={transaction.paymentId as string}
                      />
                    )}                
                    <TranItem label="tranDetailScreen_id" value={`${transaction.id}`} />            
                </>
            }
        />
        {transaction.status === TransactionStatus.PENDING && transaction.paymentRequest && (
          <View style={{marginBottom: spacing.small}}>
            <QRCodeBlock 
              qrCodeData={transaction.paymentRequest}
              title={translate("tranDetailScreen_invoice")}
              type='Bolt11Invoice'
              size={spacing.screenWidth * 0.8}
            />
          </View>
        )}
        <Card
            labelTx='tranDetailScreen_topupTo'
            style={$dataCard}
            ContentComponent={
              mint ? (
                <MintListItem
                  mint={mint}
                  isSelectable={false}
                  isUnitVisible={false}
                />
              ) : (                
                  <Text text={transaction.mint} />
              )              
            }
        />        
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {(resultModalInfo?.status === TransactionStatus.COMPLETED) && (
                <>
                  <ResultModalInfo
                    icon="faCheckCircle"
                    iconColor={colors.palette.success200}
                    title={translate("tranDetailScreen_modalSuccess")}
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx='commonClose'
                      onPress={onGoBack}
                    />
                  </View>
                </>
              )}
              {(resultModalInfo?.status === TransactionStatus.PENDING) && (
                <>
                  <ResultModalInfo
                    icon="faTriangleExclamation"
                    iconColor={colors.palette.accent400}
                    title={translate("tranDetailScreen_invoiceNotPaid")}
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx={'commonClose'}
                      onPress={toggleResultModal}
                    />
                  </View>
                </>
              )}
              {(resultModalInfo?.status === TransactionStatus.EXPIRED) && (
                <>
                  <ResultModalInfo
                    icon="faTriangleExclamation"
                    iconColor={colors.palette.accent400}
                    title={translate("tranDetailScreen_invoiceExpired")}
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
              {(resultModalInfo?.status === TransactionStatus.ERROR) && (
                <>
                  <ResultModalInfo
                    icon="faTriangleExclamation"
                    iconColor={colors.palette.angry500}
                    title={translate("tranDetailScreen_topupError")}
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
    </>
  )
}

const TransferInfoBlock = function (props: {
  transaction: Transaction
  isDataParsable: boolean
  mint?: Mint  
  colorScheme: 'dark' | 'light'
}) {
  const {transaction, mint, isDataParsable} = props
  const {proofsStore, transactionsStore} = useStores()
  const navigation = useNavigation()

  
  const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
  const [resultModalInfo, setResultModalInfo] = useState<
    {status: TransactionStatus; message: string} | undefined
  >()

  const toggleResultModal = () =>
    setIsResultModalVisible(previousState => !previousState)


  // Pay invoice received over Nostr
  const onPayDraftTransfer = async function () {

    log.trace('[onPayDraftTransfer] start', {tId: transaction.id})

    const {paymentRequest, unit, mint} = transaction

    if(!paymentRequest || !unit || !mint) {
      log.error('[onPayDraftTransfer] Missing params', {paymentRequest, unit, mint})
      
      setResultModalInfo({
        status: TransactionStatus.ERROR,
        message: 'This transaction is missing data needed to be paid.'
      })

      toggleResultModal()
      return
    }

    //@ts-ignore
    return navigation.navigate('WalletNavigator', {
      screen: 'Transfer', 
      params: {
          encodedInvoice: transaction.paymentRequest,
          paymentOption: TransferOption.PASTE_OR_SCAN_INVOICE,
          unit: transaction.unit,
          mintUrl: transaction.mint,
          draftTransactionId: transaction.id
      }
    })    
  }

  const onRevertPreparedTransfer = async function () {
    try {
      log.trace('[onRevertPreparedTransfer]', {tId: transaction.id})
      
      const pendingProofs = proofsStore.getByTransactionId(transaction.id) // PREPARED should always pending
      const transactionData = getAuditTrail(transaction)

      if(pendingProofs.length > 0) {               
        proofsStore.revertToSpendable(pendingProofs)
      }
      
      const message = 'Ecash has been returned to spendable balance.'

      transactionData.push({
        status: TransactionStatus.REVERTED,      
        message,
        createdAt: new Date(),
      })

      transaction.update({
        status: TransactionStatus.REVERTED,
        data: JSON.stringify(transactionData)
      })

      setResultModalInfo({status: TransactionStatus.REVERTED, message})
      toggleResultModal()
    } catch (e: any) {
      setResultModalInfo({status: TransactionStatus.ERROR, message: e.message})
      toggleResultModal()
    }
  }

  const copyProof = function () {
    try {        
      if(transaction && transaction.proof) Clipboard.setString(transaction.proof)
    } catch (e: any) {      
    }
  }

  return (
    <>
      <Card
        label='Transaction data'
        style={$dataCard}
        ContentComponent={
          <>
            {transaction.status === TransactionStatus.DRAFT ? (
              <View
                style={{flexDirection: 'row', justifyContent: 'space-between'}}
              >
                <TranItem
                  label="tranDetailScreen_amount"
                  value={transaction.amount}
                  unit={transaction.unit}
                  isCurrency={true}
                  isFirst={true}
                />
                <Button
                    style={{marginTop: spacing.medium}}
                    tx="transactionCommon_payNow"
                    onPress={onPayDraftTransfer}
                />
              </View>
            ):(
              <TranItem
                label="tranDetailScreen_amount"
                value={transaction.amount}
                unit={transaction.unit}
                isCurrency={true}
                isFirst={true}
              />
            )}
            {transaction.memo && (
            <TranItem
              label="tranDetailScreen_memoFromInvoice"
              value={transaction.memo as string}
            />
            )}
            {transaction.sentTo && (
                <TranItem
                    label="tranDetailScreen_sentTo"
                    value={transaction.sentTo}
                />
            )}
            <TranItem
              label="tranDetailScreen_type"
              value={transaction.type as string}
            />
            {transaction.status === TransactionStatus.COMPLETED && (
              <TranItem
                label="tranDetailScreen_fee"
                value={transaction.fee}
                unit={transaction.unit}
                isCurrency={true}
              />
            )}            
            {transaction.status === TransactionStatus.PREPARED ? (
              <View
                style={{flexDirection: 'row', justifyContent: 'space-between'}}
              >
                <TranItem
                    label="tranDetailScreen_status"
                    value={transaction.status as string}
                />
                <Button
                    style={{marginTop: spacing.medium}}
                    preset="secondary"
                    tx="tranDetailScreen_revert"
                    onPress={onRevertPreparedTransfer}
                />
              </View>
            ):(
              <TranItem
                label="tranDetailScreen_status"
                value={transaction.status as string}
              />
            )}
            {transaction.status === TransactionStatus.COMPLETED && (
                <TranItem
                    label="tranDetailScreen_balanceAfter"
                    value={transaction.balanceAfter || 0}
                    unit={transaction.unit}
                    isCurrency={true}
                />
            )}
            <TranItem
              label="tranDetailScreen_createdAt"
              value={(transaction.createdAt as Date).toLocaleString()}
            />
            {transaction.expiresAt && transaction.status !== TransactionStatus.COMPLETED && (
              <TranItem
                label="tranDetailScreen_expiresAt"
                value={(new Date(transaction.expiresAt!)).toLocaleString()}
              />
            )}
            {transaction.paymentId && (
              <TranItem
                  label="tranDetailScreen_paymentId"
                  value={transaction.paymentId as string}
              />
            )}
            <TranItem label="tranDetailScreen_id" value={`${transaction.id}`} />
          </>
        }
        />
        <Card
            labelTx='transactionCommon_paidFrom'
            style={$dataCard}
            ContentComponent={
              mint ? (
                <MintListItem
                  mint={mint}
                  isSelectable={false}
                  isUnitVisible={false}
                />
              ) : (                
                  <Text text={transaction.mint} />
              )              
            }
        />
        {transaction.proof && (
          <Card
              labelTx='tranDetailScreen_proof'
              style={$dataCard}
              ContentComponent={
                <ListItem
                  text={transaction.proof}
                  textStyle={{fontFamily: typography.code!.normal}}
                  RightComponent={
                    <View style={$rightContainer}>
                      <Button
                        onPress={copyProof}
                        text={translate("commonCopy")}
                        preset="secondary"                        
                      />
                    </View>
                  }
                />            
              }
          />
        )}     
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {resultModalInfo?.status === TransactionStatus.REVERTED && (
                <>
                  <ResultModalInfo
                    icon="faCheckCircle"
                    iconColor={colors.palette.success200}
                    title={'Transaction reverted'}
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx={'commonClose'}
                      onPress={toggleResultModal}
                    />
                  </View>
                </>
              )}
              {resultModalInfo?.status === TransactionStatus.ERROR && (
                <>
                  <ResultModalInfo
                    icon="faTriangleExclamation"
                    iconColor={colors.palette.angry500}
                    title={"Error"}
                    message={resultModalInfo?.message as string}
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
    </>
  )
}

export const TranItem = function (props: {
    label: TxKeyPath    
    value: string | number
    unit?: MintUnit
    url?: string
    labelStyle?: TextStyle
    valueStyle?: TextStyle 
    isFirst?: boolean
    isLast?: boolean
    isCurrency?: boolean    
}) {


    const onPressUrl = function () {
      if(!props.url) {
        return
      }

      try {
        Linking.openURL(props.url!);
      } catch(e: any) {
        log.error('[onPressUrl] Linking.openUrl ended with error', {url: props.url})
      }
    }

    const labelColor = useThemeColor('textDim')
    const margin = !props.isFirst ? {marginTop: spacing.small} : null

    return (
        <View>
            <Text
                style={[props.labelStyle, {color: labelColor, fontSize: 14}, margin]}
                tx={props.label}                
            />
            {props.isCurrency && props.unit ? (
              <Text 
                style={props.valueStyle ?? {}} 
                text={`${formatCurrency(props.value as number, getCurrency(props.unit).code)} ${getCurrency(props.unit).code}`} 
                selectable={true}
              />            
            ) : (
              <>
                {props.url ? (
                  <Pressable onPress={onPressUrl}>
                    <Text style={props.valueStyle ?? {textDecorationLine: 'underline'}} text={props.value as string} />
                  </Pressable>
                ) : (
                  <Text 
                    selectable={true}
                    style={props.valueStyle ?? {}} 
                    text={props.value as string} 
                  />
                )}                
              </>
            )}            
        </View>
    )
}


const getAuditTrail = function (transaction: Transaction) {
    let data = [] as unknown as TransactionData
    try {        
        data = JSON.parse(transaction.data)
    } catch (e) {}

    return data
}


const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    paddingBottom: spacing.medium,
    height: spacing.screenHeight * 0.15,
}

const $contentContainer: TextStyle = {
    // flex: 1,
    padding: spacing.extraSmall,
    marginTop: -spacing.extraLarge * 1.5,
    paddingBottom: spacing.medium,
}

const $tranAmount: TextStyle = {
    fontSize: verticalScale(48),
    lineHeight: verticalScale(48),    
    //marginLeft: -20,    
}

const $actionCard: ViewStyle = {
    marginBottom: spacing.extraSmall,    
    paddingVertical: 0,
    minHeight: verticalScale(80)
}

const $dataCard: ViewStyle = {
    // padding: spacing.medium,  
    marginBottom: spacing.extraSmall,
    // paddingTop: spacing.extraSmall,
}

const $noteContainer: ViewStyle = {
  flex: 1,
  flexDirection: 'row',
  justifyContent: 'center',
  alignItems: 'center',
}

const $noteButton: ViewStyle = {
  maxHeight: verticalScale(50),
  minWidth: verticalScale(70),
}

const $noteInput: TextStyle = {
  flex: 1,
  borderRadius: spacing.small,
  fontSize: verticalScale(16),
  textAlignVertical: 'center',
  marginRight: spacing.small,  
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
}

const $qrCodeContainer: ViewStyle = {
    backgroundColor: 'white',
    padding: spacing.small,
    margin: spacing.small,
    borderRadius: spacing.small,
    alignSelf: 'center'
}

  const $rightContainer: ViewStyle = {
    padding: spacing.extraSmall,
    alignSelf: 'center',
    marginLeft: spacing.small,
  }

  const $tokenText: TextStyle = {
    flex: 1,
    borderRadius: spacing.small,    
    textAlignVertical: 'center',
    marginRight: spacing.small,
    fontFamily: typography.code?.normal
  }

  const $copyButton: ViewStyle = {
    maxHeight: 50,
    margin: spacing.extraSmall,
  }

  const $tokenContainer: ViewStyle = {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  }

  const $pictureContainer: ViewStyle = {
    flex: 0,
    // borderRadius: spacing.small,
    // padding: spacing.extraSmall,
    alignSelf: 'flex-end',
    marginRight: spacing.tiny,    
    marginBottom: spacing.tiny,    
  }

