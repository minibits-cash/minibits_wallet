import React, { useEffect } from "react"
import {
  LayoutChangeEvent,
  Pressable,
  StyleProp,
  TextStyle,
  View,
  ViewStyle,
} from "react-native"
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import type { Route, SceneRendererProps, NavigationState } from "react-native-tab-view"
import { spacing } from "../theme"
import { Text } from "./Text"

/**
 * A modern, platform-agnostic segmented control used as the `renderTabBar` of a
 * react-native-tab-view `TabView`. A single rounded "pill" slides under the
 * active segment — native-feeling on iOS (UISegmentedControl) and equally at
 * home on Android. The default track / pill colors are translucent white so the
 * control reads well on the colored app header across all themes.
 */
export type SegmentedTabBarProps<T extends Route> = SceneRendererProps & {
  navigationState: NavigationState<T>
  /** Custom content for each segment. Defaults to the route's `title` as text. */
  renderItem?: (info: { route: T; focused: boolean }) => React.ReactNode
  /** Fixed per-segment width; the control is then centered. Omit to fill width. */
  segmentWidth?: number
  trackColor?: string
  pillColor?: string
  /** Label colors for the default text renderer. */
  activeColor?: string
  inactiveColor?: string
  containerStyle?: StyleProp<ViewStyle>
}

// Shared so non-tab surfaces (e.g. MintHeader's selected-unit chip) can match
// the active pill exactly.
export const SEGMENTED_PILL_RADIUS = 100
export const SEGMENTED_PILL_COLOR = "rgba(255,255,255,0.20)"

const PILL_RADIUS = SEGMENTED_PILL_RADIUS
// No padding: the pill fills its segment edge-to-edge so no track color shows
// as a margin around the active segment.
const TRACK_PADDING = 0
const ANIM = { duration: 220, easing: Easing.out(Easing.cubic) }

const DEFAULT_TRACK = "rgba(255,255,255,0.08)"
const DEFAULT_PILL = SEGMENTED_PILL_COLOR

export function SegmentedTabBar<T extends Route>(props: SegmentedTabBarProps<T>) {
  const {
    navigationState,
    jumpTo,
    renderItem,
    segmentWidth,
    trackColor,
    pillColor,
    activeColor = "white",
    inactiveColor = "rgba(255,255,255,0.6)",
    containerStyle,
  } = props

  const routes = navigationState.routes
  const count = routes.length
  const index = navigationState.index

  // Inner content width drives the pill geometry. In fixed-width mode we seed it
  // up front to avoid a first-frame flash; onLayout keeps it exact thereafter.
  const innerWidth = useSharedValue(segmentWidth ? segmentWidth * count : 0)
  const animIndex = useSharedValue(index)

  useEffect(() => {
    animIndex.value = withTiming(index, ANIM)
  }, [index])

  const onInnerLayout = (e: LayoutChangeEvent) => {
    innerWidth.value = e.nativeEvent.layout.width
  }

  const pillStyle = useAnimatedStyle(() => {
    const segW = count > 0 ? innerWidth.value / count : 0
    return {
      width: segW,
      transform: [{ translateX: animIndex.value * segW }],
    }
  })

  const renderLabel = (route: T, focused: boolean) => {
    if (renderItem) return renderItem({ route, focused })
    return (
      <Text
        text={(route as Route & { title?: string }).title}
        size="xs"
        style={[$label, { color: focused ? activeColor : inactiveColor }]}
      />
    )
  }

  return (
    <View
      style={[
        $track,
        { backgroundColor: trackColor ?? DEFAULT_TRACK },
        segmentWidth
          ? { width: segmentWidth * count, alignSelf: "center" }
          : { alignSelf: "stretch" },
        containerStyle,
      ]}
    >
      <View
        style={[$inner, segmentWidth ? { width: segmentWidth * count } : null]}
        onLayout={onInnerLayout}
      >
        <Animated.View
          style={[$pill, { backgroundColor: pillColor ?? DEFAULT_PILL }, pillStyle]}
        />
        <View style={$row}>
          {routes.map((route, i) => (
            <Pressable
              key={route.key}
              style={[$segment, segmentWidth ? { width: segmentWidth } : { flex: 1 }]}
              onPress={() => jumpTo(route.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === index }}
            >
              {renderLabel(route, i === index)}
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  )
}

const $track: ViewStyle = {
  borderRadius: PILL_RADIUS,
  padding: TRACK_PADDING,
  marginVertical: spacing.small,
}

const $inner: ViewStyle = {
  position: "relative",
  alignSelf: "stretch",
}

const $pill: ViewStyle = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  borderRadius: PILL_RADIUS,
}

const $row: ViewStyle = {
  flexDirection: "row",
}

const $segment: ViewStyle = {
  paddingVertical: spacing.extraSmall,
  alignItems: "center",
  justifyContent: "center",
}

const $label: TextStyle = {
  textAlign: "center",
}
