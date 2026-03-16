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

export interface AnimatedHeaderProps {
  /**
   * Title text to display.
   */
  title?: string
  /**
   * Title text which is looked up via i18n.
   */
  titleTx?: TxKeyPath
  /**
   * Shared value for scroll position tracking.
   */
  scrollY: SharedValue<number>
  /**
   * Header height. Title fades out over the first half of this distance.
   * Defaults to spacing.screenHeight * 0.15
   */
  maxHeight?: number
}

/**
 * AnimatedHeader component with a large title that fades as the user scrolls.
 * Place this as the first child inside an Animated.ScrollView so that it scrolls
 * away naturally — no height animation means no layout jitter.
 */
export function AnimatedHeader(props: AnimatedHeaderProps) {
  const {
    title,
    titleTx,
    scrollY,
    maxHeight = spacing.screenHeight * 0.15,
  } = props

  const headerBg = useThemeColor('header')
  const headerTitleColor = useThemeColor('headerTitle')

  const animatedTitleStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, maxHeight * 0.5],
      [1, 0],
      Extrapolation.CLAMP
    )
    return { opacity }
  })

  const titleContent = titleTx ? translate(titleTx) : title

  return (
    <View style={[$headerContainer, { height: maxHeight, backgroundColor: headerBg }]}>
      <Animated.Text style={[animatedTitleStyle, $headerTitle, { color: headerTitleColor }]}>
        {titleContent}
      </Animated.Text>
    </View>
  )
}

const $headerContainer: ViewStyle = {
  alignItems: 'center',
  justifyContent: 'center',
}

const $headerTitle: TextStyle = {
  fontSize: verticalScale(32),
  lineHeight: verticalScale(44),
  fontFamily: typography.light,
  marginBottom: spacing.extraLarge * 2,
}
