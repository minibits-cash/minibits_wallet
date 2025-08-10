import React, { forwardRef, useState } from 'react'
import { TextInput, TextStyle } from 'react-native'
import { spacing, useThemeColor, typography } from '../theme'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { MintUnit, getCurrency } from '../services/wallet/currency'
import numbro from 'numbro'

interface AmountInputProps {
  value: string
  onChangeText: (text: string) => void
  unit?: MintUnit
  /** 
   * Override default formatting options (thousandSeparated, mantissa, etc.) for onEndEditing formatting.
   * Useful for fiat currencies that need custom decimal precision or thousand separator behavior. 
   */
  formatOptions?: Partial<numbro.Format>
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
      formatOptions,
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
        if (onEndEditing) onEndEditing();
        if (!value) value = "0";

        // Merge default format options with overrides
        const formatOptionsMerged = Object.assign(
            { thousandSeparated: true, mantissa: getCurrency(unit).mantissa }, 
            formatOptions
        );
        const formattedValue = numbro(value).format(formatOptionsMerged);
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