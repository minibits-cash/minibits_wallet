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
import {log} from '../utils/logger'
import AppError, {Err} from '../utils/AppError'
import {translate} from '../i18n'

import {Mint, MintBalance} from '../models/Mint'
import {MintListItem} from './Mints/MintListItem'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { Proof } from '../models/Proof'
import { Contact } from '../models/Contact'
import { getImageSource } from '../utils/utils'

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
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
    
    const [encodedTokenToSend, setEncodedTokenToSend] = useState<string | undefined>()
    const [amountToSend, setAmountToSend] = useState<string>('')
    const [contactToSendFrom, setContactToSendFrom] = useState<Contact| undefined>()    
    const [contactToSendTo, setContactToSendTo] = useState<Contact| undefined>()        
    const [relaysToShareTo, setRelaysToShareTo] = useState<string[]>([])
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<
      MintBalance[]
    >([])
    const [mintBalanceToSendFrom, setMintBalanceToSendFrom] = useState<
      MintBalance | undefined
    >()
    const [selectedProofs, setSelectedProofs] = useState<Proof[]>([])
    const [transactionStatus, setTransactionStatus] = useState<
      TransactionStatus | undefined
    >()
    const [transactionId, setTransactionId] = useState<number | undefined>()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isAmountEndEditing, setIsAmountEndEditing] = useState<boolean>(false)
    const [isSharedAsNostrDirectMessage, setIsSharedAsNostrDirectMessage] = useState<boolean>(false)
    const [isSharedAsText, setIsSharedAsText] = useState<boolean>(false)
    const [isSharedAsQRCode, setIsSharedAsQRCode] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, message: string} | undefined>()
    const [isMemoEndEditing, setIsMemoEndEditing] = useState<boolean>(false)
    const [isLoading, setIsLoading] = useState(false)

    const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
    const [isSendModalVisible, setIsSendModalVisible] = useState(false)
    const [isQRModalVisible, setIsQRModalVisible] = useState(false)     
    const [isNostrDMModalVisible, setIsNostrDMModalVisible] = useState(false)
    const [isProofSelectorModalVisible, setIsProofSelectorModalVisible] = useState(false) // offline mode
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [isNostrDMSending, setIsNostrDMSending] = useState(false)
    const [isNostrDMSuccess, setIsNostrDMSuccess] = useState(false)     

    useEffect(() => {
        const focus = () => {
            if (route.params?.amountToSend) {
                return
            }

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
            const prepareSendAsNostrDM = () => {
                if (!route.params?.amountToSend) {
                    return
                }

                if (!route.params?.contact) {
                    return
                }

                if (!route.params?.relays) {
                    return
                }

                log.trace('prepareSendAsNostrDM')

                const amount = route.params?.amountToSend
                const contactTo = route.params?.contact
                const relays = route.params?.relays
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

                setAmountToSend(amount)                
                setContactToSendFrom(contactFrom)                
                setContactToSendTo(contactTo)                
                setRelaysToShareTo(relays)
                // skip showing of sharing options and set this one immediately
                setIsSharedAsNostrDirectMessage(true)
            }

            prepareSendAsNostrDM()
            
        }, [route.params?.amountToSend, route.params?.contact, route.params?.relays]),
    )

    // Make sure amountToSend has been set to state ****
    useEffect(() => {        
        if(isSharedAsNostrDirectMessage && parseInt(amountToSend) > 0) {            
            onAmountEndEditing()  
        }      
              
    }, [amountToSend, isSharedAsNostrDirectMessage])


    // Offline send
    useEffect(() => {        
        if(isInternetReachable) return
        log.trace('Offline send effect')

        // if offline we set all non-zero mint balances as available to allow coin selection
        const availableBalances =
        proofsStore.getMintBalancesWithEnoughBalance(1)

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
        const handleSendCompleted = (transactionIds: number[]) => {
            log.trace('handleSendCompleted event handler trigerred')

            if (!transactionId) return
            // Filter and handle events for a specific transactionId
            if (transactionIds.includes(transactionId)) {
                log.trace(
                    'Sent coins have been claimed by receiver for tx',
                    transactionId,
                )

                setResultModalInfo({
                    status: TransactionStatus.COMPLETED,
                    message: `That was fast! ${amountToSend} sats were received by ${contactToSendTo?.name}.`,
                })

                setTransactionStatus(TransactionStatus.COMPLETED)
                setIsQRModalVisible(false)
                setIsSendModalVisible(false)
                setIsNostrDMModalVisible(false)
                setIsProofSelectorModalVisible(false)
                setIsResultModalVisible(true)
            }
        }

        // Subscribe to the 'sendCompleted' event
        EventEmitter.on('sendCompleted', handleSendCompleted)

        // Unsubscribe from the 'sendCompleted' event on component unmount
        return () => {
            EventEmitter.off('sendCompleted', handleSendCompleted)
        }
    }, [transactionId])

    const toggleSendModal = () =>
      setIsSendModalVisible(previousState => !previousState)
    const toggleQRModal = () =>
      setIsQRModalVisible(previousState => !previousState)
    const toggleNostrDMModal = () =>
      setIsNostrDMModalVisible(previousState => !previousState)
    const toggleProofSelectorModal = () =>
       setIsProofSelectorModalVisible(previousState => !previousState)
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)


  const onAmountEndEditing = function () {
      try {        
        const amount = parseInt(amountToSend)

        if (!amount || amount === 0) {
          setInfo('Amount should be positive number')
          return
        }

        const availableBalances =
          proofsStore.getMintBalancesWithEnoughBalance(amount)

        if (availableBalances.length === 0) {
          setInfo('There is not enough funds to send this amount')
          return
        }

        log.trace(
          'availableBalances',
          availableBalances.length          
        )

        setAvailableMintBalances(availableBalances)

        // Set mint to send from immediately if only one is available
        if (availableBalances.length === 1) {
          setMintBalanceToSendFrom(availableBalances[0])
        }

        setIsAmountEndEditing(true)
        
        // Skip memo focus if it is filled / has been done already
        if(!memo && !isMemoEndEditing) {
            setTimeout(() => {memoInputRef && memoInputRef.current
            ? memoInputRef.current.focus()
            : false}, 200)
        } else {
            onMemoEndEditing()
        }

      } catch (e: any) {
        handleError(e)
      }
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


    const onMemoEndEditing = function () {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
      setIsMemoEndEditing(true)

      // On payment to selected contact we skip showing sharing options, continue immediately
      if(isSharedAsNostrDirectMessage) {
        onShareAsNostrDM()
      }
    }


    const onShareAsText = function () {
      // if tx has been already executed, re-open SendModal
      if (transactionStatus === TransactionStatus.PENDING) {
        toggleSendModal() // open
        return
      }

      setIsSharedAsText(true)
      setIsSharedAsQRCode(false)
      setIsSharedAsNostrDirectMessage(false)
      // pass share kind directly to avoid delayed state update
      return onShare('TEXT')
    }

    const onShareAsQRCode = function () {
      // if tx has been already executed, re-open QRCodeModal
      if (transactionStatus === TransactionStatus.PENDING) {
        toggleQRModal() // open
        return
      }

      setIsSharedAsQRCode(true)
      setIsSharedAsText(false)
      setIsSharedAsNostrDirectMessage(false)
      return onShare('QRCODE')
    }

    const onShareAsNostrDM = function () {
        // Tap on Send to contact option after send completed        
        if (transactionStatus === TransactionStatus.PENDING) { 
            toggleNostrDMModal()   
            return
        }             
        
        // Send initiated from contacts screen
        if(isSharedAsNostrDirectMessage) {            
            setIsSharedAsQRCode(false)
            setIsSharedAsText(false)

            return onShare('NOSTRDM')
        }

        // Tap on Send to contact after setting amount and memo
        navigation.navigate('ContactsNavigator', {screen: 'Contacts', params: {amountToSend}})
    }


    const onShare = async function (as: 'TEXT' | 'QRCODE' | 'NOSTRDM'): Promise<void> {
        if (amountToSend.length === 0) {
            setInfo('Provide the amount you want to send')
            return
        }

        // Skip mint selector and send immediately if: 
        // 1. only one mint is available or 
        // 2. we did coin selection in offline mode
        if (availableMintBalances.length === 1 || selectedProofs.length > 0) {            

            const result = await send()       

            if (result.error) {
                setResultModalInfo({
                    status: result.transaction?.status as TransactionStatus,
                    message: result.error.message,
                })
                setIsResultModalVisible(true)
                return
            }

            if (as === 'TEXT') {
                toggleSendModal()
            }

            if (as === 'QRCODE') {
                toggleQRModal()
            }

            if (as === 'NOSTRDM') {
                toggleNostrDMModal()
            }

            return
        }

        // Pre-select mint with highest balance and show mint modal to confirm which mint to send from
        setMintBalanceToSendFrom(availableMintBalances[0])
        setIsMintSelectorVisible(true)        
    }

    const onMintBalanceSelect = function (balance: MintBalance) {
        setMintBalanceToSendFrom(balance)
    }

    const onMintBalanceConfirm = async function () {
        if (!mintBalanceToSendFrom) return

        const result = await send()

        if (result.error) {
            setResultModalInfo({
                status: result.transaction?.status as TransactionStatus,
                message: result.error.message,
            })
            setIsResultModalVisible(true)
            return
        }

        // open
        isSharedAsText && toggleSendModal()
        isSharedAsQRCode && toggleQRModal()        
        isSharedAsNostrDirectMessage && toggleNostrDMModal() 

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
            const content = message + '\n' + encodedTokenToSend

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

                if(!transaction) {
                    return
                }
                
                const updated = JSON.parse(transaction.data)

                updated[2].sentToRelays = relaysToShareTo
                updated[2].sentEvent = sentEvent    
                
                await transactionsStore.updateStatus( // status does not change, just add event and relay info to tx.data
                    transactionId,
                    TransactionStatus.PENDING,
                    JSON.stringify(updated)
                )

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
                toggleSendModal()
                setTimeout(
                    () =>
                    setInfo(
                        'Coins have been shared, waiting to be claimed by receiver',
                    ),
                    500,
                )
            } else if (result.action === Share.dismissedAction) {
                setInfo(
                    'Sharing cancelled, coins are waiting to be claimed by receiver',
                )
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


    const onNostrDMSuccessClose = function () {
        // reset state so it does not interfere next payment
        setAmountToSend('')
        setMemo('')
        setIsAmountEndEditing(false)
        setIsMemoEndEditing(false)
        setIsMintSelectorVisible(false)
        setIsNostrDMModalVisible(false)
        setIsSharedAsNostrDirectMessage(false)

        navigation.navigate('Wallet', {})
    }


    const handleError = function(e: AppError): void {
        // TODO resetState() on all tx data on error? Or save txId to state and allow retry / recovery?
        setIsNostrDMSending(false)
        setIsSendModalVisible(false)
        setIsQRModalVisible(false)
        setIsProofSelectorModalVisible(false)
        setIsNostrDMModalVisible(false)
        setIsLoading(false)
        setError(e)
    }

    const headerBg = useThemeColor('header')
    // const inputBg = useThemeColor('background')

    return (
      <Screen preset="auto" contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="subheading"
            text="Amount to send"
            style={{color: 'white'}}
          />          
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
                      ? false
                      : true
                  }
                />
              </View>
            }
          />
            {!isInternetReachable && !isMemoEndEditing && (
                <Button
                    preset="secondary"                    
                    text="Select coins to send"
                    style={{alignSelf: 'center'}}
                    onPress={toggleProofSelectorModal}
                    disabled={
                        transactionStatus === TransactionStatus.PENDING
                        ? true
                        : false
                    }
                />
            )}
          {isAmountEndEditing && isMemoEndEditing && !isMintSelectorVisible && (
            <Card
              style={$card}
              ContentComponent={
                <>
                  <ListItem
                    tx="sendScreen.sendToContact"
                    subTx="sendScreen.sendToContactDescription"
                    leftIcon='faAddressCard'
                    leftIconColor={colors.palette.secondary300}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={onShareAsNostrDM}
                  />
                  <ListItem
                    tx="sendScreen.showAsQRCode"
                    subTx="sendScreen.showAsQRCodeDescription"
                    leftIcon='faQrcode'
                    leftIconColor={colors.palette.success200}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={onShareAsQRCode}
                  />
                  <ListItem
                    tx="sendScreen.shareAsText"
                    subTx="sendScreen.shareAsTextDescription"
                    leftIcon='faShareFromSquare'
                    leftIconColor={colors.palette.accent300}
                    leftIconInverse={true}
                    style={$item}
                    onPress={onShareAsText}
                  />
                </>
              }
            />
          )}

          {isMintSelectorVisible &&
            transactionStatus !== TransactionStatus.PENDING && (
              <MintBalanceSelector
                availableMintBalances={availableMintBalances}
                mintBalanceToSendFrom={mintBalanceToSendFrom as MintBalance}
                onMintBalanceSelect={onMintBalanceSelect}
                onCancel={onMintBalanceCancel}                
                onMintBalanceConfirm={onMintBalanceConfirm}
              />
            )}
          {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isProofSelectorModalVisible ? true : false}
          top={spacing.screenHeight * 0.255}
          style={{marginHorizontal: spacing.extraSmall}}
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
          isVisible={isSendModalVisible ? true : false}
          top={spacing.screenHeight * 0.367}
          style={{marginHorizontal: spacing.extraSmall}}
          ContentComponent={
            <SendAsTextBlock
              toggleSendModal={toggleSendModal}
              encodedTokenToSend={encodedTokenToSend as string}
              onShareToApp={onShareToApp}
              onCopy={onCopy}
            />
          }
          onBackButtonPress={toggleSendModal}
          onBackdropPress={toggleSendModal}
        />
        <BottomModal
          isVisible={isQRModalVisible ? true : false}
          top={spacing.screenHeight * 0.367}
          style={{marginHorizontal: spacing.extraSmall}}
          ContentComponent={
            <SendAsQRCodeBlock
              toggleQRModal={toggleQRModal}
              encodedTokenToSend={encodedTokenToSend as string}
              onCopy={onCopy}
              handleError={handleError}
            />
          }
          onBackButtonPress={toggleQRModal}
          onBackdropPress={toggleQRModal}
        />
        <BottomModal
          isVisible={isNostrDMModalVisible ? true : false}
          top={spacing.screenHeight * 0.367}
          style={{marginHorizontal: spacing.extraSmall}}
          ContentComponent={
            (isNostrDMSuccess ? (
            <NostrDMSuccessBlock
                toggleNostrDMModal={toggleNostrDMModal}
                contactToSendFrom={contactToSendFrom as Contact}
                contactToSendTo={contactToSendTo as Contact}                
                amountToSend={amountToSend}
                onClose={onNostrDMSuccessClose}                
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
          top={spacing.screenHeight * 0.5}
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
            {props.availableMintBalances.map(
              (balance: MintBalance, index: number) => (
                <MintListItem
                  key={balance.mint}
                  mint={mintsStore.findByUrl(balance.mint) as Mint}
                  mintBalance={balance}
                  onMintSelect={() => onMintSelect(balance)}
                  isSelectable={true}
                  isSelected={props.mintBalanceToSendFrom.mint === balance.mint}
                  separator={'top'}
                />
              )
            )}
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
                    text='You can send only exact coin denominations while you are offline.'
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
                <Text text='Select coins to send' />
                <Text
                    text='You can send only exact coin denominations while you are offline.'
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


const SendAsTextBlock = observer(function (props: {
  toggleSendModal: any
  encodedTokenToSend: string
  onShareToApp: any
  onCopy: any
}) {
  const sendBg = useThemeColor('background')
  const tokenTextColor = useThemeColor('textDim')  

  return (
    <View style={$bottomModal}>
      <Text
        text={'Share coins'}
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
              containerStyle={{marginRight: spacing.small}}
            />
          )}
        />
        <Button preset="secondary" text="Copy" onPress={props.onCopy} />
        <Button
          preset="tertiary"
          text="Close"
          onPress={props.toggleSendModal}
        />
      </View>
    </View>
  )
})

const SendAsQRCodeBlock = observer(function (props: {
  toggleQRModal: any
  encodedTokenToSend: string
  onCopy: any
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
        <Button preset="secondary" text="Close" onPress={props.toggleQRModal} />
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
                        containerStyle={{marginRight: spacing.small}}
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
            message="Coins have been succesfully sent."
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
    contactToSendFrom: NostrProfile
    amountToSend: string
    contactToSendTo: NostrProfile
}) {

    const tokenTextColor = useThemeColor('textDim')

    return(
        <View style={{flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: spacing.medium}}>
            <View style={{flexDirection: 'column', alignItems: 'center', width: 100}}>
                    <Image style={[
                        $profileIcon, {
                            width: 40, 
                            height: 43
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


const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
  padding: spacing.extraSmall,
}

const $amountContainer: ViewStyle = {
  height: 90,
  alignSelf: 'center',
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
  flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.large,
  // paddingHorizontal: spacing.small,
}

const $qrCodeContainer: ViewStyle = {
  backgroundColor: 'white',
  padding: spacing.small,
  margin: spacing.small,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}

const $profileIcon: ImageStyle = {
    padding: spacing.medium,
}


