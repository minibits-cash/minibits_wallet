import React, { forwardRef, useState } from 'react'
import { TextInput, TextStyle } from 'react-native'
import { spacing, useThemeColor, typography } from '../theme'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { MintUnit, getCurrency } from '../services/wallet/currency'
import numbro from 'numbro'
import { log } from '../services'

interface AmountInputProps {
  value: string
  onChangeText: (text: string) => void
  unit?: MintUnit
  onEndEditing?: () => void
  editable?: boolean
  selectTextOnFocus?: boolean
  onFocus?: () => void
  onBlur?: () => void
  style?: TextStyle
}

export const AmountInput = forwardRef<TextInput, AmountInputProps>(
  (
    {
      value,
      onChangeText,
      unit = 'sat',
      onEndEditing,
      editable = true,
      selectTextOnFocus,
      onFocus,
      onBlur,
      style,
      ...rest
    },
    ref
  ) => {
    const [hasAmountFocusedOnce, setHasAmountFocusedOnce] = useState(false)
    const amountInputColor = useThemeColor('amountInput')

    const handleFocus = () => {
      setHasAmountFocusedOnce(true)
      onFocus?.()
    }

    const handleBlur = () => {
      setHasAmountFocusedOnce(false)
      onBlur?.()
    }

    const handleEndEditing = () => {
      if (onEndEditing) {
        onEndEditing()
      } 
      // Default formatting behavior
      if (!value) value = "0";
      const formattedValue = numbro(value).format({
        thousandSeparated: true,
        mantissa: getCurrency(unit).mantissa
      })
      onChangeText(formattedValue)
    }

    const defaultStyle: TextStyle = {
      borderRadius: spacing.small,
      margin: 0,
      padding: 0,
      fontSize: verticalScale(48),
      fontFamily: typography.primary?.medium,
      textAlign: 'center',
      color: amountInputColor,
    }

    return (
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onEndEditing={handleEndEditing}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={[defaultStyle, style]}
        maxLength={9}
        keyboardType="numeric"
        returnKeyType="done"
        selectTextOnFocus={selectTextOnFocus !== undefined ? selectTextOnFocus : !hasAmountFocusedOnce}
        editable={editable}
        {...rest}
      />
    )
  }
)

AmountInput.displayName = 'AmountInput'