import { verticalScale } from '@gocodingnow/rn-size-matters'
import React, { useEffect, useState } from 'react'
import { TextInput, TextStyle, TouchableOpacity, View, ViewStyle } from 'react-native'
import { useStores } from '../models'
import type { Mint } from '../models/Mint'
import { TransactionStatus } from '../models/Transaction'
import { availableExchangeCurrencies } from '../screens'
import { MintHeader } from '../screens/Mints/MintHeader'
import { CurrencyAmount } from '../screens/Wallet/CurrencyAmount'
import { convertToFromSats, CurrencyCode, formatCurrency, getCurrency, getCurrencyByCode, MintUnit } from '../services/wallet/currency'
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
    height: spacing.screenHeight * 0.31,
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
    const [shouldTriggerSubmit, setShouldTriggerSubmit] = useState(false);
    const [amountFiat, setAmountFiat] = useState("0");
    const [currencyAmount, setCurrencyAmount] = useState(0);

    const amountInputColor = useThemeColor('amountInput');
    const convertedAmountColor = useThemeColor('headerSubTitle');
    const headerBg = useThemeColor('header')
    const buttonIconColor = useThemeColor('buttonIcon');

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
    const isFiatSupported = availableExchangeCurrencies.includes(fiatCurrency as typeof availableExchangeCurrencies[number]);
    const canUseFiatMode = isFiatSupported && walletStore.exchangeRate && unit === 'sat'

    const getFiatUnit = () => {
        const currencyData = getCurrencyByCode(fiatCurrency)
        return currencyData?.mintUnit || 'sat'
    }

    const roundToSatPrecision = (value: number) => round(value, getCurrency(unitRef.current).mantissa)
    const roundToFiatPrecision = (value: number) => round(value, getCurrencyByCode(fiatCurrency)?.mantissa || 2)

    const FIATtoSATS = (inputAmount: string) => {
        if (!walletStore.exchangeRate || !inputAmount || inputAmount.trim() === '') return null;

        const fiatCurrencyData = getCurrencyByCode(fiatCurrency)
        if (!fiatCurrencyData) return null;
        
        const precision = fiatCurrencyData.precision
        const converted = convertToFromSats(
            round(toNumber(inputAmount) * precision, 0) || 0,
            fiatCurrency,
            walletStore.exchangeRate
        )
        log.trace("FIATtoSATS", { 
            converted, precision, 
            rounded: converted && roundToFiatPrecision(converted), 
            amountFiat, amountToSend,
            fiatUnit: getFiatUnit() 
        });
        return converted ? roundToSatPrecision(converted) : null;
    }

    const SATStoFIAT = (inputAmount: string) => {
        if (!walletStore.exchangeRate || !inputAmount || inputAmount.trim() === '') return null;

        const precision = getCurrency(unitRef.current).precision
        const converted = convertToFromSats(
            round(toNumber(inputAmount) * precision, 0) || 0,
            getCurrency(unitRef.current).code,
            walletStore.exchangeRate
        )
        // log.trace("SATStoFIAT", { converted, precision, rounded: converted && roundToFiatPrecision(converted), amountFiat, amountToSend });
        return converted ? roundToFiatPrecision(converted) : null;
    }

    const isConvertedAmountVisible = () => {
        return canUseFiatMode && walletStore.exchangeRate
    }

    useEffect(() => {
        // log.trace({ "current": unitRef.current, fiatCurrency, canUseFiatMode })
        if (!canUseFiatMode) return;
        
        // the conversions between the two *looks* asymetric, but it works:
        // the reason it's like this is because <CurrencyAmount /> formats each currency differently,
        // so setting currencyAmount to 9.97 often produces stuff like 0.1 EUR

        // there is possibly a better way to solve this:
        // if CurrencyAmount would just display raw values, we could just call FIATtoSATS and SATStoFIAT respectively
        // feel free to refactor/change this; i spent way too long trying to get it to work

        if (isFiatMode) { 
            // SATS -> FIAT mode
            // for 1067 sats, even though currencyAmount is 106.26, after formatting it's the desired 1.06
            // we can simply do the same formatting as <CurrencyAmount /> to get 1.06 for our input
            // since <CurrencyAmount /> formats SATS normally, we can pass in the raw value (e.g. 1067)
            const newVal = formatCurrency(currencyAmount, fiatCurrency, false);
            setAmountFiat(newVal);
            setCurrencyAmount(toNumber(amountToSend.trim() || "0"));
        } else {
            // FIAT -> SATS mode
            // we convert our FIAT "result" (e.g. 1.06) using FIATtoSATS
            // since editing the SATS input always correctly calculates the FIAT currency on editd, we simply call handleAmountChange
            const newVal = (FIATtoSATS(amountFiat) || 0).toString();
            setAmountToSend(newVal);
            handleAmountChange(newVal)
            if (shouldTriggerSubmit && onAmountEndEditing) onAmountEndEditing();
        }

    }, [isFiatMode])

    const handleAmountChange = (amount: string) => {
        setShouldTriggerSubmit(false);
        setAmountToSend(amount)
        if (canUseFiatMode) {
            const convertedAmount = SATStoFIAT(amount)
            setCurrencyAmount(convertedAmount || 0)
        }
    }
    
    const handleFiatAmountChange = (amount: string) => {
        setAmountFiat(amount)
        setCurrencyAmount(FIATtoSATS(amount) || 0)
    }
    
    const onFiatAmountEndEditing = () => {
        const convertedAmount = FIATtoSATS(amountFiat)
        setCurrencyAmount(convertedAmount || 0)
        setAmountToSend((convertedAmount || 0).toString())

        if (amountFiat.trim()) {
            setShouldTriggerSubmit(true);
            setIsFiatMode(false);
        }
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
            unit={canUseFiatMode && isFiatMode ? getFiatUnit() : unitRef.current}
            displayCurrency={canUseFiatMode && isFiatMode ? fiatCurrency : undefined}
        />
        <View style={$amountContainer}>
            {isFiatMode && canUseFiatMode ? (
                <AmountInput
                    value={amountFiat}
                    onChangeText={handleFiatAmountChange}
                    unit={getFiatUnit()}
                    formatOptions={{ // Override formatting for fiat: no thousand separators, use fiat currency's decimal precision
                        thousandSeparated: false, 
                        mantissa: getCurrencyByCode(fiatCurrency)?.mantissa || 2 
                    }}
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
                <TouchableOpacity 
                    onPress={() => {
                        if (!canUseFiatMode) return;
                        setIsFiatMode(!isFiatMode);
                    }}
                    style={{ position: 'relative', flexDirection: 'row', alignItems: "center" }}
                >
                    <CurrencyAmount
                        amount={currencyAmount}
                        currencyCode={isFiatMode ? CurrencyCode.SAT : fiatCurrency}
                        symbolStyle={{ color: convertedAmountColor, marginTop: spacing.tiny, fontSize: verticalScale(10) }}
                        amountStyle={{ color: convertedAmountColor, lineHeight: spacing.medium }}
                        size='medium'
                        containerStyle={{ justifyContent: 'center', paddingRight: 0 }}
                    />
                    <Icon
                        icon="faArrowRightArrowLeft"
                        size={16}
                        color={buttonIconColor}
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