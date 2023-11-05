import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
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
import {WalletStackScreenProps} from '../navigation'
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
import {Database, Wallet} from '../services'
import {BackupProof, Proof} from '../models/Proof'
import useColorScheme from '../theme/useThemeColor'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import QRCode from 'react-native-qrcode-svg'

type ProofsByStatus = {
  isSpent: Proof[]
  isPending: Proof[]
  isReceived: Proof[]
}

export const TranDetailScreen: FC<WalletStackScreenProps<'TranDetail'>> =
  observer(function TranDetailScreen(_props) {
    const {navigation, route} = _props
    const {transactionsStore, userSettingsStore} = useStores()
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })
    
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

    useEffect(() => {
      try {
        const {id} = route.params
        const tx = transactionsStore.findById(id)

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
    }, [])

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
        setInfo(`Could not copy: ${e.message}`)
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
            setInfo(`Could not copy: ${e.message}`)
        }
    }


    const copyBackupProofs = function (proofsByStatus: ProofsByStatus) {
        try {               
            Clipboard.setString(JSON.stringify(proofsByStatus))  
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
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



  const getFormattedAmount = function(amount: number): string {
      if (!transaction) {
        return ''
      }

      switch (transaction?.type) {
        case TransactionType.RECEIVE || TransactionType.RECEIVE_OFFLINE:
          return `+${transaction.amount.toLocaleString()}`
        case TransactionType.SEND:
          return `-${transaction.amount.toLocaleString()}`
        case TransactionType.TOPUP:
          return `+${transaction.amount.toLocaleString()}`
        case TransactionType.TRANSFER:
          return `-${transaction.amount.toLocaleString()}`
        default:
          return `${transaction?.amount.toLocaleString()}`
      }
    }

    const feeColor = colors.palette.primary200
    const colorScheme = useColorScheme()

  return (
      <Screen style={$screen} preset="auto">
        {transaction && (
          <>
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>
              {transaction && (
                <Text
                  preset="heading"
                  text={getFormattedAmount(transaction.amount)}
                  style={{color: 'white'}}
                />
              )}
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
                          : 'Add your note'
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
                      bottomSeparator={true}
                      onPress={toggleNoteModal}
                    />
                    <ListItem
                      text="Add tags"
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
                />
              )}
              {transaction.type === TransactionType.RECEIVE_OFFLINE && (
                <ReceiveOfflineInfoBlock
                  transaction={transaction}
                  isDataParsable={isDataParsable}
                  copyAuditTrail={copyAuditTrail}
                  colorScheme={colorScheme}
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
                        text="Backed up ecash"
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
                        text="Copy"
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
              <Text text="Add your note" preset="subheading" />
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <TextInput
                  ref={noteInputRef}
                  onChangeText={note => setNote(note)}
                  value={note}
                  style={[$noteInput, {backgroundColor: inputBg}]}
                  maxLength={200}
                />
                <Button
                  text="Save"
                  style={{
                    borderRadius: spacing.small,
                    marginRight: spacing.small,
                  }}
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
}) {
    const {transaction, isDataParsable, copyAuditTrail, colorScheme} = props
    const labelColor = useThemeColor('textDim')

    return (
    <>
        <Card
            style={$dataCard}
            ContentComponent={
                <>
                    <TranItem
                        label="tranDetailScreen.amount"
                        value={`${transaction.amount}`}
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
                        label="tranDetailScreen.status"
                        value={transaction.status as string}
                    />
                    {transaction.status === TransactionStatus.COMPLETED && (
                    <TranItem
                        label="tranDetailScreen.balanceAfter"
                        value={`${transaction.balanceAfter}`}
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
                    label="tranDetailScreen.receivedTo"
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
                                text="Audit trail"
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
    </>
    )
}


const ReceiveOfflineInfoBlock = function (props: {
    transaction: Transaction
    isDataParsable: boolean
    copyAuditTrail: any
    colorScheme: 'light' | 'dark'
}) {
    const {transaction, isDataParsable, copyAuditTrail, colorScheme} = props
    const labelColor = useThemeColor('textDim')
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
        
        const result = await Wallet.receiveOfflineComplete(transaction)            

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
            style={$dataCard}
            ContentComponent={
                <>
                    {transaction.status === TransactionStatus.PREPARED_OFFLINE ? (
                        <View
                        style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                        <TranItem
                            label="tranDetailScreen.amount"
                            value={`${transaction.amount}`}
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
                            value={`${transaction.amount}`}
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
                            value={`${transaction.balanceAfter}`}
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
                    label="tranDetailScreen.receivedTo"
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
                                text="Audit trail"
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
                    title="Success!"
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
                            value={`${transaction.amount}`}
                            isFirst={true}
                        />
                        <TranItem
                            label="tranDetailScreen.memoToReceiver"
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
                                style={{maxHeight: 10, marginTop: spacing.medium}}
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
                            value={`${transaction.balanceAfter}`}
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
                                        text="Pending token"
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
                                text="Copy"
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
                                text="Audit trail"
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
                        text="Copy"
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
}) {
  const {transaction, isDataParsable, copyAuditTrail, colorScheme} = props

  const {paymentRequestsStore} = useStores()
  const paymentRequest = paymentRequestsStore.findByTransactionId(transaction.id as number)

  const copyInvoice = function () {
    try {
      Clipboard.setString(paymentRequest?.encodedInvoice as string)
    } catch (e: any) {
      return false
    }
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
                        value={`${transaction.amount}`}
                        isFirst={true}
                    />
                    <TranItem
                        label="tranDetailScreen.memoToReceiver"
                        value={transaction.memo as string}
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
                            value={`${transaction.balanceAfter}`}
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
                        <Text style={{color: labelColor, marginTop: spacing.medium}} text='Invoice to pay'/>
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
                        text="Copy"
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
                            text="Audit trail"
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
                        text="Copy"
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
              value={`${transaction.amount}`}
              isFirst={true}
            />
            <TranItem
              label="tranDetailScreen.lightningFee"
              value={`${transaction.fee}`}
            />
            <TranItem
              label="tranDetailScreen.memoFromInvoice"
              value={transaction.memo as string}
            />
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
                value={`${transaction.balanceAfter}`}
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
                    label="tranDetailScreen.paidFrom"
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
                  text="Audit trail"
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
                text="Copy"
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

const TranItem = function (props: {
    label: TxKeyPath
    value: string
    labelStyle?: TextStyle
    valueStyle?: TextStyle 
    isFirst?: boolean
    isLast?: boolean
}) {

    const labelColor = useThemeColor('textDim')
    const margin = !props.isFirst ? {marginTop: spacing.small} : null
    return (
        <View>
            <Text
                style={[props.labelStyle, {color: labelColor, fontSize: 14}, margin]}
                tx={props.label}
            />
            <Text style={props.valueStyle || {}} text={props.value} />
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

const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.medium,
    height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
    padding: spacing.extraSmall,
}

const $actionCard: ViewStyle = {
    marginBottom: spacing.extraSmall,
    marginTop: -spacing.extraLarge * 2,
    paddingTop: 0,
}

const $dataCard: ViewStyle = {
    padding: spacing.medium,  
    marginBottom: spacing.extraSmall,
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
    borderRadius: spacing.small,
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
