/**
 * Pay a Bitcoin address by melting ecash onchain (NUT-30).
 *
 * Kept separate from TransferScreen rather than folded into it as a third mode. The
 * lightning screen is shaped around a payment request that already carries its amount
 * (an invoice, or an LNURL callback that mints one), and around a quote it can fetch
 * the moment a mint is chosen. Neither holds here: the user types the amount, so a
 * quote cannot exist until they have, and the quote comes back with a LIST of fee tiers
 * instead of a single fee reserve. Threading that through the invoice-shaped reducer
 * would have meant re-auditing every `!encodedInvoice &&` render gate on a screen where
 * a mistake breaks lightning payments.
 *
 * The service layer underneath is NOT forked — both rails share one
 * `TransferOperationApi`. This is a screen, not a second implementation.
 */
import {observer} from 'mobx-react-lite'
import React, {useCallback, useEffect, useReducer, useRef, useState} from 'react'
import {StackActions, StaticScreenProps, useNavigation} from '@react-navigation/native'
import {TextInput, TextStyle, View, ViewStyle} from 'react-native'
import numbro from 'numbro'
import {MeltQuoteOnchainResponse} from '@cashu/cashu-ts'
import {colors, spacing, useThemeColor} from '../theme'
import {
    AmountInput,
    BottomModal,
    Button,
    Card,
    ErrorModal,
    Icon,
    InfoModal,
    ListItem,
    Loading,
    Screen,
    Text,
} from '../components'
import {useStores} from '../models'
import {MintBalance} from '../models/Mint'
import {Transaction, TransactionStatus} from '../models/Transaction'
import {WalletTask} from '../services'
import {TransactionTaskResult} from '../services/wallet/types'
import {log} from '../services/logService'
import {translate} from '../i18n'
import AppError, {Err} from '../utils/AppError'
import {round, toNumber} from '../utils/number'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import {MintUnit, getCurrency} from '../services/wallet/currency'
import {
    OnchainFeeOption,
    normalizeFeeOptions,
    onchainMeltFloor,
    selectDefaultFeeOption,
} from '../services/wallet/operations/onchainAmounts'
import {MintHeader} from './Mints/MintHeader'
import {MintBalanceSelector} from './Mints/MintBalanceSelector'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {TranItem} from './TranDetailScreen'

type Props = StaticScreenProps<{
    address: string
    /** BIP21 amount hint, in sats. The user may change it. */
    amountSat?: number
    /** BIP21 label/message: the PAYEE's description. Read-only. */
    memo?: string
    unit: MintUnit
    mintUrl?: string
}>

// ─── State machine ───────────────────────────────────────────────────────────

type OnchainTransferState = {
    address: string
    meltQuote: MeltQuoteOnchainResponse | undefined
    feeOptions: OnchainFeeOption[]
    selectedFee: OnchainFeeOption | undefined
    availableMintBalances: MintBalance[]
    mintBalanceToTransferFrom: MintBalance | undefined
    transaction: Transaction | undefined
    transactionStatus: TransactionStatus | undefined
    resultModalInfo: {status: TransactionStatus; title?: string; message: string} | undefined
    finalFee: number
    isLoading: boolean
    isResultModalVisible: boolean
    isFeeModalVisible: boolean
    info: string
    error: AppError | undefined
}

type OnchainTransferAction =
    | {type: 'SET_MINT_BALANCE'; balance: MintBalance}
    | {type: 'QUOTE_START'}
    | {
          type: 'QUOTE_READY'
          meltQuote: MeltQuoteOnchainResponse
          feeOptions: OnchainFeeOption[]
          selectedFee: OnchainFeeOption
          availableMintBalances: MintBalance[]
      }
    | {type: 'QUOTE_INSUFFICIENT'; message: string}
    | {type: 'QUOTE_CLEAR'}
    | {type: 'QUOTE_FINISHED'}
    | {type: 'SELECT_FEE'; option: OnchainFeeOption}
    | {type: 'TOGGLE_FEE_MODAL'}
    | {type: 'TRANSFER_START'}
    | {
          type: 'TRANSFER_COMPLETE'
          transaction?: Transaction
          transactionStatus: TransactionStatus
          finalFee: number
          resultModalInfo: {status: TransactionStatus; title?: string; message: string}
      }
    | {type: 'TOGGLE_RESULT_MODAL'}
    | {type: 'SET_INFO'; message: string}
    | {type: 'SET_ERROR'; error: AppError}
    | {type: 'RESET'}

const INITIAL_STATE: OnchainTransferState = {
    address: '',
    meltQuote: undefined,
    feeOptions: [],
    selectedFee: undefined,
    availableMintBalances: [],
    mintBalanceToTransferFrom: undefined,
    transaction: undefined,
    transactionStatus: undefined,
    resultModalInfo: undefined,
    finalFee: 0,
    isLoading: false,
    isResultModalVisible: false,
    isFeeModalVisible: false,
    info: '',
    error: undefined,
}

function onchainTransferReducer(
    state: OnchainTransferState,
    action: OnchainTransferAction,
): OnchainTransferState {
    switch (action.type) {
        case 'SET_MINT_BALANCE':
            // Switching mint invalidates the quote: fee tiers are the MINT's estimate of
            // what the chain costs, priced from its own UTXO set. They are not portable.
            return {
                ...state,
                mintBalanceToTransferFrom: action.balance,
                meltQuote: undefined,
                feeOptions: [],
                selectedFee: undefined,
            }

        case 'QUOTE_START':
            return {...state, isLoading: true, info: ''}

        case 'QUOTE_READY':
            return {
                ...state,
                isLoading: false,
                meltQuote: action.meltQuote,
                feeOptions: action.feeOptions,
                selectedFee: action.selectedFee,
                availableMintBalances: action.availableMintBalances,
            }

        case 'QUOTE_INSUFFICIENT':
            return {
                ...state,
                isLoading: false,
                info: action.message,
                meltQuote: undefined,
                feeOptions: [],
                selectedFee: undefined,
            }

        case 'QUOTE_CLEAR':
            return {...state, meltQuote: undefined, feeOptions: [], selectedFee: undefined}

        case 'QUOTE_FINISHED':
            return {...state, isLoading: false}

        case 'SELECT_FEE':
            return {...state, selectedFee: action.option, isFeeModalVisible: false}

        case 'TOGGLE_FEE_MODAL':
            return {...state, isFeeModalVisible: !state.isFeeModalVisible}

        case 'TRANSFER_START':
            return {...state, isLoading: true}

        case 'TRANSFER_COMPLETE':
            return {
                ...state,
                isLoading: false,
                transaction: action.transaction,
                transactionStatus: action.transactionStatus,
                finalFee: action.finalFee,
                resultModalInfo: action.resultModalInfo,
                isResultModalVisible: true,
            }

        case 'TOGGLE_RESULT_MODAL':
            return {...state, isResultModalVisible: !state.isResultModalVisible}

        case 'SET_INFO':
            return {...state, info: action.message}

        case 'SET_ERROR':
            return {...state, isLoading: false, error: action.error}

        case 'RESET':
            return {...INITIAL_STATE}

        default:
            return state
    }
}

// ─── Component ───────────────────────────────────────────────────────────────

export const OnchainTransferScreen = observer(function OnchainTransferScreen({route}: Props) {
    const navigation = useNavigation()
    const amountInputRef = useRef<TextInput>(null)
    const unitRef = useRef<MintUnit>('sat')

    const {proofsStore, mintsStore, walletStore} = useStores()
    const isInternetReachable = useIsInternetReachable()

    const [state, dispatch] = useReducer(onchainTransferReducer, INITIAL_STATE)
    const [amountToTransfer, setAmountToTransfer] = useState<string>('0')
    const [memo, setMemo] = useState('')

    const {
        meltQuote,
        feeOptions,
        selectedFee,
        availableMintBalances,
        mintBalanceToTransferFrom,
        transaction,
        transactionStatus,
        resultModalInfo,
        finalFee,
        isLoading,
        isResultModalVisible,
        isFeeModalVisible,
        info,
        error,
    } = state

    const address = route.params.address

    useEffect(() => {
        try {
            const {unit, mintUrl, amountSat, memo: bip21Memo} = route.params
            if (!unit) {
                throw new AppError(Err.VALIDATION_ERROR, translate('missingMintUnitRouteParamsError'))
            }

            unitRef.current = unit

            // The BIP21 amount is the payee's suggestion, not a commitment: the user can
            // change it, and the mint prices the payment from what they confirm.
            if (amountSat && amountSat > 0) {
                setAmountToTransfer(
                    numbro(amountSat).format({thousandSeparated: true, mantissa: 0}),
                )
            }
            if (bip21Memo) setMemo(bip21Memo)

            const balance = mintUrl
                ? proofsStore.getMintBalance(mintUrl)
                : proofsStore.getMintBalancesWithUnit(unit)[0]

            if (balance) dispatch({type: 'SET_MINT_BALANCE', balance})

            if (!isInternetReachable) dispatch({type: 'SET_INFO', message: translate('commonOfflinePretty')})
        } catch (e: any) {
            handleError(e)
        }

        const timer = setTimeout(() => amountInputRef.current?.focus(), 100)
        return () => clearTimeout(timer)
    }, [])

    const handleError = (e: AppError) => dispatch({type: 'SET_ERROR', error: e})

    const selectedMint = mintBalanceToTransferFrom
        ? mintsStore.findByUrl(mintBalanceToTransferFrom.mintUrl)
        : undefined

    /**
     * The mint's advertised onchain melt limits, floored by our own.
     *
     * A mint's `min_amount` has been observed wrong two independent ways on the CDK test
     * mint, so it is taken as a lower bound on OUR floor, never as the floor itself.
     */
    // `AmountLike` in the cashu-ts types, but mint info is normalized straight off the
    // JSON (only undefined → null), so these are plain numbers. Same cast as TopupScreen.
    const meltSetting = selectedMint?.meltMethodSetting?.('onchain', unitRef.current)
    const minAmount = onchainMeltFloor(
        unitRef.current,
        meltSetting?.min_amount as number | null,
    )
    const maxAmount = meltSetting?.max_amount as number | null | undefined

    const onMintBalanceSelect = (balance: MintBalance) =>
        dispatch({type: 'SET_MINT_BALANCE', balance})

    /**
     * Ask the selected mint what it would cost to send this amount to this address.
     *
     * Deliberately explicit rather than fired on every keystroke: a melt quote reserves
     * nothing but it does cost a round-trip, and re-quoting mid-typing would flicker the
     * fee under the user's finger.
     */
    const requestQuote = useCallback(async () => {
        try {
            if (!mintBalanceToTransferFrom?.mintUrl) {
                dispatch({type: 'SET_INFO', message: translate('transferScreen_selectMintFrom')})
                return
            }

            const {precision, code: currencyCode} = getCurrency(unitRef.current)
            const amountUnit = round(toNumber(amountToTransfer) * precision, 0)

            if (!amountUnit || amountUnit <= 0) {
                dispatch({type: 'SET_INFO', message: translate('payCommon_amountZeroOrNegative')})
                return
            }

            if (amountUnit < minAmount) {
                dispatch({
                    type: 'SET_INFO',
                    message: translate('payCommon_minimumPay', {
                        amount: minAmount,
                        currency: currencyCode,
                    }),
                })
                return
            }

            if (maxAmount && amountUnit > maxAmount) {
                dispatch({
                    type: 'SET_INFO',
                    message: translate('payCommon_maximumPay', {
                        amount: maxAmount,
                        currency: currencyCode,
                    }),
                })
                return
            }

            dispatch({type: 'QUOTE_START'})

            const quote: MeltQuoteOnchainResponse = await walletStore.createOnchainMeltQuote(
                mintBalanceToTransferFrom.mintUrl,
                unitRef.current,
                address,
                amountUnit,
            )

            const options = normalizeFeeOptions(quote.fee_options ?? [])
            const defaultOption = selectDefaultFeeOption(options)

            if (!defaultOption) {
                // NUT-30 requires at least one tier. A quote without one cannot be executed
                // — there is no fee_index to send — so this is a broken quote, not a fee of
                // zero.
                throw new AppError(
                    Err.MINT_ERROR,
                    translate('onchainTransferScreen_noFeeOptions'),
                    {quote: quote.quote},
                )
            }

            // Balance must cover amount + the fee reserve of the tier we will actually
            // send. Picking the cheapest tier's reserve here would offer mints that cannot
            // afford the tier the user then selects.
            const totalRequired = quote.amount.toNumber() + defaultOption.feeReserve
            const availableBalances = proofsStore.getMintBalancesWithEnoughBalance(
                totalRequired,
                unitRef.current,
            )

            if (availableBalances.length === 0) {
                dispatch({
                    type: 'QUOTE_INSUFFICIENT',
                    message: translate('transferScreen_insufficientFunds', {
                        currency: currencyCode,
                        amount: totalRequired,
                    }),
                })
                return
            }

            dispatch({
                type: 'QUOTE_READY',
                meltQuote: quote,
                feeOptions: options,
                selectedFee: defaultOption,
                availableMintBalances: availableBalances,
            })
        } catch (e: any) {
            handleError(e)
        } finally {
            dispatch({type: 'QUOTE_FINISHED'})
        }
    }, [mintBalanceToTransferFrom?.mintUrl, amountToTransfer, address, minAmount, maxAmount])

    const transfer = async () => {
        try {
            if (!meltQuote || !selectedFee) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing quote to initiate the payment')
            }
            if (!mintBalanceToTransferFrom) {
                dispatch({type: 'SET_INFO', message: translate('transferScreen_selectMintFrom')})
                return
            }

            dispatch({type: 'TRANSFER_START'})

            const result: TransactionTaskResult = await WalletTask.transferOnchainQueueAwaitable(
                mintBalanceToTransferFrom,
                meltQuote.amount.toNumber(),
                unitRef.current,
                meltQuote,
                selectedFee.feeIndex,
                memo,
                new Date(meltQuote.expiry * 1000),
                address,
            )

            handleTransferTaskResult(result)
        } catch (e: any) {
            handleError(e)
        }
    }

    const handleTransferTaskResult = (result: TransactionTaskResult) => {
        const {transaction: tx, error: taskError, message} = result

        if (!tx && taskError) {
            dispatch({
                type: 'TRANSFER_COMPLETE',
                transactionStatus: TransactionStatus.ERROR,
                finalFee: 0,
                resultModalInfo: {
                    status: TransactionStatus.ERROR,
                    title: translate('payCommon_failed'),
                    message: taskError.message || 'Bitcoin payment failed',
                },
            })
            return
        }

        if (!tx) return

        const {status} = tx

        const resultInfo = taskError
            ? {
                  status,
                  title: taskError.params?.message ? taskError.message : translate('payCommon_failed'),
                  message: taskError.params?.message || taskError.message || 'Payment failed',
              }
            : {status, message}

        dispatch({
            type: 'TRANSFER_COMPLETE',
            transaction: tx,
            transactionStatus: status,
            finalFee: tx.fee ?? 0,
            resultModalInfo: resultInfo,
        })
    }

    const gotoWallet = () => {
        dispatch({type: 'RESET'})
        navigation.dispatch(StackActions.popToTop())
    }

    const toggleResultModal = () => dispatch({type: 'TOGGLE_RESULT_MODAL'})
    const toggleFeeModal = () => dispatch({type: 'TOGGLE_FEE_MODAL'})

    const headerBg = useThemeColor('header')
    const amountInputColor = useThemeColor('amountInput')
    const iconColor = useThemeColor('textDim')
    const hintText = useThemeColor('textDim')

    const currencyCode = getCurrency(unitRef.current).code
    const hasQuote = !!meltQuote && !!selectedFee
    const isSettled =
        transactionStatus === TransactionStatus.COMPLETED ||
        transactionStatus === TransactionStatus.PENDING

    // With one tier there is nothing to choose. Showing a picker that opens a list of one
    // asks the user to make a decision that does not exist. The CDK fakewallet returns
    // exactly one, so this is the common case, not the edge case.
    const isFeePickable = feeOptions.length > 1

    return (
        <Screen preset="fixed" contentContainerStyle={$screen}>
            <MintHeader mint={selectedMint} unit={unitRef.current} />
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>
                <View style={$amountContainer}>
                    <AmountInput
                        ref={amountInputRef}
                        value={amountToTransfer}
                        onChangeText={amount => {
                            setAmountToTransfer(amount)
                            // Any amount change invalidates the quote — it was priced for the
                            // old one, and paying against it would send the wrong amount.
                            if (meltQuote) dispatch({type: 'QUOTE_CLEAR'})
                        }}
                        selectTextOnFocus={true}
                        unit={unitRef.current}
                        editable={!hasQuote && !isSettled}
                        style={{color: amountInputColor}}
                    />
                </View>
                <Text
                    size="xs"
                    tx="payCommon_amountToPayLabel"
                    style={{
                        color: amountInputColor,
                        textAlign: 'center',
                        marginTop: spacing.extraSmall,
                    }}
                />
            </View>

            <View style={$contentContainer}>
                {/*
                  * Destination, and the payee's description of the payment when the BIP21 URI
                  * carried one.
                  *
                  * The memo is READ-ONLY, and there is no field for the user to write their
                  * own. A NUT-30 melt request carries {quote, fee_index, inputs, outputs}, and
                  * a Bitcoin transaction has nowhere to put a message either — so nothing they
                  * typed could reach anyone. What the payee sent, though, is real: it is their
                  * text, arriving with the request, and the wallet honours it exactly as it
                  * honours a bolt11 invoice's description — displayed here, saved on the
                  * transaction, visible in history.
                  */}
                {!isSettled && (
                    <Card
                        style={$card}
                        ContentComponent={
                            <>
                                <ListItem
                                    tx="onchainTransferScreen_toAddress"
                                    subText={address}
                                    subTextEllipsizeMode="middle"
                                    LeftComponent={
                                        <Icon
                                            containerStyle={$iconContainer}
                                            icon="faBitcoin"
                                            size={spacing.medium}
                                            color={iconColor}
                                        />
                                    }
                                    bottomSeparator={!!memo}
                                    style={$item}
                                />
                                {!!memo && (
                                    <ListItem
                                        tx="onchainTransferScreen_memoFromPayee"
                                        subText={memo}
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
                                )}
                            </>
                        }
                    />
                )}

                {!hasQuote && !isSettled && (
                    <>
                        <Text
                            size="xxs"
                            tx="onchainTransferScreen_feeHint"
                            style={{color: hintText, textAlign: 'center', marginTop: spacing.small}}
                        />
                        <View style={$bottomContainer}>
                            <View style={$buttonContainer}>
                                <Button
                                    tx="onchainTransferScreen_requestQuote"
                                    onPress={requestQuote}
                                />
                            </View>
                        </View>
                    </>
                )}

                {hasQuote && !isSettled && (
                    <Card
                        style={$card}
                        ContentComponent={
                            <ListItem
                                tx="onchainTransferScreen_networkFee"
                                subText={translate('onchainTransferScreen_feeTierSubtext', {
                                    blocks: selectedFee!.estimatedBlocks,
                                    amount: numbro(selectedFee!.feeReserve).format({
                                        thousandSeparated: true,
                                    }),
                                    currency: currencyCode,
                                })}
                                LeftComponent={
                                    <Icon
                                        containerStyle={$iconContainer}
                                        icon="faClock"
                                        size={spacing.medium}
                                        color={iconColor}
                                    />
                                }
                                RightComponent={
                                    isFeePickable ? (
                                        <Button
                                            preset="tertiary"
                                            tx="onchainTransferScreen_changeFee"
                                            textStyle={{fontSize: 12, color: iconColor}}
                                            onPress={toggleFeeModal}
                                        />
                                    ) : undefined
                                }
                                onPress={isFeePickable ? toggleFeeModal : undefined}
                                style={$item}
                            />
                        }
                    />
                )}

                {hasQuote && !isSettled && availableMintBalances.length > 0 && (
                    <MintBalanceSelector
                        mintBalances={availableMintBalances}
                        selectedMintBalance={mintBalanceToTransferFrom}
                        unit={unitRef.current}
                        title={translate('payCommon_payFrom')}
                        confirmTitle={translate('payCommon_payNow')}
                        // A mint that cannot melt onchain in this unit cannot pay a Bitcoin
                        // address. Shown disabled with the reason rather than hidden.
                        requiredCapability={mint => mint.supportsMelt!('onchain', unitRef.current)}
                        unsupportedReason={translate('mintSelector_noOnchainPayoutSupport')}
                        onMintBalanceSelect={onMintBalanceSelect}
                        onCancel={gotoWallet}
                        onMintBalanceConfirm={transfer}
                    />
                )}

                {transaction && isSettled && (
                    <Card
                        style={{padding: spacing.medium}}
                        ContentComponent={
                            <>
                                <TranItem
                                    label="tranDetailScreen_trasferredTo"
                                    isFirst={true}
                                    value={address}
                                />
                                {!!transaction.outpoint && (
                                    <TranItem
                                        label="tranDetailScreen_outpoint"
                                        value={transaction.outpoint}
                                    />
                                )}
                                <TranItem
                                    label="transactionCommon_feePaid"
                                    value={finalFee || 0}
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

                {isSettled && (
                    <View style={$bottomContainer}>
                        <View style={$buttonContainer}>
                            <Button preset="secondary" tx="commonClose" onPress={gotoWallet} />
                        </View>
                    </View>
                )}
            </View>

            {/* Fee tier picker */}
            <BottomModal
                isVisible={isFeeModalVisible}
                headingTx="onchainTransferScreen_selectFee"
                ContentComponent={
                    <View style={{alignSelf: 'stretch'}}>
                        {feeOptions.map((option, index) => (
                            <ListItem
                                key={option.feeIndex}
                                text={translate('onchainTransferScreen_feeTierBlocks', {
                                    blocks: option.estimatedBlocks,
                                })}
                                subText={translate('onchainTransferScreen_feeTierReserve', {
                                    amount: numbro(option.feeReserve).format({
                                        thousandSeparated: true,
                                    }),
                                    currency: currencyCode,
                                })}
                                leftIcon={
                                    option.feeIndex === selectedFee?.feeIndex
                                        ? 'faCheckCircle'
                                        : 'faCircle'
                                }
                                leftIconColor={
                                    option.feeIndex === selectedFee?.feeIndex
                                        ? colors.palette.success200
                                        : (iconColor as string)
                                }
                                onPress={() => dispatch({type: 'SELECT_FEE', option})}
                                bottomSeparator={index < feeOptions.length - 1}
                            />
                        ))}
                    </View>
                }
                onBackButtonPress={toggleFeeModal}
                onBackdropPress={toggleFeeModal}
            />

            {/* Result */}
            <BottomModal
                isVisible={isResultModalVisible}
                ContentComponent={
                    <>
                        {resultModalInfo && transactionStatus === TransactionStatus.PENDING && (
                            <>
                                {/*
                                  * PENDING is the SUCCESS state here, not a warning. NUT-30 requires
                                  * the mint to answer PENDING and broadcast in the background, so
                                  * every onchain payment lands here — the money has left, and the
                                  * only thing outstanding is confirmation, which takes blocks. The
                                  * user should not be made to wait on this modal, and nothing about
                                  * it should read as though something went wrong.
                                  */}
                                <ResultModalInfo
                                    icon="faPaperPlane"
                                    iconColor={colors.palette.success200}
                                    title={translate('onchainTransferScreen_broadcastTitle')}
                                    message={resultModalInfo.message}
                                />
                                <View style={$buttonContainer}>
                                    <Button preset="secondary" tx="commonClose" onPress={gotoWallet} />
                                </View>
                            </>
                        )}

                        {resultModalInfo && transactionStatus === TransactionStatus.COMPLETED && (
                            <>
                                <ResultModalInfo
                                    icon="faCheckCircle"
                                    iconColor={colors.palette.success200}
                                    title={translate('payCommon_completed')}
                                    message={resultModalInfo.message}
                                />
                                <View style={$buttonContainer}>
                                    <Button preset="secondary" tx="commonClose" onPress={gotoWallet} />
                                </View>
                            </>
                        )}

                        {resultModalInfo && transactionStatus === TransactionStatus.ERROR && (
                            <>
                                <ResultModalInfo
                                    icon="faTriangleExclamation"
                                    iconColor={colors.palette.angry500}
                                    title={resultModalInfo.title || translate('payCommon_failed')}
                                    message={resultModalInfo.message}
                                />
                                <View style={$buttonContainer}>
                                    <Button
                                        preset="secondary"
                                        tx="commonClose"
                                        onPress={toggleResultModal}
                                    />
                                </View>
                            </>
                        )}

                        {resultModalInfo && transactionStatus === TransactionStatus.REVERTED && (
                            <>
                                <ResultModalInfo
                                    icon="faRotate"
                                    iconColor={colors.palette.accent300}
                                    title={translate('transactionCommon_reverted')}
                                    message={resultModalInfo.message}
                                />
                                <View style={$buttonContainer}>
                                    <Button
                                        preset="secondary"
                                        tx="commonClose"
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

            {isLoading && <Loading />}
            {error && <ErrorModal error={error} />}
            {info && <InfoModal message={info} />}
        </Screen>
    )
})

const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.extraSmall,
    paddingTop: 0,
    height: spacing.screenHeight * 0.2,
}

const $amountContainer: ViewStyle = {
    marginTop: -spacing.tiny,
}

const $contentContainer: TextStyle = {
    flex: 1,
    padding: spacing.extraSmall,
    marginTop: -spacing.extraLarge * 1.5,
}

const $card: ViewStyle = {
    marginBottom: spacing.small,
}

const $iconContainer: ViewStyle = {
    padding: spacing.extraSmall,
    alignSelf: 'center',
    marginRight: spacing.medium,
}

const $item: ViewStyle = {
    paddingHorizontal: spacing.small,
    paddingLeft: 0,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
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
}
