import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
    ViewStyle,
    View,
    TextStyle,
    Platform,
} from 'react-native'
import { PaymentRequest as CashuPaymentRequest, MeltQuoteBolt11Response, PaymentRequestTransportType, decodePaymentRequest, getDecodedToken, getTokenMetadata } from '@cashu/cashu-ts'
import NfcManager, { Ndef, NfcEvents } from 'react-native-nfc-manager'
import { colors, spacing, typography, useThemeColor } from '../theme'
import EventEmitter from '../utils/eventEmitter'
import { log } from '../services/logService'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'
import AppError, { Err } from '../utils/AppError'
import { AmountInput, BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, ScanIcon, Screen, Text } from '../components'
import { SvgXml } from 'react-native-svg'
import { formatCurrency, getCurrency, MintUnit, MintUnits } from '../services/wallet/currency'
import { useStores } from '../models'
import { MintHeader } from './Mints/MintHeader'
import { moderateScale } from '@gocodingnow/rn-size-matters'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { translate } from '../i18n'
import { StackActions, StaticScreenProps, useNavigation } from '@react-navigation/native'
import { observer } from 'mobx-react-lite'
import { MintBalance } from '../models/Mint'
import { MinibitsClient, NostrClient, SYNC_STATE_WITH_MINT_TASK, SyncStateTaskResult, TransactionTaskResult, WalletTask } from '../services'
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
    withTiming,
    useAnimatedStyle,
    withRepeat,
    Easing,
  } from 'react-native-reanimated';
import { NfcService } from '../services/nfcService'
import { TranItem } from './TranDetailScreen'
import { ProfilePointer } from 'nostr-tools/nip19'
import { NfcIcon } from '../components/NfcIcon'
import FastImage from 'react-native-fast-image'


type Props = StaticScreenProps<{
    unit: MintUnit
    // When the screen is opened by an incoming NFC dispatch (cold/warm app launch via the
    // OS NFC chooser), the tag has ALREADY been read by the OS; we pass the decoded text
    // here and process it directly instead of arming the reader for a live tap.
    incomingData?: string
}>

const SYNC_STATE_WITH_MINT_TIMEOUT = 10 * 1000

export const NfcPayScreen = observer(function NfcPayScreen({ route }: Props) {
    const navigation = useNavigation<any>()
    const { mintsStore, walletStore, proofsStore, transactionsStore, walletProfileStore } = useStores()
    const unitRef = useRef<MintUnit>('sat')
    const isOnline = useRef<boolean>(true)
    // While true, the reader-mode session is re-armed after each read so the NEXT tap is
    // captured by our exclusive reader-mode session instead of falling through to the OS
    // "Complete action using…" chooser / other installed wallets. Turned off once a tag is
    // actually being processed and on unmount.
    const keepScanningRef = useRef<boolean>(false)
    // Set once we lock onto a tag and hand it to the payment flow. While true we keep the
    // Android reader-mode session ALIVE (never cancelTechnologyRequest) until the screen
    // unmounts. Reader mode suppresses the OS NFC dispatch/chooser entirely; tearing it down
    // re-enables dispatch, and a payee that keeps presenting its invoice over HCE (e.g. a
    // Lightning invoice, which it has no way to know is paid) would then trigger the
    // "Complete action using…" chooser over our result modal. Also stops re-arming new taps.
    const paymentLockedRef = useRef<boolean>(false)
    // Tracks whether a reader-mode technology session is currently open. The cold/warm-launch
    // path (route.params.incomingData) processes the already-read payment request WITHOUT
    // opening a reader session — the OS consumed the launch tap. A subsequent NFC write-back
    // (Numo POS PR with no transport) would then fail with "no tech request available", so we
    // use this flag to arm a session on demand before writing in that path.
    const readerSessionActiveRef = useRef<boolean>(false)

    const isInternetReachable = useIsInternetReachable()

    const [encodedTokenToSend, setEncodedTokenToSend] = useState<string | undefined>()
    const [amountToPay, setAmountToPay] = useState<string | undefined>()
    const [amountToReceive, setAmountToReceive] = useState<string | undefined>()
    // const [encodedCashuPaymentRequest, setEncodedCashuPaymentRequest] = useState<string | undefined>()
    // const [decodedCashuPaymentRequest, setDecodedCashuPaymentRequest] = useState<CashuPaymentRequest | undefined>()
    // const [encodedInvoice, setEncodedInvoice] = useState<string>('')
    const [invoice, setInvoice] = useState<DecodedLightningInvoice | undefined>()    
    const [invoiceExpiry, setInvoiceExpiry] = useState<Date | undefined>()           
    const [meltQuote, setMeltQuote] = useState<MeltQuoteBolt11Response | undefined>() 
    const [memo, setMemo] = useState('')
    const [mintBalanceToSendFrom, setMintBalanceToSendFrom] = useState<MintBalance | undefined>()

    const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | undefined>()
    const [transaction, setTransaction] = useState<Transaction | undefined>()
    const [transactionId, setTransactionId] = useState<number | undefined>()
    // When an async (lightning) melt returns PENDING because the mint has not yet settled the
    // payment, the monitor keeps running in the background and emits ev_asyncMeltResult once the
    // quote resolves. While this id is set, the result modal shows an "in progress" state instead
    // of the "stuck pending" warning.
    const [pendingAsyncMeltId, setPendingAsyncMeltId] = useState<number | undefined>(undefined)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, title?: string, message: string} | undefined>()    
    const [isLoading, setIsLoading] = useState(false)
    //const [isOffline, setIsOffline] = useState(false)

    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    // NFC state
    const [isNfcEnabled, setIsNfcEnabled] = useState(false)    
    const [isProcessing, setIsProcessing] = useState(false)
    const [isPaid, setIsPaid] = useState(false)
    const [isError, setIsError] = useState(false)
    const [nfcInfo, setNfcInfo] = useState<string | undefined>()
    //const [readNfcData, setReadNfcData] = useState<string | undefined>()

    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState<string>('')

    // Start NFC only when this screen is visible
    useEffect(() => {
        const initNfc = async () => {
            try {
                const supported = await NfcService.init() // runs NfcManager.start()
                log.trace({isInternetReachable})

                const balance = proofsStore.getMintBalanceWithMaxBalance(unitRef.current)

                if (balance) {
                    setMintBalanceToSendFrom(balance)
                }

                // Opened by an incoming NFC dispatch (cold/warm launch via the OS chooser):
                // the tag was already read by the OS, so we can usually process the decoded
                // data directly and skip arming the live reader.
                //
                // EXCEPTION: a cashu payment request with NO transport must be paid by writing
                // the ecash back onto the payee's still-presented HCE tag (Numo POS). That write
                // needs a live reader session — and on cold/warm launch the OS already consumed
                // the tap that read the PR and closed that RF session, so there is NO session to
                // write on. Arming a reader AFTER processing the pre-read text is racy: the user
                // has no cue to keep holding, and preparing the token MAY add a mint swap
                // (online-swap path; offline/online-no-swap are instant) that drops the coupling
                // entirely — then the write hangs waiting for a tap. So we DISCARD the pre-read
                // text for this case and run the normal live reader flow: read PR → prepare →
                // write back all on ONE continuous session, exactly like the foreground path that
                // already works. The user just keeps the phones together (or taps once more).
                const incomingData = route.params?.incomingData
                if (incomingData) {
                    let needsLiveWriteBack = false
                    try {
                        const parsed = IncomingParser.findAndExtract(incomingData)
                        if (parsed?.type === IncomingDataType.CASHU_PAYMENT_REQUEST && parsed.encoded) {
                            const pr = decodePaymentRequest(parsed.encoded)
                            needsLiveWriteBack = !pr.transport || pr.transport.length === 0
                        }
                    } catch (e: any) {
                        log.warn('[initNfc] failed to pre-decode incoming data', { error: e.message })
                    }

                    if (!needsLiveWriteBack) {
                        keepScanningRef.current = false
                        setIsProcessing(true)
                        try {
                            await handleIncomingData(incomingData)
                        } catch (e: any) {
                            log.error(e.message, { params: e.params || {} })
                            setResultModalInfo({
                                status: TransactionStatus.ERROR,
                                title: e.params?.message ? e.message : 'NFC Payment failed',
                                message: e.params?.message || e.message || 'Unknown error during NFC payment processing.',
                            })
                            setNfcInfo(e.message)
                            setIsError(true)
                            toggleResultModal()
                        } finally {
                            setIsProcessing(false)
                        }
                        return
                    }
                    // needsLiveWriteBack: fall through to arm the live reader below.
                    log.trace('[initNfc] transport-less cashu PR on cold/warm launch — arming live reader for single-session write-back')
                }

                /*setNfcInfo('Hold your device close to the NFC reader.')
                setIsNfcEnabled(true)
                return

                const tx = transactionsStore.findById(1)
                setTransaction(tx || undefined)
                setAmountToPay(formatDisplayAmount(tx?.amount || 0, unitRef.current))*/

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
                keepScanningRef.current = true

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
            keepScanningRef.current = false
            readerSessionActiveRef.current = false
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
            // Don't re-arm if a payment is locked — its reader-mode session is still alive
            // and a fresh requestTechnology would collide (ERR_MULTI_REQ).
            if (isNfcEnabled && !isProcessing && !paymentLockedRef.current) {
                keepScanningRef.current = true
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

            if(currentTx?.status === TransactionStatus.PENDING && !isError) { // avoid showing pending if we've got an error later
                showPendingModal()
            }
            return
            // If ERROR → do nothing, user can close manually
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

    // async melt result listener - updates the result modal when the melt quote resolves and
    // the transaction reaches a terminal status (COMPLETED / REVERTED).
    useEffect(() => {
        if (!pendingAsyncMeltId) return

        const handler = (result: { transactionId: number; status: TransactionStatus; message: string }) => {
            log.trace('[NfcScreen] Received async melt result', { result, pendingAsyncMeltId })

            if (result.transactionId !== pendingAsyncMeltId) return

            setPendingAsyncMeltId(undefined)
            setTransactionStatus(result.status)
            setResultModalInfo({ status: result.status, message: result.message })
        }

        EventEmitter.on('ev_asyncMeltResult', handler)
        return () => EventEmitter.off('ev_asyncMeltResult', handler)
    }, [pendingAsyncMeltId])

    // Tears down the current reader-mode session and arms a fresh one. Shared by the finally
    // retry path (transient failed read) and dismissResultModal (re-scan after the modal is
    // dismissed). Android-only: on iOS a fresh requestTechnology would reopen the CoreNFC scan
    // sheet, so iOS re-arms only on screen focus.
    const rearmReader = async function () {
        if (Platform.OS !== 'android' || !keepScanningRef.current) return
        // Cancel the current (consumed or failed) session; a fresh requestTechnology would
        // otherwise collide with it (ERR_MULTI_REQ).
        await NfcManager.cancelTechnologyRequest().catch(() => {})
        readerSessionActiveRef.current = false
        // Let reader mode tear down cleanly and throttle re-arming if the NFC stack errors.
        await new Promise(r => setTimeout(r, 300))
        if (keepScanningRef.current && !paymentLockedRef.current) {
            log.trace('[rearmReader] restarting NFC reader session')
            setNfcInfo('Hold your device close to the NFC reader.')
            startNfcSession()
        }
    }

    const startNfcSession = async () => {
        let decoded: string | undefined = undefined;
        try {
            log.debug('[startNfcSession] Starting NFC session...')

            const tag = await NfcService.readNdefTag()
            // requestTechnology has now opened a reader-mode session (kept alive below); record
            // it so a later write-back can reuse it instead of arming a second one.
            readerSessionActiveRef.current = true

            if (!tag || !tag.ndefMessage) {
                return
            }

            // Lock onto this tag and hand it to the payment flow. From here we keep the
            // reader-mode session alive (see finally) so the OS chooser can't pop over the
            // result modal, and we stop re-arming for new taps.
            paymentLockedRef.current = true
            setIsProcessing(true)

            //log.info('NFC Tag found', {tag});
            const bytes = new Uint8Array(tag.ndefMessage[0]?.payload ?? [])
            decoded = Ndef.text.decodePayload(bytes)

            log.trace({decoded})

            if(!decoded || decoded.length < 40) {
                const msg = 'This NFC tag can not be processed, missing or truncated NDEF message.'
                
                throw new AppError(Err.NFC_ERROR, msg, decoded ? { decoded } : undefined)
            }

            setNfcInfo('Processing, keep your device still...')            

            log.info('NFC tag decoded', { decoded })

            //setReadNfcData(decoded)
            await handleIncomingData(decoded)

        } catch (e: any) {
            log.error(e.message, {params: e.params || {}})

             setResultModalInfo({
                status: TransactionStatus.ERROR,
                title: e.params?.message ? e.message : 'NFC Payment failed',
                message: e.params?.message || e.message || 'Unknown error during NFC payment processing.',
            })

            setNfcInfo(e.message)
            setIsError(true)
            toggleResultModal()
        } finally {
            log.trace('[startNfcSession.finally] block start', {paymentLockedRef: paymentLockedRef.current, keepScanningRef: keepScanningRef.current})
            setIsProcessing(false)

            if (Platform.OS === 'android' && paymentLockedRef.current) {
                // Keep the reader-mode session ALIVE after locking onto a payment so the OS
                // chooser can't pop over the result modal (the payee may keep presenting its
                // invoice over HCE — e.g. a Lightning invoice it can't know is paid). The
                // session is torn down on unmount, or by dismissResultModal when the user
                // dismisses the modal without leaving the screen.
                log.trace('[startNfcSession.finally] payment locked - keeping reader session alive')
            } else if (Platform.OS === 'android') {
                // Transient non-locked read (empty/failed): recover the reader so a retry tap
                // is captured by reader mode instead of falling through to the OS chooser.
                await rearmReader()
            } else {
                // iOS: close the CoreNFC scan sheet. Re-arming would reopen that popup, so iOS
                // re-arms only on screen focus.
                await NfcManager.cancelTechnologyRequest().catch(() => {})
                readerSessionActiveRef.current = false
            }
        }
    }


    const handleIncomingData = async (data: string) => {

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
        if (!pr.amount || Number(pr.amount) <= 0) {
            throw new AppError(Err.VALIDATION_ERROR, 'Payment request has no valid amount')
        }

        const transports = pr.transport

        if(transports && transports.length > 0 && !isOnline.current) {
            throw new AppError(Err.VALIDATION_ERROR, 'Payment failed',
                { message: 'Wallet can not pay this payment request while offline.' }
            )
        }

        const unit = validateAndNormalizeUnit(pr.unit)
        unitRef.current = unit

        // Store
        // setDecodedCashuPaymentRequest(pr)
        // setEncodedCashuPaymentRequest(encoded)
        if (pr.description) setMemo(pr.description)

        const requiredAmount = Number(pr.amount)
        const eligibleBalances = await getEligibleMintBalancesForCashu(pr, requiredAmount, unit)

        if (eligibleBalances.length === 0) {
            throw new AppError(Err.NOTFOUND_ERROR, 'Payment failed', {
                message: 'Wallet has no mint with enough balance accepted by this payment request.'
            })
        }

        const { selectedBalance, selectedProofs } = await selectMintBalance(
            eligibleBalances,
            requiredAmount,
            unit,
        )

        if(!selectedBalance) { // we might not find suitable balance if offline
            throw new AppError(Err.NOTFOUND_ERROR, 'Offline payment failed', {
                message: 'Wallet is offline and does not have ecash denominations matching requested amount.'
            })
        }

        // re-set selected mint balance if default is not accepted by this PR
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

        await handleSendTaskResult(encoded, result)
        // await handleSendTaskResult(result)

    }


    const handleSendTaskResult = async function (encodedCashuPaymentRequest: string, result: TransactionTaskResult) {
        log.debug('[NfcScreen] handleSendTaskResult start', {transactionStatus: result.transaction?.status})

        const { transaction, error } = result
        const decodedCashuPaymentRequest = decodePaymentRequest(encodedCashuPaymentRequest)

        // update tx with pr info
        if (transaction) {
            setTransactionStatus(transaction.status)
            setTransaction(transaction)
            setTransactionId(transaction.id)

            // Optional: link back to original payment request
            if (decodedCashuPaymentRequest?.id || encodedCashuPaymentRequest) {
                transaction.update({
                    paymentId: decodedCashuPaymentRequest?.id,
                    paymentRequest: encodedCashuPaymentRequest,
                })
            }
        }

        // ———————— Error Cases ————————
        if (error || !transaction) {
            throw new AppError(Err.NOTFOUND_ERROR, 'Payment failed', {
                message: error?.params?.message || error?.message || 'Unknown error'
            })
        }

        // ———————— Missing Token or PR ————————
        // sendTask returns the prepared token on the transaction (outputToken); there is no
        // top-level encodedTokenToSend field on TransactionTaskResult, so reading it from the
        // result was always undefined and made every NFC cashu-PR payment fail here.
        const encodedTokenToSend = transaction.outputToken ?? undefined
        if (!encodedTokenToSend || !decodedCashuPaymentRequest) {
            throw new AppError(Err.NOTFOUND_ERROR, 'Internal error', {
                message: 'Failed to retrieve Payment request or ecash token'
            })
        }

        // ———————— Success Path ————————
        setEncodedTokenToSend(encodedTokenToSend)
        // Send over NFC to payee's POS or using the PR transport method

        const transports = decodedCashuPaymentRequest.transport


        // NFC write back only if no transport methods specified (POS device)
        if(!transports || transports.length === 0) {
            setNfcInfo('Prepared ecash token to be sent via NFC.')

            // On a cold/warm launch the PR was read by the OS (route.params.incomingData) and
            // no reader session is open, so writeNdefMessage would throw "no tech request
            // available". Arm one now: the OS only consumed the launch tap, and the POS keeps
            // presenting its HCE tag, so holding the phones together re-establishes the ISO-DEP
            // connection we write the token back onto. The live-tap path already has the session
            // from the initial read open, so it skips this.
            if (!readerSessionActiveRef.current) {
                log.trace('[NfcScreen] handleSendTaskResult: no open reader session (cold/warm launch), arming one for write-back.')
                setNfcInfo('Hold your device close to the payee to deliver the ecash...')
                await NfcService.readNdefTag() // opens requestTechnology session, keeps it alive
                readerSessionActiveRef.current = true
            }

            log.trace('[NfcScreen] handleSendTaskResult: Starting NFC write of an ecash token.')
            await NfcService.writeNdefMessage(encodedTokenToSend)

            log.trace('[NfcScreen] handleSendTaskResult: Write completed.')
            setNfcInfo('Ecash token sent successfully.')
            setIsPaid(true)
            
            // Show explanatory modal immediately when offline
            if (!isOnline.current) {
                setResultModalInfo({
                    status: TransactionStatus.PENDING,
                    title: translate('commonOfflinePretty'),
                    message: 'Your wallet sent this payment while offline. Consult the payee that the funds have been claimed.',
                })
    
                toggleResultModal()
            }

            return
        }

        // Check for NOSTR transport first
        const nostrTransport = transports.find(t => t.type === PaymentRequestTransportType.NOSTR)
        
        // keysetsV2 support
        const mintKeysetIds = mintsStore.findByUrl(result.mintUrl)?.keysetIds
        if(!mintKeysetIds || mintKeysetIds.length === 0) {
            throw new AppError(Err.NOTFOUND_ERROR, 'Missing keysetIds in the wallet state, payment failed', {
                mintUrl: result.mintUrl
            })
        }

        const decodedTokenToSend = getDecodedToken(encodedTokenToSend, mintKeysetIds)

        if (nostrTransport) {
            const decoded = NostrClient.decodeNprofile(nostrTransport.target)
            const pubkey = (decoded.data as ProfilePointer).pubkey
            let relays = (decoded.data as ProfilePointer).relays?.slice(0, 5)

            if(!relays || relays.length === 0) {
                relays = NostrClient.getAllRelays()
            }

            log.debug('[NfcScreen] handleSendTaskResult: Sending ecash token via Nostr NIP-17 to payee.', { pubkey, relays })
            const messageContent = JSON.stringify({
                id: decodedCashuPaymentRequest.id,
                mint: decodedTokenToSend.mint,
                unit: decodedTokenToSend.unit,
                proofs: decodedTokenToSend.proofs,
            })
        
            const keys = await walletStore.getCachedWalletKeys()
            const sentEvent = await NostrClient.encryptAndSendDirectMessageNip17(
                pubkey,
                messageContent,
                relays,
                keys.NOSTR,
                walletProfileStore.nip05
            )

            if(!sentEvent) {
                setResultModalInfo({
                    status: TransactionStatus.PENDING,
                    title: 'Payment not confirmed',
                    message: 'Nostr relays could not confirm that payment has been sent. Consult the payee if the funds have been claimed.',
                })
    
                toggleResultModal()
                return
            }

        } else {
            // Fallback to POST transport
            const postTransport = transports.find(t => t.type === PaymentRequestTransportType.POST)

            if (postTransport && postTransport.target) {
                const payload = {
                    id: decodedCashuPaymentRequest.id,
                    mint: decodedTokenToSend.mint,
                    unit: decodedTokenToSend.unit,
                    proofs: decodedTokenToSend.proofs,
                    memo: decodedTokenToSend.memo || undefined,
                }
    
                await MinibitsClient.fetchApi(postTransport.target, {
                    method: 'POST',
                    body: payload,
                    jwtAuthRequired: false
                })
                
            } else {
                // Error if neither transport is supported
                throw new AppError(Err.NOTFOUND_ERROR, 'Payment failed', {
                    message: 'Payment request only supports NOSTR or POST transports, but neither is available.'
                })
            }
        }

        setNfcInfo('Ecash token sent successfully.')
        setIsPaid(true)
    }
        


    const handleLightningInvoice = async (encodedInvoice: string) => {
        log.trace('[handleLightningInvoice] start', {isOnline: isOnline.current})

        if (!isOnline.current) {
            throw new AppError(Err.NOTFOUND_ERROR, translate('commonOfflinePretty'), {
                message: 'Can not use Lightning payment method while offline.'
            })
        }

        // Get balance from state, or fetch directly from store if state not yet updated
        // (React state updates are async, so mintBalanceToSendFrom may be undefined
        // if NFC tag is read immediately after component mount)
        let balanceToUse = mintBalanceToSendFrom
        if (!balanceToUse) {
            balanceToUse = proofsStore.getMintBalanceWithMaxBalance(unitRef.current)
            if (balanceToUse) {
                setMintBalanceToSendFrom(balanceToUse)
            }
        }

        if(!balanceToUse) {
            throw new AppError(Err.NOTFOUND_ERROR, 'No mint balance selected for payment')
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
        // const balances = proofsStore.getMintBalancesWithEnoughBalance(totalRequired, unitRef.current)

        const availableBalance = balanceToUse.balances[unitRef.current] || 0
    
        if (availableBalance < totalRequired) {
            throw new AppError(Err.NOTFOUND_ERROR, 'Not enough funds', {
                message: translate('transferScreen_insufficientFunds', {
                    currency: getCurrency(unitRef.current).code,
                    amount: totalRequired,
                })
            })
        }
    
        // const selectedBalance = balances[0]
        // setMintBalanceToSendFrom(selectedBalance)
    
        let msgQuote = 'Creating Lightning payment quote...'
        log.trace('[handleLightningInvoice]', msgQuote)
        setNfcInfo(msgQuote)

        const quote = await walletStore.createLightningMeltQuote(
            balanceToUse.mintUrl,
            unitRef.current,
            encodedInvoice
        )
    
        // Update UI
        // setEncodedInvoice(encodedInvoice)
        setInvoice(decoded)
        setInvoiceExpiry(expiresAt)
        setMeltQuote(quote)
        setAmountToPay(formatDisplayAmount(quote.amount.toNumber(), unitRef.current))
        if (description) setMemo(description)

        setNfcInfo('Paying Lightning invoice...')

        const result = await WalletTask.transferQueueAwaitable(
            balanceToUse,
            quote.amount.toNumber(),
            unitRef.current,
            quote,
            description ?? '',
            expiresAt,
            encodedInvoice
        )

        const { transaction, message, error: txError } = result

        if (!transaction && txError) {
            throw new AppError(Err.NOTFOUND_ERROR, translate('payCommon_failed'), {
                message: txError.message || 'Lightning payment failed.'
            })
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
                    throw new AppError(Err.NOTFOUND_ERROR, txError.params?.message ? txError.message : translate('payCommon_failed'), {
                        message: txError.params?.message || txError.message || 'Lightning payment failed'
                    })
                }
            } else {
                if (status === TransactionStatus.PENDING) {
                    // Async melt: monitor is running in background and will emit ev_asyncMeltResult
                    // when the quote resolves. The listener above will update the modal at that point.
                    setPendingAsyncMeltId(transaction.id)
                }
                // Success or settled pending
                setResultModalInfo({
                    status,
                    message: message || 'Lightning payment successful!',
                    title: status === TransactionStatus.COMPLETED ? 'Payment sent!' : undefined,
                });
                setIsPaid(true)
                setNfcInfo(transaction.memo || 'Lightning payment settled.')
            }
        } else {
            // Fallback (shouldn't happen)
            throw new AppError(Err.UNKNOWN_ERROR, 'Internal error', {
                message: 'No transaction data received.'
            })
        }
        
        toggleResultModal()
    }


    const handleCashuToken = async function (encodedToken: string) {

        // keysetsV2 support
        const tokenInfo = getTokenMetadata(encodedToken)
        const {mint: mintUrl, amount, unit, memo} = tokenInfo

        let mintInstance = mintsStore.findByUrl(mintUrl)

        if(!mintInstance) {
            mintInstance = await mintsStore.addMint(mintUrl)
        }
              
        const result = await WalletTask.receiveQueueAwaitable(
            mintInstance,
            tokenInfo,
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
                    throw new AppError(Err.NOTFOUND_ERROR, txError.params?.message ? txError.message : 'Receive failed', {
                        message: txError.params?.message || txError.message || 'Could not receive cashu token'
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
                setNfcInfo(transaction.memo || 'Receive over NFC completed.')
                setAmountToReceive(formatDisplayAmount(transaction.amount, transaction.unit))
            }
        } else {
            // Fallback (shouldn't happen)
            throw new AppError(Err.UNKNOWN_ERROR, 'Internal error', {
                message: 'No transaction data received.'
            })
        }

        setIsResultModalVisible(true)
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
                const proofs = proofsStore.getByMint(balance.mintUrl, { state: 'UNSPENT', unit })
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
        //ßsetEncodedInvoice('')
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
        setPendingAsyncMeltId(undefined)
    }

    const toggleResultModal = () => setIsResultModalVisible(previousState => !previousState)

    // Dismiss the result modal while STAYING on the NFC screen (backdrop, back button, or the
    // "reverted" close). After a payment we keep the Android reader-mode session alive (and
    // paymentLockedRef true) so the OS chooser can't pop over the modal — but that session is
    // consumed. So on dismiss we reset the pay state, release the lock, and re-arm a fresh
    // reader so another NFC payment can be made; without this the next tap would never be
    // read. (Leaving via the Close buttons unmounts the screen, which cleans up instead.)
    const dismissResultModal = function () {
        resetState() // also hides the modal
        paymentLockedRef.current = false
        rearmReader()
    }



    // Theme
    const hintText = useThemeColor('textDim')
    const headerBg = useThemeColor('background')
    const headerTitle = useThemeColor('headerTitle')
    const scanIcon = useThemeColor('text')
    const nfcText = useThemeColor('text')
    const indicatorStandby = colors.palette.primary400
    const indicatorProcessing = useThemeColor('button')

    // Metallic card colors - subtle gradient effect via borders
    const isLightTheme = headerBg === colors.light.background
    const metalHighlight = isLightTheme ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.12)'
    const metalShadow = isLightTheme ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 0, 0, 0.5)'
    const metalBase = isLightTheme ? colors.palette.neutral200 : colors.palette.neutral700
    const metalShineTop = isLightTheme ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.08)'
    const metalShineBottom = isLightTheme ? 'rgba(255, 255, 255, 0)' : 'rgba(255, 255, 255, 0)' 

    return (
        <Screen preset="fixed" contentContainerStyle={$screen}>
            <MintHeader
                mint={undefined}
                unit={unitRef.current}
                onBackPress={gotoWallet}
                textColor={nfcText as string}
                backgroundColor={headerBg as string}
                leftIconColor={nfcText as string}
            />
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>                
                    {!isOnline.current && !isPaid && ( 
                        <>
                        <Text
                            tx="commonOffline"
                            style={$warning}
                            size="xxs"
                        />
                        </>    
                    )}
                    {isPaid ? (
                        <AmountInput
                            //ref={amountInputRef}                                               
                            value={`${amountToPay || amountToReceive}`}                    
                            onChangeText={() => {}}
                            unit={unitRef.current}
                            editable={false}
                        />
                    ) : (
                        <>
                            <View
                                style={{
                                    alignSelf: 'center',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: moderateScale(80),
                                    height: moderateScale(80),
                                    backgroundColor:isProcessing ? indicatorProcessing : isNfcEnabled ? indicatorStandby : hintText,
                                    borderRadius: moderateScale(80) / 2,
                                    marginVertical: spacing.medium,                                    
                                }}
                            >
                                <PulsingContactlessIcon 
                                    isNfcEnabled={isNfcEnabled}
                                    size={moderateScale(40)}
                                />
                            </View>
                            <Text
                                text={nfcInfo}
                                style={{
                                    textAlign: 'center',
                                    marginBottom: spacing.medium,
                                    paddingHorizontal: spacing.medium,
                                    color: isProcessing ? indicatorProcessing : isNfcEnabled ? indicatorStandby : hintText,
                                    //minHeight: moderateScale(52),
                                }}
                                preset='heading'
                                size='md'
                                //numberOfLines={2}
                            />
                        </>

                    )}
            </View>
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
                    <>
                    {mintBalanceToSendFrom && (() => {
                        const mint = mintsStore.findByUrl(mintBalanceToSendFrom.mintUrl)
                        const balance = mintBalanceToSendFrom.balances[unitRef.current] || 0
                        const currency = getCurrency(unitRef.current)
                        const formattedBalance = formatCurrency(balance, currency.code)

                        return (
                            <View style={[
                                $mintCardOuter,
                                {
                                    backgroundColor: metalBase,
                                    borderTopColor: metalHighlight,
                                    borderLeftColor: metalHighlight,
                                    borderBottomColor: metalShadow,
                                    borderRightColor: metalShadow,
                                }
                            ]}>
                                {/* Metallic shine overlay */}
                                <View
                                    style={[
                                        $metalShine,
                                        {
                                            backgroundColor: metalShineTop,
                                            borderColor: metalShineBottom,
                                        }
                                    ]}
                                    pointerEvents="none"
                                />
                                <Card
                                    ContentComponent={
                                        <View style={$cardContent}>
                                            <View style={$cardTopRow}>
                                                {mint?.mintInfo?.icon_url ? (
                                                    <FastImage
                                                        style={{
                                                            width: moderateScale(28),
                                                            height: moderateScale(28),
                                                            borderRadius: moderateScale(14),
                                                        }}
                                                        source={{ uri: mint.mintInfo.icon_url }}
                                                        resizeMode={FastImage.resizeMode.contain}
                                                    />
                                                ) : (
                                                    <View style={[$mintIconFallback, { backgroundColor: mint?.color || colors.palette.primary300 }]} />
                                                )}
                                                <Text
                                                    text={mint?.shortname || 'Mint'}
                                                    style={{ color: nfcText, marginLeft: spacing.small }}
                                                    size="xs"
                                                />
                                            </View>
                                            <View style={$cardBalanceRow}>
                                                <Text
                                                    text={formattedBalance}
                                                    style={{
                                                        fontFamily: typography.code?.normal,
                                                        color: nfcText,
                                                        fontSize: moderateScale(28),
                                                    }}
                                                />
                                                <Text
                                                    text={currency.code}
                                                    style={{
                                                        color: hintText,
                                                        marginLeft: spacing.extraSmall,
                                                        alignSelf: 'flex-end',
                                                        marginBottom: spacing.tiny,
                                                    }}
                                                    size="xs"
                                                />
                                            </View>
                                            <View style={$cardBottomRow}>
                                                <Text
                                                    text={mint?.hostname || mintBalanceToSendFrom.mintUrl}
                                                    style={{ color: hintText }}
                                                    size="xxs"
                                                    numberOfLines={1}
                                                />
                                            </View>
                                        </View>
                                    }
                                    style={$mintCard}
                                />
                            </View>
                        )
                    })()}
                    </>
                )} 
                <View style={$bottomContainer}>
                    <View style={$buttonContainer}>
                        {!isProcessing && !isPaid && (<Button
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
                        {isPaid && (<Button
                            preset='tertiary'                                    
                            LeftAccessory={() => (
                                <Icon
                                    icon="faXmark"
                                    size={spacing.medium}
                                    color={scanIcon as string}
                                    style={{marginHorizontal: spacing.extraSmall}}
                                />
                            )}
                            onPress={gotoWallet}
                            //style={{backgroundColor: scanButtonColor}}
                            text='Close'
                        />)}  
                    </View>
                </View>
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
                            onPress={dismissResultModal}
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
                    transactionStatus === TransactionStatus.PENDING &&
                    resultModalInfo.status !== TransactionStatus.ERROR &&
                    !pendingAsyncMeltId && (
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
                    {resultModalInfo &&
                    transactionStatus === TransactionStatus.PENDING &&
                    resultModalInfo.status !== TransactionStatus.ERROR &&
                    !!pendingAsyncMeltId && (
                        <>
                            <ResultModalInfo
                                icon="faClock"
                                iconColor={colors.palette.iconBlue200}
                                title={resultModalInfo?.title || translate('payCommon_isInProgress')}
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
                onBackButtonPress={dismissResultModal}
                onBackdropPress={dismissResultModal}
            />
            {info && <InfoModal message={info} />}
            {error && <ErrorModal error={error} />}
        </Screen>
    )
})

interface PulsingContactlessIconProps {
  isNfcEnabled: boolean;
  size?: number;
}

export const PulsingContactlessIcon: React.FC<PulsingContactlessIconProps> = ({
    isNfcEnabled,
    size,
}) => {
  const scale = useSharedValue(1);

  // Start/stop pulse based on nfcBroadcast
  useEffect(() => {
    if (isNfcEnabled) {
      scale.value = withRepeat(
        withTiming(1.15, {
          duration: 1000,
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
    ? colors.palette.success300
    : colors.light.text

  return (
    <Animated.View style={[animatedStyle, { alignSelf: 'center' }]}>
      <SvgXml
        width={size || spacing.medium}
        height={size || spacing.medium}
        xml={NfcIcon}
        stroke={'white'}
        fill={'white'}
      />
    </Animated.View>
  );
};


const $screen: ViewStyle = { }
const $contentContainer: ViewStyle = { flex: 1, padding: spacing.extraSmall }
const $headerContainer: TextStyle = { alignItems: 'center', paddingVertical: spacing.medium,}
const $buttonContainer: ViewStyle = { flexDirection: 'row', alignSelf: 'center' }
const $bottomContainer: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.extraLarge * 3,
    //alignSelf: 'stretch',
}
const $warning: TextStyle = {
    position: 'absolute',
    top: 0,
    backgroundColor: colors.palette.orange400,
    borderRadius: spacing.extraSmall,
    paddingHorizontal: spacing.tiny,
    alignSelf: 'center',
    zIndex: 1,
    marginVertical: spacing.small,
}
const $mintCardOuter: ViewStyle = {
    marginHorizontal: spacing.small,
    borderRadius: spacing.medium + 2,
    borderWidth: 1.5,
    shadowColor: colors.palette.neutral900,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    overflow: 'hidden',
}
const $metalShine: ViewStyle = {
    position: 'absolute',
    top: -50,
    left: -50,
    width: '150%',
    height: '70%',
    borderBottomWidth: 1,
    transform: [{ rotate: '-15deg' }],
}
const $mintCard: ViewStyle = {
    height: spacing.screenHeight * 0.25,
    borderRadius: spacing.medium,
    padding: spacing.medium,
    backgroundColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
}
const $cardContent: ViewStyle = {
    marginVertical: spacing.small,
    flex: 1,
    justifyContent: 'space-between',
}
const $cardTopRow: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
}
const $mintIconFallback: ViewStyle = {
    width: moderateScale(28),
    height: moderateScale(28),
    borderRadius: moderateScale(14),
}
const $cardBalanceRow: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.medium,
}
const $cardBottomRow: ViewStyle = {
    marginTop: spacing.small,
}