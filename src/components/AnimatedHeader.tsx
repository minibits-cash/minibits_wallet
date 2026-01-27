import React from 'react'
import { TextStyle, ViewStyle } from 'react-native'
import Animated, {
  SharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated'
import { spacing, typography, useThemeColor } from '../theme'
import { translate, TxKeyPath } from '../i18n'

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
   * The scroll distance over which the animation occurs.
   * Defaults to spacing.screenHeight * 0.07
   */
  scrollDistance?: number
  /**
   * Maximum header height when not scrolled.
   * Defaults to spacing.screenHeight * 0.15
   */
  maxHeight?: number
  /**
   * Minimum header height when fully scrolled.
   * Defaults to spacing.screenHeight * 0.08
   */
  minHeight?: number
}

/**
 * AnimatedHeader component that provides a collapsible header with animated title.
 * Use with Animated.ScrollView and useAnimatedScrollHandler to track scroll position.
 */
export function AnimatedHeader(props: AnimatedHeaderProps) {
  const {
    title,
    titleTx,
    scrollY,
    scrollDistance = spacing.screenHeight * 0.07,
    maxHeight = spacing.screenHeight * 0.15,
    minHeight = spacing.screenHeight * 0.08,
  } = props

  const headerBg = useThemeColor('header')
  const headerTitleColor = useThemeColor('headerTitle')

  const animatedHeaderStyle = useAnimatedStyle(() => {
    const height = interpolate(
      scrollY.value,
      [0, scrollDistance],
      [maxHeight, minHeight],
      Extrapolation.CLAMP
    )
    return { height }
  })

  const animatedTitleStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      scrollY.value,
      [0, scrollDistance],
      [1, 0.75],
      Extrapolation.CLAMP
    )
    const translateY = interpolate(
      scrollY.value,
      [0, scrollDistance],
      [0, -spacing.extraLarge * 1.5],
      Extrapolation.CLAMP
    )
    const opacity = interpolate(
      scrollY.value,
      [0, scrollDistance * 0.8],
      [1, 0],
      Extrapolation.CLAMP
    )
    return {
      transform: [{ scale }, { translateY }],
      opacity,
    }
  })

  const titleContent = titleTx ? translate(titleTx) : title

  return (
    <Animated.View style={[animatedHeaderStyle, $headerContainer, { backgroundColor: headerBg }]}>
      <Animated.Text style={[animatedTitleStyle, $headerTitle, { color: headerTitleColor }]}>
        {titleContent}
      </Animated.Text>
    </Animated.View>
  )
}

const $headerContainer: ViewStyle = {
  alignItems: 'center',
}

const $headerTitle: TextStyle = {
  fontSize: spacing.extraLarge,
  fontFamily: typography.primary?.medium,
}
