import { verticalScale } from '@gocodingnow/rn-size-matters'
import React, { useState } from 'react'
import { TextInput, TextStyle, TouchableOpacity, View, ViewStyle } from 'react-native'
import { useStores } from '../models'
import type { Mint } from '../models/Mint'
import { TransactionStatus } from '../models/Transaction'
import { MintHeader } from '../screens/Mints/MintHeader'
import { CurrencyAmount } from '../screens/Wallet/CurrencyAmount'
import { convertToFromSats, CurrencyCode, getCurrency, getCurrencyByCode, MintUnit } from '../services/wallet/currency'
import { spacing, useThemeColor } from '../theme'
import { round, toNumber } from '../utils/number'
import { AmountInput, Icon, Text } from './index'
import { log } from '../services'

interface IAmountInputHeaderProps {
    amountInputRef: React.RefObject<TextInput>
    amountToSend: string
    setAmountToSend: (amount: string) => void
    unit: MintUnit
    onAmountEndEditing?: () => void
    transactionStatus?: TransactionStatus
    isCashuPrWithAmount?: boolean
    lockedPubkey?: string
    unitRef: React.RefObject<MintUnit>
    mintHeaderMint: Mint
}

const $amountContainer: ViewStyle = {
    alignItems: 'center',
    justifyContent: 'center',
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.extraSmall,
    paddingTop: 0,
    height: spacing.screenHeight * 0.30,
}

const $pubKey: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -spacing.extraSmall
}

export function AmountInputHeader(props: IAmountInputHeaderProps) {
    const { userSettingsStore, walletStore } = useStores()
    const [isFiatMode, setIsFiatMode] = useState(false)
    const [amountFiat, setAmountFiat] = useState("0");
    const [currencyAmount, setCurrencyAmount] = useState(0);

    const amountInputColor = useThemeColor('amountInput');
    const convertedAmountColor = useThemeColor('headerSubTitle');
    const headerBg = useThemeColor('header')

    const {
        amountInputRef,
        amountToSend,
        setAmountToSend,
        unit,
        onAmountEndEditing,
        transactionStatus,
        isCashuPrWithAmount,
        lockedPubkey,
        unitRef,
        mintHeaderMint
    } = props

    const fiatCurrency = userSettingsStore.exchangeCurrency
    const isFiatSupported = fiatCurrency === CurrencyCode.USD || fiatCurrency === CurrencyCode.EUR
    const canUseFiatMode = isFiatSupported && walletStore.exchangeRate && unit === 'sat'

    const getFiatUnit = () => {
        const currencyData = getCurrencyByCode(fiatCurrency)
        return currencyData?.mintUnit || 'sat'
    }

    // Convert FIAT amount to display units (e.g., sats to mBTC)
    const FIATtoSATS = (inputAmount: string) => {
        log.trace("fiat to sats: ", inputAmount)
        // this function returns undefined even though i'm getting in 0.47 nicely
        if (!walletStore.exchangeRate || !inputAmount || inputAmount.trim() === '') return undefined;

        const precision = getCurrency(unitRef.current).precision
        return convertToFromSats(
            round(toNumber(inputAmount) * precision, 0) || 0,
            getCurrency(unitRef.current).code,
            walletStore.exchangeRate
        )
    }

    // Convert display units to FIAT amount
    const SATStoFIAT = (inputAmount: string) => {
        if (!walletStore.exchangeRate || !inputAmount || inputAmount.trim() === '') return undefined;

        const precision = getCurrency(unitRef.current).precision
        return convertToFromSats(
            round(toNumber(inputAmount) * precision, 0) || 0,
            getCurrency(unitRef.current).code,
            walletStore.exchangeRate
        )
    }

    const isConvertedAmountVisible = () => {
        return canUseFiatMode && walletStore.exchangeRate
    }

    const handleAmountChange = (amount: string) => {
        setAmountToSend(amount)
        if (canUseFiatMode) {
            const convertedAmount = SATStoFIAT(amount)
            setCurrencyAmount(convertedAmount || 0)
        }
    }
    
    const handleFiatAmountChange = (amount: string) => {
        log.trace("fiat amount: ", amount)
        setAmountFiat(amount)
        setCurrencyAmount(FIATtoSATS(amount) || 0)
    }
    
    const onFiatAmountEndEditing = () => {
        const convertedAmount = FIATtoSATS(amountFiat)
        setCurrencyAmount(convertedAmount || 0)
        setAmountToSend((convertedAmount || 0).toString())

        // if (onAmountEndEditing) {
        //     onAmountEndEditing()
        // }
    }
    
    const handleAmountEndEditing = () => {
        if (canUseFiatMode) {
            const convertedAmount = SATStoFIAT(amountToSend)
            setCurrencyAmount(convertedAmount || 0)
        }
        if (onAmountEndEditing) {
            onAmountEndEditing()
        }
    }

    return <View style={[$headerContainer, { backgroundColor: headerBg }]}>
        <MintHeader
            mint={mintHeaderMint}
            unit={isFiatMode && canUseFiatMode ? getFiatUnit() : unitRef.current}
        />
        <View style={$amountContainer}>
            {isFiatMode && canUseFiatMode ? (
                <AmountInput
                    value={amountFiat}
                    onChangeText={handleFiatAmountChange}
                    unit={getFiatUnit()}
                    onEndEditing={transactionStatus !== TransactionStatus.PENDING ? onFiatAmountEndEditing : undefined}
                    editable={!(transactionStatus === TransactionStatus.PENDING || isCashuPrWithAmount)}
                    style={{ color: amountInputColor }}
                />
            ) : (
                <AmountInput
                    value={amountToSend}
                    onChangeText={handleAmountChange}
                    unit={unit}
                    onEndEditing={transactionStatus !== TransactionStatus.PENDING ? handleAmountEndEditing : undefined}
                    editable={!(transactionStatus === TransactionStatus.PENDING || isCashuPrWithAmount)}
                    style={{ color: amountInputColor }}
                    ref={amountInputRef}
                />
            )}
            {isConvertedAmountVisible() && (
                <TouchableOpacity onPress={() => {
                    if (!canUseFiatMode) return;
                    setIsFiatMode(!isFiatMode);
                    if (isFiatMode) {
                        setAmountFiat(SATStoFIAT(amountToSend).toString() || "0");
                        setCurrencyAmount(toNumber(amountToSend.trim() || "0"));
                    } else {
                        setAmountToSend(FIATtoSATS(amountFiat).toString() || "0");
                        setCurrencyAmount(toNumber(amountFiat.trim() || "0"));
                    }
                }}>
                    <CurrencyAmount
                        amount={currencyAmount}
                        currencyCode={isFiatMode ? CurrencyCode.SAT : fiatCurrency}
                        symbolStyle={{ color: convertedAmountColor, marginTop: spacing.tiny, fontSize: verticalScale(10) }}
                        amountStyle={{ color: convertedAmountColor, lineHeight: spacing.medium }}
                        size='medium'
                        containerStyle={{ justifyContent: 'center' }}
                    />
                </TouchableOpacity>
            )}
            {lockedPubkey ? (
                <View style={$pubKey}>
                    <Icon
                        icon="faLock"
                        size={spacing.small}
                        color={amountInputColor}
                    />
                    <Text
                        size='xs'
                        tx="sendLocked"
                        style={{ color: amountInputColor, marginLeft: spacing.tiny }}
                    />

                </View>
            ) : (
                <Text
                    size='xs'
                    tx='amountSend'
                    style={{
                        color: amountInputColor,
                        textAlign: 'center',
                        marginTop: isConvertedAmountVisible() ? -spacing.extraSmall : undefined
                    }}
                />
            )}
        </View>
    </View>
}