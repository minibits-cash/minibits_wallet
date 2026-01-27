import React from 'react'
import { TextStyle, View, ViewStyle } from 'react-native'
import Animated, {
  SharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated'
import { spacing, typography, useThemeColor } from '../theme'
import { translate, TxKeyPath } from '../i18n'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { Text } from './Text'

export interface StaticHeaderProps {
  /**
   * Title text to display.
   */
  title?: string
  /**
   * Title text which is looked up via i18n.
   */
  titleTx?: TxKeyPath

  height?: number
  
}


export function StaticHeader(props: StaticHeaderProps) {
  const {
    title,
    titleTx,
    height = spacing.screenHeight * 0.15,
  } = props

  const headerBg = useThemeColor('header')
  const headerTitleColor = useThemeColor('headerTitle')


  const titleContent = titleTx ? translate(titleTx) : title

  return (
    <View style={[$headerContainer, { height, backgroundColor: headerBg }]}>
      <Text style={[$headerTitle, { color: headerTitleColor }]}>
        {titleContent}
      </Text>
    </View>
  )
}

const $headerContainer: ViewStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
}

const $headerTitle: TextStyle = {
  fontSize: verticalScale(32), 
  lineHeight: verticalScale(44),
  fontFamily: typography.primary?.medium,
}
