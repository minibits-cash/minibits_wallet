import React from 'react'
import { View, ViewStyle, TextInput } from 'react-native'
import { AmountInput } from "./AmountInput"
import { CurrencyAmount } from '../screens/Wallet/CurrencyAmount'
import { Text, Icon } from './'
import { spacing, useThemeColor } from '../theme'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { TransactionStatus } from '../models/Transaction'
import { MintUnit, CurrencyCode, getCurrency, convertToFromSats } from '../services/wallet/currency'
import { useStores } from '../models'
import { round, toNumber } from '../utils/number'

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
}

const $amountContainer: ViewStyle = {
  alignItems: 'center',
  justifyContent: 'center',
}

export function AmountInputHeader(props: IAmountInputHeaderProps) {
  const { userSettingsStore, walletStore } = useStores()

  const amountInputColor = useThemeColor('amountInput');
  const convertedAmountColor = useThemeColor('headerSubTitle');

  const {
    amountInputRef,
    amountToSend,
    setAmountToSend,
    unit,
    onAmountEndEditing,
    transactionStatus,
    isCashuPrWithAmount,
    lockedPubkey,
    unitRef
  } = props

  const isConvertedAmountVisible = () => {
    return (
      walletStore.exchangeRate &&
      (userSettingsStore.exchangeCurrency === getCurrency(unit).code ||
        unit === 'sat') &&
      getConvertedAmount() !== undefined
    )
  }

  const getConvertedAmount = () => {
    if (!walletStore.exchangeRate) return undefined;

    const precision = getCurrency(unitRef.current).precision
    return convertToFromSats(
      round(toNumber(amountToSend) * precision, 0) || 0,
      getCurrency(unitRef.current).code,
      walletStore.exchangeRate
    )
  }

  return <View style={$amountContainer}>
    <AmountInput
      ref={amountInputRef}
      value={amountToSend}
      onChangeText={amount => setAmountToSend(amount)}
      unit={unit}
      onEndEditing={transactionStatus !== TransactionStatus.PENDING ? onAmountEndEditing : undefined}
      editable={!(transactionStatus === TransactionStatus.PENDING || isCashuPrWithAmount)}
      style={{ color: amountInputColor }}
    />
    {isConvertedAmountVisible() && (
      <CurrencyAmount
        amount={getConvertedAmount() ?? 0}
        currencyCode={unit === 'sat' ? userSettingsStore.exchangeCurrency : CurrencyCode.SAT}
        symbolStyle={{ color: convertedAmountColor, marginTop: spacing.tiny, fontSize: verticalScale(10) }}
        amountStyle={{ color: convertedAmountColor, lineHeight: spacing.medium }}
        size='medium'
        containerStyle={{ justifyContent: 'center' }}
      />
    )}
    {lockedPubkey ? (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: isConvertedAmountVisible() ? -spacing.extraSmall : undefined
        }}
      >
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
}