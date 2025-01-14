import * as React from 'react'
import { StyleSheet, View, ActivityIndicator, ViewProps, TextStyle, ColorValue, ViewStyle, StatusBar } from 'react-native'
import { useThemeColor, colors } from '../theme'
import { Text } from './Text'
import { spacing } from '../theme'

export function Loading(props: ViewProps & { statusMessage?: string, textStyle?: TextStyle, shiftedUp?: boolean }) {
  const statusBarOnModalOpen = useThemeColor('statusBarOnLoading')
  const loadingIndicator = useThemeColor('loadingIndicator')
  return (
    <View style={[StyleSheet.absoluteFillObject, $loading(props?.shiftedUp ?? false), props.style]}>
      <StatusBar backgroundColor={props.style &&  props.style.backgroundColor ? props.style.backgroundColor  : statusBarOnModalOpen } />
      <ActivityIndicator color={loadingIndicator} animating size="large" />
      {props.statusMessage && (<Text style={[{opacity: 1}, props.textStyle]} text={props.statusMessage}/>)}
    </View>
  )
}

const $loading = (shiftedUp = false) => ({
  flex: 1,
  width: '100%',
  height: '100%',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: colors.dark.background,
  opacity: 0.25,
  zIndex: 9999,
  // for cards that go up in the header, the loading should cover them
  marginTop: shiftedUp ? -(spacing.extraLarge * 2 + spacing.small) : 0,
} satisfies ViewStyle)