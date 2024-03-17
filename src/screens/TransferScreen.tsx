import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState, useCallback, useRef} from 'react'
import {useFocusEffect} from '@react-navigation/native'
import {
  UIManager,
  Platform,
  TextStyle,
  View,
  ViewStyle,
  FlatList,
  TextInput,
} from 'react-native'
import QuickCrypto from 'react-native-quick-crypto'
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
import {Transaction, TransactionStatus} from '../models/Transaction'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {MintClient, Wallet} from '../services'
import {log} from '../services/logService'
import AppError, {Err} from '../utils/AppError'
import {MintBalance} from '../models/Mint'
import {MintListItem} from './Mints/MintListItem'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import addSeconds from 'date-fns/addSeconds'
import { PaymentRequestStatus } from '../models/PaymentRequest'
import { infoMessage } from '../utils/utils'
import { DecodedLightningInvoice, LightningUtils } from '../services/lightning/lightningUtils'
import { SendOption } from './SendOptionsScreen'
import { roundDown, roundUp } from '../utils/number'
import { LnurlClient, LNURLPayParams } from '../services/lnurlService'
import { moderateScale, moderateVerticalScale, scale, verticalScale } from '@gocodingnow/rn-size-matters'
import { CurrencyCode, CurrencySign } from './Wallet/CurrencySign'
import { FeeBadge } from './Wallet/FeeBadge'
import { isObj } from '@cashu/cashu-ts/src/utils'

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

    const amountInputRef = useRef<TextInput>(null)
    const {proofsStore, mintsStore, paymentRequestsStore, transactionsStore} = useStores()

    const [encodedInvoice, setEncodedInvoice] = useState<string>('')
    const [invoice, setInvoice] = useState<DecodedLightningInvoice | undefined>()
    const [amountToTransfer, setAmountToTransfer] = useState<string>('0')
    const [invoiceExpiry, setInvoiceExpiry] = useState<Date | undefined>()
    const [paymentHash, setPaymentHash] = useState<string | undefined>()
    const [lnurlPayParams, setLnurlPayParams] = useState<LNURLPayParams & {address?: string} | undefined>()
    const [isWaitingForFees, setIsWaitingForFees] = useState<boolean>(false)
    const [estimatedFee, setEstimatedFee] = useState<number>(0)
    const [finalFee, setFinalFee] = useState<number>(0)
    const [memo, setMemo] = useState('')
    const [lnurlDescription, setLnurlDescription] = useState('')
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
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus; title?: string, message: string} | undefined>()


useEffect(() => {
    const focus = () => {
        if(route.params?.paymentOption === SendOption.LNURL_PAY) {
            amountInputRef && amountInputRef.current
            ? amountInputRef.current.focus()
            : false
        }
    }
    
    const timer = setTimeout(() => focus(), 100)   
    
    return () => {
        clearTimeout(timer)
    }
}, [])


useFocusEffect(
    useCallback(() => {
        const { paymentOption } = route.params

        const handleInvoice = () => {
            try {
                const {encodedInvoice} = route.params

                if (!encodedInvoice) {                    
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing invoice.')
                }

                log.trace('Invoice', encodedInvoice, 'useFocusEffect')        
                
                onEncodedInvoice(encodedInvoice)
            } catch (e: any) {
                handleError(e)
            }                
        }

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
                const {lnurlParams} = route.params

                if (!lnurlParams) {                    
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing LNURL params.')
                }

                const metadata = lnurlParams.decodedMetadata

                if(metadata) {
                    let desc: string = ''
                    let address: string = ''

                    for (const entry of metadata) {
                        if (entry[0] === "text/plain") {
                            desc = entry[1];
                            break // Exit the loop once we find the "text/plain" entry
                        }
                    }

                    for (const entry of metadata) {
                        if (entry[0] === "text/identifier" || entry[0] === "text/email") {
                            address = entry[1];
                            break
                        }
                    }

                    if(desc) {
                        setLnurlDescription(desc)
                    }

                    if(address) {
                        // overwrite sender address set by wallet with the address from the lnurl response
                        lnurlParams.address = address
                    }
                }                

                const amountSats = roundUp(lnurlParams.minSendable / 1000, 0)

                setAmountToTransfer(`${amountSats}`)        
                setLnurlPayParams(lnurlParams)                
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

        if(paymentOption && paymentOption === SendOption.PASTE_OR_SCAN_INVOICE) {   
            handleInvoice()
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
            log.trace('[getEstimatedFee]', 'mintBalanceToTransferFrom', mintBalanceToTransferFrom)  
            if (!mintBalanceToTransferFrom || !encodedInvoice) {
                return
            }            
            setIsLoading(true)
            const fee = await MintClient.getLightningFee(
                mintBalanceToTransferFrom.mint,
                encodedInvoice,
            )
            setIsLoading(false)
            
            if (parseInt(amountToTransfer) + fee > mintBalanceToTransferFrom.balance) {
                setInfo(
                    'There are not enough funds to cover expected lightning network fee. Try selecting another mint with a higher balance.',
                )
            }

            setEstimatedFee(fee)
        } catch (e: any) {            
            handleError(e)
        }
    }
    getEstimatedFee()
}, [mintBalanceToTransferFrom])



const resetState = function () {
    setEncodedInvoice('')
    setInvoice(undefined)      
    setAmountToTransfer('')
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

const togglePasteInvoiceModal = () => setIsPasteInvoiceModalVisible(previousState => !previousState)
const toggleResultModal = () => setIsResultModalVisible(previousState => !previousState)

const onMintBalanceSelect = function (balance: MintBalance) {
    setMintBalanceToTransferFrom(balance) // this triggers effect to get estimated fees
}

// Amount is editable only in case of LNURL Pay, while invoice is not yet retrieved
const onAmountEndEditing = async function () {
    try {
        const amount = parseInt(amountToTransfer)

        if (!amount || amount === 0) {
            infoMessage('Amount should be positive number.')          
            return
        }

        if(!lnurlPayParams) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing LNURL pay parameters', {caller: 'onAmountEndEditing'})
        }

        if (lnurlPayParams.minSendable && amount < lnurlPayParams.minSendable / 1000 ) {
            infoMessage(`Minimal amount to pay is ${lnurlPayParams.minSendable / 1000} SATS.`)          
            return
        }

        if (lnurlPayParams.maxSendable && amount > lnurlPayParams.maxSendable / 1000 ) {
            infoMessage(`Maximal amount to pay is ${lnurlPayParams.maxSendable / 1000} SATS.`)          
            return
        }

        if (lnurlPayParams.payerData) {
            infoMessage(`Minibits does not yet support entering of payer identity data (LUD18).`)   
        }

        setIsLoading(true)
        const encoded = await LnurlClient.getInvoice(lnurlPayParams, amount * 1000)
        setIsLoading(false)

        if(encoded) {
            return onEncodedInvoice(encoded)
        }        

        throw new AppError(Err.NOTFOUND_ERROR, `Could not get lightning invoice from ${lnurlPayParams.domain}`)

    } catch (e: any) {
      handleError(e)
    }
  }


const onEncodedInvoice = async function (encoded: string, paymentRequestDesc: string = '') {
    try {
        navigation.setParams({encodedInvoice: undefined})
        navigation.setParams({paymentRequest: undefined})
        navigation.setParams({lnurlParams: undefined})
        navigation.setParams({paymentOption: undefined})

        setEncodedInvoice(encoded)        

        const invoice = LightningUtils.decodeInvoice(encoded)
        const {amount, expiry, description, timestamp} = LightningUtils.getInvoiceData(invoice)

        // log.trace('Decoded invoice', invoice, 'onEncodedInvoice')
        log.trace('Invoice data', {amount, expiry, description}, 'onEncodedInvoice')

        if (!amount || amount === 0) {
            infoMessage('Invoice amount should be positive number')            
            return
        }        

        // all with enough balance
        let availableBalances = proofsStore.getMintBalancesWithEnoughBalance(amount)

        if (availableBalances.length === 0) {
            infoMessage('There are not enough funds to send this amount')
            return
        }

        const expiresAt = addSeconds(new Date(timestamp as number * 1000), expiry as number)

        setAvailableMintBalances(availableBalances)
        setMintBalanceToTransferFrom(availableBalances[0])
        setInvoice(invoice)
        setAmountToTransfer(`${amount}`)
        setInvoiceExpiry(expiresAt)
        
        if (paymentRequestDesc) {
            setMemo(paymentRequestDesc)
        } else if(description) {
            setMemo(description)
        }
            
    } catch (e: any) {
        resetState()
        handleError(e)
        navigation.popToTop()
    }
}

const transfer = async function () {
    setIsLoading(true)

    try {   
        const {transaction, message, error, finalFee} = await Wallet.transfer(
            mintBalanceToTransferFrom as MintBalance,
            parseInt(amountToTransfer),
            estimatedFee,
            invoiceExpiry as Date,
            memo,
            encodedInvoice,
        )

        log.trace('[transfer]', 'Transfer result', {transaction, message, error, finalFee})

        const {status} = transaction as Transaction
        setTransactionStatus(status)

        if(transaction && lnurlPayParams && lnurlPayParams.address) {
            await transactionsStore.updateSentTo( // set ln address to send to to the tx, could be elsewhere //
                transaction.id as number,                    
                lnurlPayParams.address as string
            )
        }

        if (error) { // This handles timed out pending payments           

            if(status === TransactionStatus.PENDING) {
                setResultModalInfo({
                    status,                    
                    message,
                })
            } else {
                setResultModalInfo({
                    status,
                    title: error.params?.message ? error.message : 'Payment failed',
                    message: error.params?.message || error.message,
                })
            }
            

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
    

const onClose = function () {
    resetState()
    navigation.popToTop()
}


const handleError = function(e: AppError): void {
    setIsLoading(false)
    setError(e)
}

const headerBg = useThemeColor('header')
const feeColor = colors.palette.primary200
const iconColor = useThemeColor('textDim')
const satsColor = colors.palette.primary200

    return (
        <Screen preset="fixed" contentContainerStyle={$screen}>
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>
                <View style={$amountContainer}>
                    <CurrencySign 
                        currencyCode={CurrencyCode.SATS}
                        textStyle={{color: 'white'}}                        
                    />
                    <TextInput
                        ref={amountInputRef}
                        onChangeText={amount => setAmountToTransfer(amount)}                                
                        onEndEditing={onAmountEndEditing}
                        value={amountToTransfer}
                        style={$amountInput}
                        maxLength={9}
                        keyboardType="numeric"
                        selectTextOnFocus={true}
                        editable={
                            encodedInvoice ? false : true
                        }
                    />

                    {encodedInvoice && (estimatedFee || finalFee) ? (
                        <FeeBadge
                            currencyCode={CurrencyCode.SATS}
                            estimatedFee={estimatedFee}
                            finalFee={finalFee}              
                        />    
                    ) : (
                        <Text
                            size='sm'
                            text={'Amount to pay'}
                            style={{color: 'white', textAlign: 'center'}}
                        />
                    )}
                </View>
            </View>
            <View style={$contentContainer}>
                <>                    
                    <Card
                        style={[$card, {minHeight: 0}]}
                        ContentComponent={
                            <ListItem
                                text={lnurlPayParams?.address || memo || lnurlPayParams?.domain || 'Payment info'}
                                subText={lnurlDescription}
                                LeftComponent={
                                    <Icon
                                        containerStyle={$iconContainer}
                                        icon="faInfoCircle"
                                        size={spacing.medium}
                                        color={iconColor}
                                    />
                                }
                                style={$item}
                            />
                        }
                    />
                    {mintBalanceToTransferFrom &&
                    availableMintBalances.length > 0 &&
                    transactionStatus !== TransactionStatus.COMPLETED && (
                    <MintBalanceSelector
                        availableMintBalances={availableMintBalances}
                        mintBalanceToSendFrom={mintBalanceToTransferFrom as MintBalance}                        
                        onMintBalanceSelect={onMintBalanceSelect}
                        onCancel={onClose}
                        findByUrl={mintsStore.findByUrl}
                        onMintBalanceConfirm={transfer}
                    />
                    )}
                </>                
                {transactionStatus === TransactionStatus.COMPLETED && (
                    <Card
                        style={$card}
                        heading={'Transferred from'}
                        headingStyle={{textAlign: 'center', padding: spacing.small}}
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
                            separator={'top'}
                        />
                        }
                    />
                )}
                {transactionStatus === TransactionStatus.COMPLETED && (
                    <View style={$bottomContainer}>
                        <View style={$buttonContainer}>
                            <Button
                                preset="secondary"
                                tx={'common.close'}
                                onPress={onClose}
                            />
                        </View>
                    </View>
                )}
                {isLoading && <Loading />}
            </View>
            <BottomModal
                isVisible={isResultModalVisible}
                ContentComponent={
                    <>
                        {resultModalInfo &&
                            transactionStatus === TransactionStatus.COMPLETED && (
                            <>
                                <ResultModalInfo
                                    icon="faCheckCircle"
                                    iconColor={colors.palette.success200}
                                    title="Payment completed"
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
                                            navigation.navigate('Wallet', {})
                                        }
                                    }}
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
                                    title={resultModalInfo?.title || 'Payment failed'}
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
                            transactionStatus === TransactionStatus.PENDING && (
                            <>
                                <ResultModalInfo
                                    icon="faTriangleExclamation"
                                    iconColor={colors.palette.iconYellow300}
                                    title="Payment is pending"
                                    message={resultModalInfo?.message}
                                />
                                <View style={$buttonContainer}>
                                <Button
                                    preset="secondary"
                                    tx={'common.close'}
                                    onPress={() => {
                                        navigation.navigate('Wallet', {})
                                    }}
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
    <View style={{flex: 1}}>
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
      <View style={$bottomContainer}>
        <View style={[$buttonContainer, {marginTop: spacing.large}]}>
            <Button
            text={'Pay now'}
            onPress={props.onMintBalanceConfirm}
            style={{marginRight: spacing.medium}}          
            />
            <Button
            preset="secondary"
            tx={'common.cancel'}
            onPress={props.onCancel}
            />
        </View>
      </View>
    </View>
  )
})

const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.extraSmall,
    paddingTop: 0,
    height: spacing.screenHeight * 0.18,  
  }
  
  const $amountContainer: ViewStyle = {
  }
  
  const $amountInput: TextStyle = {    
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
