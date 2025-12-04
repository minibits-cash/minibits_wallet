import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState, useCallback, useRef} from 'react'
import {StackActions, StaticScreenProps, useFocusEffect, useNavigation} from '@react-navigation/native'
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
import {Transaction, TransactionStatus} from '../models/Transaction'
import {useStores} from '../models'
import {TransactionTaskResult, WalletTask} from '../services'
import EventEmitter from '../utils/eventEmitter'
import {log} from '../services/logService'
import AppError, {Err} from '../utils/AppError'
import {MintBalance} from '../models/Mint'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {addSeconds} from 'date-fns'
import { DecodedLightningInvoice, LightningUtils } from '../services/lightning/lightningUtils'
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
import { TRANSFER_TASK } from '../services/wallet/transferTask'
import { CurrencyAmount } from './Wallet/CurrencyAmount'

type Props = StaticScreenProps<{
  unit: MintUnit,
  encodedInvoice?: string,
  draftTransactionId?: number, 
  lnurlParams?: LNURLPayParams,
  fixedAmount?: number, 
  comment?: string      
  paymentOption?: TransferOption,
  mintUrl?: string,
  isDonation?: boolean,
  donationForName?: string
}>

export enum TransferOption {  
  PASTE_OR_SCAN_INVOICE = 'PASTE_OR_SCAN_INVOICE',    
  LNURL_PAY = 'LNURL_PAY',
  LNURL_ADDRESS = 'LNURL_ADDRESS',  
}

export const TransferScreen = observer(function TransferScreen({ route }: Props) {
    const navigation = useNavigation()
    const amountInputRef = useRef<TextInput>(null)
    const lnurlCommentInputRef = useRef<TextInput>(null)
    const unitRef = useRef<MintUnit>('sat')
    const mintUrlRef = useRef<string>('')
    const draftTransactionIdRef = useRef<number>(null)

    const {
      proofsStore, 
      mintsStore,      
      walletStore, 
      walletProfileStore, 
      contactsStore,
      userSettingsStore
    } = useStores()
    // const {walletStore} = nonPersistedStores

    const isInternetReachable = useIsInternetReachable()

    const [encodedInvoice, setEncodedInvoice] = useState<string>('')
    const [invoice, setInvoice] = useState<DecodedLightningInvoice | undefined>()
    const [amountToTransfer, setAmountToTransfer] = useState<string>('0')    
    const [invoiceExpiry, setInvoiceExpiry] = useState<Date | undefined>()
    const [paymentHash, setPaymentHash] = useState<string | undefined>()
    const [lnurlPayParams, setLnurlPayParams] = useState<LNURLPayParams & {address?: string} | undefined>()    
    const [meltQuote, setMeltQuote] = useState<MeltQuoteResponse | undefined>()
    const [finalFee, setFinalFee] = useState<number>(0)
    const [memo, setMemo] = useState('')
    const [lnurlDescription, setLnurlDescription] = useState('')
    const [lnurlPayCommentAllowed, setLnurlPayCommentAllowed] = useState(0)
    const [lnurlPayComment, setLnurlPayComment] = useState('')
    const [donationForName, setDonationForName] = useState<string | undefined>()
    const [availableMintBalances, setAvailableMintBalances] = useState<MintBalance[]>([])
    const [mintBalanceToTransferFrom, setMintBalanceToTransferFrom] = useState<MintBalance | undefined>()    
    const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
    const [transaction, setTransaction] = useState<Transaction | undefined>()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isAmountEditable, setIsAmountEditable] = useState(true)
    const [isNotEnoughFunds, setIsNotEnoughFunds] = useState(false)    
    const [isInvoiceDonation, setIsInvoiceDonation] = useState(false)    
    const [isTransferTaskSentToQueue, setIsTransferTaskSentToQueue] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus; title?: string, message: string} | undefined>()


  useEffect(() => {
    const focus = () => {
      if (route.params?.paymentOption === TransferOption.LNURL_PAY) {
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

            unitRef.current = unit            

            if(mintUrl) {
                const mintBalance = proofsStore.getMintBalance(mintUrl)
                mintUrlRef.current = mintUrl  
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
                const {encodedInvoice, draftTransactionId} = route.params

                if (!encodedInvoice) {                    
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing invoice.')
                }

                // This is a transfer initiated from invoice receivd over Nostr event,
                // so DRAFT transaction exisits
                if(draftTransactionId) {
                  draftTransactionIdRef.current = draftTransactionId
                }

                log.trace('[handleInvoice] Invoice', {encodedInvoice})        
                
                onEncodedInvoice(encodedInvoice)
            } catch (e: any) {
                handleError(e)
            }                
        }

        const handleLnurlPay = async () => {
            try {
                // amountSats allows to default amount to be paid to a lightning address  
                const {lnurlParams, unit, fixedAmount, comment, isDonation, donationForName} = route.params

                log.trace('[handleLnurlPay] start', {unit})

                if (!lnurlParams) {                    
                    throw new AppError(Err.VALIDATION_ERROR, translate('missingLNURLParamsError'))
                }
                                
                if(fixedAmount && fixedAmount > 0) {
                  setIsAmountEditable(false)
                }

                if(comment) {
                  setLnurlPayComment(comment)
                }

                if(isDonation) {
                  setIsInvoiceDonation(true)
                  setDonationForName(donationForName)
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

                const defaultAmount = fixedAmount || roundUp(lnurlParams.minSendable / 1000, 0)
                
                // Set minSendable into amountToTransfer in unit currency
                if (unit !== 'sat') {
                  const rate = await walletStore.getExchangeRate(getCurrency(unit).code)
                  const defaultAmountUnit = convertToFromSats(defaultAmount, CurrencyCode.SAT, rate)

                  log.trace('[handleLnurlPay] minSendable conversion from SAT', {defaultAmount, rate, defaultAmountUnit})

                  setAmountToTransfer(`${numbro(defaultAmountUnit / getCurrency(unit).precision)
                    .format({
                      thousandSeparated: true, 
                      mantissa: getCurrency(unit).mantissa
                    })}`
                  )

                } else {
                  setAmountToTransfer(`${numbro(defaultAmount)
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


        if(paymentOption && paymentOption === TransferOption.PASTE_OR_SCAN_INVOICE) {   
            handleInvoice()
        }

        /* if(paymentOption && paymentOption === SendOption.PAY_PAYMENT_REQUEST) {   
            handlePaymentRequest()
        } */

        if(paymentOption && paymentOption === TransferOption.LNURL_PAY) {   
            handleLnurlPay()
        }

        
    }, [route.params?.paymentOption]),
)

const handleError = function(e: AppError): void {
    setIsLoading(false)
    setError(e)
}


// Ref to track if a quote request is in progress
const quoteRequestRef = useRef<AbortController | null>(null);

// Stable function to create melt quote
const createMeltQuote = useCallback(async () => {
  // Cancel any previous in-flight request
  if (quoteRequestRef.current) {
    quoteRequestRef.current.abort()
  }

  const controller = new AbortController()
  quoteRequestRef.current = controller

  try {
    log.trace('[TransferScreen] createMeltQuote triggered', {
      mintBalanceToTransferFrom,
      encodedInvoice,
      hasExistingQuote: !!meltQuote,
    })

    // Guard: required data not ready yet
    if (!mintBalanceToTransferFrom?.mintUrl || !encodedInvoice) {
      log.trace('[createMeltQuote] Missing required data, skipping quote request')
      return
    }

    // Optional: prevent double quote if we already have one for the same invoice + mint
    if (meltQuote && meltQuote.quote) {
      log.trace('[createMeltQuote] Melt quote already exists, skipping')
      return
    }

    setIsLoading(true)
    setIsNotEnoughFunds(false)
    setInfo('')

    const quote = await walletStore.createLightningMeltQuote(
      mintBalanceToTransferFrom.mintUrl,
      unitRef.current,
      encodedInvoice,      
    )

    // Ignore result if request was aborted (e.g. user switched mint)
    if (controller.signal.aborted) {
      log.trace('[createMeltQuote] Request was aborted, ignoring stale result');
      return;
    }

    setMeltQuote(quote);

    // Format amount for display
    const displayAmount = numbro(quote.amount / getCurrency(unitRef.current).precision).format({
      thousandSeparated: true,
      mantissa: getCurrency(unitRef.current).mantissa,
    });
    setAmountToTransfer(displayAmount)

    // Check total required balance (amount + fee reserve)
    const totalRequired = quote.amount + quote.fee_reserve
    const availableBalances = proofsStore.getMintBalancesWithEnoughBalance(totalRequired, unitRef.current)

    if (availableBalances.length === 0) {
      setInfo(
        translate('transferScreen_insufficientFunds', {
          currency: getCurrency(unitRef.current).code,
          amount: totalRequired,
        })
      );
      setIsNotEnoughFunds(true);
    } else {
      setAvailableMintBalances(availableBalances);
      setIsNotEnoughFunds(false);
    }
  } catch (e: any) {
    // Ignore abort errors
    if (e.name === 'AbortError') {
      log.trace('[createMeltQuote] Aborted');
      return
    }

    log.error('[createMeltQuote] Failed to create melt quote', e)
    handleError(e)
    
  } finally {
    // Only reset loading if this was the active request
    if (quoteRequestRef.current === controller) {
      setIsLoading(false)
      quoteRequestRef.current = null
    }
  }
}, [
  mintBalanceToTransferFrom?.mintUrl,
  encodedInvoice,
  meltQuote, // to avoid refetching same quote
  unitRef.current,  
])

// Trigger quote creation when mint changes
useEffect(() => {
  createMeltQuote()
}, [createMeltQuote])

// Cleanup on unmount
useEffect(() => {
  return () => {
    if (quoteRequestRef.current) {
      quoteRequestRef.current.abort()
      quoteRequestRef.current = null
    }
  };
}, [])


// ====================== TransferScreen – Lightning Payment Result Handler ======================

const handleTransferTaskResult = useCallback(
  async (result: TransactionTaskResult) => {
    log.trace('[TransferScreen] handleTransferTaskResult triggered', {
      result,
      isInvoiceDonation,
      donationForName,
    })

    setIsLoading(false)

    const { transaction, error, message, finalFee } = result

    // ——— Early error: no transaction object yet ———
    if (!transaction && error) {
      setTransactionStatus(TransactionStatus.ERROR)

      setResultModalInfo({
        status: TransactionStatus.ERROR,
        title: translate('payCommon_failed'),
        message: error.message || 'Lightning payment failed',
      });

      toggleResultModal()
      return
    }

    // ——— Transaction exists ———
    if (transaction) {
      const { status } = transaction
      setTransactionStatus(status)
      setTransaction(transaction)

      // ——— Link transaction to LNURL / contact profile ———
      if (lnurlPayParams?.address) {
        const profile = contactsStore.findByLud16(lnurlPayParams.address)

        if (profile) {
          transaction.update({
            sentTo: profile.nip05 || profile.name || lnurlPayParams.address,
            profile: JSON.stringify(profile),
          })
        } else {
          transaction.update({
            sentTo: lnurlPayParams.address,
          })
        }
      }

      // ——— Final fee reporting ———
      if (finalFee != null) {
        setFinalFee(finalFee)
      }

      // ——— Success / Pending / Error message logic ———
      if (error) {
        if (status === TransactionStatus.PENDING) {
          setResultModalInfo({
            status,
            message,
          })
        } else {
          setResultModalInfo({
            status,
            title: error.params?.message ? error.message : translate('payCommon_failed'),
            message: error.params?.message || error.message || 'Payment failed',
          })
        }
      } else {
        // Success path
        if (isInvoiceDonation && donationForName) {
          // Update profile donation counter
          await walletProfileStore.updateName(donationForName);

          setResultModalInfo({
            status,
            message: translate('transferScreen_donationSuccessMessage', { donationForName }),
          })
        } else {
          setResultModalInfo({
            status,
            message,
          })
        }
      }
    }

    toggleResultModal()
  },
  [
    isInvoiceDonation,
    donationForName,
    lnurlPayParams?.address,
    setIsLoading,
    setTransaction,
    setTransactionStatus,
    setFinalFee,
    setResultModalInfo,    
    translate,
  
  ],
)

// One-time listener with auto-cleanup
const transferTaskListenerRef = useRef<((r: TransactionTaskResult) => void) | null>(null)

useEffect(() => {
  if (!isTransferTaskSentToQueue) {
    if (transferTaskListenerRef.current) {
      EventEmitter.off(`ev_${TRANSFER_TASK}_result`, transferTaskListenerRef.current)
      transferTaskListenerRef.current = null
    }
    return
  }

  const eventName = `ev_${TRANSFER_TASK}_result`

  // Remove any stale listener
  if (transferTaskListenerRef.current) {
    EventEmitter.off(eventName, transferTaskListenerRef.current)
  }

  const oneTimeHandler = (result: TransactionTaskResult) => {
    // Detach immediately — this event fires once per payment
    EventEmitter.off(eventName, oneTimeHandler)
    transferTaskListenerRef.current = null

    // Forward to stable handler
    handleTransferTaskResult(result)
  }

  transferTaskListenerRef.current = oneTimeHandler
  EventEmitter.on(eventName, oneTimeHandler)

  return () => {
    if (transferTaskListenerRef.current) {
      EventEmitter.off(eventName, transferTaskListenerRef.current)
      transferTaskListenerRef.current = null
    }
  }
}, [isTransferTaskSentToQueue])


const gotoContacts = function () {
  resetState()
  navigation.dispatch(                
    StackActions.popToTop()
  )
  //@ts-ignore
  navigation.navigate('ContactsNavigator', {
      screen: 'Contacts',
      params: {}            
  })
}


const gotoWallet = function() {
  resetState()
  navigation.dispatch(                
   StackActions.popToTop()
  )
}


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
    setDonationForName(undefined)
    setError(undefined)
    setIsLoading(false)
    setIsAmountEditable(true)    
    setIsInvoiceDonation(false)
    setIsTransferTaskSentToQueue(false)
    setIsResultModalVisible(false)
    setResultModalInfo(undefined)
    setLnurlPayCommentAllowed(0)
    setLnurlPayComment('')
}

const toggleResultModal = () => setIsResultModalVisible(previousState => !previousState)

const onMintBalanceSelect = function (balance: MintBalance) {
    mintUrlRef.current = balance.mintUrl
    setMintBalanceToTransferFrom(balance) // this triggers effect to get melt quote
}


// Amount is editable only in case of LNURL Pay, while invoice is not yet retrieved
const onRequestLnurlInvoice = async function () {
  log.trace('[onRequestLnurlInvoice] start', {amountToTransfer, unit: unitRef.current})
  try {
    const {precision, code: currencyCode} = getCurrency(unitRef.current)
       
    const amountUnit = round(toNumber(amountToTransfer) * precision, 0)

    if (!amountUnit || amountUnit === 0) {
      setInfo(translate('payCommon_amountZeroOrNegative'))          
      return
    }

    if(!lnurlPayParams) {
      throw new AppError(Err.VALIDATION_ERROR, 'Missing LNURL pay parameters', {caller: 'onRequestLnurlInvoice'})
    }

    let amountSats = 0

    if(unitRef.current !== 'sat') {
      const rate = await walletStore.getExchangeRate(currencyCode)
      amountSats = roundUp(convertToFromSats(amountUnit, currencyCode, rate), 0)

      log.trace('[onRequestLnurlInvoice] converted amountToTransfer to SAT', {amountUnit, amountSats})
    } else {
      amountSats = amountUnit
    }   

    if (lnurlPayParams.minSendable && amountSats < lnurlPayParams.minSendable / 1000) {
      setInfo(translate('payCommon_minimumPay', { 
        amount: roundUp(lnurlPayParams.minSendable / 1000, 0), 
        currency: CurrencyCode.SAT 
      }))        
      return;
    }

    if (lnurlPayParams.maxSendable && amountSats > lnurlPayParams.maxSendable / 1000) {       
      setInfo(translate("payCommon_maximumPay", { 
        amount: roundDown(lnurlPayParams.maxSendable / 1000, 0),
        currency: CurrencyCode.SAT
      }))          
      return;
    }

    if (lnurlPayParams.payerData) {
      setInfo(translate("transferScreen_LUD18unsupported"))
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


const onEncodedInvoice = async function (encoded: string) {
 
    log.trace("[onEncodedInvoice] start", {mintUrl: mintUrlRef.current, unit: unitRef.current})
    
    try {
        //@ts-ignore
        navigation.setParams({
          encodedInvoice: undefined,          
          lnurlParams: undefined,
          paymentOption: undefined,
          fixedAmount: undefined,
          isDonation: undefined,
          donationForName: undefined,
          draftTransactionIdRef: undefined,
          unit: undefined,
          mintUrl: undefined
        })

        const invoice = LightningUtils.decodeInvoice(encoded)
        const {amount, expiry, description, timestamp} = LightningUtils.getInvoiceData(invoice)
        const expiresAt = addSeconds(new Date(timestamp as number * 1000), expiry as number)

        if (!amount || amount === 0) {
          setInfo(translate('payCommon_amountZeroOrNegative'))            
          return;
        }

        if(!isInternetReachable) setInfo(translate('commonOfflinePretty'));
        
        setIsAmountEditable(false)
        setEncodedInvoice(encoded)
        setInvoice(invoice)        
        setInvoiceExpiry(expiresAt)
        
        if(description) {
          setMemo(description)
        }
        
        if (lnurlPayComment) {
          setMemo(lnurlPayComment)
        }
        
        // We need to retrieve the quote first to know how much is needed to settle invoice in selected currency unit        
        const balanceToTransferFrom  = mintUrlRef.current ? 
            proofsStore.getMintBalance(mintUrlRef.current) :
            proofsStore.getMintBalancesWithUnit(unitRef.current)[0]

        log.trace('[onEncodedInvoice]', {balanceToTransferFrom})

        if (!balanceToTransferFrom) {
          log.warn('Not enough balance')
          setInfo(translate("transferScreen_noMintWithBalance", { unit: unitRef.current }))
          setIsNotEnoughFunds(true)
          return
        }

        setMintBalanceToTransferFrom({...balanceToTransferFrom}) // force to trigger effect to create melt quote
        // continues in hook that handles other mint selection by user
            
    } catch (e: any) {      
      handleError(e)
      gotoWallet()
    }
}

const transfer = async function () {
  try {
    if(!meltQuote) {
      throw new AppError(Err.VALIDATION_ERROR, 'Missing quote to initiate transfer transaction')
    }

    if (!mintBalanceToTransferFrom) {
      setInfo(translate("transferScreen_selectMintFrom"))
      return;
    }

    setIsLoading(true)
    setIsTransferTaskSentToQueue(true)    

    log.trace('[transfer]', {isInvoiceDonation})

    const amountToTransferInt = round(toNumber(amountToTransfer) * getCurrency(unitRef.current).precision, 0)

    WalletTask.transferQueue(
        mintBalanceToTransferFrom,
        amountToTransferInt,
        unitRef.current,
        meltQuote,        
        memo,
        invoiceExpiry as Date,
        encodedInvoice,
        undefined,
        draftTransactionIdRef.current || undefined
    )
  } catch (e: any) {
    handleError(e)
  }
}

const increaseProofsCounterAndRetry = async function () {
  try {
    const walletInstance = await walletStore.getWallet(
      mintBalanceToTransferFrom?.mintUrl as string, 
      unitRef.current, 
      {withSeed: true}
    )
    const mintInstance = mintsStore.findByUrl(mintBalanceToTransferFrom?.mintUrl as string)
    const counter = mintInstance!.getProofsCounterByKeysetId!(walletInstance.keysetId)
    counter!.increaseProofsCounter(10)

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
          unit={unitRef.current}          
        />
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <View style={$amountContainer}>
            <AmountInput
              ref={amountInputRef}
              value={amountToTransfer}
              onChangeText={amount => setAmountToTransfer(amount)}
              selectTextOnFocus={true}
              unit={unitRef.current}
              editable={isAmountEditable}
              style={{color: amountInputColor}}
            />
          </View>
          {encodedInvoice && (meltQuote?.fee_reserve || finalFee) ? (
              <FeeBadge
                currencyCode={getCurrency(unitRef.current).code}
                estimatedFee={meltQuote?.fee_reserve || 0}
                finalFee={finalFee}
              />
            ) : (
              <Text
                  size='xs'
                  tx='payCommon_amountToPayLabel'
                  style={{
                      color: amountInputColor,
                      textAlign: 'center',
                      marginTop: spacing.extraSmall                            
                  }}
              />
            )}
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
                    translate('commonNoDescPlaceholder')
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
                  tx="transferScreen_requestInvoice"
                  onPress={onRequestLnurlInvoice}
                />
              </View>
            </View>
          )}
          {isNotEnoughFunds && transactionStatus !== TransactionStatus.COMPLETED && (
            <View style={$bottomContainer}>
              <View style={$buttonContainer}>
                <Button                    
                  tx="commonClose"
                  onPress={gotoWallet}
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
                unit={unitRef.current}
                title={translate('payCommon_payFrom')}
                confirmTitle={translate('payCommon_payNow')}
                onMintBalanceSelect={onMintBalanceSelect}
                onCancel={gotoWallet}
                onMintBalanceConfirm={transfer}
              />
            )}
          {transaction && transactionStatus === TransactionStatus.COMPLETED && (
            <Card
              style={{padding: spacing.medium}}
              ContentComponent={
                <>
                  <TranItem
                    label="tranDetailScreen_trasferredTo"
                    isFirst={true}
                    value={
                      mintsStore.findByUrl(transaction.mint)
                        ?.shortname as string
                    }
                  />
                  {transaction?.memo && (
                    <TranItem
                      label="tranDetailScreen_memoFromInvoice"
                      value={transaction.memo as string}
                    />
                  )}
                  <TranItem
                    label="transactionCommon_feePaid"
                    value={transaction.fee || 0}
                    unit={unitRef.current}
                    isCurrency={true}
                  />
                  <TranItem
                    label="tranDetailScreen_status"
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
                  tx={'commonClose'}
                  onPress={gotoWallet}
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
                      title={translate('payCommon_completed')}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx={'commonClose'}
                        onPress={() => {
                          if (isInvoiceDonation) {
                            gotoContacts()
                          } else {
                            gotoWallet()
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
                      title={translate('transactionCommon_reverted')}
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
              {resultModalInfo &&
                transactionStatus === TransactionStatus.ERROR && (
                  <>
                    <ResultModalInfo
                      icon="faTriangleExclamation"
                      iconColor={colors.palette.angry500}
                      title={
                        resultModalInfo?.title || translate('payCommon_failed')
                      }
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                        {((/already.*signed|duplicate key/i.test(resultModalInfo.message))) ? (
                            <Button
                                preset="secondary"
                                text={"Retry again"}
                                onPress={increaseProofsCounterAndRetry}
                            />
                        ) : resultModalInfo.message.toLowerCase().includes('token already spent') ? (
                            <Button
                                preset="secondary"
                                text={"Retry again"}
                                onPress={retryAfterSpentCleaned}
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
              {resultModalInfo &&
                transactionStatus === TransactionStatus.PENDING && (
                  <>
                    <ResultModalInfo
                      icon="faTriangleExclamation"
                      iconColor={colors.palette.iconYellow300}
                      title={translate('payCommon_isPending')}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx={'commonClose'}
                        onPress={gotoWallet}
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
    // height: spacing.screenHeight * 0.11,
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
