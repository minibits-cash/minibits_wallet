import React, {forwardRef} from 'react'
import {View, ViewStyle, TextInput, TextStyle} from 'react-native'
import {spacing, useThemeColor} from '../theme'
import {Button} from './Button'
import {Card} from './Card'
import {translate} from '../i18n'
import { verticalScale } from '@gocodingnow/rn-size-matters'

interface MemoInputProps {
  memo: string
  setMemo: (memo: string) => void
  disabled?: boolean
  onMemoDone: () => void
  onMemoEndEditing?: () => void
  maxLength?: number
}

export const MemoInputCard = forwardRef<TextInput, MemoInputProps>((props, memoInputRef) => {
  const {
    memo,
    setMemo,
    disabled = true,
    onMemoDone,
    onMemoEndEditing = () => {},
    maxLength = 200,
  } = props

  const placeholderTextColor = useThemeColor('textDim')
  const inputText = useThemeColor('text')  
  
  return (
    <Card
      style={$memoCard}
      ContentComponent={
        <View style={$memoContainer}>
          <TextInput
            ref={memoInputRef}
            onChangeText={memo => setMemo(memo)}
            onEndEditing={onMemoEndEditing}
            value={`${memo}`}
            style={[$memoInput, {color: inputText}]}
            maxLength={maxLength}
            keyboardType="default"
            selectTextOnFocus={true}
            placeholder={translate('sendScreen_memo')}
            placeholderTextColor={placeholderTextColor}
            editable={!disabled}
          />
          <Button
            preset="secondary"
            style={$memoButton}
            text="Done"
            onPress={onMemoDone}
            disabled={disabled}
          />
        </View>
      }
    />
  )
})

const $memoContainer: ViewStyle = {
  flex: 1,
  flexDirection: 'row',
  justifyContent: 'center',
  alignItems: 'center',
}

const $memoCard: ViewStyle = {
  marginBottom: spacing.small,
  minHeight: verticalScale(80),
}

const $memoButton: ViewStyle = {
  maxHeight: verticalScale(50),
}

const $memoInput: TextStyle = {
  flex: 1,
  borderRadius: spacing.small,
  fontSize: verticalScale(16),
  textAlignVertical: 'center',
  marginRight: spacing.small,
}
