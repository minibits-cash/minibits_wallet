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
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import QRCode from 'react-native-qrcode-svg'
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
import {TransactionStatus, Transaction} from '../models/Transaction'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {NostrClient, NostrProfile, NostrUnsignedEvent, Wallet} from '../services'
import {log} from '../utils/logger'
import AppError from '../utils/AppError'

import {MintBalance} from '../models/Mint'
import {MintListItem} from './Mints/MintListItem'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {Invoice} from '../models/Invoice'
import { useFocusEffect } from '@react-navigation/native'
import { Contact } from '../models/Contact'
import { getImageSource } from '../utils/utils'

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

    const [amountToTopup, setAmountToTopup] = useState<string>('')
    const [contactToSendFrom, setContactToSendFrom] = useState<Contact| undefined>()    
    const [contactToSendTo, setContactToSendTo] = useState<Contact| undefined>()        
    const [relaysToShareTo, setRelaysToShareTo] = useState<string[]>([])
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<MintBalance[]>(route.params.availableMintBalances || [])
    const [mintBalanceToTopup, setMintBalanceToTopup] = useState<MintBalance | undefined>(undefined)
    const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
    const [transactionId, setTransactionId] = useState<number | undefined>()
    const [invoiceToPay, setInvoiceToPay] = useState<string>('')
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isAmountEndEditing, setIsAmountEndEditing] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus; message: string} | undefined>()
    const [isSharedAsText, setIsSharedAsText] = useState<boolean>(false)
    const [isSharedAsQRCode, setIsSharedAsQRCode] = useState<boolean>(false)
    const [isSharedAsNostrDirectMessage, setIsSharedAsNostrDirectMessage] = useState<boolean>(false)

    const [isMemoEndEditing, setIsMemoEndEditing] = useState<boolean>(false)
    const [isLoading, setIsLoading] = useState(false)

    const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
    const [isShareModalVisible, setIsShareModalVisible] = useState(false)
    const [isQRModalVisible, setIsQRModalVisible] = useState(false)
    const [isNostrDMModalVisible, setIsNostrDMModalVisible] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [isNostrDMSending, setIsNostrDMSending] = useState(false)
    const [isNostrDMSuccess, setIsNostrDMSuccess] = useState(false) 

    useEffect(() => {
      const focus = () => {
        if (route.params?.amountToTopup) {
            return
        }

        amountInputRef && amountInputRef.current
          ? amountInputRef.current.focus()
          : false        
      }
      const timer = setTimeout(() => focus(), 500)

      return () => {
        clearTimeout(timer)
      }
    }, [])


    // Send to contact
    useFocusEffect(
        useCallback(() => {
            const prepareSendAsNostrDM = () => {
                if (!route.params?.amountToTopup) {
                    return
                }

                if (!route.params?.contact) {
                    return
                }

                if (!route.params?.relays) {
                    return
                }

                

                const amount = route.params?.amountToTopup
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

                setAmountToTopup(amount)                
                setContactToSendFrom(contactFrom)                
                setContactToSendTo(contactTo)                
                setRelaysToShareTo(relays)
                // skip showing of sharing options and set this one immediately                
                setIsSharedAsNostrDirectMessage(true)
            }

            prepareSendAsNostrDM()
            
        }, [route.params?.amountToTopup, route.params?.contact, route.params?.relays]),
    )


    // Make sure amountToTopup has been set to the state
    useEffect(() => {        
        if(isSharedAsNostrDirectMessage && parseInt(amountToTopup) > 0) {            
            onAmountEndEditing()  
        }      
              
    }, [amountToTopup, isSharedAsNostrDirectMessage])


    useEffect(() => {
      const handleCompleted = (invoice: Invoice) => {
        log.trace('handleCompleted event handler trigerred')

        if (!transactionId) {
          return
        }
        // Filter and handle events only for this topup transactionId
        if (invoice.transactionId === transactionId) {
          log.trace('Invoice has been paid and new proofs received')

          setResultModalInfo({
            status: TransactionStatus.COMPLETED,
            message: `Payment received! Your wallet has been credited with ${invoice.amount} sats.`,
          })

          setTransactionStatus(TransactionStatus.COMPLETED)
          setIsQRModalVisible(false)
          setIsShareModalVisible(false)
          setIsResultModalVisible(true)
        }
      }

      // Subscribe to the 'tokenEntryAdded' event
      EventEmitter.on('topupCompleted', handleCompleted)

      // Unsubscribe from the 'tokenEntryAdded' event on component unmount
      return () => {
        EventEmitter.off('topupCompleted', handleCompleted)
      }
    }, [transactionId])

    const toggleShareModal = () =>
      setIsShareModalVisible(previousState => !previousState)
    const toggleQRModal = () =>
      setIsQRModalVisible(previousState => !previousState)
    const toggleNostrDMModal = () =>
      setIsNostrDMModalVisible(previousState => !previousState)
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)

    const onAmountEndEditing = function () {
      try {
        const amount = parseInt(amountToTopup)

        if (!amount || amount === 0) {
          setInfo('Amount should be positive number')
          return
        }

        const availableAllBalances = proofsStore.getBalances().mintBalances

        if (availableAllBalances.length === 0) {
            setInfo(
              'There is no mint connected to your wallet that you would receive your coins from. Add the mint first.',
            )
            return
        }

        // Filtered by the balances passed in props
        let availableFilteredBalances: MintBalance[] = []

        // Resulting balances to select from
        let availableBalances: MintBalance[] = []
 
        if(availableMintBalances.length > 0) {
            availableFilteredBalances = availableAllBalances.filter((b) => availableMintBalances.find(f => f.mint === b.mint ))
            log.trace('Filtered', availableFilteredBalances)
        }

        if (availableFilteredBalances.length > 0) {
            availableBalances = availableFilteredBalances
        } else {
            availableBalances = availableAllBalances
        }

        log.trace('onAmountEndEditing() availableBalances', availableBalances.length)

        setAvailableMintBalances(availableBalances)

        // Set mint to send from immediately if only one is available
        if (availableBalances.length === 1) {
          setMintBalanceToTopup(availableBalances[0])
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
    

    const onMemoEndEditing = function () {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
        setIsMemoEndEditing(true)

        // On payment to selected contact we skip showing sharing options, continue immediately
        if(isSharedAsNostrDirectMessage) {
            onShareAsNostrDM()
        }
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


    const onShareAsText = async function () {
      // if tx has been already executed, re-open SendModal
      if (transactionStatus === TransactionStatus.PENDING) {
        toggleShareModal() // open
        return
      }

      setIsSharedAsText(true)
      setIsSharedAsQRCode(false)
      setIsSharedAsNostrDirectMessage(false)
      // pass share kind directly to avoid delayed state update
      return onShare('TEXT')
    }


    const onShareAsQRCode = async function () {
      // if tx has been already executed, re-open QRCodeModal
      if (transactionStatus === TransactionStatus.PENDING) {
        toggleQRModal() // open
        return
      }

      setIsSharedAsQRCode(true)
      setIsSharedAsText(false)
      setIsSharedAsNostrDirectMessage(false)
      // pass share kind directly to avoid delayed state update
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
        navigation.navigate('ContactsNavigator', {screen: 'Contacts', params: {amountToTopup}})
    }

    const onShare = async function (as: 'TEXT' | 'QRCODE' | 'NOSTRDM'): Promise<void> {
      if (amountToTopup.length === 0) {
        setInfo('Provide the top-up amount')
        return
      }

      // Skip mint modal and send immediately if only one mint is available
      if (availableMintBalances.length === 1) {
        const result = await requestTopup()

        if (result.error) {
          setResultModalInfo({
            status: result.transaction?.status as TransactionStatus,
            message: result.error.message,
          })
          setIsResultModalVisible(true)
          return
        }

        if (as === 'TEXT') {
          toggleShareModal()
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
      if(!mintBalanceToTopup) {
        setMintBalanceToTopup(availableMintBalances[0])
      }      
      setIsMintSelectorVisible(true)
      // toggleMintModal() // open
    }

    const onMintBalanceSelect = function (balance: MintBalance) {
      setMintBalanceToTopup(balance)
    }

    const onMintBalanceConfirm = async function () {
      if (mintBalanceToTopup) {
        const result = await requestTopup()

        if (result.error) {
          setResultModalInfo({
            status: result.transaction?.status as TransactionStatus,
            message: result.error.message,
          })
          setIsResultModalVisible(true)
          return
        }

        isSharedAsText && toggleShareModal() // open
        isSharedAsQRCode && toggleQRModal() // open
        isSharedAsNostrDirectMessage && toggleNostrDMModal() 
      }
      setIsMintSelectorVisible(false)
    }

    const onMintBalanceCancel = async function () {
      setIsMintSelectorVisible(false)
    }

    const requestTopup = async function () {
        setIsLoading(true)

        
        const result = await Wallet.topup(
            mintBalanceToTopup as MintBalance,
            parseInt(amountToTopup),
            memo,
        )

        const {status, id} = result.transaction as Transaction
        setTransactionStatus(status)
        setTransactionId(id)

        if (result.encodedInvoice) {
            setInvoiceToPay(result.encodedInvoice)
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
            const message = `nostr:${walletProfileStore.npub} sent you Lightning invoice for ${amountToTopup} sats from Minibits wallet!`
            let content = message + ' \n' + invoiceToPay + ' \n'

            if (memo) {
                content += `memo: ${memo}`
            }

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

                updated[1].sentToRelays = relaysToShareTo
                updated[1].sentEvent = sentEvent    
                
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
          message: invoiceToPay as string,
        })

        if (result.action === Share.sharedAction) {
          toggleShareModal()
          setTimeout(
            () =>
              setInfo(
                'Lightning invoice has been shared, waiting to be paid by receiver',
              ),
            500,
          )
        } else if (result.action === Share.dismissedAction) {
          setInfo('Sharing cancelled')
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


    const onNostrDMSuccessClose = function () {
        // reset state so it does not interfere next payment
        setAmountToTopup('')
        setMemo('')
        setIsAmountEndEditing(false)
        setIsMemoEndEditing(false)
        setIsMintSelectorVisible(false)
        setIsNostrDMModalVisible(false)
        setIsSharedAsNostrDirectMessage(false)

        navigation.navigate('Wallet', {})
    }



    const handleError = function (e: AppError): void {
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
            text="Top-up amount"
            style={{color: 'white'}}
          />
          <View style={$amountContainer}>
            <TextInput
              ref={amountInputRef}
              onChangeText={amount => setAmountToTopup(amount)}
              // onFocus={() => setIsAmountEndEditing(false)}
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
                      ? false
                      : true
                  }
                />
              </View>
            }
          />
          {isAmountEndEditing && isMemoEndEditing && !isMintSelectorVisible && (
            <Card
              style={$card}
              ContentComponent={
                <>
                  {<ListItem
                    tx="topupScreen.sendInvoiceToContact"
                    subTx="topupScreen.sendInvoiceToContactDescription"
                    leftIcon='faAddressCard'
                    leftIconColor={colors.palette.secondary300}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={onShareAsNostrDM}
                   />}
                  <ListItem
                    tx="topupScreen.showInvoiceQRCode"
                    subTx="topupScreen.showInvoiceQRCodeDescription"
                    leftIcon='faQrcode'
                    leftIconColor={colors.palette.success200}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={onShareAsQRCode}
                  />
                  <ListItem
                    tx="topupScreen.shareInvoiceAsText"
                    subTx="topupScreen.shareInvoiceAsTextDescription"
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
                mintBalanceToTopup={mintBalanceToTopup as MintBalance}
                onMintBalanceSelect={onMintBalanceSelect}
                onCancel={onMintBalanceCancel}
                findByUrl={mintsStore.findByUrl}
                onMintBalanceConfirm={onMintBalanceConfirm}
              />
            )}
          {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isShareModalVisible ? true : false}
          top={spacing.screenHeight * 0.367}
          style={{marginHorizontal: spacing.extraSmall}}
          ContentComponent={
            <ShareAsTextBlock
              toggleSendModal={toggleShareModal}
              invoiceToPay={invoiceToPay as string}
              onShareToApp={onShareToApp}
              onCopy={onCopy}
            />
          }
          onBackButtonPress={toggleShareModal}
          onBackdropPress={toggleShareModal}
        />
        <BottomModal
          isVisible={isQRModalVisible ? true : false}
          top={spacing.screenHeight * 0.367}
          style={{marginHorizontal: spacing.extraSmall}}
          ContentComponent={
            <ShareAsQRCodeBlock
              toggleQRModal={toggleQRModal}
              encodedTokenToSend={invoiceToPay as string}
              onCopy={onCopy}
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
                amountToTopup={amountToTopup}
                onClose={onNostrDMSuccessClose}                
            />
            ) : (
            <SendAsNostrDMBlock
                toggleNostrDMModal={toggleNostrDMModal}
                encodedTokenToSend={invoiceToPay as string}
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
          isVisible={isResultModalVisible ? true : false}
          top={spacing.screenHeight * 0.5}
          style={{paddingHorizontal: spacing.small}}
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
                      title="Topup failed"
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
    <>
      <Card
        style={$card}
        heading={'Select mint to top-up'}
        headingStyle={{textAlign: 'center', padding: spacing.small}}
        ContentComponent={
          <>
            {props.availableMintBalances.map(
              (balance: MintBalance) => (
                <MintListItem
                  key={balance.mint}
                  mint={props.findByUrl(balance.mint)}
                  mintBalance={balance}
                  onMintSelect={() => onMintSelect(balance)}
                  isSelectable={true}
                  isSelected={props.mintBalanceToTopup.mint === balance.mint}
                  separator={'top'}
                />
              ),
            )}
          </>
        }
      />
      <View style={[$buttonContainer, {marginTop: spacing.large}]}>
        <Button
          text="Create invoice"
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

const ShareAsTextBlock = observer(function (props: {
  toggleSendModal: any
  invoiceToPay: string
  onShareToApp: any
  onCopy: any
}) {
  const sendBg = useThemeColor('background')
  const tokenTextColor = useThemeColor('textDim')

  return (
    <View style={$bottomModal}>
      <Text text={'Share lightning invoice'} />
      <ScrollView
        style={[
          $tokenContainer,
          {backgroundColor: sendBg, marginHorizontal: spacing.small},
        ]}>
        <Text
          selectable
          text={props.invoiceToPay}
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

const ShareAsQRCodeBlock = observer(function (props: {
  toggleQRModal: any
  encodedTokenToSend: string
  onCopy: any
}) {
  return (
    <View style={[$bottomModal, {marginHorizontal: spacing.small}]}>
      <Text text={'Scan and pay to top-up'} />
      <View style={$qrCodeContainer}>
        <QRCode size={270} value={props.encodedTokenToSend} />
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
    amountToTopup: string
    sendAsNostrDM: any 
    isNostrDMSending: boolean   
  }) {
    const sendBg = useThemeColor('background')
    const tokenTextColor = useThemeColor('textDim')    
      
    return (
      <View style={$bottomModal}>
        <NostDMInfoBlock
            contactToSendFrom={props.contactToSendFrom}
            amountToTopup={props.amountToTopup}
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
    amountToTopup: string
    onClose: any   
  }) {
  
    return (
      <View style={$bottomModal}>
        <NostDMInfoBlock
            contactToSendFrom={props.contactToSendFrom}
            amountToTopup={props.amountToTopup}
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
                <Icon
                        icon='faPaperPlane'                                
                        size={spacing.medium}                    
                        color={tokenTextColor}                
                />
                <Text size='xxs' style={{color: tokenTextColor, marginBottom: -10}} text={`${props.amountToTopup} sats`} />
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
  maxHeight: 150,
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
