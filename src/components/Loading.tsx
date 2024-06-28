import * as React from 'react'
import { StyleSheet, View, ActivityIndicator, ViewProps, TextStyle, ColorValue, ViewStyle } from 'react-native'
import { useThemeColor } from '../theme'
import { Text } from './Text'
import { spacing } from '../theme'

export function Loading(props: ViewProps & { statusMessage?: string, textStyle?: TextStyle, shiftedUp?: boolean }) {
  return (
    <View style={[StyleSheet.absoluteFillObject, $loading(useThemeColor('background'), props?.shiftedUp ?? false), props.style]}>
      <ActivityIndicator color="#ccc" animating size="large" />
      {props.statusMessage && (<Text style={[{opacity: 1}, props.textStyle]} text={props.statusMessage}/>)}
    </View>
  )
}

const $loading = (bg: ColorValue, shiftedUp = false) => ({
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: bg,
  opacity: 0.5,
  zIndex: 9999,
  // for cards that go up in the header, the loading should cover them
  marginTop: shiftedUp ? -(spacing.extraLarge * 2 + spacing.small) : 0,
} satisfies ViewStyle)