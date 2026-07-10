import React, { useContext, useEffect, useState } from 'react'
import { LayoutChangeEvent, View, ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import {
  BottomTabBarHeightCallbackContext,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs'
import { PlatformPressable } from '@react-navigation/elements'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { spacing, useThemeColor } from '../theme'
import { tabBarHiddenProgress } from './tabBarVisibility'

/** Slightly smaller than the spacing.large icons the bar used when it was full width. */
export const TAB_ICON_SIZE = verticalScale(21)

/** Gap the bar keeps between its own bottom and the safe area. */
const TAB_BAR_BOTTOM_GAP = spacing.tiny

/**
 * Breathing room reserved above the bar. It is part of the height the bar reports,
 * so bottom-aligned screen content — WalletScreen's Scan button, PrivateContacts'
 * Add button — clears the bar instead of resting against it.
 */
const TAB_BAR_TOP_GAP = spacing.small

/**
 * A floating, fully rounded tab bar that sits on top of the screen content.
 *
 * It is absolutely positioned, so screens inside the tabs navigator render all
 * the way to the bottom edge. Screens reserve room for it by reading its height
 * from `useTabBarInset()` — see the `Screen` component.
 */
export function FloatingTabBar(props: BottomTabBarProps) {
  const { state, descriptors, navigation, insets } = props

  const background = useThemeColor('background')
  const activeIcon = useThemeColor('tabActiveIcon') as string
  const inactiveIcon = useThemeColor('tabIcon') as string

  const setTabBarHeight = useContext(BottomTabBarHeightCallbackContext)

  const bottomOffset = insets.bottom + TAB_BAR_BOTTOM_GAP
  const [barHeight, setBarHeight] = useState(0)

  /** Distance that parks the bar just below the screen edge. */
  const travel = barHeight + bottomOffset

  /** What screens reserve: the bar's footprint plus the gap above it. */
  const occupiedHeight = travel + TAB_BAR_TOP_GAP

  // The bar takes no part in keyboard avoidance. It is absolutely positioned at the
  // bottom of a window that the IME overlays rather than resizes (Android runs
  // edge-to-edge; iOS avoids the keyboard inside `Screen`), so the keyboard simply
  // covers it. Reacting to keyboard events here only risked latching it off-screen,
  // since `keyboardDidHide` is not reliably emitted when the window never resizes.
  useEffect(() => {
    if (barHeight === 0) return
    setTabBarHeight?.(occupiedHeight)
  }, [setTabBarHeight, occupiedHeight, barHeight])

  // Parks the bar fully below the screen edge.
  const $animatedBar = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: tabBarHiddenProgress.value * travel }],
    }
  }, [travel])

  const onLayout = (event: LayoutChangeEvent) => {
    setBarHeight(event.nativeEvent.layout.height)
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[$wrapper, { bottom: bottomOffset }, $animatedBar]}
    >
      <View style={[$bar, { backgroundColor: background }]} onLayout={onLayout}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key]
          const isFocused = state.index === index
          const color = isFocused ? activeIcon : inactiveIcon

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            })

            if (!isFocused && !event.defaultPrevented) {
              // @ts-ignore navigate() is not narrowed to this navigator's routes here
              navigation.navigate(route.name, route.params)
            }
          }

          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key })
          }

          return (
            <PlatformPressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              android_ripple={{ color: 'transparent' }}
              style={$tabButton}
            >
              {options.tabBarIcon?.({
                focused: isFocused,
                color,
                size: TAB_ICON_SIZE,
              })}
            </PlatformPressable>
          )
        })}
      </View>
    </Animated.View>
  )
}

const $wrapper: ViewStyle = {
  position: 'absolute',
  left: 0,
  right: 0,
  alignItems: 'center',
}

const $bar: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: spacing.extraSmall,
  borderRadius: 999,
  // `elevation` renders Android's own Material shadow, which ignores the iOS
  // shadow* props and reads darker and lower. boxShadow is honoured identically on
  // both platforms. Its blur is twice the iOS shadowRadius it maps to, hence 16px.
  boxShadow: '0px 3px 16px rgba(0, 0, 0, 0.14)',
}

const $tabButton: ViewStyle = {
  alignItems: 'center',
  justifyContent: 'center',
  paddingVertical: spacing.small,
  paddingHorizontal: spacing.small,
  borderRadius: 999,
}
