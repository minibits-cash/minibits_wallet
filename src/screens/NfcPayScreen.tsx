import React, { FC, useState, useEffect, useRef, useCallback } from 'react'
import {
    ViewStyle,
    View,
    TextStyle,
    Alert,
    ColorValue,
    Platform,
} from 'react-native'
import {
    PulseIndicator,
    WaveIndicator,
  } from 'react-native-indicators'
import { PaymentRequest as CashuPaymentRequest, MeltQuoteResponse, PaymentRequestTransport, PaymentRequestTransportType, decodePaymentRequest, getDecodedToken } from '@cashu/cashu-ts'
import NfcManager, { NfcTech, Ndef, NfcEvents, TagEvent } from 'react-native-nfc-manager'
import { colors, spacing, typography, useThemeColor } from '../theme'
import EventEmitter from '../utils/eventEmitter'
import { log } from '../services/logService'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'
import AppError, { Err } from '../utils/AppError'
import { AmountInput, BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, ScanIcon, Screen, Text } from '../components'
import { infoMessage } from '../utils/utils'
import { SvgXml } from 'react-native-svg'
import { formatCurrency, getCurrency, MintUnit, MintUnits } from '../services/wallet/currency'
import { useStores } from '../models'
import { MintHeader } from './Mints/MintHeader'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { translate } from '../i18n'
import { StackActions, StaticScreenProps, useNavigation } from '@react-navigation/native'
import { observer } from 'mobx-react-lite'
import { Mint, MintBalance } from '../models/Mint'
import { SYNC_STATE_WITH_MINT_TASK, SyncStateTaskResult, TransactionTaskResult, WalletTask } from '../services'
import { Transaction, TransactionStatus } from '../models/Transaction'
import { Proof } from '../models/Proof'
import { toNumber } from '../utils/number'
import numbro from 'numbro'
import { DecodedLightningInvoice, LightningUtils } from '../services/lightning/lightningUtils'
import { addSeconds } from 'date-fns/addSeconds'
import { CashuUtils } from '../services/cashu/cashuUtils'
import { LIGHTNING_FEE_PERCENT, MIN_LIGHTNING_FEE } from '../models/NwcStore'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import Animated, {
    useSharedValue,
    withRepeat,
    withTiming,
    useAnimatedStyle,
    Easing,
  } from 'react-native-reanimated';
import { NfcService } from '../services/nfcService'
import { TranItem } from './TranDetailScreen'
//import Animated from 'react-native-reanimated'

const ContactlessIcon = (color: ColorValue | string) => `<?xml version="1.0" encoding="utf-8"?>
<svg  viewBox="-5 0 35 35" fill="none" xmlns="http://www.w3.org/2000/svg">
<path 
    d="M16.3 19.5002C17.4 17.2002 18 14.7002 18 12.0002C18 9.30024 17.4 6.70024 16.3 4.50024M12.7 17.8003C13.5 16.0003 14 14.0003 14 12.0003C14 10.0003 13.5 7.90034 12.7 6.10034M9.1001 16.1001C9.7001 14.8001 10.0001 13.4001 10.0001 12.0001C10.0001 10.6001 9.7001 9.10015 9.1001 7.90015M5.5 14.3003C5.8 13.6003 6 12.8003 6 12.0003C6 11.2003 5.8 10.3003 5.5 9.60034" 
    stroke="${String(color)}" 
    stroke-width="2" 
    stroke-linecap="round" 
    stroke-linejoin="round"/>
</svg>`


interface PulsingContactlessIconProps {
  isNfcEnabled: boolean;
}

export const PulsingContactlessIcon: React.FC<PulsingContactlessIconProps> = ({
  isNfcEnabled,
}) => {
  const scale = useSharedValue(1);

  // Start/stop pulse based on isNfcEnabled
  useEffect(() => {
    if (isNfcEnabled) {
      scale.value = withRepeat(
        withTiming(1.22, {
          duration: 1200,
          easing: Easing.out(Easing.quad),
        }),
        -1, // infinite
        true // reverse (so it goes 1 → 1.22 → 1 → 1.22...)
      );
    } else {
      scale.value = withTiming(1, { duration: 300 });
    }
  }, [isNfcEnabled, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const color = isNfcEnabled
    ? colors.palette.success200
    : colors.palette.neutral400

  return (
    <Animated.View style={[animatedStyle, { alignSelf: 'center' }]}>
      <SvgXml
        xml={ContactlessIcon(color)}
        width={150}
        height={150}
        style={{ marginVertical: 24 }} // or your spacing.large
      />
    </Animated.View>
  );
};

type Props = StaticScreenProps<{
    unit: MintUnit
}>

const SYNC_STATE_WITH_MINT_TIMEOUT = 10 * 1000

export const NfcPayScreen = observer(function NfcPayScreen({ route }: Props) {
    const navigation = useNavigation<any>()
    const { mintsStore, walletStore, proofsStore, transactionsStore } = useStores()
    const unitRef = useRef<MintUnit>('sat')
    const isOnline = useRef<boolean>(true)

    const isInternetReachable = useIsInternetReachable()

    const [encodedTokenToSend, setEncodedTokenToSend] = useState<string | undefined>()
    const [amountToPay, setAmountToPay] = useState<string | undefined>()
    const [amountToReceive, setAmountToReceive] = useState<string | undefined>()
    const [encodedCashuPaymentRequest, setEncodedCashuPaymentRequest] = useState<string | undefined>()
    const [decodedCashuPaymentRequest, setDecodedCashuPaymentRequest] = useState<CashuPaymentRequest | undefined>()
    const [encodedInvoice, setEncodedInvoice] = useState<string>('')
    const [invoice, setInvoice] = useState<DecodedLightningInvoice | undefined>()    
    const [invoiceExpiry, setInvoiceExpiry] = useState<Date | undefined>()           
    const [meltQuote, setMeltQuote] = useState<MeltQuoteResponse | undefined>() 
    const [memo, setMemo] = useState('')
    const [mintBalanceToSendFrom, setMintBalanceToSendFrom] = useState<MintBalance | undefined>()

    const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
    const [transaction, setTransaction] = useState<Transaction | undefined>()
    const [transactionId, setTransactionId] = useState<number | undefined>()      
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, title?: string, message: string} | undefined>()    
    const [isLoading, setIsLoading] = useState(false)
    //const [isOffline, setIsOffline] = useState(false)

    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    // NFC state
    const [isNfcEnabled, setIsNfcEnabled] = useState(false)
    const [isNfcSupported, setIsNfcSupported] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [isPaid, setIsPaid] = useState(false)
    const [nfcInfo, setNfcInfo] = useState<string | undefined>()
    const [readNfcData, setReadNfcData] = useState<string | undefined>()
    const [mint, setMint] = useState<Mint | undefined>()

    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState<string>('')

    // Start NFC only when this screen is visible
    useEffect(() => {
        const initNfc = async () => {
            try {
                const supported = await NfcService.init() // runs NfcManager.start()
                setIsNfcSupported(supported)
                log.trace({isInternetReachable})

                if (!supported) {
                    setNfcInfo('NFC is not supported on this device')
                    return
                }
                
                const enabled = await NfcService.isEnabled()
                if (!enabled) {
                    setNfcInfo('Please enable NFC in your device settings')
                    return
                }

                setNfcInfo('Hold your device close to the NFC reader.')
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
            NfcManager.setEventListener(NfcEvents.SessionClosed, null)
        }
    }, [])

    useEffect(() => {
        log.trace('on change', {isInternetReachable})
        isOnline.current = isInternetReachable
    }, [isInternetReachable])

    // Auto-restart session when screen comes into focus
    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            if (isNfcEnabled && !isProcessing) {
                startNfcSession()
            }
        })
        return unsubscribe
    }, [navigation, isNfcEnabled, isProcessing])


    const showSuccessModal = function () {
        const amountSentInt = Math.round(
            (toNumber(amountToPay || '0') * getCurrency(unitRef.current).precision)
        );

        const currency = getCurrency(unitRef.current);

        setResultModalInfo({
            status: TransactionStatus.COMPLETED,
            title: 'That was fast!',
            message: `${formatCurrency(amountSentInt, currency.code)} ${currency.code} were received by the payee.`,
        });
        setTransactionStatus(TransactionStatus.COMPLETED);
        setIsResultModalVisible(true);
        //setNfcInfo('Payment completed successfully!');
    }


    const showPendingModal = function () {
        const amountSentInt = Math.round(
            (toNumber(amountToPay || '0') * getCurrency(unitRef.current).precision)
        );

        const currency = getCurrency(unitRef.current);

        setResultModalInfo({
            status: TransactionStatus.PENDING,
            //title: 'Payment is pending',
            message: `${formatCurrency(amountSentInt, currency.code)} ${currency.code} were sent successfully, but the payee has not yet claimed the ecash . You can wait for confirmation or revert the transaction.`,
        });
        setTransactionStatus(TransactionStatus.PENDING);
        setIsResultModalVisible(true)
    }

    // Stable handler — only recreated when dependencies actually change
    const handleSyncStateResult = useCallback(async (result: SyncStateTaskResult) => {
        log.trace('[NfcScreen.handleSyncStateResult] handleSyncStateResult triggered', { result, transactionId });

        if (!transactionId) return;

        const { completedTransactionIds, errorTransactionIds, transactionStateUpdates } = result;

        // ——— SUCCESS: Receiver claimed the ecash ———
        if (completedTransactionIds?.includes(transactionId)) {
            log.debug('[NfcScreen.handleSyncStateResult] Ecash claimed successfully by the payee.', { transactionId });
            showSuccessModal()
            return;
        }

        // ——— ERROR: Sync detected mismatch or failure ———
        if (errorTransactionIds?.includes(transactionId)) {
            log.trace('[NfcScreen] Sync error for transaction', { transactionId });

            const update = transactionStateUpdates?.find(u => u.tId === transactionId);
            const message = update?.message || 'Transaction failed to complete on the mint side.'

            setResultModalInfo({
                status: TransactionStatus.ERROR,
                title: 'Send failed',
                message,
            });
            setTransactionStatus(TransactionStatus.ERROR)
            setIsResultModalVisible(true)
        }
    },
    [
        transactionId,
        amountToPay,
    ],
    );

    // One-time listener with auto-cleanup using ref
    const syncStateListenerRef = useRef<((r: SyncStateTaskResult) => void) | null>(null)
    const fallbackTimeoutRef = useRef<number>(null)

    useEffect(() => {
        log.trace('[useEffect] Triggered to set syncStateListenerRef', {transactionId})
        // If no transactionId → nothing to listen for
        if (!transactionId) {
            // Clean up any dangling listener
            if (syncStateListenerRef.current) {
                EventEmitter.off(`ev_${SYNC_STATE_WITH_MINT_TASK}_result`, syncStateListenerRef.current)
                syncStateListenerRef.current = null
            }

            if (fallbackTimeoutRef.current) {
                clearTimeout(fallbackTimeoutRef.current)
                fallbackTimeoutRef.current = null
            }
            return
        }

        const checkFallback = () => {
            const currentTx = transactionsStore.findById(transactionId)
            log.trace('[checkFallback] Check after timeout returned transaction', {status: currentTx?.status})
            if (currentTx?.status === TransactionStatus.COMPLETED) {
                showSuccessModal()
            }

            if(currentTx?.status === TransactionStatus.PENDING) {
                showPendingModal()
            }
            return
            // If still PENDING or ERROR → do nothing, user can close manually
        }

        const eventName = `ev_${SYNC_STATE_WITH_MINT_TASK}_result`
        // Start fallback timer — 15 seconds after token write. Skip if offline.
        if(isOnline.current) {
            fallbackTimeoutRef.current = setTimeout(checkFallback, SYNC_STATE_WITH_MINT_TIMEOUT)
        }      

        // Remove previous listener (defensive)
        if (syncStateListenerRef.current) {
            EventEmitter.off(eventName, syncStateListenerRef.current)
        }

        const handler = (result: SyncStateTaskResult) => {
            handleSyncStateResult(result)

            // Clear fallback — event won
            if (fallbackTimeoutRef.current) {
                clearTimeout(fallbackTimeoutRef.current)
                fallbackTimeoutRef.current = null
            }
    
            // "keep listening" for poller if our transaction is still pending
            const shouldStaySubscribed = (() => {
                const {transactionStateUpdates} = result

                if(transactionStateUpdates.length === 0) {
                    return true
                } else {
                    return false
                }
            })();
    
            // Only unsubscribe if the condition is NOT met
            if (!shouldStaySubscribed) {
                EventEmitter.off(eventName, handler);
                syncStateListenerRef.current = null;
            }
            // If shouldStaySubscribed === true → we keep the handler attached
        };

        syncStateListenerRef.current = handler
        EventEmitter.on(eventName, handler)

        // Cleanup on unmount or when transactionId changes/becomes null
        return () => {
            if (syncStateListenerRef.current) {
                EventEmitter.off(eventName, syncStateListenerRef.current)
                syncStateListenerRef.current = null
            }
            if (fallbackTimeoutRef.current) {
                clearTimeout(fallbackTimeoutRef.current)
                fallbackTimeoutRef.current = null
            }
        }
    }, [transactionId, handleSyncStateResult])


    // ====================== Lightning Payment (Transfer Task) Result Handler ======================

    const startNfcSession = async () => {
        let decoded: string | undefined = undefined;
        try {
            log.debug('[startNfcSession] Starting NFC session for payment request reading...')

            const tag = await NfcService.readNdefTag()

            if (!tag || !tag.ndefMessage) {
                return
            }

            setIsProcessing(true)

            //log.info('NFC Tag found', {tag});
            const bytes = new Uint8Array(tag.ndefMessage[0]?.payload ?? [])
            decoded = Ndef.text.decodePayload(bytes)

            log.trace({decoded})

            if(!decoded || decoded.length < 40) {
                const msg = 'This NFC tag can not be processed, missing or truncated NDEF message.'
                
                throw new AppError(Err.NFC_ERROR, msg)
            }

            setNfcInfo('Processing, keep your device still...')            

            log.info('NFC tag decoded', { decoded })

            setReadNfcData(decoded)
            await handleIncomingData(decoded)

        } catch (e: any) {
            log.error('[NfcPayScreen] handlePaymentRequest failed', {
                message: e?.message,
                stack: e?.stack,
                //decoded: decoded?.slice?.(0,200)
             })
            handleError(e)
        } finally { 
            setIsProcessing(false)
        }
    }


    const handleIncomingData = async (data: string) => {
        
        // Alert.alert(data)
        log.info('[handlePaymentRequest] received data via NFC', { data })

        const result = IncomingParser.findAndExtract(data)

        log.info('[handlePaymentRequest] parsed result', { result })
        if (!result || !result.encoded) {
            throw new AppError(Err.VALIDATION_ERROR, 'Unsupported or invalid payment request')
        }

        if (result.type === IncomingDataType.CASHU_PAYMENT_REQUEST) {
            await handleCashuPaymentRequest(result.encoded)
        } else if (result.type === IncomingDataType.INVOICE) {
            await handleLightningInvoice(result.encoded)
        } else if(result.type === IncomingDataType.CASHU) {
            await handleCashuToken(result.encoded)
        }
    }

    const handleCashuPaymentRequest = async (encoded: string) => {
        const pr = decodePaymentRequest(encoded)
        log.trace('[handlePaymentRequest] decoded Cashu payment request', { pr })

        // Validate basics
        if (!pr.amount || pr.amount <= 0) {
            throw new AppError(Err.VALIDATION_ERROR, 'Payment request has no valid amount')
        }

        const unit = validateAndNormalizeUnit(pr.unit)
        unitRef.current = unit

        // Store for UI
        setDecodedCashuPaymentRequest(pr)
        setEncodedCashuPaymentRequest(encoded)
        if (pr.description) setMemo(pr.description)

        const requiredAmount = pr.amount
        const eligibleBalances = await getEligibleMintBalancesForCashu(pr, requiredAmount, unit)

        if (eligibleBalances.length === 0) {
            throw new AppError(Err.NOTFOUND_ERROR, 'Wallet has no mint with enough balance accepted by this payment request')
        }

        const { selectedBalance, selectedProofs } = await selectMintBalance(
            eligibleBalances,
            requiredAmount,
            unit,
        )

        if(!selectedBalance) { // we might not find suitable balance if offline
            setResultModalInfo({
                status: (transaction?.status || TransactionStatus.ERROR) as TransactionStatus,
                title: 'Offline payment failed',
                message: 'Wallet is offline and does not have ecash denominations matching requested amount',
            });
            toggleResultModal()
            setNfcInfo('Can not pay requested amount')
            return
        }

        setMintBalanceToSendFrom(selectedBalance)
        setAmountToPay(formatDisplayAmount(requiredAmount, unit))
        
        const result = await WalletTask.sendQueueAwaitable(
            selectedBalance,
            requiredAmount,
            unit,
            pr.description ?? '',
            selectedProofs.length > 0 ? selectedProofs : [],
            undefined, // p2pk not supported in current Cashu PR spec
            undefined
        )

        await handleSendTaskResult(result)

    }


    const handleSendTaskResult = async function (result: TransactionTaskResult) {
        log.debug('[NfcScreen] handleSendTaskResult start', {transactionStatus: result.transaction?.status})

        try {
            const { transaction, error, encodedTokenToSend } = result

            // Always update core transaction state
            if (transaction) {
                setTransactionStatus(transaction.status)
                setTransaction(transaction)
                setTransactionId(transaction.id)

                // Optional: link back to original payment request
                if (decodedCashuPaymentRequest?.id || encodedCashuPaymentRequest) {
                    transaction.update({
                        paymentId: decodedCashuPaymentRequest?.id,
                        paymentRequest: encodedCashuPaymentRequest,
                    });
                }
            }

            // ———————— Error Cases ————————
            if (error || !transaction) {
                const message = error?.params?.message || error?.message || 'Unknown error'
                const title = error ? 'Payment failed' : 'Internal error'

                setResultModalInfo({
                    status: (transaction?.status || TransactionStatus.ERROR) as TransactionStatus,
                    title,
                    message,
                });
                toggleResultModal()
                setNfcInfo('Payment failed')
                return
            }

            // ———————— Missing Token ————————
            if (!encodedTokenToSend) {
                setResultModalInfo({
                    status: TransactionStatus.ERROR,
                    title: 'Internal error',
                    message: 'Failed to generate ecash token',
                });
                toggleResultModal()
                setNfcInfo('Payment failed')
                return
            }

            // ———————— Success Path ————————
            setEncodedTokenToSend(encodedTokenToSend)
            // Send over NFC to payee's POS or wallet

            setNfcInfo('Prepared ecash token to be sent via NFC.')

            log.trace('[NfcScreen] handleSendTaskResult: Starting NFC write of an ecash token.')
            await NfcService.writeNdefMessage(encodedTokenToSend)

            log.trace('[NfcScreen] handleSendTaskResult: Write completed.')
            setNfcInfo('Ecash token sent successfully.')
            setIsPaid(true)
            expandHeader()

            // Show explanatory modal immediately when offline
            if (!isOnline.current) {
                setResultModalInfo({
                    status: TransactionStatus.PENDING,
                    title: translate('commonOfflinePretty'),
                    message: 'Your wallet sent this payment while offline. Consult the payee that the funds have been claimed.',
                })
    
                toggleResultModal()
            }
        } catch (err: any) {
            log.error('Error in handleSendTaskResult', {error: err, caller: 'NfcScreen.handleSendTaskResult'})

            setResultModalInfo({
                status: TransactionStatus.ERROR,
                title: 'Unexpected error',
                message: err.message || 'Something went wrong',
            })

            toggleResultModal()

        }
    }
        


    const handleLightningInvoice = async (encodedInvoice: string) => {
        try {
            log.trace('[handleLightningInvoice] start', {isOnline: isOnline.current})

            if (!isOnline.current) {
                // setInfo('Can not use Lightning payment method while offline.')
                setResultModalInfo({
                    status: TransactionStatus.ERROR,
                    title: translate('commonOfflinePretty'),
                    message: 'Can not use Lightning payment method while offline.',
                })

                setIsResultModalVisible(true)
                return
            }

            log.trace('[handleLightningInvoice] decoding invoice')

            const decoded = LightningUtils.decodeInvoice(encodedInvoice)
            const { amount: invoiceAmount, description, expiry, timestamp } = LightningUtils.getInvoiceData(decoded)
        
            if (!invoiceAmount || invoiceAmount <= 0) {
                throw new AppError(Err.VALIDATION_ERROR, 'Lightning invoice has no amount')
            }
        
            const expiresAt = addSeconds(new Date((timestamp as number) * 1000), expiry as number)
            const feeReserve = Math.max(MIN_LIGHTNING_FEE, Math.round(invoiceAmount * LIGHTNING_FEE_PERCENT / 100))
            const totalRequired = invoiceAmount + feeReserve
            const balances = proofsStore.getMintBalancesWithEnoughBalance(totalRequired, unitRef.current)
        
            if (balances.length === 0) {
                setResultModalInfo({
                    status: TransactionStatus.ERROR,
                    title: 'Not enough funds',
                    message: translate('transferScreen_insufficientFunds', {
                        currency: getCurrency(unitRef.current).code,
                        amount: totalRequired,
                    }),
                })

                toggleResultModal()
                return
            }
        
            const selectedBalance = balances[0]
            setMintBalanceToSendFrom(selectedBalance)
        
            let msgQuote = 'Creating Lightning payment quote...'
            log.trace('[handleLightningInvoice]', msgQuote)
            setNfcInfo(msgQuote)

            const quote = await walletStore.createLightningMeltQuote(
                selectedBalance.mintUrl,
                unitRef.current,
                encodedInvoice
            )
        
            // Update UI
            setEncodedInvoice(encodedInvoice)
            setInvoice(decoded)
            setInvoiceExpiry(expiresAt)
            setMeltQuote(quote)
            setAmountToPay(formatDisplayAmount(quote.amount, unitRef.current))
            if (description) setMemo(description)
        
            setNfcInfo('Paying Lightning invoice...')
    
            const result = await WalletTask.transferQueueAwaitable(
                selectedBalance,
                quote.amount,
                unitRef.current,
                quote,
                description ?? '',
                expiresAt,
                encodedInvoice
            )

            const { transaction, message, error: txError } = result
    
            if (!transaction && txError) {
                setTransactionStatus(TransactionStatus.ERROR)

                setResultModalInfo({
                    status: TransactionStatus.ERROR,
                    title: translate('payCommon_failed'),
                    message: txError.message || 'Lightning payment failed',
                })

                toggleResultModal()
                return;
            }

            // ——— Transaction exists ———
            if (transaction) {
                const { status } = transaction;
                setTransactionStatus(status);
                setTransaction(transaction);

                if (txError) {
                    // Pending but timed out / failed
                    if (status === TransactionStatus.PENDING) {
                        setResultModalInfo({
                            status,
                            message,
                        })
                    } else {
                        setResultModalInfo({
                            status,
                            title: txError.params?.message ? txError.message : translate('payCommon_failed'),
                            message: txError.params?.message || txError.message || 'Lightning payment failed',
                        })
                    }
                } else {
                    // Success or settled pending
                    setResultModalInfo({
                        status,
                        message: message || 'Lightning payment successful!',
                        title: status === TransactionStatus.COMPLETED ? 'Payment sent!' : undefined,
                    });
                    setIsPaid(true)
                    expandHeader()
                    setNfcInfo(transaction.memo || 'Lightning payment settled.')
                }
            } else {
                // Fallback (shouldn't happen)
                setResultModalInfo({
                    status: TransactionStatus.ERROR,
                    title: 'Unknown error',
                    message: 'No transaction data received',
                })
            }
            
            toggleResultModal()
        } catch (e: any) {
            log.error(e.message, {error: String(e)})
            handleError(e)
        }
    }


    const handleCashuToken = async function (encodedToken: string) {
        try {
            const decoded = getDecodedToken(encodedToken)
            const amount = CashuUtils.getProofsAmount(decoded.proofs)        
            const memo = decoded.memo || 'Received over NFC'
            const result = await WalletTask.receiveQueueAwaitable(
                decoded,
                amount,
                memo,
                encodedToken
            )

            const { transaction, message, error: txError } = result
    
            if (transaction) {
                const { status } = transaction;
                setTransactionStatus(status);
                setTransaction(transaction);

                if (txError) {
                    // Pending but timed out / failed
                    if (status === TransactionStatus.PENDING) {
                        setResultModalInfo({
                            status,
                            message,
                        })
                    } else {
                        setResultModalInfo({
                            status,
                            title: txError.params?.message ? txError.message : 'Receive failed',
                            message: txError.params?.message || txError.message || 'Could not receive cashu token',
                        })
                    }
                } else {
                    // Success or settled pending
                    setResultModalInfo({
                        status,
                        message: message || 'Ecash token has been successfully received to your wallet.',
                        title: status === TransactionStatus.COMPLETED ? 'Ecash received!' : undefined,
                    });
                    setIsPaid(true)
                    expandHeader()
                    setNfcInfo(transaction.memo || 'Receive over NFC completed.')
                    setAmountToReceive(formatDisplayAmount(transaction.amount, transaction.unit))
                }
            } else {
                // Fallback (shouldn't happen)
                setResultModalInfo({
                    status: TransactionStatus.ERROR,
                    title: 'Unknown error',
                    message: 'No transaction data received',
                })
            }

            setIsResultModalVisible(true)

        } catch(e: any) {
            log.error(e.message, {error: String(e)})
            handleError(e)
        }
    }


    const validateAndNormalizeUnit = (unit?: string): MintUnit => {
        if (!unit) return 'sat'
        if (MintUnits.includes(unit as MintUnit)) {
            return unit as MintUnit;
        }
        throw new AppError(Err.VALIDATION_ERROR, `Unsupported unit: ${unit}`);
    }

    const getEligibleMintBalancesForCashu = async (
        pr: CashuPaymentRequest,
        amount: number,
        unit: MintUnit
    ): Promise<MintBalance[]> => {
    if (pr.mints && pr.mints.length > 0) {
        const balances: MintBalance[] = []
        for (const mintUrl of pr.mints) {
            if (mintsStore.mintExists(mintUrl)) {
                const balance = proofsStore.getMintBalance(mintUrl)
                if (balance && 
                    balance.balances[unit] && 
                    balance.balances[unit] >= amount
                ) {
                    balances.push(balance)
                }
            }
        }
        return balances
    }

    // No mint restriction → all mints with enough balance
    return proofsStore.getMintBalancesWithEnoughBalance(amount, unit);
    };

    const selectMintBalance = async (
        balances: MintBalance[],
        amount: number,
        unit: MintUnit,
    ): Promise<{ selectedBalance: MintBalance | undefined; selectedProofs: Proof[] }> => {
        let selectedProofs: Proof[] = [];

        if (!isOnline.current) {
            // Try to pay exactly with available proofs (avoid swap)
            for (const balance of balances) {
                const proofs = proofsStore.getByMint(balance.mintUrl, { isPending: false, unit })
                const exactProofs = CashuUtils.getProofsToSend(amount, proofs)

                if (CashuUtils.getProofsAmount(exactProofs) === amount) {
                    selectedProofs = exactProofs;
                    return { selectedBalance: balance, selectedProofs }
                }
            }

            return { selectedBalance: undefined, selectedProofs: [] }   
        }

        // Default: just pick first mint with enough balance
        return { selectedBalance: balances[0], selectedProofs };
    }

    const formatDisplayAmount = (amount: number, unit: MintUnit): string => {
        const currency = getCurrency(unit);
        return numbro(amount / currency.precision).format({
            thousandSeparated: true,
            mantissa: currency.mantissa,
        })
    }


    const handleError = (e: AppError) => {
        setError(e)
        setInfo('')
        setIsProcessing(false)
    }

    const gotoScan = () => {
        navigation.navigate('Scan', { unit: unitRef.current })
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
        setInvoiceExpiry(undefined)
        setMeltQuote(undefined)
        setMemo('')
        setTransactionStatus(undefined)
        setInfo('')
        setError(undefined)
        setIsLoading(false)
        setIsProcessing(false)
        setIsResultModalVisible(false)
        setResultModalInfo(undefined)
        setIsPaid(false)
    }

    const toggleResultModal = () => setIsResultModalVisible(previousState => !previousState)

    const headerHeight = useSharedValue(spacing.screenHeight * 0.15); // Initial height
    const collapseHeader = () => {
        headerHeight.value = spacing.screenHeight * 0.15
    }
    
    const expandHeader = () => {
        headerHeight.value = spacing.screenHeight * 0.20
    }

    const animatedHeader = useAnimatedStyle(() => {
        return {
            height: withTiming(headerHeight.value, { duration: 300 }),
            // opacity: withTiming(isVisible.value ? 1 : 0, { duration: 300 }),
        }
    })

    // Theme
    const hintText = useThemeColor('textDim')
    const headerBg = useThemeColor('header')
    const headerTitle = useThemeColor('headerTitle')
    const scanIcon = useThemeColor('text')
    const nfcText = useThemeColor('text')
    const indicatorStandby = colors.palette.primary400
    const indicatorProcessing = useThemeColor('button') 

    return (
        <Screen preset="fixed" contentContainerStyle={$screen}>
            <MintHeader mint={mint} unit={unitRef.current} />
            <Animated.View style={[animatedHeader, $headerContainer, {backgroundColor: headerBg}]}>
                <View style={{}}>
                    {!isOnline.current && !isPaid && ( 
                        <Text
                            tx="commonOffline"
                            style={$warning}
                            size="xxs"
                        />    
                    )}
                    {isPaid && (
                        <AmountInput
                            //ref={amountInputRef}                                               
                            value={`${amountToPay || amountToReceive}`}                    
                            onChangeText={() => {}}
                            unit={unitRef.current}
                            editable={false}
                        />
                    )}
                </View>
            </Animated.View>
            <View style={$contentContainer}>
                {isPaid && transaction ? (
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
                ) : (
                    <Card
                        HeadingComponent={<Icon icon='faNfcSymbol' size={spacing.medium} containerStyle={{alignSelf: 'center'}}/>}
                        ContentComponent={
                        <>
                            {isProcessing ? (
                                <WaveIndicator 
                                    color={indicatorProcessing} 
                                    size={verticalScale(120)}
                                    animating={resultModalInfo ? false : true}
                                    animationDuration={2000}
                                />
                            ) : isNfcEnabled ? (
                            
                                <PulseIndicator 
                                    color={indicatorStandby} 
                                    size={verticalScale(120)}
                                    animating={resultModalInfo ? false : true}
                                    hidesWhenStopped={false}
                                    animationDuration={2000}
                                />
                                    
                            ) : (
                                <PulseIndicator 
                                    color={hintText} 
                                    size={verticalScale(120)}
                                    animating={false}
                                    useNativeDriver={true}
                                    hidesWhenStopped={false}
                                    //animationDuration={2000}
                                />
                            )}
                            
                        </>
                    }
                    FooterComponent={
                        <Text
                                text={
                                    nfcInfo ? nfcInfo : ''
                                }
                                style={{
                                    textAlign: 'center',
                                    marginBottom: spacing.medium,
                                    //fontFamily: typography.code,
                                    color: isProcessing ? indicatorProcessing : isNfcEnabled ? nfcText : hintText,
                                    fontSize: 18,
                                    
                                }}
                        />
                    }
                    style={{height: spacing.screenHeight * 0.3}}
                />
                )}
                

                <View style={$bottomContainer}>
                    <View style={$buttonContainer}>
                        {!isProcessing && (<Button
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
                        />)} 
                    </View>
                </View>
            </View>

            {info && <InfoModal message={info} />}
            {error && <ErrorModal error={error} />}
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
                            onPress={gotoWallet}
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
                    {resultModalInfo && resultModalInfo.status === TransactionStatus.ERROR &&
                    (
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
                            <Button
                                preset="secondary"
                                tx={'commonClose'}
                                onPress={gotoWallet}
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
                                title={resultModalInfo?.title || translate('payCommon_isPending')}
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
        </Screen>
    )
})


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
const $warning: TextStyle = {
    backgroundColor: colors.palette.orange400,
    borderRadius: spacing.extraSmall,
    paddingHorizontal: spacing.tiny,
    marginTop: spacing.medium
}