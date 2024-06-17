import React, {forwardRef} from 'react'
import {View, ViewStyle, TextInput, TextStyle} from 'react-native'
import {spacing} from '../theme'
import {Button} from './Button'
import {Card} from './Card'
import {translate} from '../i18n'

interface MemoInputProps {
  memo: string
  setMemo: (memo: string) => void
  disabled?: boolean
  onMemoDone: () => void
  onMemoEndEditing: () => void
}

export const MemoInputCard = forwardRef<TextInput, MemoInputProps>((props, memoInputRef) => {
  const {memo, setMemo, disabled = true, onMemoDone, onMemoEndEditing} = props
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
            style={$memoInput}
            maxLength={200}
            keyboardType="default"
            selectTextOnFocus={true}
            placeholder={translate('sendScreen.memo')}
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
}

const $memoButton: ViewStyle = {
  maxHeight: 50,
}

const $memoInput: TextStyle = {
  flex: 1,
  borderRadius: spacing.small,
  fontSize: 16,
  textAlignVertical: 'center',
  marginRight: spacing.small,
}
