import React, { useContext, useEffect, useState } from 'react'
import { LayoutChangeEvent, View, ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import {
  BottomTabBarHeightCallbackContext,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs'
import { PlatformPressable } from '@react-navigation/elements'
import { getFocusedRouteNameFromRoute } from '@react-navigation/native'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { SvgXml } from 'react-native-svg'
import { ScanIcon } from '../components/ScanIcon'
import { translate } from '../i18n'
import { useStores } from '../models'
import { spacing, useThemeColor } from '../theme'
import { tabBarHiddenProgress } from './tabBarVisibility'

/** Slightly smaller than the spacing.large icons the bar used when it was full width. */
export const TAB_ICON_SIZE = verticalScale(21)

/** The Scan button splits the tabs down the middle. */
const SCAN_BUTTON_INDEX = 2

/** A touch larger than the tab icons, so Scan reads as the primary action. */
const SCAN_ICON_SIZE = verticalScale(21)

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
  const barShadow = useThemeColor('tabBarShadow') as string

  const { userSettingsStore } = useStores()
  const setTabBarHeight = useContext(BottomTabBarHeightCallbackContext)

  // Scan is a screen inside WalletStack, so the tab state only reports that
  // WalletNavigator is focused. Look one level down for the screen actually shown.
  const focusedRoute = state.routes[state.index]
  const isScanFocused = getFocusedRouteNameFromRoute(focusedRoute) === 'Scan'

  const gotoScan = () => {
    // ScanScreen requires a unit. WalletScreen restores its mint-unit tab from
    // preferredUnit on load and writes it back on every tab change, so this is the
    // unit the user is looking at. It is what the other screens pass here too.
    // @ts-ignore navigate() is not narrowed to this navigator's routes here
    navigation.navigate('WalletNavigator', {
      screen: 'Scan',
      params: { unit: userSettingsStore.preferredUnit },
    })
  }

  const renderTabs = (routes: typeof state.routes, offset = 0) =>
    routes.map((route, index) => {
      const routeIndex = offset + index
      const { options } = descriptors[route.key]
      const isFocused = state.index === routeIndex

      // Scan sits inside WalletStack, so WalletNavigator stays the focused tab while
      // it is open. Defer to Scan so exactly one item ever reads as active. This is
      // presentation only — tapping the tab must still behave as a focused tab press,
      // which is what pops the stack back from Scan.
      const isActive = isFocused && !isScanFocused
      const color = isActive ? activeIcon : inactiveIcon

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
          accessibilityState={{ selected: isActive }}
          accessibilityLabel={options.tabBarAccessibilityLabel}
          testID={options.tabBarButtonTestID}
          onPress={onPress}
          onLongPress={onLongPress}
          android_ripple={{ color: 'transparent' }}
          style={$tabButton}
        >
          {options.tabBarIcon?.({
            focused: isActive,
            color,
            size: TAB_ICON_SIZE,
          })}
        </PlatformPressable>
      )
    })

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
      <View
        style={[
          $bar,
          { backgroundColor: background, boxShadow: `0px 3px 16px ${barShadow}` },
        ]}
        onLayout={onLayout}
      >
        {renderTabs(state.routes.slice(0, SCAN_BUTTON_INDEX))}
        <PlatformPressable
          accessibilityRole="button"
          accessibilityLabel={translate('commonScan')}
          accessibilityState={{ selected: isScanFocused }}
          onPress={gotoScan}
          android_ripple={{ color: 'transparent' }}
          style={$tabButton}
        >
          <SvgXml
            width={SCAN_ICON_SIZE}
            height={SCAN_ICON_SIZE}
            xml={ScanIcon}
            fill={isScanFocused ? activeIcon : inactiveIcon}
          />
        </PlatformPressable>
        {renderTabs(state.routes.slice(SCAN_BUTTON_INDEX), SCAN_BUTTON_INDEX)}
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

// The shadow is applied inline, from the `tabBarShadow` theme colour: a black glow
// is invisible against the dark themes' background, so they carry a stronger one.
//
// `elevation` renders Android's own Material shadow, which ignores the iOS shadow*
// props and reads darker and lower. boxShadow is honoured identically on both
// platforms. Its blur is twice the iOS shadowRadius it maps to, hence 16px.
const $bar: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: spacing.extraSmall,
  borderRadius: 999,
}

const $tabButton: ViewStyle = {
  alignItems: 'center',
  justifyContent: 'center',
  paddingVertical: spacing.small,
  paddingHorizontal: spacing.extraSmall,
  borderRadius: 999,
}
