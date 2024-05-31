import {observer} from 'mobx-react-lite'
import {getSnapshot} from 'mobx-state-tree'
import React, {
  FC,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import {useFocusEffect} from '@react-navigation/native'
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
  FlatList,
  ImageStyle,
  Image,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import QRCode from 'react-native-qrcode-svg'
import {spacing, typography, useThemeColor, colors} from '../theme'
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
import {NostrClient, NostrUnsignedEvent, TransactionTaskResult, WalletTask} from '../services'
import {log} from '../services/logService'
import AppError, {Err} from '../utils/AppError'
import {translate} from '../i18n'

import {MintBalance} from '../models/Mint'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { Proof } from '../models/Proof'
import { Contact, ContactType } from '../models/Contact'
import { getImageSource, infoMessage } from '../utils/utils'
import { NotificationService } from '../services/notificationService'
import { SendOption } from './SendOptionsScreen'
import { moderateVerticalScale, verticalScale } from '@gocodingnow/rn-size-matters'
import { MintUnit, formatCurrency, getCurrency } from "../services/wallet/currency"
import { MintHeader } from './Mints/MintHeader'
import { MintBalanceSelector } from './Mints/MintBalanceSelector'
import { round, toNumber } from '../utils/number'
import { QRCodeBlock } from './Wallet/QRCode'
import numbro from 'numbro'
import { TranItem } from './TranDetailScreen'


if (Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const SendScreen: FC<WalletStackScreenProps<'Send'>> = observer(
  function SendScreen({route, navigation}) {

    const isInternetReachable = useIsInternetReachable()

    const {proofsStore, walletProfileStore, transactionsStore, mintsStore, relaysStore} = useStores()
    const amountInputRef = useRef<TextInput>(null)
    const memoInputRef = useRef<TextInput>(null)
    
    const [paymentOption, setPaymentOption] = useState<SendOption>(SendOption.SHOW_TOKEN)
    const [encodedTokenToSend, setEncodedTokenToSend] = useState<string | undefined>()
    const [amountToSend, setAmountToSend] = useState<string>('0')
    const [unit, setUnit] = useState<MintUnit>('sat')
    const [contactToSendFrom, setContactToSendFrom] = useState<Contact| undefined>()    
    const [contactToSendTo, setContactToSendTo] = useState<Contact| undefined>()        
    const [relaysToShareTo, setRelaysToShareTo] = useState<string[]>([])
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<MintBalance[]>([])
    const [mintBalanceToSendFrom, setMintBalanceToSendFrom] = useState<MintBalance | undefined>()
    const [selectedProofs, setSelectedProofs] = useState<Proof[]>([])
    const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
    const [transaction, setTransaction] = useState<Transaction | undefined>()
    const [transactionId, setTransactionId] = useState<number | undefined>()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isAmountEndEditing, setIsAmountEndEditing] = useState<boolean>(false)
    const [isSharedAsNostrDirectMessage, setIsSharedAsNostrDirectMessage] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, title?: string, message: string} | undefined>()
    const [isMemoEndEditing, setIsMemoEndEditing] = useState<boolean>(false)
    const [isLoading, setIsLoading] = useState(false)

    const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
    const [isOfflineSend, setIsOfflineSend] = useState(false)     
    const [isNostrDMModalVisible, setIsNostrDMModalVisible] = useState(false)
    const [isProofSelectorModalVisible, setIsProofSelectorModalVisible] = useState(false) // offline mode
    const [isSendTaskSentToQueue, setIsSendTaskSentToQueue] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [isNostrDMSending, setIsNostrDMSending] = useState(false)
    const [isNostrDMSuccess, setIsNostrDMSuccess] = useState(false)     

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



    useEffect(() => {
        const setUnitAndMint = () => {
            try {
                const {unit, mintUrl} = route.params
                if(!unit) {
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing mint unit in route params')
                }

                setUnit(unit)

                if(mintUrl) {
                    const mintBalance = proofsStore.getMintBalance(mintUrl)    
                    setMintBalanceToSendFrom(mintBalance)
                }
            } catch (e: any) {
                handleError(e)
            }
        }
        
        setUnitAndMint()
        return () => {}
    }, [])


    // Send to contact
    useFocusEffect(
        useCallback(() => {

            const {paymentOption, contact} = route.params

            const prepareSendToContact = () => {
                try {
                    let relays: string[] = []                
                    log.trace('[prepareSendToContact] selected contact', contact, paymentOption)
        
                    if(contact?.type === ContactType.PUBLIC) {
                        relays = relaysStore.allPublicUrls
                    } else {
                        relays = relaysStore.allUrls
                    }
        
                    if (!relays) {                    
                        throw new AppError(Err.VALIDATION_ERROR, 'Missing NOSTR relays')
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

                    setPaymentOption(SendOption.SEND_TOKEN)
                    setContactToSendFrom(contactFrom)                
                    setContactToSendTo(contact)                
                    setRelaysToShareTo(relays)

                    if(encodedTokenToSend) {
                        toggleNostrDMModal() // open if we already have an invoice
                    }

                    //reset
                    navigation.setParams({
                        paymentOption: undefined,
                        contact: undefined
                    })
                    
                } catch(e: any) {
                    handleError(e)
                }
            }            

            if(paymentOption && contact && paymentOption === SendOption.SEND_TOKEN) {
                prepareSendToContact()
            }
            
        }, [route.params?.paymentOption])
    )

    
    // Offline send
    useEffect(() => {        
        if(isInternetReachable) return
        log.trace('[Offline send]')

        // if offline we set all non-zero mint balances as available to allow ecash selection
        const availableBalances = proofsStore.getMintBalancesWithEnoughBalance(1, unit)

        if (availableBalances.length === 0) {
            setInfo('There are not enough funds to send')
            return
        }
        
        log.trace('Setting availableBalances')

        setIsOfflineSend(true)
        setAvailableMintBalances(availableBalances)
        setMintBalanceToSendFrom(availableBalances[0])        
        setIsMintSelectorVisible(true)      
    }, [isInternetReachable])


    useEffect(() => {
        const handleSendTaskResult = async (result: TransactionTaskResult) => {
            log.trace('handleSendTaskResult event handler triggered')
            
            setIsLoading(false)

            const {transaction} = result

            setTransactionStatus(transaction?.status)
            setTransaction(transaction)
            setTransactionId(transaction?.id)
    
            if (result.encodedTokenToSend) {
                setEncodedTokenToSend(result.encodedTokenToSend)
            }

            if (result.error) {
                setResultModalInfo({
                    status: result.transaction?.status as TransactionStatus,
                    title: result.error.params?.message ? result.error.message : 'Send failed',
                    message: result.error.params?.message || result.error.message,
                })
                setIsResultModalVisible(true)
                return
            }
    
            setIsMintSelectorVisible(false)   
    
            if (paymentOption === SendOption.SEND_TOKEN) {
                toggleNostrDMModal()
            }   
        }

        // Subscribe to the 'sendCompleted' event
        EventEmitter.on('ev_sendTask_result', handleSendTaskResult)

        // Unsubscribe from the 'sendCompleted' event on component unmount
        return () => {
            EventEmitter.off('ev_sendTask_result', handleSendTaskResult)
        }
    }, [isSendTaskSentToQueue])


    useEffect(() => {
        const handleSendCompleted = async (transactionIds: number[]) => {
            log.trace('handleSendCompleted event handler triggered')

            if (!transactionId) return
            // Filter and handle events for a specific transactionId
            if (transactionIds.includes(transactionId)) {
                log.trace(
                    'Sent ecash has been claimed by the receiver for tx',
                    transactionId,
                )

                setTransactionStatus(TransactionStatus.COMPLETED)                
                setIsProofSelectorModalVisible(false)

                const receiver = (contactToSendTo?.nip05) ? contactToSendTo?.nip05 : 'unknown wallet'

                try {
                    const amountSentInt = round(toNumber(amountToSend) * getCurrency(unit).precision, 0)

                    await NotificationService.createLocalNotification(
                        '🚀 That was fast!',
                        `<b>${formatCurrency(amountSentInt, getCurrency(unit).code)} ${getCurrency(unit).code}</b> were received by <b>${receiver}</b>.`,
                         contactToSendTo?.picture             
                    )

                    return navigation.navigate('Wallet', {})
                } catch(e: any) {
                    log.error(e.name, e.message) // silent
                }
            }
        }

        // Subscribe to the 'sendCompleted' event
        EventEmitter.on('ev_sendCompleted', handleSendCompleted)

        // Unsubscribe from the 'sendCompleted' event on component unmount
        return () => {
            EventEmitter.off('ev_sendCompleted', handleSendCompleted)
        }
    }, [transactionId])
       
    const toggleNostrDMModal = () => setIsNostrDMModalVisible(previousState => !previousState)
    const toggleProofSelectorModal = () => setIsProofSelectorModalVisible(previousState => !previousState)
    const toggleResultModal = () => setIsResultModalVisible(previousState => !previousState)

    const onAmountEndEditing = function () {
        try {        
            const precision = getCurrency(unit).precision
            const mantissa = getCurrency(unit).mantissa
            const amount = round(toNumber(amountToSend) * precision, 0)
            //const amount = parseInt(amountToSend)

            log.trace('[onAmountEndEditing]', amount)

            if (!amount || amount === 0) {
                infoMessage(translate('payCommon.amountZeroOrNegative'))
                return
            }
            
            const availableBalances = proofsStore.getMintBalancesWithEnoughBalance(amount, unit)

            if (availableBalances.length === 0) {
                infoMessage(translate('payCommon.insufficientFunds'))
                return
            }

            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
            
            setAmountToSend(`${numbro(amountToSend).format({thousandSeparated: true, mantissa: getCurrency(unit).mantissa})}`)
            setAvailableMintBalances(availableBalances)

            // Default mint if not set from route params is with the one with highest balance
            if(!mintBalanceToSendFrom) {setMintBalanceToSendFrom(availableBalances[0])}
            setIsAmountEndEditing(true)
            // We do not make memo focus mandatory            
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
        if (parseInt(amountToSend) > 0) {
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
        setMintBalanceToSendFrom(balance)
    }


    const onMintBalanceConfirm = async function () {
        if (!mintBalanceToSendFrom) {
            return
        }       

        setIsLoading(true)       
        setIsSendTaskSentToQueue(true)       

        const amountToSendInt = round(toNumber(amountToSend) * getCurrency(unit).precision, 0)

        WalletTask.send(
            mintBalanceToSendFrom as MintBalance,
            amountToSendInt,
            unit,
            memo,
            selectedProofs
        )
    }


    const onSelectProofsOffline = async function () {
        if (!mintBalanceToSendFrom) {
            return
        }       

        setIsProofSelectorModalVisible(true)
    }



    const onMintBalanceCancel = async function () {
        setIsMintSelectorVisible(false)
        
        amountInputRef && amountInputRef.current
        ? amountInputRef.current.focus()
        : false
    }



    const sendAsNostrDM = async function () {
        try {            
            setIsNostrDMSending(true)
            const senderPubkey = walletProfileStore.pubkey            
            const receiverPubkey = contactToSendTo?.pubkey

            // log.trace('', {senderPrivkey, senderPubkey, receiverPubkey}, 'sendAsNostrDM')
            const message = `nostr:${walletProfileStore.npub} sent you ${amountToSend} ${getCurrency(unit).code} from Minibits wallet!`
            const content = message + ' \n' + encodedTokenToSend

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
                created_at: Math.floor(Date.now() / 1000)
            }

            const sentEvent: Event | undefined = await NostrClient.publish(
                dmEvent,
                relaysToShareTo,                     
            )
            
            setIsNostrDMSending(false)

            if(sentEvent) {                
                setIsNostrDMSuccess(true)

                if(!transactionId) {
                    return
                }

                const transaction = transactionsStore.findById(transactionId)

                if(!transaction || !transaction.data) {
                    return
                }
                
                const updated = JSON.parse(transaction.data)

                if(updated.length > 2) {
                    updated[2].sentToRelays = relaysToShareTo
                    updated[2].sentEvent = sentEvent
                    
                    await transactionsStore.updateStatus( // status does not change, just add event and relay info to tx.data
                        transactionId,
                        TransactionStatus.PENDING,
                        JSON.stringify(updated)
                    )
                }

                const txupdate = await transactionsStore.updateSentTo( // set contact to send to to the tx, could be elsewhere //
                    transactionId,                    
                    contactToSendTo?.nip05handle as string
                )

                log.trace('sentTo tx', txupdate, 'sendAsNostrDM')
            } else {
                setInfo('Relay could not confirm that the message has been published')
            }
        } catch (e: any) {
            handleError(e)
        }
    }


    const toggleSelectedProof = function (proof: Proof) {
        setSelectedProofs(prevSelectedProofs => {
          const isSelected = prevSelectedProofs.some(
            p => p.secret === proof.secret
          )
  
          if (isSelected) {
            // If the proof is already selected, remove it from the array            
            setAmountToSend(`${parseInt(amountToSend) - proof.amount}`)
            return prevSelectedProofs.filter(p => p.secret !== proof.secret)
          } else {
            // If the proof is not selected, add it to the array            
            setAmountToSend(`${(parseInt(amountToSend) || 0) + proof.amount}`)
            return [...prevSelectedProofs, proof]
          }
        })
    }

    const resetSelectedProofs = function () {
        setSelectedProofs([])
        setAmountToSend('0')
    }


    const onOfflineSendConfirm = function () {
        toggleProofSelectorModal() // close
        onMintBalanceConfirm()
    }


    const gotoContacts = function () {
        navigation.navigate('ContactsNavigator', {
            screen: 'Contacts', 
            params: {            
              paymentOption: SendOption.SEND_TOKEN
            }})
    }


    const resetState = function () {
        // reset state so it does not interfere next payment
        setAmountToSend('')
        setMemo('')
        setIsAmountEndEditing(false)
        setIsMemoEndEditing(false)
        setIsMintSelectorVisible(false)
        setIsNostrDMModalVisible(false)
        setIsSharedAsNostrDirectMessage(false)
        setIsNostrDMSending(false)
        setIsNostrDMModalVisible(false)
        setIsProofSelectorModalVisible(false)
        setIsLoading(false)

        navigation.popToTop()
    }


    const handleError = function(e: AppError): void {
        // TODO resetState() on all tx data on error? Or save txId to state and allow retry / recovery?
        setIsNostrDMSending(false)
        setIsProofSelectorModalVisible(false)
        setIsNostrDMModalVisible(false)
        setIsLoading(false)
        setError(e)
    }

    const headerBg = useThemeColor('header')
    const satsColor = colors.palette.primary200
    // const inputBg = useThemeColor('background')

    return (
      <Screen preset="fixed" contentContainerStyle={$screen}>
        <MintHeader 
            mint={mintBalanceToSendFrom ? mintsStore.findByUrl(mintBalanceToSendFrom?.mintUrl) : undefined}
            unit={unit}
            navigation={navigation}
        />
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>        
            <View style={$amountContainer}>
                <TextInput
                    ref={amountInputRef}
                    onChangeText={amount => setAmountToSend(amount)}                
                    onEndEditing={onAmountEndEditing}
                    value={amountToSend}
                    style={$amountInput}
                    maxLength={9}
                    keyboardType="numeric"
                    selectTextOnFocus={true}
                    editable={
                        (transactionStatus === TransactionStatus.PENDING || isOfflineSend)
                            ? false 
                            : true
                    }
                />
                <Text
                    size='sm'
                    text="Amount to send"
                    style={{color: 'white', textAlign: 'center'}}
                />  
            </View>          
        </View>
        <View style={$contentContainer}>
        {!encodedTokenToSend && (
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
                        placeholder="Memo for recipient"
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
            )} 
         
            {isMintSelectorVisible && (
                <MintBalanceSelector
                    mintBalances={availableMintBalances}
                    selectedMintBalance={mintBalanceToSendFrom as MintBalance}
                    unit={unit}
                    title='Send from mint'
                    confirmTitle={isOfflineSend ? 'Send offline' : 'Create token'}
                    onMintBalanceSelect={onMintBalanceSelect}
                    onCancel={onMintBalanceCancel}              
                    onMintBalanceConfirm={isOfflineSend ? onSelectProofsOffline : onMintBalanceConfirm}
                />
            )}
            {transactionStatus === TransactionStatus.PENDING && encodedTokenToSend && paymentOption && (
                <>
                    <QRCodeBlock                  
                        qrCodeData={encodedTokenToSend as string}
                        title='Ecash token to send'                        
                    />
                    <TokenOptionsBlock                    
                        toggleNostrDMModal={toggleNostrDMModal}
                        contactToSendTo={contactToSendTo}                  
                        gotoContacts={gotoContacts}                    
                    />
                </>
            )}
            {transaction && transactionStatus === TransactionStatus.COMPLETED && (
                <Card
                    style={{padding: spacing.medium}}
                    ContentComponent={
                    <>
                        <TranItem 
                            label="tranDetailScreen.sentTo"
                            isFirst={true}
                            value={mintsStore.findByUrl(transaction.mint)?.shortname as string}
                        />
                        {transaction?.memo && (
                        <TranItem
                            label="tranDetailScreen.memoToReceiver"
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
            {error && <ErrorModal error={error} />}
            {info && <InfoModal message={info} />}
        </View>
        <BottomModal
          isVisible={isProofSelectorModalVisible}
          ContentComponent={
            <SelectProofsBlock
                mintBalanceToSendFrom={mintBalanceToSendFrom as MintBalance}
                unit={unit}
                selectedProofs={selectedProofs}               
                toggleProofSelectorModal={toggleProofSelectorModal}
                toggleSelectedProof={toggleSelectedProof} 
                resetSelectedProofs={resetSelectedProofs}           
                onOfflineSendConfirm={onOfflineSendConfirm}                
            />
          }
          onBackButtonPress={toggleProofSelectorModal}
          onBackdropPress={toggleProofSelectorModal}
        />
        <BottomModal
          isVisible={isNostrDMModalVisible ? true : false}
          ContentComponent={
            (isNostrDMSuccess ? (
            <NostrDMSuccessBlock
                toggleNostrDMModal={toggleNostrDMModal}
                contactToSendFrom={contactToSendFrom as Contact}
                contactToSendTo={contactToSendTo as Contact}                
                amountToSend={amountToSend}
                onClose={resetState}                
            />
            ) : (
            <SendAsNostrDMBlock
                toggleNostrDMModal={toggleNostrDMModal}
                encodedTokenToSend={encodedTokenToSend as string}
                contactToSendFrom={contactToSendFrom as Contact}
                contactToSendTo={contactToSendTo as Contact}
                relaysToShareTo={relaysToShareTo}
                amountToSend={amountToSend}
                unit={unit}
                sendAsNostrDM={sendAsNostrDM}
                isNostrDMSending={isNostrDMSending}                
            />
            ))
            
          }
          onBackButtonPress={toggleNostrDMModal}
          onBackdropPress={toggleNostrDMModal}
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
                      title={resultModalInfo?.title || "Send failed"}
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
      </Screen>
    )
  }
)


const SelectProofsBlock = observer(function (props: {    
    mintBalanceToSendFrom: MintBalance
    unit: MintUnit
    selectedProofs: Proof[]
    toggleProofSelectorModal: any                    
    toggleSelectedProof: any
    resetSelectedProofs: any
    onOfflineSendConfirm: any
  }) {

    const {proofsStore} = useStores()
    const hintColor = useThemeColor('textDim')

    
    const onCancel = function () {        
        props.resetSelectedProofs()
        props.toggleProofSelectorModal()        
    }
    
    return (
        <View style={$bottomModal}>
            <Text text='Select ecash to send' />
            <Text
                text='You can send only exact ecash denominations while you are offline.'
                style={{color: hintColor, paddingHorizontal: spacing.small, textAlign: 'center', marginBottom: spacing.small}}
                size='xs'
            />
            <View style={{maxHeight: spacing.screenHeight * 0.45}}>
                <FlatList<Proof>
                    data={proofsStore.getByMint(props.mintBalanceToSendFrom.mintUrl, {isPending: false, unit: props.unit})}
                    renderItem={({ item }) => {
                        const isSelected = props.selectedProofs.some(
                            p => p.secret === item.secret
                        )

                        return (
                            <Button
                                preset={isSelected ? 'default' : 'secondary'}
                                onPress={() => props.toggleSelectedProof(item)}
                                text={`${item.amount}`}
                                style={{minWidth: 80, margin: spacing.small}}
                            />
                        )
                    }}
                    numColumns={3}
                    keyExtractor={(item) => item.secret}
                />
            </View>
            <View style={[$buttonContainer, {marginTop: spacing.extraLarge}]}>
                <Button
                    text="Create token"
                    onPress={props.onOfflineSendConfirm}
                    style={{marginRight: spacing.medium}}          
                />
                <Button 
                    preset="secondary" 
                    text="Cancel" 
                    onPress={onCancel} 
                />        
            </View>
        </View>
    )
    
  })


  const TokenOptionsBlock = observer(function (props: {
    toggleNostrDMModal: any
    contactToSendTo?: Contact   
    gotoContacts: any
}) {

    return (
        <View style={{flex: 1}}>               
            <View style={$bottomContainer}>
                <View style={$buttonContainer}>
                  {props.contactToSendTo ? (
                    <Button
                        text={`Send to ${props.contactToSendTo.nip05}`}
                        preset='secondary'
                        onPress={props.toggleNostrDMModal}
                        style={{maxHeight: 50}}
                        LeftAccessory={() => (
                            <Icon
                            icon='faPaperPlane'
                            // color="white"
                            size={spacing.medium}              
                            />
                        )} 
                    />
                  ) : (
                    <Button
                        text='Send to contact'
                        preset='secondary'
                        onPress={props.gotoContacts}
                        style={{maxHeight: 50}}
                        LeftAccessory={() => (
                            <Icon
                            icon='faPaperPlane'
                            // color="white"
                            size={spacing.medium}              
                            />
                        )} 
                    />
                  )}
                </View>
            </View>  
        </View>
    )
})


const SendAsNostrDMBlock = observer(function (props: {
    toggleNostrDMModal: any
    encodedTokenToSend: string
    contactToSendFrom: Contact
    contactToSendTo: Contact
    relaysToShareTo: string[]
    amountToSend: string
    unit: MintUnit
    sendAsNostrDM: any 
    isNostrDMSending: boolean   
  }) {
    const sendBg = useThemeColor('background')
    const tokenTextColor = useThemeColor('textDim')    
      
    return (
      <View style={$bottomModal}>
        <Text text={'Send to contact'} />
        <NostDMInfoBlock
            contactToSendFrom={props.contactToSendFrom}
            amountToSend={props.amountToSend}
            unit={props.unit}
            contactToSendTo={props.contactToSendTo}
        />
        <ScrollView
          style={[
            $tokenContainer,
            {backgroundColor: sendBg, marginHorizontal: spacing.small},
          ]}>
          <Text
            selectable
            text={props.encodedTokenToSend}
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
                    text="Send"
                    onPress={props.sendAsNostrDM}
                    style={{marginRight: spacing.medium}}
                    LeftAccessory={() => (
                    <Icon
                        icon="faPaperPlane"
                        color="white"
                        size={spacing.medium}
                        //containerStyle={{marginRight: spacing.small}}
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
    amountToSend: string
    onClose: any   
  }) {
  
    return (
      <View style={$bottomModal}>
        {/*<NostDMInfoBlock
            contactToSendFrom={props.contactToSendFrom}
            amountToSend={props.amountToSend}
            contactToSendTo={props.contactToSendTo}
        />*/}
        <ResultModalInfo
            icon="faCheckCircle"
            iconColor={colors.palette.success200}
            title="Success!"
            message="Ecash has been successfully sent."
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

const NostDMInfoBlock = observer(function (props: {
    contactToSendFrom: Contact
    amountToSend: string
    unit: MintUnit
    contactToSendTo: Contact
}) {

    const {walletProfileStore} = useStores()
    const tokenTextColor = useThemeColor('textDim')
    const amountToSendInt = round(toNumber(props.amountToSend) * getCurrency(props.unit).precision, 0)
    const amountToSendDisplay = formatCurrency(amountToSendInt, getCurrency(props.unit).code)
    

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
                <Icon
                        icon='faPaperPlane'                                
                        size={spacing.medium}                    
                        color={tokenTextColor}                
                />
                <Text size='xxs' style={{color: tokenTextColor, marginBottom: -10}} text={`${amountToSendDisplay} ${getCurrency(props.unit).code}`} />
            </View>
            <Text size='xxs' style={{color: tokenTextColor, textAlign: 'center', marginRight: 30, marginBottom: 20}} text='...........' />
            <View style={{flexDirection: 'column', alignItems: 'center', width: 100}}>
                {props.contactToSendTo.picture ? (
                    <View style={{borderRadius: 20, overflow: 'hidden'}}>
                        <Image style={[
                            $profileIcon, {
                                width: 40, 
                                height: props.contactToSendTo.isExternalDomain ? 40 :  43,
                                borderRadius: props.contactToSendTo.isExternalDomain ? 20 :  0,
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
    fontSize: moderateVerticalScale(48),
    fontFamily: typography.primary?.medium,
    textAlign: 'center',
    color: 'white',    
}

const $contentContainer: TextStyle = {
    flex: 1,
    padding: spacing.extraSmall,
    marginTop: -spacing.extraLarge * 2
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
  maxHeight: 114,
  marginTop: spacing.small,
  marginBottom: spacing.large,
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
    paddingHorizontal: spacing.small,    
    marginHorizontal: spacing.small,
    marginBottom: spacing.small,
    borderRadius: spacing.small,
    alignItems: 'center',
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


