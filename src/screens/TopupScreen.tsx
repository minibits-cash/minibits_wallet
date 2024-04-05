import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState, useRef, useCallback} from 'react'
import {
  UIManager,
  Platform,
  Alert,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
  LayoutAnimation,
  ScrollView,
  Share,
  Image,
  ImageStyle,
  FlatList,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import QRCode from 'react-native-qrcode-svg'
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
import {TransactionStatus, Transaction} from '../models/Transaction'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {NostrClient, NostrProfile, NostrUnsignedEvent, TransactionTaskResult, WalletTask} from '../services'
import {log} from '../services/logService'
import AppError, { Err } from '../utils/AppError'

import {Mint, MintBalance} from '../models/Mint'
import {MintListItem} from './Mints/MintListItem'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {PaymentRequest} from '../models/PaymentRequest'
import { useFocusEffect } from '@react-navigation/native'
import { Contact } from '../models/Contact'
import { getImageSource, infoMessage } from '../utils/utils'
import { ReceiveOption } from './ReceiveOptionsScreen'
import { LNURLWithdrawParams } from 'js-lnurl'
import { roundDown } from '../utils/number'
import { LnurlClient, LnurlWithdrawResult } from '../services/lnurlService'
import { moderateVerticalScale, verticalScale } from '@gocodingnow/rn-size-matters'
import { CurrencyCode, CurrencySign } from './Wallet/CurrencySign'

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const TopupScreen: FC<WalletStackScreenProps<'Topup'>> = observer(
  function TopupScreen({navigation, route}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {proofsStore, mintsStore, walletProfileStore, transactionsStore} = useStores()
    const amountInputRef = useRef<TextInput>(null)
    const memoInputRef = useRef<TextInput>(null)
    // const tokenInputRef = useRef<TextInput>(null)

    const [paymentOption, setPaymentOption] = useState<ReceiveOption>(ReceiveOption.SHOW_INVOICE)
    const [amountToTopup, setAmountToTopup] = useState<string>('0')
    const [contactToSendFrom, setContactToSendFrom] = useState<Contact| undefined>()    
    const [contactToSendTo, setContactToSendTo] = useState<Contact| undefined>()        
    const [relaysToShareTo, setRelaysToShareTo] = useState<string[]>([])
    const [lnurlWithdrawParams, setLnurlWithdrawParams] = useState<LNURLWithdrawParams | undefined>()
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<MintBalance[]>([])
    const [mintBalanceToTopup, setMintBalanceToTopup] = useState<MintBalance | undefined>(undefined)
    const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
    const [transactionId, setTransactionId] = useState<number | undefined>()
    const [invoiceToPay, setInvoiceToPay] = useState<string>('')
    const [lnurlWithdrawResult, setLnurlWithdrawResult] = useState<LnurlWithdrawResult | undefined>()
    
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isAmountEndEditing, setIsAmountEndEditing] = useState<boolean>(false)
    const [isMemoEndEditing, setIsMemoEndEditing] = useState<boolean>(false)

    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus; title?: string, message: string} | undefined>()

    const [isLoading, setIsLoading] = useState(false)

    const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
    const [isQRModalVisible, setIsQRModalVisible] = useState(false)
    const [isNostrDMModalVisible, setIsNostrDMModalVisible] = useState(false)
    const [isWithdrawModalVisible, setIsWithdrawModalVisible] = useState(false)
    const [isTopupTaskSentToQueue, setIsTopupTaskSentToQueue] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [isNostrDMSending, setIsNostrDMSending] = useState(false)
    const [isNostrDMSuccess, setIsNostrDMSuccess] = useState(false)
    const [isWithdrawRequestSending, setIsWithdrawRequestSending] = useState(false)
    const [isWithdrawRequestSuccess, setIsWithdrawRequestSuccess] = useState(false)

    useEffect(() => {
        const focus = () => {
            amountInputRef && amountInputRef.current
            ? amountInputRef.current.focus()
            : false
        }        
        const timer = setTimeout(() => focus(), 100)
        return () => {
            clearTimeout(timer)
        }
    }, [])

    // Send to contact
    useFocusEffect(
        useCallback(() => {
            const { paymentOption } = route.params
            
            const prepareSendPaymentRequest = () => {
                try {
                    const {contact, relays} = route.params

                    if (!contact || !relays) {                    
                        throw new AppError(Err.VALIDATION_ERROR, 'Missing contact or relay')
                    }

                    const {
                        pubkey,
                        npub,
                        name,
                        picture,
                    } = walletProfileStore

                    const contactFrom: Contact = {
                        pubkey,
                        npub,
                        name,
                        picture
                    }
                        
                    setPaymentOption(ReceiveOption.SEND_PAYMENT_REQUEST)
                    setContactToSendFrom(contactFrom)                
                    setContactToSendTo(contact)                
                    setRelaysToShareTo(relays)

                    navigation.setParams({contact: undefined})
                    navigation.setParams({relays: undefined})
                } catch(e: any) {
                    handleError(e)
                }
            }



            const prepareLnurlWithdraw = () => {
                try {
                    const { lnurlParams } = route.params
                    if (!lnurlParams) {                    
                        throw new AppError(Err.VALIDATION_ERROR, 'Missing LNURL params.')
                    }

                    const amountSats = roundDown(lnurlParams.maxWithdrawable / 1000, 0)

                    setAmountToTopup(`${amountSats}`)
                    setLnurlWithdrawParams(lnurlParams)
                    setMemo(lnurlParams.defaultDescription)                    
                    setPaymentOption(ReceiveOption.LNURL_WITHDRAW)                

                    // onAmountEndEditing(`${amountSats}`)
                } catch(e: any) {
                    handleError(e)
                }
            }

            if(paymentOption && paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST) {                
                prepareSendPaymentRequest()
            }

            if(paymentOption && paymentOption === ReceiveOption.LNURL_WITHDRAW) {                
                prepareLnurlWithdraw()
            }
            
        }, [route.params?.paymentOption])
    )


    useEffect(() => {
        const handleTopupTaskResult = async (result: TransactionTaskResult) => {
            log.trace('handleTopupTaskResult event handler triggered')
            
            setIsLoading(false)

            const {status, id} = result.transaction as Transaction
            setTransactionStatus(status)
            setTransactionId(id)
    
            if (result.encodedInvoice) {
                setInvoiceToPay(result.encodedInvoice)
            }

            if (result.error) {
                setResultModalInfo({
                    status: result.transaction?.status as TransactionStatus,
                    title: result.error.params?.message ? result.error.message : 'Topup failed',
                    message: result.error.params?.message || result.error.message,
                })
                setIsResultModalVisible(true)
                return
            }
            
            if (paymentOption === ReceiveOption.SHOW_INVOICE) {
                toggleQRModal()
            }
    
            if (paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST) {
                toggleNostrDMModal()
            }
    
            if (paymentOption === ReceiveOption.LNURL_WITHDRAW) {
                toggleWithdrawModal()
            }
          
            setIsMintSelectorVisible(false)
        }

        // Subscribe to the 'sendCompleted' event
        EventEmitter.on('ev_topupTask_result', handleTopupTaskResult)        

        // Unsubscribe from the 'sendCompleted' event on component unmount
        return () => {
            EventEmitter.off('ev_topupTask_result', handleTopupTaskResult)        
        }
    }, [isTopupTaskSentToQueue])


    useEffect(() => {
      const handlePendingTopupTaskResult = (result: TransactionTaskResult) => {
        log.trace('[handlePendingTopupTaskResult] event handler triggered')

        if (!transactionId) {
          return
        }
        
        // Filter and handle events only for this topup transactionId
        if (result.transaction?.id === transactionId) {
            // Show result modal only on completed topup
            if (result.transaction.status !== TransactionStatus.COMPLETED) {                
                return
            }

            log.trace('[handlePendingTopupTaskResult]', 'Invoice has been paid and new proofs received')

          setResultModalInfo({
            status: result.transaction.status,
            message: result.message,
          })

          setTransactionStatus(TransactionStatus.COMPLETED)
          setIsQRModalVisible(false)
          setIsNostrDMModalVisible(false)
          setIsWithdrawModalVisible(false)
          setIsResultModalVisible(true)
        }
      }
      
      EventEmitter.on('ev__handlePendingTopupTask_result', handlePendingTopupTaskResult)
      
      return () => {
        EventEmitter.off('ev__handlePendingTopupTask_result', handlePendingTopupTaskResult)
      }
    }, [transactionId])


    const toggleQRModal = () => setIsQRModalVisible(previousState => !previousState)
    const toggleNostrDMModal = () => setIsNostrDMModalVisible(previousState => !previousState)
    const toggleWithdrawModal = () => setIsWithdrawModalVisible(previousState => !previousState)
    const toggleResultModal = () => setIsResultModalVisible(previousState => !previousState)


    const onAmountEndEditing = function () {
      try {
            const amount = parseInt(amountToTopup)

            if (!amount || amount === 0) {
                infoMessage('Amount should be positive number.')          
                return
            }

            if (lnurlWithdrawParams && amount < lnurlWithdrawParams?.minWithdrawable / 1000 ) {
                infoMessage(`Minimal withdraw amount is ${lnurlWithdrawParams?.minWithdrawable / 1000} SATS.`)          
                return
            }

            const availableBalances = proofsStore.getBalances().mintBalances

            if (availableBalances.length === 0) {
                infoMessage('Add the mint first.', 'There is no mint connected to your wallet that you would receive your ecash from.')
                return
            }

            setAvailableMintBalances(availableBalances)

            // Default mint with highest balance to topup
            setMintBalanceToTopup(availableBalances[0])
            setIsAmountEndEditing(true)
            // We do not make memo focus mandatory
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
            // Show mint selector        
            setIsMintSelectorVisible(true)
      } catch (e: any) {
        handleError(e)
      }
    }
    

    const onMemoEndEditing = function () {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
        
        // Show mint selector
        if (availableMintBalances.length > 0) {
            setIsMintSelectorVisible(true)
        }
        setIsMemoEndEditing(true)    
    }


    const onMemoDone = function () {
      if (parseInt(amountToTopup) > 0) {
        memoInputRef && memoInputRef.current
          ? memoInputRef.current.blur()
          : false
        amountInputRef && amountInputRef.current
          ? amountInputRef.current.blur()
          : false
        onMemoEndEditing()
      } else {
        amountInputRef && amountInputRef.current
          ? amountInputRef.current.focus()
          : false
      }
    }


    const onMintBalanceSelect = function (balance: MintBalance) {
      setMintBalanceToTopup(balance)
    }


    const onMintBalanceConfirm = async function () {
        if (!mintBalanceToTopup) {
            return
        }

        setIsLoading(true)
        setIsTopupTaskSentToQueue(true)
        
        WalletTask.topup(
            mintBalanceToTopup as MintBalance,
            parseInt(amountToTopup),
            memo,            
            contactToSendTo
        )        
    }


    const onMintBalanceCancel = async function () {
      setIsMintSelectorVisible(false)
    }


    const sendAsNostrDM = async function () {
        try {            
            setIsNostrDMSending(true)
            const senderPubkey = walletProfileStore.pubkey            
            const receiverPubkey = contactToSendTo?.pubkey

            // redable message
            let message = `nostr:${walletProfileStore.npub} sent you Lightning invoice for ${amountToTopup} SATS from Minibits wallet!`
            // invoice
            let content = message + ' \n' + invoiceToPay + ' \n'
            // parsable memo that overrides static default mint invoice description
            if (memo) {
                content = content + `Memo: ${memo}`
            }             

            const encryptedContent = await NostrClient.encryptNip04(                
                receiverPubkey as string, 
                content as string
            )
            
            // log.trace('Relays', relaysToShareTo)          

            const dmEvent: NostrUnsignedEvent = {
                kind: 4,
                pubkey: senderPubkey,
                tags: [['p', receiverPubkey as string], ['from', walletProfileStore.nip05]],
                content: encryptedContent,                                                    
            }

            const sentEvent: Event | undefined = await NostrClient.publish(
                dmEvent,
                relaysToShareTo,                     
            )
            
            setIsNostrDMSending(false)

            if(sentEvent) {                
                setIsNostrDMSuccess(true)

                const transaction = transactionsStore.findById(transactionId as number)

                if(!transaction || !transaction.data) {
                    return
                }
                
                const updated = JSON.parse(transaction.data)

                if(updated.length > 1) {
                    updated[1].sentToRelays = relaysToShareTo
                    updated[1].sentEvent = sentEvent    
                    
                    await transactionsStore.updateStatus( // status does not change, just add event and relay info to tx.data
                        transactionId as number,
                        TransactionStatus.PENDING,
                        JSON.stringify(updated)
                    )
                }
            } else {
                setInfo('Relay could not confirm that the message has been published.')
            }
        } catch (e: any) {
            handleError(e)
        }
    }

    
    const onShareToApp = async () => {
      try {
        const result = await Share.share({
          message: invoiceToPay as string,
        })

        if (result.action === Share.sharedAction) {          
          setTimeout(
            () => infoMessage('Lightning invoice has been shared, waiting to be paid by receiver.'),              
            500,
          )
        } else if (result.action === Share.dismissedAction) {
            infoMessage('Sharing cancelled')          
        }
      } catch (e: any) {
        handleError(e)
      }
    }


    const onCopy = function () {
      try {
        Clipboard.setString(invoiceToPay as string)
      } catch (e: any) {
        setInfo(`Could not copy: ${e.message}`)
      }
    }


    const onLnurlWithdraw = async function () {
        try {
            setIsWithdrawRequestSending(true) // replace, not working
            const result = await LnurlClient.withdraw(lnurlWithdrawParams as LNURLWithdrawParams, invoiceToPay)
            log.trace('Withdraw result', result, 'onLnurlWithdraw')

            if(result.status === 'OK') {
                setIsWithdrawRequestSuccess(true)
                setLnurlWithdrawResult(result)
                setIsWithdrawRequestSending(false)
                return
            }
            
            const transaction = transactionsStore.findById(transactionId as number)

            if(!transaction) {
                throw new AppError(Err.NOTFOUND_ERROR, 'Could not find transaction in the app state.', {transactionId})
            }
            
            const updated = JSON.parse(transaction.data)

            updated.push({
                status: TransactionStatus.ERROR,               
                error: result,
            })

            await transactionsStore.updateStatus( 
                transactionId as number,
                TransactionStatus.ERROR, 
                JSON.stringify(updated),
            )
            
            setResultModalInfo({
                status: TransactionStatus.ERROR,
                message: JSON.stringify(result),
            })

            toggleWithdrawModal()
            setIsResultModalVisible(true)                
            return
        } catch (e: any) {
            handleError(e)
        }
    }


    const resetState = function () {
        // reset state so it does not interfere next payment
        setAmountToTopup('')
        setMemo('')
        setIsAmountEndEditing(false)
        setIsMemoEndEditing(false)
        setIsMintSelectorVisible(false)
        setIsNostrDMModalVisible(false)
        setIsWithdrawModalVisible(false)
        setIsWithdrawRequestSending(false)
        setPaymentOption(ReceiveOption.SHOW_INVOICE)

        navigation.popToTop()
    }


    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }

    const headerBg = useThemeColor('header')

    const getAmountTitle = function () {
        switch (paymentOption) {
            case ReceiveOption.SEND_PAYMENT_REQUEST:
                return 'Requested amount'             
            case ReceiveOption.LNURL_WITHDRAW:
                return 'Withdraw amount'
            default:
                return 'Topup amount'                
        }
    }
    // const inputBg = useThemeColor('background')
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
                    onChangeText={amount => setAmountToTopup(amount)}                    
                    onEndEditing={onAmountEndEditing}
                    value={amountToTopup}
                    style={$amountInput}
                    maxLength={9}
                    keyboardType="numeric"
                    selectTextOnFocus={true}
                    editable={
                        transactionStatus === TransactionStatus.PENDING ? false : true
                    }
                />
                <Text
                    size='sm'
                    text={getAmountTitle()}
                    style={{color: 'white', textAlign: 'center'}}
                />
          </View>
        </View>
        <View style={$contentContainer}>
          <Card
            style={$memoCard}
            ContentComponent={
              <View style={$memoContainer}>
                <TextInput
                  ref={memoInputRef}
                  onChangeText={memo => setMemo(memo)}
                  onEndEditing={onMemoEndEditing}
                  value={`${memo}`}
                  style={$memoInput}
                  maxLength={200}
                  keyboardType="default"
                  selectTextOnFocus={true}
                  placeholder="Memo for the payer"
                  editable={
                    transactionStatus === TransactionStatus.PENDING
                      ? false
                      : true
                  }
                />
                <Button
                  preset="secondary"
                  style={$memoButton}
                  text="Done"
                  onPress={onMemoDone}
                  disabled={
                    transactionStatus === TransactionStatus.PENDING
                      ? true
                      : false
                  }
                />
              </View>
            }
          />          
            {isMintSelectorVisible && (
                    <MintBalanceSelector
                        availableMintBalances={availableMintBalances}
                        mintBalanceToTopup={mintBalanceToTopup as MintBalance}
                        onMintBalanceSelect={onMintBalanceSelect}
                        onCancel={onMintBalanceCancel}
                        findByUrl={mintsStore.findByUrl}
                        onMintBalanceConfirm={onMintBalanceConfirm}
                    />
            )}
            {transactionStatus === TransactionStatus.PENDING && invoiceToPay && paymentOption && (
                    <SelectedMintBlock                    
                        toggleNostrDMModal={toggleNostrDMModal}
                        toggleQRModal={toggleQRModal}
                        toggleWithdrawModal={toggleWithdrawModal}
                        paymentOption={paymentOption}
                        invoiceToPay={invoiceToPay}
                        mintBalanceToTopup={mintBalanceToTopup as MintBalance}
                        gotoWallet={resetState}
                    />
            )}
            {(transactionStatus === TransactionStatus.COMPLETED)  && (
                <View style={$bottomContainer}>
                    <View style={$buttonContainer}>
                        <Button
                            preset="secondary"
                            tx={'common.close'}
                            onPress={resetState}
                        />
                    </View>
                </View>
            )}
            {isLoading && <Loading />}
        </View>        
        <BottomModal
            isVisible={isQRModalVisible}
            ContentComponent={
                <ShareAsQRCodeBlock
                    toggleQRModal={toggleQRModal}
                    invoiceToPay={invoiceToPay as string}
                    onShareToApp={onShareToApp}
                    onCopy={onCopy}
                    onError={handleError}
                />
            }
            onBackButtonPress={toggleQRModal}
            onBackdropPress={toggleQRModal}
        />
        <BottomModal
          isVisible={isNostrDMModalVisible ? true : false}
          ContentComponent={
            (isNostrDMSuccess ? (
            <NostrDMSuccessBlock
                toggleNostrDMModal={toggleNostrDMModal}
                contactToSendFrom={contactToSendFrom as Contact}
                contactToSendTo={contactToSendTo as Contact}                
                amountToTopup={amountToTopup}
                onClose={resetState}                
            />
            ) : (
            <SendAsNostrDMBlock
                toggleNostrDMModal={toggleNostrDMModal}
                encodedInvoiceToSend={invoiceToPay as string}
                contactToSendFrom={contactToSendFrom as Contact}
                contactToSendTo={contactToSendTo as Contact}
                relaysToShareTo={relaysToShareTo}
                amountToTopup={amountToTopup}
                sendAsNostrDM={sendAsNostrDM}
                isNostrDMSending={isNostrDMSending}                
            />
            ))
            
          }
          onBackButtonPress={toggleNostrDMModal}
          onBackdropPress={toggleNostrDMModal}
        />
        <BottomModal
            isVisible={isWithdrawModalVisible ? true : false}
            style={{alignItems: 'stretch'}}
            ContentComponent={
                (isWithdrawRequestSuccess ? (
                    <LnurlWithdrawSuccessBlock 
                        toggleWithdrawModal={toggleWithdrawModal}
                        amountToTopup={amountToTopup}
                        lnurlWithdrawParams={lnurlWithdrawParams as LNURLWithdrawParams}                       
                        lnurlWithdrawResult={lnurlWithdrawResult as LnurlWithdrawResult}
                        onClose={resetState}
                    />
                ) : (
                    <LnurlWithdrawBlock 
                        toggleWithdrawModal={toggleWithdrawModal}
                        amountToTopup={amountToTopup}
                        mintBalanceToTopup={mintBalanceToTopup as MintBalance}
                        lnurlWithdrawParams={lnurlWithdrawParams as LNURLWithdrawParams}                        
                        memo={memo}      
                        onLnurlWithdraw={onLnurlWithdraw}
                        isWithdrawRequestSending={isWithdrawRequestSending}                        
                    />
                )

            )}
            onBackButtonPress={toggleWithdrawModal}
            onBackdropPress={toggleWithdrawModal}
        />
        <BottomModal
          isVisible={isResultModalVisible ? true : false}
          ContentComponent={
            <>
              {resultModalInfo &&
                transactionStatus === TransactionStatus.COMPLETED && (
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
                        onPress={() => navigation.navigate('Wallet', {})}
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
                      title={resultModalInfo?.title || "Topup failed"}
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
  },
)

const MintBalanceSelector = observer(function (props: {
  availableMintBalances: MintBalance[]
  mintBalanceToTopup: MintBalance
  onMintBalanceSelect: any
  onCancel: any
  findByUrl: any
  onMintBalanceConfirm: any
}) {
  const onMintSelect = function (balance: MintBalance) {
    log.trace('onMintBalanceSelect', balance.mint)
    return props.onMintBalanceSelect(balance)
  }

  return (
    <View style={{flex: 1}}>
      <Card
        style={$card}
        heading={'Select mint to top-up'}
        headingStyle={{textAlign: 'center', padding: spacing.small}}
        ContentComponent={
          <>
            <FlatList<MintBalance>
                data={props.availableMintBalances}
                renderItem={({ item, index }) => {                                
                    return(
                        <MintListItem
                            key={item.mint}
                            mint={props.findByUrl(item.mint)}
                            mintBalance={item}
                            onMintSelect={() => onMintSelect(item)}
                            isSelectable={true}
                            isSelected={props.mintBalanceToTopup.mint === item.mint}
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
            text="Create invoice"
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

const SelectedMintBlock = observer(function (props: {
    toggleNostrDMModal: any
    toggleQRModal: any
    toggleWithdrawModal: any
    invoiceToPay: string
    paymentOption: ReceiveOption
    mintBalanceToTopup: MintBalance
    gotoWallet: any
}) {

    const {mintsStore} = useStores()
    const sendBg = useThemeColor('card')
    const tokenTextColor = useThemeColor('textDim')

    return (
        <View style={{flex: 1}}>           
            <Card
                style={$card}
                heading={'Mint to topup'}
                headingStyle={{textAlign: 'center', padding: spacing.small}}
                ContentComponent={
                    <MintListItem
                        mint={
                        mintsStore.findByUrl(
                            props.mintBalanceToTopup?.mint as string,
                        ) as Mint
                        }
                        isSelectable={false}                
                        separator={'top'}
                    />
                }
            />      
            <View style={$bottomContainer}>
                <View style={$buttonContainer}>
                    <Button
                    text='QR code'
                    preset='secondary'
                    onPress={props.toggleQRModal}          
                    LeftAccessory={() => (
                        <Icon
                        icon='faQrcode'
                        // color="white"
                        size={spacing.medium}              
                        />
                    )}
                    />
                    {props.paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST && (
                        <Button
                            text='Send to contact'
                            preset='secondary'
                            onPress={props.toggleNostrDMModal}
                            style={{marginLeft: spacing.medium}}
                            LeftAccessory={() => (
                                <Icon
                                icon='faPaperPlane'
                                // color="white"
                                size={spacing.medium}              
                                />
                            )} 
                        />
                    )}
                    {props.paymentOption === ReceiveOption.LNURL_WITHDRAW && (
                        <Button
                            text='Withdraw'
                            preset='secondary'
                            onPress={props.toggleWithdrawModal}
                            style={{marginLeft: spacing.medium}}
                            LeftAccessory={() => (
                                <Icon
                                icon='faArrowTurnDown'
                                // color="white"
                                size={spacing.medium}              
                                />
                            )} 
                        />
                    )}
                    <Button
                        preset="secondary"
                        tx={'common.close'}
                        onPress={props.gotoWallet}
                        style={{marginLeft: spacing.small}}
                    />
                </View>
            </View>  
        </View>
    )
})

const ShareAsQRCodeBlock = observer(function (props: {
  toggleQRModal: any
  invoiceToPay: string
  onShareToApp: any  
  onCopy: any
  onError: any
}) {
  return (
    <View style={[$bottomModal, {marginHorizontal: spacing.small}]}>
      <Text text={'Scan and pay to top-up'} />
      <View style={$qrCodeContainer}>
        <QRCode 
            size={270} 
            value={props.invoiceToPay}
            onError={props.onError}
        />
      </View>
      <View style={$buttonContainer}>
        <Button
          text="Share"
          onPress={props.onShareToApp}
          style={{marginRight: spacing.medium}}
          LeftAccessory={() => (
            <Icon
              icon="faShareFromSquare"
              color="white"
              size={spacing.medium}
              // containerStyle={{marginRight: spacing.small}}
            />
          )}
        />
        <Button preset="secondary" text="Copy" onPress={props.onCopy} />
        <Button
          preset="tertiary"
          text="Close"
          onPress={props.toggleQRModal}
        />
      </View>
    </View>
  )
})


const SendAsNostrDMBlock = observer(function (props: {
    toggleNostrDMModal: any
    encodedInvoiceToSend: string
    contactToSendFrom: Contact
    contactToSendTo: Contact
    relaysToShareTo: string[]
    amountToTopup: string
    sendAsNostrDM: any 
    isNostrDMSending: boolean   
  }) {
    const sendBg = useThemeColor('background')
    const tokenTextColor = useThemeColor('textDim')    
      
    return (
      <View style={$bottomModal}>
        <NostrDMInfoBlock
            contactToSendFrom={props.contactToSendFrom as NostrProfile}
            amountToTopup={props.amountToTopup}
            contactToSendTo={props.contactToSendTo as NostrProfile}
        />
        <ScrollView
          style={[
            $tokenContainer,
            {backgroundColor: sendBg, marginHorizontal: spacing.small},
          ]}>
          <Text
            selectable
            text={props.encodedInvoiceToSend}
            style={{color: tokenTextColor, paddingBottom: spacing.medium}}
            size="xxs"
          />
        </ScrollView>
        {props.isNostrDMSending ? (
            <View style={[$buttonContainer, {minHeight: verticalScale(55)}]}>
                <Loading />
            </View>            
        ) : (
            <View style={$buttonContainer}>            
                <Button
                    text="Send request"
                    onPress={props.sendAsNostrDM}
                    style={{marginRight: spacing.medium}}
                    LeftAccessory={() => (
                    <Icon
                        icon="faPaperPlane"
                        color="white"
                        size={spacing.medium}
                        // containerStyle={{marginRight: spacing.small}}
                    />
                    )}
                />          
                <Button
                    preset="tertiary"
                    text="Close"
                    onPress={props.toggleNostrDMModal}
                />           
            </View>
        )}        
      </View>
    )
  })


  const NostrDMSuccessBlock = observer(function (props: {
    toggleNostrDMModal: any
    contactToSendFrom: Contact
    contactToSendTo: Contact
    amountToTopup: string
    onClose: any   
  }) {
  
    return (
      <View style={$bottomModal}>
        {/* <NostrDMInfoBlock
            contactToSendFrom={props.contactToSendFrom}
            amountToTopup={props.amountToTopup}
            contactToSendTo={props.contactToSendTo}
        /> */}
        <ResultModalInfo
            icon="faCheckCircle"
            iconColor={colors.palette.success200}
            title="Success!"
            message="Payment request has been successfully sent."
        />
        <View style={$buttonContainer}>
            <Button
            preset="secondary"
            tx={'common.close'}
            onPress={props.onClose}
            />
        </View>
      </View>
    )
})



const NostrDMInfoBlock = observer(function (props: {
    contactToSendFrom: NostrProfile
    amountToTopup: string
    contactToSendTo: NostrProfile
}) {

    const {walletProfileStore} = useStores()
    const tokenTextColor = useThemeColor('textDim')

    return(
        <View style={{flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: spacing.medium}}>
            <View style={{flexDirection: 'column', alignItems: 'center', width: 100}}>
                    <Image style={[
                        $profileIcon, {
                            width: 40, 
                            height: walletProfileStore.isOwnProfile ? 40 :  43,
                            borderRadius: walletProfileStore.isOwnProfile ? 20 :  0,
                        }]} 
                        source={{
                            uri: getImageSource(props.contactToSendFrom.picture as string)
                        }} 
                    />
                    <Text size='xxs' style={{color: tokenTextColor}} text={props.contactToSendFrom.name}/>
            </View>
            <Text size='xxs' style={{color: tokenTextColor, textAlign: 'center', marginLeft: 30,  marginBottom: 20}} text='...........' />
            <View style={{flexDirection: 'column', alignItems: 'center'}}>                
            <Text size='xxs' style={{color: tokenTextColor, marginTop: -20}} text={`requests`} />
                <Icon
                        icon='faPaperPlane'                                
                        size={spacing.medium}                    
                        color={tokenTextColor}                
                />
                <Text size='xxs' style={{color: tokenTextColor, marginBottom: -10}} text={`${props.amountToTopup} SATS`} />
            </View>
            <Text size='xxs' style={{color: tokenTextColor, textAlign: 'center', marginRight: 30, marginBottom: 20}} text='...........' />
            <View style={{flexDirection: 'column', alignItems: 'center', width: 100}}>
                {props.contactToSendTo.picture ? (
                    <View style={{borderRadius: 20, overflow: 'hidden'}}>
                        <Image style={[
                            $profileIcon, {
                                width: 40, 
                                height: 40
                            }]} 
                            source={{
                                uri: getImageSource(props.contactToSendTo.picture as string) 
                            }} 
                        />
                    </View>
                ) : (
                    <Icon
                        icon='faCircleUser'                                
                        size={38}                    
                        color={tokenTextColor}                
                    />
                )}
                <Text size='xxs' style={{color: tokenTextColor}} text={props.contactToSendTo.name}/>
            </View>
        </View>
    )
})


const LnurlWithdrawBlock = observer(function (props: {
    toggleWithdrawModal: any
    amountToTopup: string
    mintBalanceToTopup: MintBalance
    lnurlWithdrawParams: any
    memo: string  
    onLnurlWithdraw: any
    isWithdrawRequestSending: boolean
}) {

  return (
    <View style={[$bottomModal, {alignItems: 'stretch'}]}>
        <Text style={{textAlign: 'center', marginBottom: spacing.small}} text={props.lnurlWithdrawParams.domain} preset={'subheading'} />        
        <ListItem 
            leftIcon='faCheckCircle'
            leftIconColor={colors.palette.success200}
            text={`Withdrawal is available`}
            subText={`Up to ${props.lnurlWithdrawParams.maxWithdrawable / 1000} SATS are available to withdraw`}
            topSeparator={true}
        />
        <ListItem 
            leftIcon='faCheckCircle'
            leftIconColor={colors.palette.success200}
            text={`Invoice for ${props.amountToTopup} SATS created`}
            subText={`Your selected mint balance to top up is ${props.mintBalanceToTopup.mint}`}
            bottomSeparator={true}
        />
        {props.isWithdrawRequestSending ? (
            <View style={[$buttonContainer, {marginTop: spacing.medium}]}> 
                <Loading />
            </View>            
        ) : (             
        <View style={[$buttonContainer, {marginTop: spacing.medium}]}>
            <Button
            text="Withdraw"
            onPress={props.onLnurlWithdraw}
            style={{marginRight: spacing.medium}}
            LeftAccessory={() => (
                <Icon
                icon='faArrowTurnDown'
                color="white"
                size={spacing.medium}
                // containerStyle={{marginRight: spacing.small}}
                />
            )}
            />        
            <Button
            preset="tertiary"
            text="Cancel"
            onPress={props.toggleWithdrawModal}
            />
        </View>
        )}
    </View>
  )
})


const LnurlWithdrawSuccessBlock = observer(function (props: {
    toggleWithdrawModal: any,
    amountToTopup: string,
    lnurlWithdrawParams: LNURLWithdrawParams,                      
    lnurlWithdrawResult: LnurlWithdrawResult,
    onClose: any
  }) {
  
    return (
      <View style={$bottomModal}>
        <ResultModalInfo
            icon='faCheckCircle'
            iconColor={colors.palette.success200}
            title='Success!'
            message={`Withdrawal request has been received by ${props.lnurlWithdrawParams.domain}.`}
        />        
        <View style={$buttonContainer}>
            <Button
                preset="secondary"
                tx={'common.close'}
                onPress={props.onClose}
            />
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
    flex:1,
    padding: spacing.extraSmall,
}

const $memoCard: ViewStyle = {
  marginBottom: spacing.small,
}

const $memoContainer: ViewStyle = {
  flex: 1,
  flexDirection: 'row',
  justifyContent: 'center',
  alignItems: 'center',
}

const $memoInput: TextStyle = {
  flex: 1,
  borderRadius: spacing.small,
  fontSize: 16,
  textAlignVertical: 'center',
  marginRight: spacing.small,
}

const $tokenContainer: ViewStyle = {
  borderRadius: spacing.small,
  alignSelf: 'stretch',
  padding: spacing.small,
  maxHeight: 150,
  marginTop: spacing.small,
  marginBottom: spacing.large,
  // marginHorizontal: spacing.small
}

const $memoButton: ViewStyle = {
  maxHeight: 50,
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
  alignItems: 'center',
  paddingVertical: spacing.large,  
}

const $qrCodeContainer: ViewStyle = {
  backgroundColor: 'white',
  padding: spacing.small,
  margin: spacing.small,
  borderRadius: spacing.small
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}

const $profileIcon: ImageStyle = {
    padding: spacing.medium,
}

const $bottomContainer: ViewStyle = {
    // position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.medium,
    alignSelf: 'stretch',
    // opacity: 0,
  }
