import React from 'react'
import { View, ViewStyle, TextStyle, Pressable } from 'react-native'
import { verticalScale, moderateScale } from '@gocodingnow/rn-size-matters'
import { spacing, useThemeColor, typography } from '../theme'
import { Text } from './Text'
import { Icon } from './Icon'

export interface NumericKeypadProps {
  onKeyPress: (key: string) => void
  onClear?: () => void
  onLongPressBackspace?: () => void
  disabled?: boolean
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'backspace'],
]

export function NumericKeypad({ onKeyPress, onClear, onLongPressBackspace, disabled = false }: NumericKeypadProps) {
  const keyBg = useThemeColor('card')
  const keyBgPressed = useThemeColor('buttonSecondary')
  const textColor = useThemeColor('text')
  const textDimColor = useThemeColor('textDim')

  const renderKey = (key: string) => {
    const isBackspace = key === 'backspace'
    const isClear = key === 'clear'

    return (
      <Pressable
        key={key}
        onPress={() => {
          if (disabled) return
          if (isClear && onClear) {
            onClear()
          } else {
            onKeyPress(key)
          }
        }}
        onLongPress={isBackspace && onLongPressBackspace ? onLongPressBackspace : undefined}
        delayLongPress={500}
        disabled={disabled}
        style={({ pressed }) => [
          $key,
          { backgroundColor: pressed ? keyBgPressed : keyBg },
          disabled && $keyDisabled,
        ]}
      >
        {isBackspace ? (
          <Icon
            icon="faChevronLeft"
            size={moderateScale(24)}
            color={disabled ? textDimColor : textColor}
          />
        ) : isClear ? (
          <Icon
            icon="faXmark"
            size={moderateScale(24)}
            color={disabled ? textDimColor : textColor}
          />
        ) : (
          <Text
            style={[
              $keyText,
              { color: disabled ? textDimColor : textColor },
            ]}
            preset='heading'
          >
            {key}
          </Text>
        )}
      </Pressable>
    )
  }

  return (
    <View style={$container}>
      {KEYS.map((row, rowIndex) => (
        <View key={rowIndex} style={$row}>
          {row.map(renderKey)}
        </View>
      ))}
    </View>
  )
}

const $container: ViewStyle = {
  width: '100%',
  paddingHorizontal: spacing.medium,
}

const $row: ViewStyle = {
  flexDirection: 'row',
  justifyContent: 'center',
  marginVertical: spacing.small,
}

const $key: ViewStyle = {
  width: moderateScale(80),
  height: verticalScale(56),
  borderRadius: spacing.small,
  justifyContent: 'center',
  alignItems: 'center',
  marginHorizontal: spacing.small,
}

const $keyDisabled: ViewStyle = {
  opacity: 0.5,
}

const $keyText: TextStyle = {
  //fontFamily: typography.primary.medium,
  //fontSize: moderateScale(28),
  
}
