import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useRef, useState} from 'react'
import {
  Alert,
  LayoutAnimation,
  Platform,
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
import {TransactionsStackScreenProps} from '../navigation'
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
  TransactionStatus,
  TransactionType,
} from '../models/Transaction'
import AppError, {Err} from '../utils/AppError'
import {log} from '../services/logService'
import {isArray} from 'lodash'
import {Database, TransactionTaskResult, WalletTask} from '../services'
import {BackupProof, Proof} from '../models/Proof'
import useColorScheme from '../theme/useThemeColor'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import { CashuUtils, TokenV3 } from '../services/cashu/cashuUtils'
import { Mint, MintStatus } from '../models/Mint'
import { moderateVerticalScale } from '@gocodingnow/rn-size-matters'
import { CurrencySign } from './Wallet/CurrencySign'
import { MintUnit, formatCurrency, getCurrency } from "../services/wallet/currency"
import { PaymentRequest } from '../models/PaymentRequest'
import { pollerExists } from '../utils/poller'
import { useFocusEffect } from '@react-navigation/native'
import { QRCodeBlock } from './Wallet/QRCode'
import { MintListItem } from './Mints/MintListItem'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

type ProofsByStatus = {
  isSpent: Proof[]
  isPending: Proof[]
  isReceived: Proof[]
}

export const TranDetailScreen: FC<TransactionsStackScreenProps<'TranDetail'>> =
  observer(function TranDetailScreen(_props) {
    const {navigation, route} = _props
    const {transactionsStore, userSettingsStore, mintsStore} = useStores()
    
    const noteInputRef = useRef<TextInput>(null)

    const [transaction, setTransaction] = useState<Transaction>()
    const [proofsByStatus, setProofsByStatus] = useState<
      ProofsByStatus | undefined
    >(undefined)
    const [error, setError] = useState<AppError | undefined>()
    const [isNoteModalVisible, setIsNoteModalVisible] = useState<boolean>(false)
    const [isDataParsable, setIsDataParsable] = useState<boolean>(true)    
    const [info, setInfo] = useState('')
    const [note, setNote] = useState<string>('')
    const [savedNote, setSavedNote] = useState<string>('')
    const [mint, setMint] = useState<Mint | undefined>()
    const [isAuditTrailVisible, setIsAuditTrailVisible] = useState<boolean>(false)

    const toggleAuditTrail = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
      setIsAuditTrailVisible(!isAuditTrailVisible)
    }

    useFocusEffect(useCallback(() => {
      try {
        const {id} = route.params        
        const tx = transactionsStore.findById(id)
        log.trace('Transaction loaded', {id: tx?.id, unit: tx?.unit})

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

      setTransaction(tx as Transaction)
      } catch (e: any) {
        handleError(e)
      }
    }, [route]))

    useEffect(() => {
      try {
        const {id} = route.params

        if (userSettingsStore.isLocalBackupOn === false) {
            return
        }

        const proofs = Database.getProofsByTransaction(id)

        if (proofs.length  === 0) {
            return
        }
        
        const proofsByStatus = proofs.reduce(
            (result: ProofsByStatus, proof: BackupProof) => {
            if (proof.isSpent) {
                result.isSpent.push(proof)
            } else if (proof.isPending) {
                result.isPending.push(proof)
            } else {
                result.isReceived.push(proof)
            }
            return result
            },
            {isReceived: [], isPending: [], isSpent: []},
        )            
        setProofsByStatus(proofsByStatus)          
        
      } catch (e: any) {
        log.error(e.name, e.message)
      }
    }, [])

    useEffect(() => {
      const focus = () => {
        noteInputRef && noteInputRef.current
          ? noteInputRef.current.focus()
          : false
      }

      if (isNoteModalVisible) {
        setTimeout(() => focus(), 100)
      }
    }, [isNoteModalVisible])



  const toggleNoteModal = function () {
      if (isNoteModalVisible) {
        setIsNoteModalVisible(false)
      } else {
        setIsNoteModalVisible(true)
      }
    }

    const saveNote = async function () {
      try {
        setIsNoteModalVisible(false)
        await transactionsStore.saveNote(transaction?.id as number, note)
        setSavedNote(note)
      } catch (e: any) {
        handleError(e)
      }
    }

    const copyAuditTrail = function (transaction: Transaction) {
      try {
        Clipboard.setString(JSON.stringify(getAuditTrail(transaction)))
      } catch (e: any) {
        setInfo(translate("common.copyFailParam", { param: e.message }))
      }
    }

    const copyToken = function (transaction: Transaction) {
      try {
          const encoded = getEncodedTokenToSend(transaction)

          if (!encoded) {
            throw new AppError(
              Err.VALIDATION_ERROR,
              'Could not get encoded ecash token from transaction',
            )
          }

          Clipboard.setString(encoded)

        } catch (e: any) {
          setInfo(translate("common.copyFailParam", { param: e.message }))
        }
    }


    const copyBackupProofs = function (proofsByStatus: ProofsByStatus) {
        try {               
            Clipboard.setString(JSON.stringify(proofsByStatus))  
        } catch (e: any) {
          setInfo(translate("common.copyFailParam", { param: e.message }))
        }
    }
 

    const handleError = function (e: AppError): void {
      setIsNoteModalVisible(false)
      setError(e)
    }


  const headerBg = useThemeColor('header')
  const iconColor = useThemeColor('textDim')
  const inputBg = useThemeColor('background')
    
  const getFormattedAmount = function(): string {
      if (!transaction) { return '' }

      switch (transaction?.type) {
        case TransactionType.RECEIVE || TransactionType.RECEIVE_OFFLINE:
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

  return (
      <Screen contentContainerStyle={$screen} preset="auto">        
        {transaction && (
          <>
            <Header 
                  leftIcon='faArrowLeft'
                  onLeftPress={() => navigation.goBack()}
                                      
            />
            <View style={[$headerContainer, {
                backgroundColor: headerBg, 
                justifyContent: 'space-around', 
                paddingBottom: spacing.huge
              }]}
            >              
              <CurrencySign 
                mintUnit={transaction.unit}
                textStyle={{color: 'white'}}              
              />
              <Text
                  preset="heading"
                  text={getFormattedAmount()}
                  style={$tranAmount}
              />              
            </View>
            <View style={$contentContainer}>
              <Card
                style={$actionCard}
                ContentComponent={
                  <>
                    <ListItem
                      text={
                        transaction.noteToSelf
                          ? transaction.noteToSelf
                          : savedNote
                          ? savedNote
                          : translate("tranDetailScreen.addYourNote")
                      }
                      LeftComponent={
                        <Icon
                          containerStyle={$iconContainer}
                          icon="faPencil"
                          size={spacing.medium}
                          color={iconColor}
                        />
                      }
                      style={$item}
                      // bottomSeparator={true}
                      onPress={toggleNoteModal}
                    />
                    {/*<ListItem
                      tx="tranDetailScreen.addTags"
                      LeftComponent={
                        <Icon
                          containerStyle={$iconContainer}
                          icon="faTags"
                          size={spacing.medium}
                          color={iconColor}
                        />
                      }
                      style={$item}
                      bottomSeparator={false}
                      onPress={() => Alert.alert('Not yet implemented')}
                    />*/}
                  </>
                }
              />

              {transaction.type === TransactionType.RECEIVE && (
                <ReceiveInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  mint={mint}
                  colorScheme={colorScheme}
                  navigation={navigation}
                />
              )}
              {transaction.type === TransactionType.RECEIVE_OFFLINE && (
                <ReceiveOfflineInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  mint={mint}
                  colorScheme={colorScheme}
                  navigation={navigation}
                />
              )}
              {transaction.type === TransactionType.SEND && (
                <SendInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  copyToken={copyToken}
                  mint={mint}
                  colorScheme={colorScheme}
                />
              )}
              {transaction.type === TransactionType.TOPUP && (
                <TopupInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  mint={mint}
                  colorScheme={colorScheme}
                  navigation={navigation}
                />
              )}
              {transaction.type === TransactionType.TRANSFER && (
                <TransferInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  mint={mint}
                  colorScheme={colorScheme}
                />
              )}
              {isDataParsable && (
                <Card
                  labelTx='tranDetailScreen.auditTrail'   
                  ContentComponent={
                    <>
                      <ListItem
                        text='Detailed record of your transaction'
                        RightComponent={
                          <View style={$rightContainer}>
                            <Button
                              onPress={toggleAuditTrail}
                              text={isAuditTrailVisible ? translate("common.hide") : translate("common.show")}
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
                            onPress={() => copyAuditTrail(transaction)}
                            tx="common.copy"
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
              
              {/*proofsByStatus && (
                <Card
                  labelTx='tranDetailScreen.backedUpEcash'
                  style={$dataCard}
                  ContentComponent={
                    <>
                      <JSONTree
                        hideRoot
                        data={proofsByStatus}
                        theme={{
                          scheme: 'default',
                          base00: '#eee',
                        }}
                        invertTheme={colorScheme === 'light' ? false : true}
                      />
                    </>
                  }
                  FooterComponent={
                    <Button
                        preset="tertiary"
                        onPress={() => copyBackupProofs(proofsByStatus)}
                        tx="common.copy"
                        style={{
                            minHeight: 25,
                            paddingVertical: spacing.extraSmall,
                            marginTop: spacing.small,
                            alignSelf: 'center',
                        }}
                        textStyle={{fontSize: 14}}
                    />  
                  }
                />
              )*/}
            </View>
          </>
        )}
        <BottomModal
          isVisible={isNoteModalVisible}
          ContentComponent={
            <View style={$noteContainer}>
              <Text tx="tranDetailScreen.addYourNote" preset="subheading" />
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <TextInput
                  ref={noteInputRef}
                  onChangeText={note => setNote(note)}
                  value={note}
                  style={[$noteInput, {backgroundColor: inputBg}]}
                  maxLength={200}
                />
                <Button
                  tx="common.save"
                  onPress={saveNote}
                />
              </View>
            </View>
          }
          onBackButtonPress={toggleNoteModal}
          onBackdropPress={toggleNoteModal}
        />
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

    const isInternetReachable = useIsInternetReachable()
    const encodedTokenToRetry = getEncodedTokenToRetry(transaction)  
    const {transactionsStore} = useStores()
    const [isReceiveTaskSentToQueue, setIsReceiveTaskSentToQueue] = useState<boolean>(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; message: string} | undefined
    >()
    const [isLoading, setIsLoading] = useState(false)


    useEffect(() => {
        const handleReceiveTaskResult = async (result: TransactionTaskResult) => {
            log.trace('[handleReceiveTaskResult] event handler triggered')
            
            setIsLoading(false)

            if (result.error) {
                setResultModalInfo({
                    status: result.transaction?.status as TransactionStatus,
                    message: result.error.params?.message || result.error.message,
                })
            } else {

                const transactionDataUpdate = {
                    status: TransactionStatus.EXPIRED,                    
                    message: translate("tranDetailScreen.successRetrieveEcashAfterRetry"),
                    createdAt: new Date(),
                }
        
                transactionsStore.updateStatuses(
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

        // Subscribe to the 'sendCompleted' event
        EventEmitter.on('ev_receiveTask_result', handleReceiveTaskResult)

        // Unsubscribe from the 'sendCompleted' event on component unmount
        return () => {
            EventEmitter.off('ev_receiveTask_result', handleReceiveTaskResult)
        }
    }, [isReceiveTaskSentToQueue])


    const toggleResultModal = () =>
    setIsResultModalVisible(previousState => !previousState)

    const onRetryToReceive = async function () {                
        if(!encodedTokenToRetry || !isInternetReachable) {
            return
        }
        
        setIsLoading(true)     

        try {    
            const tokenToRetry: TokenV3 = CashuUtils.decodeToken(encodedTokenToRetry)              
            const amountToReceive = CashuUtils.getTokenAmounts(tokenToRetry).totalAmount
            const memo = tokenToRetry.memo || ''
            
            setIsReceiveTaskSentToQueue(true)
            WalletTask.receive(
                tokenToRetry,
                amountToReceive,
                memo,
                encodedTokenToRetry
            )
 

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

    const onGoBack = () => {
        navigation.goBack()
    } 

    return (
    <>
        <Card
            style={$dataCard}
            ContentComponent={
                <>
                    <TranItem
                        label="tranDetailScreen.amount"
                        value={transaction.amount}
                        unit={transaction.unit}
                        isCurrency={true}
                        isFirst={true}
                    />
                    <TranItem
                        label="tranDetailScreen.memoFromSender"
                        value={transaction.memo as string}
                    />
                    {transaction.sentFrom && (
                        <TranItem
                            label="tranDetailScreen.sentFrom"
                            value={transaction.sentFrom as string}
                        />
                    )}                    
                    <TranItem
                        label="tranDetailScreen.type"
                        value={transaction.type as string}
                    />
                    <TranItem
                      label="tranDetailScreen.fee"
                      value={transaction.fee}
                      unit={transaction.unit}
                      isCurrency={true}
                    />
                    {encodedTokenToRetry ? (
                        <View
                        style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                        <TranItem
                            label="tranDetailScreen.status"
                            value={transaction.status as string}
                        />
                        <Button
                            style={{marginTop: spacing.medium}}
                            // preset="secondary"
                            tx="tranDetailScreen.retryToReceive"
                            onPress={onRetryToReceive}
                        />
                        </View>
                    ) : (
                        <TranItem
                            label="tranDetailScreen.status"
                            value={transaction.status as string}
                        />
                    )}
                    {transaction.status === TransactionStatus.COMPLETED && (
                    <TranItem
                        label="tranDetailScreen.balanceAfter"
                        value={transaction.balanceAfter || 0}
                        unit={transaction.unit}
                        isCurrency={true}
                    />
                    )}
                    <TranItem
                        label="tranDetailScreen.createdAt"
                        value={(transaction.createdAt as Date).toLocaleString()}
                    />
                    <TranItem label="tranDetailScreen.id" value={`${transaction.id}`} />
                </>
            }
        />
        <Card
            labelTx='transactionCommon.receivedTo'
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
                    title={translate("tranDetailScreen.modalSuccess")}
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx={'common.close'}
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
                    title={translate('transactionCommon.receiveFailed')}
                    message={resultModalInfo?.message as string}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx='common.close'
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

    const [isReceiveOfflineCompleteTaskSentToQueue, setIsReceiveOfflineCompleteTaskSentToQueue] = useState<boolean>(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; message: string} | undefined
    >()
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        const handleReceiveOfflineCompleteTaskResult = async (result: TransactionTaskResult) => {
            log.trace('handleReceiveOfflineCompleteTaskResult event handler triggered')
            
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

        // Subscribe to the 'sendCompleted' event
        EventEmitter.on('ev_receiveOfflineCompleteTask', handleReceiveOfflineCompleteTaskResult)

        // Unsubscribe from the 'sendCompleted' event on component unmount
        return () => {
            EventEmitter.off('ev_receiveOfflineCompleteTask', handleReceiveOfflineCompleteTaskResult)
        }
    }, [isReceiveOfflineCompleteTaskSentToQueue])

    // MVP implementaition
    const toggleResultModal = () =>
    setIsResultModalVisible(previousState => !previousState)

    const receiveOfflineComplete = async function () {
        setIsLoading(true)
        setIsReceiveOfflineCompleteTaskSentToQueue(true)   
        WalletTask.receiveOfflineComplete(transaction)             
    }

    const onGoBack = () => {
        navigation.goBack()
    }

    const labelColor = useThemeColor('textDim')

    return (
    <>
        <Card
            style={$dataCard}
            ContentComponent={
                <>
                    {transaction.status === TransactionStatus.PREPARED_OFFLINE ? (
                        <View
                        style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                        <TranItem
                            label="tranDetailScreen.amount"
                            value={transaction.amount}
                            unit={transaction.unit}
                            isCurrency={true}
                            isFirst={true}
                        />
                        {isInternetReachable ? (
                            <Button
                                style={{maxHeight: 10, marginTop: spacing.medium}}
                                preset="default"
                                tx="tranDetailScreen.receiveOfflineComplete"
                                onPress={receiveOfflineComplete}
                            />
                        ) : (
                            <Button
                                style={{maxHeight: 10, marginTop: spacing.medium}}
                                preset="secondary"
                                tx="tranDetailScreen.isOffline"                                
                            />
                        )}
                        </View>
                    ) : (
                        <TranItem
                            label="tranDetailScreen.amount"
                            value={transaction.amount}
                            isFirst={true}
                        />
                    )}                    
                    <TranItem
                        label="tranDetailScreen.memoFromSender"
                        value={transaction.memo as string}
                    />
                    <TranItem
                        label="tranDetailScreen.sentFrom"
                        value={transaction.sentFrom as string}
                    />
                    <TranItem
                        label="tranDetailScreen.type"
                        value={transaction.type as string}
                    />
                    <TranItem
                      label="tranDetailScreen.fee"
                      value={transaction.fee}
                      unit={transaction.unit}
                      isCurrency={true}
                    />
                    <TranItem
                        label="tranDetailScreen.status"
                        value={transaction.status as string}
                    />
                    {transaction.status === TransactionStatus.COMPLETED && (
                        <TranItem
                            label="tranDetailScreen.balanceAfter"
                            value={transaction.balanceAfter || 0}
                            unit={transaction.unit}
                            isCurrency={true}
                        />
                    )}
                    <TranItem
                        label="tranDetailScreen.createdAt"
                        value={(transaction.createdAt as Date).toLocaleString()}
                    />
                    <TranItem label="tranDetailScreen.id" value={`${transaction.id}`} />
                </>
            }
        />
        <Card
            labelTx='transactionCommon.receivedTo'
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
                    title={translate('common.success')}
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx='common.close'
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
                    title={translate('transactionCommon.receiveFailed')}
                    message={resultModalInfo?.message as string}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx='common.close'
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
    copyToken: any
    mint?: Mint
    colorScheme: 'light' | 'dark'
}) {
    const {transaction, isDataParsable, copyToken, mint} = props
    const {proofsStore, transactionsStore} = useStores()

    const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; message: string} | undefined
    >()
  
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)    

    const onRevertPendingSend = async function () {
      try {
        log.trace('[onRevertPendingSend]', {tId: transaction.id})
        
        const pendingProofs = proofsStore.getByTransactionId(transaction.id!, true)

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
  
        if(pendingProofs.length > 0) {          
          // remove it from pending proofs in the wallet
          proofsStore.removeProofs(pendingProofs, true, true)
          // add proofs back to the spendable wallet                
          proofsStore.addProofs(pendingProofs)
        }
        
        const message = 'Ecash unclaimed by the payee has been returned to spendable balance.'
  
        const transactionDataUpdate = {
          status: TransactionStatus.REVERTED,      
          message,
          createdAt: new Date(),
        }
  
        await transactionsStore.updateStatuses(
            [transaction.id!],
            TransactionStatus.REVERTED,
            JSON.stringify(transactionDataUpdate),
        )
  
        setResultModalInfo({status: TransactionStatus.REVERTED, message})
        toggleResultModal()
      } catch (e: any) {
        setResultModalInfo({status: TransactionStatus.ERROR, message: e.message})
        toggleResultModal()
      }
    }
    
    return (
        <>
            <Card
                style={$dataCard}
                ContentComponent={
                    <>
                        <TranItem
                            label="tranDetailScreen.amount"
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
                                label="tranDetailScreen.sentTo"
                                value={transaction.sentTo as string}
                            />
                        )}
                        <TranItem
                            label="tranDetailScreen.type"
                            value={transaction.type as string}
                        />
                        <TranItem
                          label="tranDetailScreen.fee"
                          value={transaction.fee}
                          unit={transaction.unit}
                          isCurrency={true}
                        />
                        {transaction.status === TransactionStatus.PENDING ? (
                            <View
                            style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                            <TranItem
                                label="tranDetailScreen.status"
                                value={transaction.status as string}
                            />
                            <Button
                                style={{marginVertical: spacing.small}}
                                preset="secondary"
                                tx="tranDetailScreen.revert"
                                onPress={onRevertPendingSend}
                            />
                            </View>
                        ) : (
                            <TranItem
                              label="tranDetailScreen.status"
                              value={transaction.status as string}
                            />
                        )}
                        {transaction.status !== TransactionStatus.ERROR && (
                            <TranItem
                              label="tranDetailScreen.balanceAfter"
                              value={transaction.balanceAfter || 0}
                              unit={transaction.unit}
                              isCurrency={true}
                            />
                        )}
                        <TranItem
                            label="tranDetailScreen.createdAt"
                            value={(transaction.createdAt as Date).toLocaleString()}
                        />
                        <TranItem label="tranDetailScreen.id" value={`${transaction.id}`} />
                    </>
                }
            />
            <Card
                labelTx='tranDetailScreen.sentFrom'
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
            {isDataParsable && (
            <>
              {transaction.status === TransactionStatus.PENDING && (
              <Card
                  labelTx='tranDetailScreen.pendingToken'
                  style={$dataCard}
                  ContentComponent={
                    <View style={$tokenContainer}>
                        <Text
                          text={getEncodedTokenToSend(transaction) as string}
                          style={$tokenText} 
                          numberOfLines={1}
                          ellipsizeMode="middle"                         
                        />
                        <Button
                          preset="secondary"
                          style={$copyButton}
                          tx='common.copy'
                          onPress={() => copyToken(transaction)}
                          
                        />
                    </View>
                  }
              />
              )}
            </>
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
                        tx={'common.close'}
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
                        tx='common.close'
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

const TopupInfoBlock = function (props: {
    transaction: Transaction
    isDataParsable: boolean
    mint?: Mint
    colorScheme: 'dark' | 'light'
    navigation: any
}) {
  const {transaction, isDataParsable, colorScheme, navigation, mint} = props
  const {mintsStore} = useStores()
  
  // retrieve pr from transaction as it might have been expired and removed from storage
  const paymentRequest = getPaymentRequestToRetry(transaction)
  const isInternetReachable = useIsInternetReachable()  
  
  const [isPendingTopupTaskSentToQueue, setIsPendingTopupTaskSentToQueue] = useState<boolean>(false)
  const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
  const [resultModalInfo, setResultModalInfo] = useState<
    {status: TransactionStatus; message: string} | undefined
  >()
  const [isLoading, setIsLoading] = useState(false)

  useFocusEffect(useCallback(() => {
      const handlePendingTopupTaskResult = async (result: TransactionTaskResult) => {
          log.trace('[handlePendingTopupTaskResult] event handler triggered')
          setIsLoading(false)

          // do not react to an active poller :)
          if(pollerExists(`handlePendingTopupTaskPoller-${result.paymentHash}`)) {
              return false            
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

      // Subscribe to the 'sendCompleted' event
      EventEmitter.on('ev__handlePendingTopupTask_result', handlePendingTopupTaskResult)

      // Unsubscribe from the 'sendCompleted' event on component unmount
      return () => {
          EventEmitter.off('ev__handlePendingTopupTask_result', handlePendingTopupTaskResult)
      }
  }, [isPendingTopupTaskSentToQueue]))


  const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)


  const onRetryToHandlePendingTopup = async function () {                
      if(!isInternetReachable || !paymentRequest) {
          return
      }    
      setIsLoading(true)

      setIsPendingTopupTaskSentToQueue(true)
      WalletTask.handlePendingTopup(
          {paymentRequest}
      )

  }

  const onGoBack = () => {
      navigation.goBack()
  }

  const labelColor = useThemeColor('textDim')

  return (
    <>
        <Card
            style={$dataCard}
            ContentComponent={
                <>
                    <TranItem
                        label="tranDetailScreen.amount"
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
                            label="tranDetailScreen.sentFrom"
                            value={transaction.sentFrom as string}
                        />
                    )}                    
                    <TranItem
                        label="tranDetailScreen.type"
                        value={transaction.type as string}
                    />
                    <TranItem
                      label="tranDetailScreen.fee"
                      value={transaction.fee}
                      unit={transaction.unit}
                      isCurrency={true}
                    />
                    {paymentRequest && isInternetReachable ? (
                        <View
                        style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                        <TranItem
                            label="tranDetailScreen.status"
                            value={transaction.status as string}
                        />
                        <Button
                            style={{marginTop: spacing.medium}}
                            preset="secondary"
                            tx="tranDetailScreen.retryToComplete"
                            onPress={onRetryToHandlePendingTopup}
                        />
                        </View>
                    ) : (
                        <TranItem
                            label="tranDetailScreen.status"
                            value={transaction.status as string}
                        />
                    )}
                    {transaction.status === TransactionStatus.COMPLETED && (
                        <TranItem
                            label="tranDetailScreen.balanceAfter"
                            value={transaction.balanceAfter || 0}
                            unit={transaction.unit}
                            isCurrency={true}
                        />
                    )}
                    <TranItem
                        label="tranDetailScreen.createdAt"
                        value={(transaction.createdAt as Date).toLocaleString()}
                    />
                    {paymentRequest && (
                      <TranItem
                        label="tranDetailScreen.expiresAt"
                        value={(new Date(paymentRequest.expiresAt!)).toLocaleString()}
                      />
                    )}                    
                    <TranItem label="tranDetailScreen.id" value={`${transaction.id}`} />            
                </>
            }
        />
        <Card
            labelTx='tranDetailScreen.topupTo'
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
        {transaction.status === TransactionStatus.PENDING && paymentRequest && (
            <View style={{marginBottom: spacing.small}}>
              <QRCodeBlock 
                qrCodeData={paymentRequest.encodedInvoice}
                title={translate("tranDetailScreen.invoice")}
                type='Bolt11Invoice'
                size={spacing.screenWidth * 0.8}
              />
            </View>
        )}        
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {(resultModalInfo?.status === TransactionStatus.COMPLETED) && (
                <>
                  <ResultModalInfo
                    icon="faCheckCircle"
                    iconColor={colors.palette.success200}
                    title={translate("tranDetailScreen.modalSuccess")}
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx='common.close'
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
                    title={translate("tranDetailScreen.invoiceNotPaid")}
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
              {(resultModalInfo?.status === TransactionStatus.EXPIRED) && (
                <>
                  <ResultModalInfo
                    icon="faTriangleExclamation"
                    iconColor={colors.palette.accent400}
                    title={translate("tranDetailScreen.invoiceExpired")}
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx='common.close'
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
                    title={translate("tranDetailScreen.topupError")}
                    message={resultModalInfo?.message}
                  />
                  <View style={$buttonContainer}>
                    <Button
                      preset="secondary"
                      tx='common.close'
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
  const {transaction, mint} = props
  const {proofsStore, transactionsStore} = useStores()

  
  const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
  const [resultModalInfo, setResultModalInfo] = useState<
    {status: TransactionStatus; message: string} | undefined
  >()

  const toggleResultModal = () =>
    setIsResultModalVisible(previousState => !previousState)



  const onRevertPreparedTransfer = async function () {
    try {
      log.trace('[onRevertPreparedTransfer]', {tId: transaction.id})
      
      const pendingProofs = proofsStore.getByTransactionId(transaction.id!, true) // PREPARED should always pending

      if(pendingProofs.length > 0) {
        // remove it from pending proofs in the wallet
        proofsStore.removeProofs(pendingProofs, true, true)
        // add proofs back to the spendable wallet                
        proofsStore.addProofs(pendingProofs)
      }
      
      const message = 'Ecash has been returned to spendable balance.'

      const transactionDataUpdate = {
        status: TransactionStatus.REVERTED,      
        message,
        createdAt: new Date(),
      }

      await transactionsStore.updateStatuses(
          [transaction.id!],
          TransactionStatus.REVERTED,
          JSON.stringify(transactionDataUpdate),
      )

      setResultModalInfo({status: TransactionStatus.REVERTED, message})
      toggleResultModal()
    } catch (e: any) {
      setResultModalInfo({status: TransactionStatus.ERROR, message: e.message})
      toggleResultModal()
    }
  }

  return (
    <>
      <Card
        label='Transaction data'
        style={$dataCard}
        ContentComponent={
          <>
            <TranItem
              label="tranDetailScreen.amount"
              value={transaction.amount}
              unit={transaction.unit}
              isCurrency={true}
              isFirst={true}
            />
            {transaction.memo && (
            <TranItem
              label="tranDetailScreen.memoFromInvoice"
              value={transaction.memo as string}
            />
            )}
            {transaction.sentTo && (
                <TranItem
                    label="tranDetailScreen.trasferredTo"
                    value={transaction.sentTo as string}
                />
            )}
            <TranItem
              label="tranDetailScreen.type"
              value={transaction.type as string}
            />
            <TranItem
              label="tranDetailScreen.fee"
              value={transaction.fee}
              unit={transaction.unit}
              isCurrency={true}
            />
            {transaction.status === TransactionStatus.PREPARED ? (
              <View
                style={{flexDirection: 'row', justifyContent: 'space-between'}}
              >
                <TranItem
                    label="tranDetailScreen.status"
                    value={transaction.status as string}
                />
                <Button
                    style={{marginTop: spacing.medium}}
                    preset="secondary"
                    text="Revert"
                    onPress={onRevertPreparedTransfer}
                />
              </View>
            ):(
              <TranItem
                label="tranDetailScreen.status"
                value={transaction.status as string}
              />
            )}
            {transaction.status !== TransactionStatus.ERROR && (
                <TranItem
                    label="tranDetailScreen.balanceAfter"
                    value={transaction.balanceAfter || 0}
                    unit={transaction.unit}
                    isCurrency={true}
                />
            )}

            <TranItem
              label="tranDetailScreen.createdAt"
              value={(transaction.createdAt as Date).toLocaleString()}
            />
            <TranItem label="tranDetailScreen.id" value={`${transaction.id}`} />
          </>
        }
        />
        <Card
            labelTx='transactionCommon.paidFrom'
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
                      tx={'common.close'}
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
                      tx='common.close'
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
    labelStyle?: TextStyle
    valueStyle?: TextStyle 
    isFirst?: boolean
    isLast?: boolean
    isCurrency?: boolean
}) {

    const labelColor = useThemeColor('textDim')
    const margin = !props.isFirst ? {marginTop: spacing.small} : null

    return (
        <View>
            <Text
                style={[props.labelStyle, {color: labelColor, fontSize: 14}, margin]}
                tx={props.label}
            />
            {props.isCurrency && props.unit ? (
              <Text style={props.valueStyle || {}} text={`${formatCurrency(props.value as number, getCurrency(props.unit).code)} ${getCurrency(props.unit).code}`} />            
            ) : (
              <Text style={props.valueStyle || {}} text={props.value as string} />
            )}            
        </View>
    )
}


const getAuditTrail = function (transaction: Transaction) {
    try {        
        const data = JSON.parse(transaction.data)

        if (data && isArray(data)) {
            return data
            /* for (const item of data) {
            if(item.status === TransactionStatus.ERROR) {
                return item
            }
            }*/
        }
        return false
    } catch (e) {
        // silent
        return false
    }
}

const getEncodedTokenToSend = (
  transaction: Transaction,
): string | undefined => {
    try {
        const data = JSON.parse(transaction.data)
        const pendingRecord = data.find(
            (record: any) => record.status === 'PENDING',
        )

        if (pendingRecord) {
            return pendingRecord.encodedTokenToSend
        }

        return undefined // No pending record found
    } catch (e) {
        // silent
        return undefined
    }
}


const getEncodedTokenToRetry = (
    transaction: Transaction,
  ): string | undefined => {
    try {
        if(transaction.type !== (TransactionType.RECEIVE || TransactionType.RECEIVE_OFFLINE)) {
            return undefined
        }

        if (transaction.status !== TransactionStatus.ERROR && 
            transaction.status !== TransactionStatus.DRAFT &&
            transaction.status !== TransactionStatus.BLOCKED) {
            return undefined
        }

        const {mintsStore} = useStores()

        // skip if mint is still offline
        const {mint} = transaction
        const mintInstance = mintsStore.findByUrl(mint)
        if(!mintInstance || mintInstance.status === MintStatus.OFFLINE) {
            return undefined
        }

        const data = JSON.parse(transaction.data)
        const draftRecord = data.find(
            (record: any) => record.status === 'DRAFT',
        )

        const encodedTokenToRetry: string = draftRecord.encodedToken

        if(!encodedTokenToRetry) {return undefined}

        // return token to retry if transaction somehow got stuck in DRAFT status or user blocked a mint and than changed his mind
        // solves #57
        if (transaction.status === TransactionStatus.DRAFT || transaction.status === TransactionStatus.BLOCKED){
            return encodedTokenToRetry
        }

        const errorRecord = data.find(
            (record: any) => record.status === 'ERROR',
        )
        
        const {error} = errorRecord
        
        if(error && error.message) {
            if(error.message.toLowerCase().includes('network request failed') || 
              error.message.toLowerCase().includes('bad gateway') || 
              error.message.toLowerCase().includes('outputs')) {                    
                return encodedTokenToRetry
            }

            return undefined            
        }            
    } catch (e) {
        // silent
        return undefined
    }
}


const getPaymentRequestToRetry = (
    transaction: Transaction,
  ): PaymentRequest | undefined => {
    try {
        if(transaction.type !== (TransactionType.TOPUP)) {
            return undefined
        }

        if (transaction.status !== TransactionStatus.ERROR && 
            transaction.status !== TransactionStatus.PENDING &&
            transaction.status !== TransactionStatus.EXPIRED) {
            return undefined
        }

        const {mintsStore} = useStores()

        // skip if mint is still offline
        const {mint} = transaction
        const mintInstance = mintsStore.findByUrl(mint)
        if(!mintInstance || mintInstance.status === MintStatus.OFFLINE) {
            return undefined
        }

        const data = JSON.parse(transaction.data)
        const pendingRecord = data.find(
            (record: any) => record.status === 'PENDING',
        )

        const paymentRequest: PaymentRequest = pendingRecord.paymentRequest

        if(!paymentRequest) {return undefined}
        if(pollerExists(`handlePendingTopupTaskPoller-${paymentRequest.paymentHash}`)) {return undefined}

        // return paymentRequest to retry if wallet somehow failed to retreive proofs for paid invoice        
        return paymentRequest
       
    } catch (e) {
        // silent
        return undefined
    }
}


const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
    // flex: 1,
    padding: spacing.extraSmall,
}

const $tranAmount: TextStyle = {
    fontSize: moderateVerticalScale(48),
    lineHeight: moderateVerticalScale(48),
    // marginTop: spacing.small,
    marginLeft: -20,
    color: 'white',
}

const $actionCard: ViewStyle = {
    marginBottom: spacing.extraSmall,
    marginTop: -spacing.extraLarge * 1.5,
    paddingVertical: 0,
}

const $dataCard: ViewStyle = {
    // padding: spacing.medium,  
    marginBottom: spacing.extraSmall,
    // paddingTop: spacing.extraSmall,
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

const $noteContainer: TextStyle = {
    padding: spacing.small,
    alignItems: 'center',
}

const $noteInput: TextStyle = {
    flex: 1,
    margin: spacing.small,
    borderRadius: spacing.extraSmall,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
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

