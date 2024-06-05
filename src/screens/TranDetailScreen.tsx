import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useRef, useState} from 'react'
import {
  Alert,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import JSONTree from 'react-native-json-tree'
import {colors, spacing, useThemeColor} from '../theme'
import {TransactionsStackScreenProps, WalletStackScreenProps} from '../navigation'
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
import {useHeader} from '../utils/useHeader'
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
import QRCode from 'react-native-qrcode-svg'
import { getDecodedToken, Token as CashuToken } from '@cashu/cashu-ts'
import { CashuUtils } from '../services/cashu/cashuUtils'
import { MintStatus } from '../models/Mint'
import { moderateVerticalScale } from '@gocodingnow/rn-size-matters'
import { CurrencySign } from './Wallet/CurrencySign'
import { MintUnit, formatCurrency, getCurrency } from "../services/wallet/currency"
import { Token } from '../models/Token'
import { PaymentRequest } from '../models/PaymentRequest'
import { pollerExists } from '../utils/poller'
import { StackActions, useFocusEffect } from '@react-navigation/native'
import { CurrencyAmount } from './Wallet/CurrencyAmount'
import { toNumber } from '../utils/number'

type ProofsByStatus = {
  isSpent: Proof[]
  isPending: Proof[]
  isReceived: Proof[]
}

export const TranDetailScreen: FC<TransactionsStackScreenProps<'TranDetail'>> =
  observer(function TranDetailScreen(_props) {
    const {navigation, route} = _props
    const {transactionsStore, userSettingsStore} = useStores()
    
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
    const labelColor = useThemeColor('textDim')
    const inputBg = useThemeColor('background')
    const tokenTextColor = useThemeColor('textDim')



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
                  TitleActionComponent={
                      <CurrencySign 
                        mintUnit={transaction.unit}
                        textStyle={{color: 'white'}}              
                      />
                  }                    
            />
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>              
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
                    <ListItem
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
                    />
                  </>
                }
              />

              {transaction.type === TransactionType.RECEIVE && (
                <ReceiveInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  copyAuditTrail={copyAuditTrail}
                  colorScheme={colorScheme}
                  navigation={navigation}
                />
              )}
              {transaction.type === TransactionType.RECEIVE_OFFLINE && (
                <ReceiveOfflineInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  copyAuditTrail={copyAuditTrail}
                  colorScheme={colorScheme}
                  navigation={navigation}
                />
              )}
              {transaction.type === TransactionType.SEND && (
                <SendInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  copyToken={copyToken}
                  copyAuditTrail={copyAuditTrail}
                  colorScheme={colorScheme}
                />
              )}
              {transaction.type === TransactionType.TOPUP && (
                <TopupInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  copyAuditTrail={copyAuditTrail}
                  colorScheme={colorScheme}
                  navigation={navigation}
                />
              )}
              {transaction.type === TransactionType.TRANSFER && (
                <TransferInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  copyAuditTrail={copyAuditTrail}
                  colorScheme={colorScheme}
                />
              )}
              {proofsByStatus && (
                <Card
                  style={$dataCard}
                  ContentComponent={
                    <>
                      <Text
                        style={{color: labelColor, fontSize: 14}}
                        tx="tranDetailScreen.backedUpEcash"
                      />
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
              )}
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
    copyAuditTrail: any    
    colorScheme: 'light' | 'dark'
    navigation: any
}) {
    const {
        transaction, 
        isDataParsable, 
        copyAuditTrail,
        colorScheme,
        navigation
    } = props

    const isInternetReachable = useIsInternetReachable()
    const encodedTokenToRetry = getEncodedTokenToRetry(transaction)  
    const {transactionsStore, mintsStore} = useStores()
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
            const tokenToRetry: CashuToken = getDecodedToken(encodedTokenToRetry)              
            const amountToReceive = CashuUtils.getTokenAmounts(tokenToRetry as Token).totalAmount
            const memo = tokenToRetry.memo || ''
            
            setIsReceiveTaskSentToQueue(true)
            WalletTask.receive(
                tokenToRetry as Token,
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
                    {encodedTokenToRetry && isInternetReachable ? (
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
            style={$dataCard}
            ContentComponent={
                <TranItem
                    label="transactionCommon.receivedTo"
                    value={transaction.mint as string}
                />
            }
        />
        {isDataParsable && (
            <>
                <Card
                    style={$dataCard}
                    ContentComponent={
                        <>
                            <Text
                                style={{color: labelColor, fontSize: 14}}
                                tx="tranDetailScreen.auditTrail"
                            />
                            <JSONTree
                                hideRoot
                                data={getAuditTrail(transaction)}
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
                            onPress={() => copyAuditTrail(transaction)}
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
            </>
        )}
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
    copyAuditTrail: any
    colorScheme: 'light' | 'dark'
    navigation: any
}) {
    const {
        transaction, 
        isDataParsable, 
        copyAuditTrail, 
        colorScheme, 
        navigation
    } = props

    const labelColor = useThemeColor('textDim')
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
            style={$dataCard}
            ContentComponent={                        
                <TranItem
                    label="transactionCommon.receivedTo"
                    value={transaction.mint as string}
                />
            }
        />
        {isDataParsable && (
            <>
                <Card
                    style={$dataCard}
                    ContentComponent={
                        <>
                            <Text
                                style={{color: labelColor, fontSize: 14}}
                                tx='tranDetailScreen.auditTrail'
                            />
                            <JSONTree
                                hideRoot
                                data={getAuditTrail(transaction)}
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
                            onPress={() => copyAuditTrail(transaction)}
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
            </>
        )}
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
    copyAuditTrail: any
    colorScheme: 'light' | 'dark'
}) {
    const {transaction, isDataParsable, copyToken, copyAuditTrail, colorScheme} = props
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
                        <TranItem
                            label="receiverMemo"
                            value={transaction.memo as string}
                        />
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
                                onPress={() =>
                                  Alert.alert('Not yet implemented. Copy the token instead.')
                                }
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
                style={$dataCard}
                ContentComponent={                                       
                    <TranItem
                        label="tranDetailScreen.sentFrom"
                        value={transaction.mint as string}
                    />
                }                    
            />
            {isDataParsable && (
            <>
                {transaction.status === TransactionStatus.PENDING && (
                <Card
                    style={$dataCard}
                    ContentComponent={
                        <>
                            
                                <>
                                    <Text
                                        style={{
                                        color: labelColor,
                                        fontSize: 14,
                                        marginTop: spacing.small,
                                        }}
                                        tx="tranDetailScreen.pendingToken"
                                    />
                                    <Text
                                        text={getEncodedTokenToSend(transaction) as string}
                                        numberOfLines={1}
                                        ellipsizeMode="middle"
                                    />
                                </>
                            
                        </>
                    }
                    FooterComponent={
                        <>                            
                            <Button
                                preset="tertiary"
                                onPress={() => copyToken(transaction)}
                                tx='common.copy'
                                style={{
                                    minHeight: 25,
                                    paddingVertical: spacing.extraSmall,
                                    marginTop: spacing.small,
                                    alignSelf: 'center',
                                }}
                                textStyle={{fontSize: 14}}
                            />                            
                        </>
                    }
                />
                )}
                <Card
                    style={$dataCard}
                    ContentComponent={
                        <>
                            <Text
                                style={{color: labelColor, fontSize: 14}}
                                tx='tranDetailScreen.auditTrail'
                            />
                            <JSONTree
                                hideRoot
                                data={getAuditTrail(transaction)}
                                theme={{
                                scheme: 'default',
                                base00: '#eee',
                                }}
                                invertTheme={colorScheme === 'light' ? false : true}
                            />
                        </>
                    }
                    // footerStyle={{borderWidth: 10, borderColor: 'red'}}
                    FooterComponent={
                        <Button
                        preset="tertiary"
                        onPress={() => copyAuditTrail(transaction)}
                        tx='common.copy'
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
            </>
        )}
    </>
  )
}

const TopupInfoBlock = function (props: {
    transaction: Transaction
    isDataParsable: boolean
    copyAuditTrail: any
    colorScheme: 'dark' | 'light'
    navigation: any
}) {
  const {transaction, isDataParsable, copyAuditTrail, colorScheme, navigation} = props
  
  // retrieve pr from transaction as it might have been expired and removed from storage
  const paymentRequest = getPaymentRequestToRetry(transaction)
  const isInternetReachable = useIsInternetReachable()  
  
  const [isPendingTopupTaskSentToQueue, setIsPendingTopupTaskSentToQueue] = useState<boolean>(false)
  const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
  const [resultModalInfo, setResultModalInfo] = useState<
    {status: TransactionStatus; message: string} | undefined
  >()
  const [isLoading, setIsLoading] = useState(false)


    useEffect(() => {
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
    }, [isPendingTopupTaskSentToQueue])


    const toggleResultModal = () =>
        setIsResultModalVisible(previousState => !previousState)

    const copyInvoice = function () {
        try {
            Clipboard.setString(paymentRequest?.encodedInvoice as string)
        } catch (e: any) {
            return false
        }
    }

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
                    <TranItem
                        label="receiverMemo"
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
                    <TranItem label="tranDetailScreen.id" value={`${transaction.id}`} />            
                </>
            }
        />
        <Card
            style={$dataCard}
            ContentComponent={                        
                <>
                <TranItem
                    label="tranDetailScreen.topupTo"
                    value={transaction.mint as string}
                />
                {transaction.status === TransactionStatus.PENDING && paymentRequest && (
                    <>
                      <Text style={{ color: labelColor, marginTop: spacing.medium }} tx="tranDetailScreen.invoiceToPay" />
                      <View style={$qrCodeContainer}>
                          <QRCode size={270} value={paymentRequest.encodedInvoice} />
                      </View>
                    </>
                )}
                </>
            }
            FooterComponent={
                <>
                {transaction.status === TransactionStatus.PENDING && paymentRequest && (
                <Button
                    preset="tertiary"
                    onPress={() => copyInvoice()}
                    tx='common.copy'
                    style={{
                        minHeight: 25,
                        paddingVertical: spacing.extraSmall,
                        marginTop: spacing.small,
                        alignSelf: 'center',
                    }}
                    textStyle={{fontSize: 14}}
                />
                )}
                </>
            }
        />
        {isDataParsable && (
            <>
                <Card
                    style={$dataCard}
                    ContentComponent={
                        <>
                            <Text
                            style={{color: labelColor, fontSize: 14}}
                            tx="tranDetailScreen.auditTrail"
                            />
                            <JSONTree
                                hideRoot
                                data={getAuditTrail(transaction)}
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
                        onPress={() => copyAuditTrail(transaction)}
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
            </>
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
  copyAuditTrail: any
  colorScheme: 'dark' | 'light'
}) {
  const {transaction, isDataParsable, copyAuditTrail, colorScheme} = props

  const labelColor = useThemeColor('textDim')

  // log.trace(JSON.parse(transaction.data)[0])

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
              label="tranDetailScreen.lightningFee"
              value={`${transaction.fee}`}
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
              label="tranDetailScreen.status"
              value={transaction.status as string}
            />

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
            style={$dataCard}
            ContentComponent={
                <TranItem
                  label="transactionCommon.paidFrom"
                  value={transaction.mint as string}
                />
            }
        />
      {isDataParsable && (        
      <>
          <Card
            style={[$dataCard]}
            ContentComponent={
              <>
                <Text
                  style={{color: labelColor, fontSize: 14}}
                  tx="tranDetailScreen.auditTrail"
                />
                <JSONTree
                  hideRoot
                  data={getAuditTrail(transaction)}
                  theme={{
                    scheme: 'default',
                    base00: '#eee',
                  }}
                  invertTheme={colorScheme === 'light' ? false : true}
                />
              </>
            }
            // footerStyle={{borderWidth: 10, borderColor: 'red'}}
            FooterComponent={
              <Button
                preset="tertiary"
                onPress={() => copyAuditTrail(transaction)}
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
        </>
      )}
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
        
        if(error && error.params && error.params.message) {          

            if(error.params.message.includes('Network request failed') || error.params.message.includes('Bad Gateway')) {                    
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
    paddingBottom: spacing.medium,
    height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
    // flex: 1,
    padding: spacing.extraSmall,
}

const $tranAmount: TextStyle = {
    fontSize: moderateVerticalScale(48),
    lineHeight: moderateVerticalScale(48),
    marginTop: spacing.extraSmall,
    marginLeft: -30,
    color: 'white',
}

const $actionCard: ViewStyle = {
    marginBottom: spacing.extraSmall,
    marginTop: -spacing.extraLarge * 2,
    paddingVertical: 0,
}

const $dataCard: ViewStyle = {
    padding: spacing.medium,  
    marginBottom: spacing.extraSmall,
    paddingTop: spacing.extraSmall,
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
