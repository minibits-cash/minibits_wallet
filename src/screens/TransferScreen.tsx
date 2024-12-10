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
  Keyboard,
} from 'react-native'
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
import {Transaction, TransactionStatus} from '../models/Transaction'
import {useStores} from '../models'
import {TransactionTaskResult, WalletTask} from '../services'
import EventEmitter from '../utils/eventEmitter'
import {log} from '../services/logService'
import AppError, {Err} from '../utils/AppError'
import {MintBalance} from '../models/Mint'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {addSeconds} from 'date-fns'
import { PaymentRequestStatus } from '../models/PaymentRequest'
import { DecodedLightningInvoice, LightningUtils } from '../services/lightning/lightningUtils'
import { SendOption } from './SendScreen'
import { round, roundDown, roundUp, toNumber } from '../utils/number'
import { LnurlClient, LNURLPayParams } from '../services/lnurlService'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { CurrencyCode, MintUnit, convertToFromSats, getCurrency } from "../services/wallet/currency"
import { FeeBadge } from './Wallet/FeeBadge'
import { MeltQuoteResponse } from '@cashu/cashu-ts'
import { MintHeader } from './Mints/MintHeader'
import { MintBalanceSelector } from './Mints/MintBalanceSelector'
import numbro from 'numbro'
import { TranItem } from './TranDetailScreen'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { translate } from '../i18n'
import { MemoInputCard } from '../components/MemoInputCard'


if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const TransferScreen: FC<WalletStackScreenProps<'Transfer'>> = observer(
  function TransferScreen({route, navigation}) {

    const amountInputRef = useRef<TextInput>(null)
    const lnurlCommentInputRef = useRef<TextInput>(null)

    const {proofsStore, mintsStore, paymentRequestsStore, walletStore} = useStores()
    // const {walletStore} = nonPersistedStores

    const isInternetReachable = useIsInternetReachable()

    const [encodedInvoice, setEncodedInvoice] = useState<string>('')
    const [invoice, setInvoice] = useState<DecodedLightningInvoice | undefined>()
    const [amountToTransfer, setAmountToTransfer] = useState<string>('0')
    const [unit, setUnit] = useState<MintUnit>('sat')
    const [invoiceExpiry, setInvoiceExpiry] = useState<Date | undefined>()
    const [paymentHash, setPaymentHash] = useState<string | undefined>()
    const [lnurlPayParams, setLnurlPayParams] = useState<LNURLPayParams & {address?: string} | undefined>()
    const [meltQuote, setMeltQuote] = useState<MeltQuoteResponse | undefined>()
    const [finalFee, setFinalFee] = useState<number>(0)
    const [memo, setMemo] = useState('')
    const [lnurlDescription, setLnurlDescription] = useState('')
    const [lnurlPayCommentAllowed, setLnurlPayCommentAllowed] = useState(0)
    const [lnurlPayComment, setLnurlPayComment] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<MintBalance[]>([])
    const [mintBalanceToTransferFrom, setMintBalanceToTransferFrom] = useState<MintBalance | undefined>()
    const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
    const [transaction, setTransaction] = useState<Transaction | undefined>()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isNotEnoughFunds, setIsNotEnoughFunds] = useState(false)    
    const [isInvoiceDonation, setIsInvoiceDonation] = useState(false)    
    const [isTransferTaskSentToQueue, setIsTransferTaskSentToQueue] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus; title?: string, message: string} | undefined>()


  useEffect(() => {
    const focus = () => {
      if (route.params?.paymentOption === SendOption.LNURL_PAY) {
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

// TODO: fix indentation in this component

useEffect(() => {
    const setUnitAndMint = () => {
        try {
            const {unit, mintUrl} = route.params
            if(!unit) {
                throw new AppError(Err.VALIDATION_ERROR, translate('missingMintUnitRouteParamsError'))
            }

            setUnit(unit)

            if(mintUrl) {
                const mintBalance = proofsStore.getMintBalance(mintUrl)    
                setMintBalanceToTransferFrom(mintBalance)
            }
        } catch (e: any) {
            handleError(e)
        }
    }
    
    setUnitAndMint()
    return () => {}
}, [])


useFocusEffect(
    useCallback(() => {
        const {paymentOption} = route.params
        log.trace('[useFocusEffect]', {paymentOption})

        const handleInvoice = () => {
            try {
                const {encodedInvoice} = route.params

                if (!encodedInvoice) {                    
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing invoice.')
                }

                log.trace('[handleInvoice] Invoice', {encodedInvoice})        
                
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

                log.trace('[handlePaymentRequest] Payment request', {paymentRequest})
        
                const {encodedInvoice, description, paymentHash} = paymentRequest       
        
                setPaymentHash(paymentHash)
                onEncodedInvoice(encodedInvoice, description)
            } catch (e: any) {
                handleError(e)
            }                
        }

        const handleLnurlPay = async () => {
            try {
                const {lnurlParams, unit} = route.params

                log.trace('[handleLnurlPay] start', {unit})

                if (!lnurlParams) {                    
                    throw new AppError(Err.VALIDATION_ERROR, translate('missingLNURLParamsError'))
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
                    if ('commentAllowed' in lnurlParams && lnurlParams.commentAllowed > 0) {
                      setLnurlPayCommentAllowed(lnurlParams.commentAllowed)
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
                
                // Set minSendable into amountToTransfer in unit currency
                if (unit !== 'sat') {
                  const rate = await walletStore.getExchangeRate(getCurrency(unit).code)
                  const amountUnit = convertToFromSats(amountSats, CurrencyCode.SAT, rate)

                  log.trace('[handleLnurlPay] minSendable conversion from SAT', {amountSats, rate, amountUnit})

                  setAmountToTransfer(`${numbro(amountUnit / getCurrency(unit).precision)
                    .format({
                      thousandSeparated: true, 
                      mantissa: getCurrency(unit).mantissa
                    })}`
                  )

                } else {
                  setAmountToTransfer(`${numbro(amountSats)
                    .format({
                      thousandSeparated: true, 
                      mantissa: 0
                    })}`
                  )        
                }

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

                if(unit !== 'sat') {
                    throw new AppError(Err.VALIDATION_ERROR, `Donations can currently be paid only with ${CurrencyCode.SAT} balances.`)
                }

                log.trace('[handleDonation]', {encodedInvoice})
                
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
    const createMeltQuote = async function () {
        try {
            log.trace('[createMeltQuote]', {mintBalanceToTransferFrom})  
            if (!mintBalanceToTransferFrom || !encodedInvoice) {
                log.trace(
                  '[createMeltQuote]',
                  'Not yet ready to request melt quote or melt quote already exists... exiting',
                  {mintBalanceToTransferFrom,                  
                  encodedInvoice}
                )  
                return
            }           
            
            setIsLoading(true)
            const quote = await walletStore.createLightningMeltQuote(
                mintBalanceToTransferFrom.mintUrl,
                unit,
                encodedInvoice,
            )
            
            setIsLoading(false)
            setMeltQuote(quote)
            setAmountToTransfer(`${numbro(quote.amount / getCurrency(unit).precision)
              .format({
                thousandSeparated: true, 
                mantissa: getCurrency(unit).mantissa
              })}`
            )
    
            const totalAmount = quote.amount + quote.fee_reserve
    
            let availableBalances = proofsStore.getMintBalancesWithEnoughBalance(totalAmount, unit)
    
            if (availableBalances.length === 0) {
                setInfo(translate("transferScreen.insufficientFunds", {
                  currency: getCurrency(unit).code,
                  amount: amountToTransfer
                }))
                setIsNotEnoughFunds(true)
                return
            }
            
            setAvailableMintBalances(availableBalances)
            
        } catch (e: any) { 
            handleError(e)
        }
    }

    createMeltQuote()

}, [mintBalanceToTransferFrom])


useEffect(() => {
    const handleTransferTaskResult = async (result: TransactionTaskResult) => {
        log.trace('handleTransferTaskResult event handler triggered', {isInvoiceDonation})

        /* if(result.meltQuote && meltQuote && result.meltQuote.quote !== meltQuote.quote) {
          log.error('[handleTransferTaskResult] Event belongs to a different meltquote, skipping...')
          return
        } */
        
        setIsLoading(false)
        const {transaction, message, error, finalFee} = result        

        // handle errors before transaction is created
        if (!transaction && error) {    
            setTransactionStatus(TransactionStatus.ERROR)
            setResultModalInfo({
                status: TransactionStatus.ERROR,                    
                message: error.message,
            })
    
            setIsLoading(false)
            toggleResultModal()
            return
        }
        
        const { status } = transaction as Transaction
        setTransactionStatus(status)
        setTransaction(transaction)
    
        if(transaction && lnurlPayParams && lnurlPayParams.address) {
            transaction.setSentTo(                                 
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
                    title: error.params?.message ? error.message : translate('payCommon.failed'),
                    message: error.params?.message || error.message,
                })
            }        
    
        } else {
            if(!isInvoiceDonation) {  // Donation has own polling to avoid paying with test ecash and triggers own ResultModal on paid invoice
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
        
        if(!isInvoiceDonation || error) {
            toggleResultModal()
        }
    }

    // Subscribe to the task result event
    if(isTransferTaskSentToQueue) {
      EventEmitter.on('ev_transferTask_result', handleTransferTaskResult)        
    }    

    // Unsubscribe from the task result event on component unmount
    return () => {
        EventEmitter.off('ev_transferTask_result', handleTransferTaskResult)        
    }
}, [isTransferTaskSentToQueue])



const resetState = function () {
    setEncodedInvoice('')
    setInvoice(undefined)      
    setAmountToTransfer('')
    setInvoiceExpiry(undefined)
    setMeltQuote(undefined)
    setMemo('')
    setAvailableMintBalances([])
    setMintBalanceToTransferFrom(undefined)    
    setTransactionStatus(undefined)
    setInfo('')
    setError(undefined)
    setIsLoading(false)    
    setIsInvoiceDonation(false)
    setIsTransferTaskSentToQueue(false)
    setIsResultModalVisible(false)
    setResultModalInfo(undefined)
    setLnurlPayCommentAllowed(0)
    setLnurlPayComment('')
}

const toggleResultModal = () => setIsResultModalVisible(previousState => !previousState)

const onMintBalanceSelect = function (balance: MintBalance) {
    setMintBalanceToTransferFrom(balance) // this triggers effect to get melt quote
}

const onAmountEndEditing = function () {

  setAmountToTransfer(
    `${numbro(amountToTransfer).format({
      thousandSeparated: true,
      mantissa: getCurrency(unit).mantissa
    })}`
  )
}

// Amount is editable only in case of LNURL Pay, while invoice is not yet retrieved
const onRequestLnurlInvoice = async function () {
  log.trace('[onRequestLnurlInvoice] start', {amountToTransfer, unit})
  try {
    const {precision, code: currencyCode} = getCurrency(unit)
       
    const amountUnit = round(toNumber(amountToTransfer) * precision, 0)

    if (!amountUnit || amountUnit === 0) {
      setInfo(translate('payCommon.amountZeroOrNegative'))          
      return
    }

    if(!lnurlPayParams) {
      throw new AppError(Err.VALIDATION_ERROR, 'Missing LNURL pay parameters', {caller: 'onRequestLnurlInvoice'})
    }

    let amountSats = 0

    if(unit !== 'sat') {
      const rate = await walletStore.getExchangeRate(currencyCode)
      amountSats = roundUp(convertToFromSats(amountUnit, currencyCode, rate), 0)

      log.trace('[onRequestLnurlInvoice] converted amountToTransfer to SAT', {amountUnit, amountSats})
    } else {
      amountSats = amountUnit
    }   

    if (lnurlPayParams.minSendable && amountSats < lnurlPayParams.minSendable / 1000) {
      setInfo(translate('payCommon.minimumWithdraw', { 
        amount: roundUp(lnurlPayParams.minSendable / 1000, 0), 
        currency: CurrencyCode.SAT 
      }))        
      return;
    }

    if (lnurlPayParams.maxSendable && amountSats > lnurlPayParams.maxSendable / 1000) {       
      setInfo(translate("payCommon.maximumPay", { 
        amount: roundDown(lnurlPayParams.maxSendable / 1000, 0),
        currency: CurrencyCode.SAT
      }))          
      return;
    }

    if (lnurlPayParams.payerData) {
      setInfo(translate("transferScreen.LUD18unsupported"))
    }

    setIsLoading(true)

    const encoded = await LnurlClient.getInvoice(
      lnurlPayParams, 
      amountSats * 1000, 
      lnurlPayCommentAllowed > 0 ? lnurlPayComment : void 0
    )

    setIsLoading(false)

    if (encoded) return onEncodedInvoice(encoded)

    throw new AppError(Err.NOTFOUND_ERROR, `Could not get lightning invoice from ${lnurlPayParams.domain}`)
  } catch (e: any) { handleError(e) }
}

const ensureCommentNotTooLong = async function () {
  Keyboard.dismiss()
  if (!lnurlPayCommentAllowed  || lnurlPayComment.trim().length === 0) return;
  if (lnurlPayComment.trim().length > lnurlPayCommentAllowed) {
    setLnurlPayComment(lnurlPayComment.slice(0, lnurlPayCommentAllowed));
  }
}


const onEncodedInvoice = async function (encoded: string, paymentRequestDesc: string = '') {
    // Need to retrieve from params as they might not be set in state yet
    // TODO fix this so that we kick this off only when state is set
    const { mintUrl, unit } = route.params
    log.trace("[onEncodedInvoice] start", {mintUrl, unit})
    
    try {
        navigation.setParams({encodedInvoice: undefined})
        navigation.setParams({paymentRequest: undefined})
        navigation.setParams({lnurlParams: undefined})
        navigation.setParams({paymentOption: undefined})             

        const invoice = LightningUtils.decodeInvoice(encoded)
        const {amount, expiry, description, timestamp} = LightningUtils.getInvoiceData(invoice)
        const expiresAt = addSeconds(new Date(timestamp as number * 1000), expiry as number)

        if (!amount || amount === 0) {
          setInfo(translate('payCommon.amountZeroOrNegative'))            
          return;
        }

        if(!isInternetReachable) setInfo(translate('common.offlinePretty'));
        
        setEncodedInvoice(encoded)
        setInvoice(invoice)        
        setInvoiceExpiry(expiresAt)
        
        if(description) {
          setMemo(description)
        }
        
        if (paymentRequestDesc) {
          setMemo(paymentRequestDesc)
        }  
        
        if (lnurlPayComment) {
          setMemo(lnurlPayComment)
        }
        
        // We need to retrieve the quote first to know how much is needed to settle invoice in selected currency unit        
        const balanceToTransferFrom  = mintUrl ? 
            proofsStore.getMintBalance(mintUrl) : 
            proofsStore.getMintBalancesWithUnit(unit)[0]

        log.trace('[onEncodedInvoice]', {balanceToTransferFrom})

        if (!balanceToTransferFrom) {
          log.warn('Not enough balance')
          setInfo(translate("transferScreen.noMintWithBalance", { unit }))
          setIsNotEnoughFunds(true)
          return
        }

        setMintBalanceToTransferFrom(balanceToTransferFrom)
        // continues in hook that handles other mint selection by user
            
    } catch (e: any) {
      resetState()
      handleError(e)
      navigation.popToTop()
    }
}

const transfer = async function () {
  try {
    if(!meltQuote) {
      throw new AppError(Err.VALIDATION_ERROR, 'Missing quote to initiate transfer transaction')
    }

    if (!mintBalanceToTransferFrom) {
      setInfo(translate("transferScreen.selectMintFrom"))
      return;
    }

    setIsLoading(true)
    setIsTransferTaskSentToQueue(true)    

    log.trace('[transfer]', {isInvoiceDonation})

    const amountToTransferInt = round(toNumber(amountToTransfer) * getCurrency(unit).precision, 0)

    WalletTask.transfer(
        mintBalanceToTransferFrom,
        amountToTransferInt,
        unit,
        meltQuote,        
        memo,
        invoiceExpiry as Date,
        encodedInvoice,
    )
  } catch (e: any) {
    handleError(e)
  }
}

const increaseProofsCounterAndRetry = async function () {
  try {
    const walletInstance = await walletStore.getWallet(
      mintBalanceToTransferFrom?.mintUrl as string, 
        unit, 
        {withSeed: true}
    )
    const mintInstance = mintsStore.findByUrl(mintBalanceToTransferFrom?.mintUrl as string)
    const counter = mintInstance!.getProofsCounterByKeysetId!(walletInstance.keysetId)
    counter!.increaseProofsCounter(20)

    // retry transfer
    transfer()
  } catch (e: any) {            
    handleError(e)
  } finally {
    toggleResultModal() //close
  }
}


const retryAfterSpentCleaned = async function () {
  try {
    // retry transfer
    transfer()
  } catch (e: any) {            
    handleError(e)
  } finally {
    toggleResultModal() //close
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
const iconColor = useThemeColor('textDim')
const amountInputColor = useThemeColor('amountInput')


    return (
      <Screen preset="fixed" contentContainerStyle={$screen}>
        <MintHeader
          mint={
            mintBalanceToTransferFrom
              ? mintsStore.findByUrl(mintBalanceToTransferFrom?.mintUrl)
              : undefined
          }
          unit={unit}
          navigation={navigation}
        />
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <View style={$amountContainer}>
            <TextInput
              ref={amountInputRef}
              onChangeText={amount => setAmountToTransfer(amount)}
              onEndEditing={onAmountEndEditing}
              value={amountToTransfer}
              style={[$amountInput, {color: amountInputColor}]}
              maxLength={9}
              keyboardType="numeric"
              selectTextOnFocus={true}
              editable={encodedInvoice ? false : true}
            />

            {encodedInvoice && (meltQuote?.fee_reserve || finalFee) ? (
              <FeeBadge
                currencyCode={getCurrency(unit).code}
                estimatedFee={meltQuote?.fee_reserve || 0}
                finalFee={finalFee}
              />
            ) : (
              <Text
                size="sm"
                tx="payCommon.amountToPayLabel"
                style={{color: amountInputColor, textAlign: 'center'}}
              />
            )}
          </View>
        </View>
        <View style={$contentContainer}>
          {transactionStatus !== TransactionStatus.COMPLETED && (
            <Card
              style={$memoCard}
              ContentComponent={
                <>
                <ListItem
                  text={
                    lnurlPayParams?.address ||
                    memo ||
                    lnurlPayParams?.domain ||
                    translate('common.noDescPlaceholder')
                  }
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
                {lnurlPayComment && encodedInvoice && (
                  <ListItem
                  text={lnurlPayComment}
                  topSeparator={true}                  
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
                )}
                </>
              }
            />
          )}
          {!encodedInvoice && transactionStatus !== TransactionStatus.COMPLETED && lnurlPayCommentAllowed > 0 && (
            <MemoInputCard 
              memo={lnurlPayComment}
              setMemo={setLnurlPayComment}
              ref={lnurlCommentInputRef}
              onMemoDone={ensureCommentNotTooLong}
              disabled={encodedInvoice ? true : false}
              maxLength={lnurlPayCommentAllowed}
            />
          )}
          {!encodedInvoice && transactionStatus !== TransactionStatus.COMPLETED && (
            <View style={$bottomContainer}>
              <View style={$buttonContainer}>
                <Button                    
                  tx="transferScreen.requestInvoice"
                  onPress={onRequestLnurlInvoice}
                />
              </View>
            </View>
          )}
          {isNotEnoughFunds && transactionStatus !== TransactionStatus.COMPLETED && (
            <View style={$bottomContainer}>
              <View style={$buttonContainer}>
                <Button                    
                  tx="common.close"
                  onPress={onClose}
                  preset="secondary"
                />
              </View>
            </View>
          )}
          {availableMintBalances.length > 0 &&
            transactionStatus !== TransactionStatus.COMPLETED && (
              <MintBalanceSelector
                mintBalances={availableMintBalances}
                selectedMintBalance={mintBalanceToTransferFrom}
                unit={unit}
                title={translate('payCommon.payFrom')}
                confirmTitle={translate('payCommon.payNow')}
                onMintBalanceSelect={onMintBalanceSelect}
                onCancel={onClose}
                onMintBalanceConfirm={transfer}
              />
            )}
          {transaction && transactionStatus === TransactionStatus.COMPLETED && (
            <Card
              style={{padding: spacing.medium}}
              ContentComponent={
                <>
                  <TranItem
                    label="tranDetailScreen.trasferredTo"
                    isFirst={true}
                    value={
                      mintsStore.findByUrl(transaction.mint)
                        ?.shortname as string
                    }
                  />
                  {transaction?.memo && (
                    <TranItem
                      label="tranDetailScreen.memoFromInvoice"
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
                    label="tranDetailScreen.status"
                    value={transaction.status as string}
                  />
                </>
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
                      title={translate('payCommon.completed')}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx={'common.close'}
                        onPress={() => {
                          if (isInvoiceDonation) {
                            navigation.navigate('ContactsNavigator', {
                              screen: 'Contacts',
                              params: {},
                            })
                          } else {
                            navigation.navigate('Wallet', {})
                          }
                        }}
                      />
                    </View>
                  </>
                )}
              {resultModalInfo &&
                transactionStatus === TransactionStatus.REVERTED && (
                  <>
                    <ResultModalInfo
                      icon="faRotate"
                      iconColor={colors.palette.accent300}
                      title={translate('transactionCommon.reverted')}
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
                      title={
                        resultModalInfo?.title || translate('payCommon.failed')
                      }
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                        {resultModalInfo.message.includes('outputs have already been signed before') ? (
                            <Button
                                preset="secondary"
                                text={"Retry again"}
                                onPress={increaseProofsCounterAndRetry}
                            />
                        ) : resultModalInfo.message.includes('Token already spent') ? (
                            <Button
                                preset="secondary"
                                text={"Retry again"}
                                onPress={retryAfterSpentCleaned}
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
              {resultModalInfo &&
                transactionStatus === TransactionStatus.PENDING && (
                  <>
                    <ResultModalInfo
                      icon="faTriangleExclamation"
                      iconColor={colors.palette.iconYellow300}
                      title={translate('payCommon.isPending')}
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
        {isLoading && <Loading />}
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  }
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

const $commentInput: TextStyle = {
  textAlignVertical: 'top' ,
  borderRadius: spacing.extraSmall,
  padding: spacing.extraSmall,        
  alignSelf: 'stretch',
  height: 120,
}

const $contentContainer: TextStyle = {
    flex: 1,
    padding: spacing.extraSmall,
    marginTop: -spacing.extraLarge * 1.5    
}

const $memoCard: ViewStyle = {
  marginBottom: spacing.small,
  minHeight: 80,
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
