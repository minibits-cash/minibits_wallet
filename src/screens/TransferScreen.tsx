import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState, useCallback} from 'react'
import {useFocusEffect} from '@react-navigation/native'
import {
  UIManager,
  Platform,
  TextStyle,
  View,
  ViewStyle,
  FlatList,
} from 'react-native'
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
import {Transaction, TransactionStatus} from '../models/Transaction'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {MintClient, Wallet} from '../services'
import {log} from '../utils/logger'
import AppError, {Err} from '../utils/AppError'
import {CashuUtils} from '../services/cashu/cashuUtils'
import {MintBalance} from '../models/Mint'
import {MintListItem} from './Mints/MintListItem'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import addSeconds from 'date-fns/addSeconds'
import { PaymentRequestStatus } from '../models/PaymentRequest'
import { infoMessage } from '../utils/utils'
import { DecodedLightningInvoice, LightningUtils } from '../services/lightning/lightningUtils'
import { SendOption } from './SendOptionsScreen'
import { LNURLPayParams } from 'js-lnurl'

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const TransferScreen: FC<WalletStackScreenProps<'Transfer'>> = observer(
  function TransferScreen({route, navigation}) {

  useHeader({
    leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {proofsStore, mintsStore, paymentRequestsStore} = useStores()

    const [encodedInvoice, setEncodedInvoice] = useState<string>('')
    const [invoice, setInvoice] = useState<DecodedLightningInvoice | undefined>()
    const [amountToTransfer, setAmountToTransfer] = useState<number>(0)
    const [invoiceExpiry, setInvoiceExpiry] = useState<Date | undefined>()
    const [paymentHash, setPaymentHash] = useState<string | undefined>()
    const [lnurlPayParams, setLnurlPayParams] = useState<LNURLPayParams | undefined>()
    const [estimatedFee, setEstimatedFee] = useState<number>(0)
    const [finalFee, setFinalFee] = useState<number>(0)
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<MintBalance[]>([])
    const [mintBalanceToTransferFrom, setMintBalanceToTransferFrom] = useState<MintBalance | undefined>()
    const [transactionStatus, setTransactionStatus] = useState<
      TransactionStatus | undefined
    >()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isPasteInvoiceModalVisible, setIsPasteInvoiceModalVisible] =
      useState(false)
    const [isInvoiceDonation, setIsInvoiceDonation] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus; message: string} | undefined>()


useFocusEffect(
    useCallback(() => {
    if (!route.params?.encodedInvoice) {            
        return
    }
    const encoded = route.params?.encodedInvoice
    onEncodedInvoice(encoded)
    }, [route.params?.encodedInvoice]),
)


useFocusEffect(
    useCallback(() => {
        const { paymentOption } = route.params

        const handlePaymentRequest = () => {
            try {
                const {paymentRequest} = route.params

                if (!paymentRequest) {                    
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing paymentRequest.')
                }

                log.trace('Payment request', paymentRequest, 'useFocusEffect')
        
                const {encodedInvoice, description, paymentHash} = paymentRequest       
        
                setPaymentHash(paymentHash)
                onEncodedInvoice(encodedInvoice, description)
            } catch (e: any) {
                handleError(e)
            }                
        }


        const handleLnurlPay = () => {
            try {
                const {lnurlParams, encodedInvoice} = route.params

                if (!lnurlParams || !encodedInvoice) {                    
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing LNURL params or invoice.')
                }

                log.trace('LNURL params.', lnurlParams, 'useFocusEffect')
        
                setLnurlPayParams(lnurlParams)             
                onEncodedInvoice(encodedInvoice)
            } catch (e: any) {
                handleError(e)
            }                
        }


        const handleDonation = () => {
            try {
                const {encodedInvoice} = route.params

                if (!encodedInvoice) {                    
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing donation invoice.')
                }
                
                setIsInvoiceDonation(true)
                onEncodedInvoice(encodedInvoice)
            } catch (e: any) {
                handleError(e)
            }                
        }

        if(paymentOption && paymentOption === SendOption.PAY_PAYMENT_REQUEST) {   
            handlePaymentRequest()
        }

        if(paymentOption && paymentOption === SendOption.LNURL_PAY) {   
            handleLnurlPay()
        }

        if(paymentOption && paymentOption === SendOption.DONATION) {   
            handleDonation()
        }

        
    }, [route.params?.paymentOption]),
)


useEffect(() => {
    const getEstimatedFee = async function () {
    try {
        log.trace('mintBalanceToTransferFrom', mintBalanceToTransferFrom, 'getEstimatedFee')  
        if (!mintBalanceToTransferFrom || !encodedInvoice) return
            // if (!encodedInvoice) return

            const fee = await MintClient.getLightningFee(
            mintBalanceToTransferFrom.mint,
            encodedInvoice,
        )
        
        if (amountToTransfer + fee > mintBalanceToTransferFrom.balance) {
            setInfo(
                'There is not enough funds to cover expected lightning network fee. Try to select another mint with higher balance.',
            )
        }

        setEstimatedFee(fee)
    } catch (e: any) {
        resetState()
        handleError(e)
    }
    }
    getEstimatedFee()
}, [mintBalanceToTransferFrom])



const resetState = function () {
    setEncodedInvoice('')
    setInvoice(undefined)      
    setAmountToTransfer(0)
    setInvoiceExpiry(undefined)
    setEstimatedFee(0)
    setMemo('')
    setAvailableMintBalances([])
    setMintBalanceToTransferFrom(undefined)
    setTransactionStatus(undefined)
    setInfo('')
    setError(undefined)
    setIsLoading(false)
    setIsPasteInvoiceModalVisible(false)
    setIsInvoiceDonation(false)
    setIsResultModalVisible(false)
    setResultModalInfo(undefined)
}

const onCancel = function () {
    resetState()
    navigation.navigate('Wallet', {})
}

const togglePasteInvoiceModal = () => setIsPasteInvoiceModalVisible(previousState => !previousState)
const toggleResultModal = () => setIsResultModalVisible(previousState => !previousState)

const onMintBalanceSelect = function (balance: MintBalance) {
    setMintBalanceToTransferFrom(balance) // this triggers effect to get estimated fees
}


const onEncodedInvoice = async function (encoded: string, paymentRequestDesc: string = '') {
    try {
        navigation.setParams({encodedInvoice: undefined})
        navigation.setParams({paymentRequest: undefined})
        navigation.setParams({lnurlParams: undefined})

        setEncodedInvoice(encoded)        

        const invoice = LightningUtils.decodeInvoice(encoded)
        const {amount, expiry, description, timestamp} = LightningUtils.getInvoiceData(invoice)

        log.trace('Decoded invoice', invoice)
        log.trace('Invoice data', {amount, expiry, description})

        if (!amount || amount === 0) {
            infoMessage('Invoice amount should be positive number')            
            return
        }        

        // all with enough balance
        let availableBalances = proofsStore.getMintBalancesWithEnoughBalance(amount)

        if (availableBalances.length === 0) {
            infoMessage('There is not enough funds to send this amount')
            return
        }

        const expiresAt = addSeconds(new Date(timestamp as number * 1000), expiry as number)

        setAvailableMintBalances(availableBalances)
        setMintBalanceToTransferFrom(availableBalances[0])
        setInvoice(invoice)
        setAmountToTransfer(amount)
        setInvoiceExpiry(expiresAt)
        
        if (paymentRequestDesc) {
            setMemo(paymentRequestDesc)
        } else if(description) {
            setMemo(description)
        }
            
    } catch (e: any) {
        resetState()
        handleError(e)
    }
}

const transfer = async function () {
    setIsLoading(true)

    try {   
        const {transaction, message, error, finalFee} = await Wallet.transfer(
            mintBalanceToTransferFrom as MintBalance,
            amountToTransfer,
            estimatedFee,
            invoiceExpiry as Date,
            memo,
            encodedInvoice,
        )

        log.info('Transfer result', {transaction, message, error, finalFee}, 'transfer')

        const {status} = transaction as Transaction
        setTransactionStatus(status)

        if (error) {
            setResultModalInfo({
                status,
                message: error.message,
            })
        } else {
            if(!isInvoiceDonation) {  // Donation polling triggers own ResultModal on paid invoice
                setResultModalInfo({
                    status,
                    message,
                })
            }
            
            // update related paymentRequest status if exists
            if(paymentHash) {
                const pr = paymentRequestsStore.findByPaymentHash(paymentHash)

                if(pr) {
                    pr.setStatus(PaymentRequestStatus.PAID)
                }
            }
        }

        if (finalFee) {
            setFinalFee(finalFee)
        }

        setIsLoading(false)
        
        if(!isInvoiceDonation || error) {
            toggleResultModal()
        }
    }catch (e: any) {
        // Handle errors before transaction is created
        resetState()
        handleError(e)
    }


}
    

const onCompletedTransfer = function(): void {
    resetState()
    navigation.navigate('Wallet', {})        
}


const handleError = function(e: AppError): void {
    setIsLoading(false)
    setError(e)
}

const headerBg = useThemeColor('header')
const feeColor = colors.palette.primary200
const iconColor = useThemeColor('textDim')

    return (
        <Screen preset="fixed" contentContainerStyle={$screen}>
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>
                {invoice && amountToTransfer > 0 ? (
                    <View style={$amountContainer}>
                        <Text
                            preset="subheading"
                            text="Amount to transfer"
                            style={{color: 'white'}}
                        />
                        {/*<Text 
                            text='Satoshi'
                            size='xxs' 
                            style={{color: feeColor}}
                        />*/}
                        <Text
                            style={$amountToTransfer}
                            text={amountToTransfer.toLocaleString()}
                        />
                        {transactionStatus === TransactionStatus.COMPLETED ? (
                            <Text
                                style={{color: feeColor}}
                                text={`+ final fee ${finalFee.toLocaleString()} sats`}
                            />
                        ) : (
                            <Text
                                style={{color: feeColor}}
                                text={`+ estimated fee ${estimatedFee.toLocaleString()} sats`}
                            />
                        )}
                    </View>
                ) : (
                    <Text preset="heading" text="Transfer" style={{color: 'white'}} />
                )}
            </View>
            <View style={$contentContainer}>
                {mintBalanceToTransferFrom &&
                availableMintBalances.length > 0 &&
                transactionStatus !== TransactionStatus.COMPLETED && (
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
                    <MintBalanceSelector
                        availableMintBalances={availableMintBalances}
                        mintBalanceToSendFrom={mintBalanceToTransferFrom as MintBalance}
                        onMintBalanceSelect={onMintBalanceSelect}
                        onCancel={onCancel}
                        findByUrl={mintsStore.findByUrl}
                        onMintBalanceConfirm={transfer}
                    />
                    {lnurlPayParams && (
                        <Text size='xs' text={`This payment has been requested by ${lnurlPayParams.domain}.`}/>
                    )}
                </>
                )}
                {transactionStatus === TransactionStatus.COMPLETED && (
                <>
                    <Card
                        style={$card}
                        ContentComponent={
                        <MintListItem
                            mint={
                            mintsStore.findByUrl(
                                mintBalanceToTransferFrom?.mint as string,
                            ) as Mint
                            }
                            isSelectable={false}
                            mintBalance={proofsStore
                            .getBalances()
                            .mintBalances.find(
                                balance =>
                                balance.mint === mintBalanceToTransferFrom?.mint,
                            )}
                            separator={undefined}
                        />
                        }
                    />
                    <View style={$buttonContainer}>
                        <Button
                            preset="secondary"
                            tx={'common.close'}
                            onPress={onCompletedTransfer}
                        />
                    </View>
                </>
                )}
                {isLoading && <Loading />}
            </View>
            <BottomModal
                isVisible={isResultModalVisible ? true : false}
                top={spacing.screenHeight * 0.5}                
                ContentComponent={
                    <>
                        {resultModalInfo &&
                            transactionStatus === TransactionStatus.COMPLETED && (
                            <>
                                <ResultModalInfo
                                    icon="faCheckCircle"
                                    iconColor={colors.palette.success200}
                                    title="Transfer completed"
                                    message={resultModalInfo?.message}
                                />
                                <View style={$buttonContainer}>
                                <Button
                                    preset="secondary"
                                    tx={'common.close'}
                                    onPress={() => {
                                        if(isInvoiceDonation) {
                                            navigation.navigate('ContactsNavigator', {screen: 'Contacts', params: {}})
                                        } else {
                                            navigation.navigate('Wallet', {})}
                                        }
                                    }
                                />
                                </View>
                            </>
                        )}
                        {resultModalInfo && transactionStatus === TransactionStatus.REVERTED && (
                            <>
                                <ResultModalInfo
                                    icon="faRotate"
                                    iconColor={colors.palette.accent300}
                                    title="Transfer reverted"
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
                        {resultModalInfo &&
                            transactionStatus === TransactionStatus.ERROR && (
                            <>
                                <ResultModalInfo
                                icon="faTriangleExclamation"
                                iconColor={colors.palette.angry500}
                                title="Transfer failed"
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

    const onMintSelect = function(balance: MintBalance) {
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
            <FlatList<MintBalance>
                data={props.availableMintBalances}
                renderItem={({ item, index }) => {                                
                    return(
                        <MintListItem
                            key={item.mint}
                            mint={props.findByUrl(item.mint) as Mint}
                            mintBalance={item}
                            onMintSelect={() => onMintSelect(item)}
                            isSelectable={true}
                            isSelected={props.mintBalanceToSendFrom.mint === item.mint}
                            separator={'top'}
                        />
                    )
                }}                
                keyExtractor={(item) => item.mint} 
                style={{ flexGrow: 0, maxHeight: spacing.screenHeight * 0.35 }}
            />
          </>
        }
      />
      <View style={[$buttonContainer, {marginTop: spacing.large}]}>
        <Button
          text="Transfer now"
          onPress={props.onMintBalanceConfirm}
          style={{marginRight: spacing.medium}}          
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

const $screen: ViewStyle = {
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  paddingTop: 0,
  height: spacing.screenHeight * 0.18,
}

const $amountContainer: ViewStyle = {
  alignItems: 'center',
  justifyContent: 'center',
}

const $amountToTransfer: TextStyle = {
  flex: 1,
  paddingTop: spacing.extraLarge + 10,
  fontSize: 52,
  fontWeight: '400',
  textAlignVertical: 'center',
  color: 'white',
}

const $contentContainer: TextStyle = {
  padding: spacing.extraSmall,
}

const $optionsCard: ViewStyle = {
  marginTop: -spacing.extraLarge * 2,
  marginBottom: spacing.small,
  paddingTop: 0,
}

const $iconContainer: ViewStyle = {
    padding: spacing.extraSmall,
    alignSelf: 'center',
    marginRight: spacing.medium,
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
  paddingHorizontal: spacing.small,
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

