import React, { FC, useState, useEffect, useRef } from 'react'
import {
    ViewStyle,
    View,
    TextStyle,
    Alert,
    Platform,
    DeviceEventEmitter,
} from 'react-native'
import { PaymentRequest as CashuPaymentRequest, PaymentRequestTransport, PaymentRequestTransportType, decodePaymentRequest, getDecodedToken } from '@cashu/cashu-ts'
import NfcManager, { NfcTech, Ndef, NfcEvents } from 'react-native-nfc-manager'
import { colors, spacing, typography, useThemeColor } from '../theme'
import EventEmitter from '../utils/eventEmitter'
import { log } from '../services/logService'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'
import AppError, { Err } from '../utils/AppError'
import { Button, Card, ErrorModal, Icon, InfoModal, ListItem, ScanIcon, Screen, Text } from '../components'
import { infoMessage } from '../utils/utils'
import { SvgXml } from 'react-native-svg'
import { MintUnit, MintUnits } from '../services/wallet/currency'
import { useStores } from '../models'
import { MintHeader } from './Mints/MintHeader'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { translate } from '../i18n'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'
import { observer } from 'mobx-react-lite'
import { Mint, MintBalance } from '../models/Mint'
import { TransactionTaskResult } from '../services'
import { SendOption } from './SendScreen'
import { TransferOption } from './TransferScreen'
import { Transaction, TransactionStatus } from '../models/Transaction'
import { Proof } from '../models/Proof'
import { SEND_TASK } from '../services/wallet/sendTask'

type Props = StaticScreenProps<{
    unit: MintUnit
}>

export const NfcPayScreen = observer(function NfcPayScreen({ route }: Props) {
    const navigation = useNavigation<any>()
    const { mintsStore, walletStore, proofsStore } = useStores()
    const unitRef = useRef<MintUnit>('sat')
    const isInternetReachable = useIsInternetReachable()

    const [paymentOption, setPaymentOption] = useState<SendOption | TransferOption>(TransferOption.PASTE_OR_SCAN_INVOICE)
    const [encodedTokenToSend, setEncodedTokenToSend] = useState<string | undefined>()
    const [encodedCashuPaymentRequest, setEncodedCashuPaymentRequest] = useState<string | undefined>()
    const [decodedCashuPaymentRequest, setDecodedCashuPaymentRequest] = useState<CashuPaymentRequest | undefined>()   
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<MintBalance[]>([])
    const [mintBalanceToSendFrom, setMintBalanceToSendFrom] = useState<MintBalance | undefined>()
    const [selectedProofs, setSelectedProofs] = useState<Proof[]>([])
    const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
    const [transaction, setTransaction] = useState<Transaction | undefined>()
    const [transactionId, setTransactionId] = useState<number | undefined>()      
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, title?: string, message: string} | undefined>()    
    const [isLoading, setIsLoading] = useState(false)

    const [isMintSelectorVisible, setIsMintSelectorVisible] = useState(false)
    const [isOfflineSend, setIsOfflineSend] = useState(false)
    const [isSendTaskSentToQueue, setIsSendTaskSentToQueue] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    // NFC state
    const [isNfcEnabled, setIsNfcEnabled] = useState(false)
    const [isNfcSupported, setIsNfcSupported] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [nfcInfo, setNfcInfo] = useState<string | undefined>()
    const [readNfcData, setReadNfcData] = useState<string | undefined>()
    const [mint, setMint] = useState<Mint | undefined>()

    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState<string>('')

    // Start NFC only when this screen is visible
    useEffect(() => {
        const initNfc = async () => {
            try {
                const supported = await NfcManager.isSupported()
                setIsNfcSupported(supported)
                if (!supported) {
                    setNfcInfo('NFC is not supported on this device')
                    return
                }

                await NfcManager.start()

                const enabled = await NfcManager.isEnabled()
                if (!enabled) {
                    setNfcInfo('Please enable NFC in your device settings')
                    return
                }

                setIsNfcEnabled(true)

                // Start listening for tags immediately
                startNfcSession()
            } catch (e: any) {
                log.error('Failed to initialize NFC', e.message)
                setNfcInfo('Failed to initialize NFC: ' + e.message)
                // setError(new AppError(Err.NFC_ERROR, 'Failed to initialize NFC', e.message))
            }
        }

        initNfc()

        return () => {
            NfcManager.cancelTechnologyRequest().catch(() => {})
            NfcManager.setEventListener(NfcEvents.DiscoverTag, null)
        }
    }, [])

    // Auto-restart session when screen comes into focus
    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            if (isNfcEnabled && !isProcessing) {
                startNfcSession()
            }
        })
        return unsubscribe
    }, [navigation, isNfcEnabled, isProcessing])


    useEffect(() => {
            const handleSendTaskResult = async (result: TransactionTaskResult) => {
                log.trace('handleSendTaskResult event handler triggered')
            
                const {transaction} = result
    
                setTransactionStatus(transaction?.status)
                setTransaction(transaction)
                setTransactionId(transaction?.id)
        
                if (result.encodedTokenToSend) {
                    setEncodedTokenToSend(result.encodedTokenToSend)
                }
    
                if(paymentOption === SendOption.PAY_CASHU_PAYMENT_REQUEST) {  
                    if(decodedCashuPaymentRequest && decodedCashuPaymentRequest.id && transaction) {
    
                        transaction.update({
                            paymentId: decodedCashuPaymentRequest.id,
                            paymentRequest: encodedCashuPaymentRequest,
                        })
                    }
                }
    
                if (result.error) {
                    setResultModalInfo({
                        status: result.transaction?.status as TransactionStatus,
                        title: result.error.params?.message ? result.error.message : 'Payment failed',
                        message: result.error.params?.message || result.error.message,
                    })
                    setIsResultModalVisible(true)
                    return
                }
            }
    
            // Subscribe to the 'sendCompleted' event
            if(isSendTaskSentToQueue) {
                EventEmitter.on(`ev_${SEND_TASK}_result`, handleSendTaskResult)
            }        
    
            // Unsubscribe from the 'sendCompleted' event on component unmount
            return () => {
                EventEmitter.off(`ev_${SEND_TASK}_result`, handleSendTaskResult)
            }
        }, [isSendTaskSentToQueue])


    const startNfcSession = async () => {
        try {
            await NfcManager.requestTechnology(NfcTech.Ndef, {
                alertMessage: 'Hold phone near the device...',
                //invalidateAfterFirstRead: false,
            })

            // Listen for tag discovery
            NfcManager.setEventListener(NfcEvents.DiscoverTag, async (tag: any) => {
                if (isProcessing) return
                setIsProcessing(true)
                setNfcInfo('Reading payment request...')

                try {
                    const ndefMessage = tag.ndefMessage?.[0]
                    if (!ndefMessage) {
                        throw new AppError(Err.VALIDATION_ERROR, 'No NDEF message found')
                    }

                    let payload: string

                    // Handle both Text and URI records
                    if (ndefMessage.type === Ndef.RTD_TEXT) {
                        const decoded = Ndef.text.decodePayload(ndefMessage.payload)
                        payload = decoded
                    } else if (ndefMessage.type === Ndef.RTD_URI) {
                        const decoded = Ndef.uri.decodePayload(ndefMessage.payload)
                        payload = decoded
                    } else {
                        payload = new TextDecoder().decode(ndefMessage.payload)
                    }

                    log.trace('NFC tag read', { payload })
                    setReadNfcData(payload)
                    await handlePaymentRequest(payload)

                } catch (e: any) {
                    handleError(e)
                } finally {
                    setIsProcessing(false)
                }
            })
        } catch (ex: any) {
            if (ex.message !== 'cancelled') {
                setInfo('Tap terminal to pay')
            }
        }
    }

    const handlePaymentRequest = async (data: string) => {
        try {
            Alert.alert(data)
            const result = IncomingParser.findAndExtract(data)

            if (result.type === IncomingDataType.CASHU_PAYMENT_REQUEST) {
                const encodedCashuPaymentRequest = result.encoded
                const pr: CashuPaymentRequest = decodePaymentRequest(encodedCashuPaymentRequest)

                    log.trace('[handlePaymentRequest] decoded payment request', {pr})

                    //setDecodedCashuPaymentRequest(pr)
                    //setEncodedCashuPaymentRequest(encodedCashuPaymentRequest)

                    if(pr.unit && !MintUnits.includes(pr.unit as MintUnit)) {
                        throw new AppError(Err.VALIDATION_ERROR, `Wallet does not support ${pr.unit} unit.`)
                    }
                    
                    if(pr.unit) {
                        unitRef.current = pr.unit as MintUnit
                    }

                    /*if (pr.description && pr.description.length > 0) {
                        setMemo(pr.description)
                        setIsCashuPrWithDesc(true)
                    }*/

                    if (!pr.amount || pr.amount <= 0) {
                        throw new AppError(Err.VALIDATION_ERROR, 'Cashu payment request does not specify an amount to pay.')
                    }

                    /*
                        setAmountToSend(`${numbro(pr.amount / getCurrency(unitRef.current).precision)
                        .format({
                          thousandSeparated: true, 
                          mantissa: getCurrency(unitRef.current).mantissa
                        })}`)

                    */

                    let availableBalances: MintBalance[] = []

                    if (pr.mints && pr.mints.length > 0) {                        

                        for (const mint of pr.mints) {
                            if (mintsStore.mintExists(mint)) {
                                const mintBalance = proofsStore.getMintBalance(mint)   
                                availableBalances.push(mintBalance!)
                            }
                        }

                        if (availableBalances.length === 0) {
                            throw new AppError(Err.NOTFOUND_ERROR, 'Wallet does not have any of the mints accepted by Cashu payment request.', {mints: pr.mints})
                        }
                        
                        const withEnoughBalance = availableBalances.filter(balance => {
                            const unitBalance = balance.balances[unitRef.current]
                            
                            if(unitBalance && unitBalance >= pr.amount!) {
                                return balance
                            }

                            return null                             
                        })

                        if(withEnoughBalance.length === 0) {        
                            throw new AppError(Err.NOTFOUND_ERROR, `Wallet does not have enough balance to fulfill Cashu payment request of ${pr.amount} ${unitRef.current}.`, {availableBalances, amount: pr.amount, unit: unitRef.current})
                        }

                        availableBalances = withEnoughBalance
                        
                        // setAvailableMintBalances(withEnoughBalance)
                        // setMintBalanceToSendFrom(withEnoughBalance[0])  

                    } else {
                        availableBalances = proofsStore.getMintBalancesWithEnoughBalance(pr.amount, unitRef.current)
                    }


                    
                    //setIsMintSelectorVisible(true)
            }

            if (result.type === IncomingDataType.INVOICE) {
                Alert.alert(result.toString())
            }

        } catch (e: any) {
            handleError(e)
        }
    }

    const writeTokenToTag = async (token: string) => {
        try {
            // Re-request tech to write back
            await NfcManager.requestTechnology(NfcTech.Ndef)

            const textRecord = Ndef.textRecord('en', token)
            const bytes = Ndef.encodeMessage([textRecord])

            await NfcManager.ndefHandler.writeNdefMessage(bytes)
            setInfo('Payment sent!')
        } catch (e: any) {
            throw new AppError(Err.NFC_ERROR, 'Failed to send token', e.message)
        } finally {
            NfcManager.cancelTechnologyRequest().catch(() => {})
        }
    }

    const handleError = (e: AppError) => {
        setError(e)
        setInfo('')
        setIsProcessing(false)
    }

    const gotoScan = () => {
        navigation.navigate('Scan', { unit: unitRef.current })
    }

    // Theme
    const hintText = useThemeColor('textDim')
    const headerBg = useThemeColor('header')
    const headerTitle = useThemeColor('headerTitle')
    const scanIcon = useThemeColor('text')
    const scanButtonColor = useThemeColor('card') 

    return (
        <Screen preset="fixed" contentContainerStyle={$screen}>
            <MintHeader mint={mint} unit={unitRef.current} />
            <View style={[$headerContainer, { backgroundColor: headerBg }]}>
                <Icon
                    icon='faNfcSymbol'
                    size={verticalScale(35)}
                    color={headerTitle}
                />
            </View>

            <View style={$contentContainer}>
                <Card
                    ContentComponent={
                        <>
                            <Icon
                                icon='faWifi'
                                size={verticalScale(80)}
                                color={isNfcEnabled ? colors.palette.success200 : colors.palette.neutral400}
                                containerStyle={{
                                    alignSelf: 'center',
                                    marginVertical: spacing.large,
                                    transform: [{ rotate: '-90deg' }]
                                }}
                            />
                            <Text
                                text={
                                    nfcInfo ? nfcInfo : ''
                                }
                                style={{
                                    textAlign: 'center',
                                    marginBottom: spacing.medium,
                                    //fontFamily: typography.code,
                                    color: isNfcEnabled ? colors.palette.success200 : colors.palette.neutral500,
                                    fontSize: 18
                                }}
                            />
                        </>
                    }
                />

                <View style={$bottomContainer}>
                    <View style={$buttonContainer}>
                        <Button
                            preset='tertiary'                                    
                            LeftAccessory={() => (
                                <SvgXml 
                                    width={spacing.medium} 
                                    height={spacing.medium} 
                                    xml={ScanIcon}
                                    fill={scanIcon}
                                    style={{marginHorizontal: spacing.extraSmall}}
                                />
                            )}
                            onPress={gotoScan}
                            //style={{backgroundColor: scanButtonColor}}
                            text='Scan QR instead'
                        />  
                    </View>
                </View>
            </View>

            {info && !isProcessing && <InfoModal message={info} />}
            {error && <ErrorModal error={error} />}
        </Screen>
    )
})

// Styles remain unchanged
const $screen: ViewStyle = { flex: 1 }
const $contentContainer: ViewStyle = { flex: 1, marginTop: -spacing.extraLarge * 2, padding: spacing.extraSmall }
const $headerContainer: TextStyle = { alignItems: 'center', paddingBottom: spacing.medium, height: spacing.screenHeight * 0.15 }
const $buttonContainer: ViewStyle = { marginTop: spacing.large, flexDirection: 'row', alignSelf: 'center' }
const $bottomContainer: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.medium,
    alignSelf: 'stretch',
}