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
import {useHeader} from '../utils/useHeader'
import {Wallet, NostrClient, NostrProfile, KeyPair, NostrUnsignedEvent} from '../services'
import {log} from '../services/logService'
import AppError, {Err} from '../utils/AppError'
import {translate} from '../i18n'

import {Mint, MintBalance} from '../models/Mint'
import {MintListItem} from './Mints/MintListItem'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { Proof } from '../models/Proof'
import { Contact } from '../models/Contact'
import { getImageSource, infoMessage } from '../utils/utils'
import { NotificationService } from '../services/notificationService'
import { SendOption } from './SendOptionsScreen'
import { verticalScale } from '@gocodingnow/rn-size-matters'


if (Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const SendScreen: FC<WalletStackScreenProps<'Send'>> = observer(
  function SendScreen({route, navigation}) {

    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const isInternetReachable = useIsInternetReachable()

    const {proofsStore, walletProfileStore, transactionsStore} = useStores()
    const amountInputRef = useRef<TextInput>(null)
    const memoInputRef = useRef<TextInput>(null)
    
    const [paymentOption, setPaymentOption] = useState<SendOption>(SendOption.SHOW_TOKEN)
    const [encodedTokenToSend, setEncodedTokenToSend] = useState<string | undefined>()
    const [amountToSend, setAmountToSend] = useState<string>('')
    const [contactToSendFrom, setContactToSendFrom] = useState<Contact| undefined>()    
    const [contactToSendTo, setContactToSendTo] = useState<Contact| undefined>()        
    const [relaysToShareTo, setRelaysToShareTo] = useState<string[]>([])
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<MintBalance[]>([])
    const [mintBalanceToSendFrom, setMintBalanceToSendFrom] = useState<MintBalance | undefined>()
    const [selectedProofs, setSelectedProofs] = useState<Proof[]>([])
    const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
    const [transactionId, setTransactionId] = useState<number | undefined>()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isAmountEndEditing, setIsAmountEndEditing] = useState<boolean>(false)
    const [isSharedAsNostrDirectMessage, setIsSharedAsNostrDirectMessage] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, message: string} | undefined>()
    const [isMemoEndEditing, setIsMemoEndEditing] = useState<boolean>(false)
    const [isLoading, setIsLoading] = useState(false)

    const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
    const [isQRModalVisible, setIsQRModalVisible] = useState(false)     
    const [isNostrDMModalVisible, setIsNostrDMModalVisible] = useState(false)
    const [isProofSelectorModalVisible, setIsProofSelectorModalVisible] = useState(false) // offline mode
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


    // Send to contact
    useFocusEffect(
        useCallback(() => {

            const {paymentOption} = route.params

            const prepareSendToken = () => {
                log.trace('prepareSendToken start')
                
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

                setPaymentOption(SendOption.SEND_TOKEN)
                setContactToSendFrom(contactFrom)                
                setContactToSendTo(contact)                
                setRelaysToShareTo(relays)

                navigation.setParams({contact: undefined})
                navigation.setParams({relays: undefined})
            }            

            if(paymentOption && paymentOption === SendOption.SEND_TOKEN) {
                prepareSendToken()
            }
            
        }, [route.params?.paymentOption])
    )

    
    // Offline send
    useEffect(() => {        
        if(isInternetReachable) return
        log.trace('Offline send effect')

        // if offline we set all non-zero mint balances as available to allow ecash selection
        const availableBalances = proofsStore.getMintBalancesWithEnoughBalance(1)

        if (availableBalances.length === 0) {
            setInfo('There is not enough funds to send')
            return
        }
        
        log.trace('Setting availableBalances')

        setAvailableMintBalances(availableBalances)
        if (availableBalances.length === 1) {
            log.trace('Setting mintBalanceToSendFrom')
            setMintBalanceToSendFrom(availableBalances[0])
        }

        setIsProofSelectorModalVisible(true)        
    }, [isInternetReachable])



    useEffect(() => {
        const handleSendCompleted = async (transactionIds: number[]) => {
            log.trace('handleSendCompleted event handler trigerred')

            if (!transactionId) return
            // Filter and handle events for a specific transactionId
            if (transactionIds.includes(transactionId)) {
                log.trace(
                    'Sent ecash has been claimed by the receiver for tx',
                    transactionId,
                )

                setTransactionStatus(TransactionStatus.COMPLETED)
                setIsQRModalVisible(false) // needed ??                
                setIsProofSelectorModalVisible(false)

                const receiver = (contactToSendTo?.nip05) ? contactToSendTo?.nip05 : 'unknown wallet'

                try {
                    await NotificationService.createLocalNotification(
                        '🚀 That was fast!',
                        `<b>${amountToSend} sats</b> were received by <b>${receiver}</b>.`,
                         contactToSendTo?.picture             
                    )

                    return navigation.navigate('Wallet', {})
                } catch(e: any) {
                    log.error(e.name, e.message) // silent
                }
            }
        }

        // Subscribe to the 'sendCompleted' event
        EventEmitter.on('sendCompleted', handleSendCompleted)

        // Unsubscribe from the 'sendCompleted' event on component unmount
        return () => {
            EventEmitter.off('sendCompleted', handleSendCompleted)
        }
    }, [transactionId])

    
    const toggleQRModal = () => setIsQRModalVisible(previousState => !previousState)
    const toggleNostrDMModal = () => setIsNostrDMModalVisible(previousState => !previousState)
    const toggleProofSelectorModal = () => setIsProofSelectorModalVisible(previousState => !previousState)
    const toggleResultModal = () => setIsResultModalVisible(previousState => !previousState)


    const onAmountEndEditing = function () {
        try {        
            const amount = parseInt(amountToSend)

            if (!amount || amount === 0) {
                infoMessage('Amount should be positive number.')
                return
            }

            const availableBalances = proofsStore.getMintBalancesWithEnoughBalance(amount)

            if (availableBalances.length === 0) {
                infoMessage('There is not enough funds to send this amount.')
                return
            }

            setAvailableMintBalances(availableBalances)

            // Default mint with highest balance to topup
            setMintBalanceToSendFrom(availableBalances[0])
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

        const result = await send()

        if (result.error) {
            setResultModalInfo({
                status: result.transaction?.status as TransactionStatus,
                message: result.error.message,
            })
            setIsResultModalVisible(true)
            return
        }

        if (paymentOption === SendOption.SHOW_TOKEN) {
            toggleQRModal()
        }

        if (paymentOption === SendOption.SEND_TOKEN) {
            toggleNostrDMModal()
        }
      
        setIsMintSelectorVisible(false)
    }



    const onMintBalanceCancel = async function () {
        setIsMintSelectorVisible(false)
    }



    const send = async function () {
        setIsLoading(true)
        
        let updatedMemo: string = ''
        if(isSharedAsNostrDirectMessage && memo === '') {
            updatedMemo = `Sent from ${contactToSendFrom?.name}`
        }

        const result = await Wallet.send(
            mintBalanceToSendFrom as MintBalance,
            parseInt(amountToSend),
            memo || updatedMemo,
            selectedProofs
        )

        const {status, id} = result.transaction as Transaction
        setTransactionStatus(status)
        setTransactionId(id)

        if (result.encodedTokenToSend) {
            setEncodedTokenToSend(result.encodedTokenToSend)
        }

        setIsLoading(false)
        return result
    }


    const sendAsNostrDM = async function () {
        try {            
            setIsNostrDMSending(true)
            const senderPubkey = walletProfileStore.pubkey            
            const receiverPubkey = contactToSendTo?.pubkey

            // log.trace('', {senderPrivkey, senderPubkey, receiverPubkey}, 'sendAsNostrDM')
            const message = `nostr:${walletProfileStore.npub} sent you ${amountToSend} sats from Minibits wallet!`
            const content = message + ' \n' + encodedTokenToSend

            const encryptedContent = await NostrClient.encryptNip04(                
                receiverPubkey as string, 
                content as string
            )
            
            // log.trace('Relays', relaysToShareTo)          

            const dmEvent: NostrUnsignedEvent = {
                kind: 4,
                pubkey: senderPubkey,
                tags: [['p', receiverPubkey], ['from', walletProfileStore.nip05]],
                content: encryptedContent,                                      
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

    const onShareToApp = async () => {
        try {
          const result = await Share.share({
            message: encodedTokenToSend as string,
          })
  
          if (result.action === Share.sharedAction) {          
            setTimeout(
              () => infoMessage('Ecash has been shared, waiting to be claimed by receiver'),              
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
            Clipboard.setString(encodedTokenToSend as string)
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
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


    const onSelectProofsConfirm = function () {
        setIsAmountEndEditing(true)
        toggleProofSelectorModal() // close

        const focus = () => {
            memoInputRef && memoInputRef.current
            ? memoInputRef.current.focus()
            : false
        }        
        const timer = setTimeout(() => focus(), 500)
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
        setIsQRModalVisible(false)
        setIsProofSelectorModalVisible(false)
        setIsLoading(false)

        navigation.popToTop()
    }


    const handleError = function(e: AppError): void {
        // TODO resetState() on all tx data on error? Or save txId to state and allow retry / recovery?
        setIsNostrDMSending(false)        
        setIsQRModalVisible(false)
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
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            <Text
                preset="subheading"
                text="Amount to send"
                style={{color: 'white'}}
            />          
            <View style={$amountContainer}>
                <Text 
                    text='SATS' 
                    size='xxs' 
                    style={{color: satsColor, fontFamily: typography.primary?.light}}
                />
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
                        (transactionStatus === TransactionStatus.PENDING || !isInternetReachable)
                            ? false 
                            : true
                    }
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
            {!isInternetReachable && !isMemoEndEditing && (
                <Button
                    preset="secondary"                    
                    text="Select ecash to send"
                    style={{alignSelf: 'center'}}
                    onPress={toggleProofSelectorModal}
                    disabled={
                        transactionStatus === TransactionStatus.PENDING
                        ? true
                        : false
                    }
                />
            )}
          
            {isMintSelectorVisible &&(
                <MintBalanceSelector
                    availableMintBalances={availableMintBalances}
                    mintBalanceToSendFrom={mintBalanceToSendFrom as MintBalance}
                    onMintBalanceSelect={onMintBalanceSelect}
                    onCancel={onMintBalanceCancel}                
                    onMintBalanceConfirm={onMintBalanceConfirm}
                />
            )}
            {transactionStatus === TransactionStatus.PENDING && encodedTokenToSend && paymentOption && (
                <SelectedMintBlock                    
                    toggleNostrDMModal={toggleNostrDMModal}
                    toggleQRModal={toggleQRModal}
                    paymentOption={paymentOption}
                    encodedTokenToSend={encodedTokenToSend}
                    mintBalanceToSendFrom={mintBalanceToSendFrom as MintBalance}
                    gotoWallet={resetState}
                />
            )}
            {(transactionStatus === TransactionStatus.PENDING || transactionStatus === TransactionStatus.COMPLETED)  && (
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
          isVisible={isProofSelectorModalVisible}
          ContentComponent={
            <SelectProofsBlock
                availableMintBalances={availableMintBalances}
                mintBalanceToSendFrom={mintBalanceToSendFrom as MintBalance}                
                onMintBalanceSelect={onMintBalanceSelect}
                selectedProofs={selectedProofs}               
                toggleProofSelectorModal={toggleProofSelectorModal}
                toggleSelectedProof={toggleSelectedProof} 
                resetSelectedProofs={resetSelectedProofs}           
                onSelectProofsConfirm={onSelectProofsConfirm}                
            />
          }
          onBackButtonPress={toggleProofSelectorModal}
          onBackdropPress={toggleProofSelectorModal}
        />
        <BottomModal
          isVisible={isQRModalVisible ? true : false}
          ContentComponent={
            <SendAsQRCodeBlock
              toggleQRModal={toggleQRModal}
              encodedTokenToSend={encodedTokenToSend as string}
              onCopy={onCopy}
              onShareToApp={onShareToApp}
              handleError={handleError}
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
                      title="Send failed"
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
  onMintBalanceConfirm: any
}) {

  const onMintSelect = function (balance: MintBalance) {
    log.trace('onMintBalanceSelect', balance.mint)
    return props.onMintBalanceSelect(balance)
  }

  const {mintsStore} = useStores()

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
                            mint={mintsStore.findByUrl(item.mint) as Mint}
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
          text="Send now"
          onPress={props.onMintBalanceConfirm}
          style={{marginRight: spacing.medium}}
          // LeftAccessory={() => <Icon icon="faCoins" color="white" size={spacing.medium} containerStyle={{marginRight: spacing.small}}/>}
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

const SelectProofsBlock = observer(function (props: {
    availableMintBalances: MintBalance[]
    mintBalanceToSendFrom: MintBalance    
    onMintBalanceSelect: any
    selectedProofs: Proof[]
    toggleProofSelectorModal: any                    
    toggleSelectedProof: any
    resetSelectedProofs: any
    onSelectProofsConfirm: any
  }) {

    const {proofsStore, mintsStore} = useStores()
    const hintColor = useThemeColor('textDim')

    const onMintSelect = function (balance: MintBalance) {
        log.info('onMintBalanceSelect', balance.mint)
        return props.onMintBalanceSelect(balance)
    }
    
    const onBack = function () {        
        props.resetSelectedProofs()
        props.onMintBalanceSelect(undefined)
    }

    if(!props.mintBalanceToSendFrom) {
        return (
            <View style={$bottomModal}>
                <Text text='Select mint to send from' />
                <Text
                    text='You can send only exact ecash denominations while you are offline.'
                    style={{color: hintColor, paddingHorizontal: spacing.small, textAlign: 'center', marginBottom: spacing.small}}
                    size='xs'
                />
                <ScrollView style={{maxHeight: spacing.screenHeight * 0.5, alignSelf: 'stretch'}}>
                    {props.availableMintBalances.map(
                        (balance: MintBalance, index: number) => (
                            <MintListItem
                                key={balance.mint}
                                mint={mintsStore.findByUrl(balance.mint) as Mint}
                                mintBalance={balance}
                                onMintSelect={() => onMintSelect(balance)}
                                isSelectable={true}
                                isSelected={props.mintBalanceToSendFrom ? props.mintBalanceToSendFrom.mint === balance.mint : false}
                                separator={'top'}
                            />
                        )
                    )}
                </ScrollView>
                <View style={$buttonContainer}>
                    <Button 
                        preset="secondary" 
                        text="Cancel" 
                        onPress={props.toggleProofSelectorModal} 
                    />        
                </View>
            </View>
        )
    } else {
        return (
            <View style={$bottomModal}>
                <Text text='Select ecash to send' />
                <Text
                    text='You can send only exact ecash denominations while you are offline.'
                    style={{color: hintColor, paddingHorizontal: spacing.small, textAlign: 'center', marginBottom: spacing.small}}
                    size='xs'
                />
                <View style={{maxHeight: spacing.screenHeight * 0.5}}>
                    <FlatList<Proof>
                        data={proofsStore.getByMint(props.mintBalanceToSendFrom.mint)}
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
                <View style={$buttonContainer}>
                    <Button
                        text="Confirm selection"
                        onPress={props.onSelectProofsConfirm}
                        style={{marginRight: spacing.medium}}          
                    />
                    <Button 
                        preset="secondary" 
                        text="Back" 
                        onPress={onBack} 
                    />        
                </View>
            </View>
        )
    }
    
  })


const SelectedMintBlock = observer(function (props: {
    toggleNostrDMModal: any
    toggleQRModal: any
    encodedTokenToSend: string
    paymentOption: SendOption
    mintBalanceToSendFrom: MintBalance
    gotoWallet: any
}) {

    const {mintsStore} = useStores()
    const sendBg = useThemeColor('card')
    const tokenTextColor = useThemeColor('textDim')

  return (
        <View>            
            <Card
                style={$card}
                heading={'Send from'}
                headingStyle={{textAlign: 'center', padding: spacing.small}}
                ContentComponent={
                    <MintListItem
                        mint={
                        mintsStore.findByUrl(
                            props.mintBalanceToSendFrom?.mint as string,
                        ) as Mint
                        }
                        isSelectable={false}                
                        separator={'top'}
                    />
                }
            /> 
            <View style={$buttonContainer}>
                <Button
                    text='QR code'
                    preset='secondary'
                    onPress={props.toggleQRModal}          
                    LeftAccessory={() => (
                        <Icon
                        icon='faQrcode'
                        //color="white"
                        size={spacing.medium}              
                        />
                    )}
                />
                {props.paymentOption === SendOption.SEND_TOKEN && (
                    <Button
                        text='Send to contact'
                        preset='secondary'
                        onPress={props.toggleNostrDMModal}
                        style={{marginLeft: spacing.medium}}
                        LeftAccessory={() => (
                            <Icon
                            icon='faPaperPlane'
                            //color="white"
                            size={spacing.medium}              
                            />
                        )} 
                    />
                )}
            </View>
        </View>
  )
})




const SendAsQRCodeBlock = observer(function (props: {
  toggleQRModal: any
  encodedTokenToSend: string
  onCopy: any
  onShareToApp: any  
  handleError: any
}) {

  return (
    <View style={[$bottomModal, {marginHorizontal: spacing.small}]}>
      <Text text={'Scan to receive'} />
      <View style={$qrCodeContainer}>                  
            <QRCode 
                size={spacing.screenWidth - spacing.large * 2} value={props.encodedTokenToSend} 
                onError={props.handleError}
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
    encodedTokenToSend: string
    contactToSendFrom: Contact
    contactToSendTo: Contact
    relaysToShareTo: string[]
    amountToSend: string
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
            <View style={$buttonContainer}> 
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
        <NostDMInfoBlock
            contactToSendFrom={props.contactToSendFrom}
            amountToSend={props.amountToSend}
            contactToSendTo={props.contactToSendTo}
        />
        <ResultModalInfo
            icon="faCheckCircle"
            iconColor={colors.palette.success200}
            title="Success!"
            message="Ecash has been succesfully sent."
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
    contactToSendTo: Contact
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
                <Icon
                        icon='faPaperPlane'                                
                        size={spacing.medium}                    
                        color={tokenTextColor}                
                />
                <Text size='xxs' style={{color: tokenTextColor, marginBottom: -10}} text={`${props.amountToSend} sats`} />
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
  height: spacing.screenHeight * 0.18,

}

const $contentContainer: TextStyle = {
    flex: 1,
    padding: spacing.extraSmall,
}

const $amountContainer: ViewStyle = {
  height: verticalScale(100) * 1.05,
  alignItems: 'center',
  justifyContent: 'center',
}

const $coinSelectorContainer: ViewStyle = {
    marginTop: spacing.medium
  }

const $amountInput: TextStyle = {
  flex: 1,
  borderRadius: spacing.small,
  fontSize: 52,
  fontWeight: '400',
  textAlignVertical: 'center',
  textAlign: 'center',
  color: 'white',
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


