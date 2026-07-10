import { useCallback, useContext } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs'
import {
  makeMutable,
  useAnimatedScrollHandler,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

const HIDE_DURATION = 200
const SHOW_DURATION = 250

/**
 * How far the list may be scrolled while still counting as "at the top". Also
 * absorbs the sub-pixel jitter of a settling bounce.
 */
const TOP_REVEAL_OFFSET = 16

/** 0 = bar resting in place, 1 = bar parked below the bottom edge. */
export const tabBarHiddenProgress = makeMutable(0)

/** Guards against restarting an in-flight animation on every scroll frame. */
const isHidden = makeMutable(false)

export function hideTabBar() {
  'worklet'
  if (isHidden.value) return
  isHidden.value = true
  tabBarHiddenProgress.value = withTiming(1, { duration: HIDE_DURATION })
}

export function showTabBar() {
  'worklet'
  if (!isHidden.value) return
  isHidden.value = false
  tabBarHiddenProgress.value = withTiming(0, { duration: SHOW_DURATION })
}

/**
 * Vertical space the floating tab bar occupies, including its bottom offset.
 * Returns 0 outside of the tabs navigator, and while the keyboard hides the bar.
 */
export function useTabBarInset(): number {
  return useContext(BottomTabBarHeightContext) ?? 0
}

/**
 * Scroll handler that parks the floating tab bar off-screen as soon as the user
 * scrolls away from the top, and brings it back only once they return there.
 *
 * Visibility follows the scroll offset rather than the scroll direction, so the
 * bar never slides in while the user is reading part-way down a list, nor when
 * they simply stop scrolling.
 *
 * Pass `scrollY` to also track the offset, e.g. to drive an `AnimatedHeader`.
 */
export function useTabBarScrollHandler(scrollY?: SharedValue<number>) {
  useFocusEffect(
    useCallback(() => {
      // A screen can be blurred while scrolled down, which leaves the bar parked.
      isHidden.value = false
      tabBarHiddenProgress.value = withTiming(0, { duration: SHOW_DURATION })
    }, []),
  )

  return useAnimatedScrollHandler(
    {
      onScroll: event => {
        const y = event.contentOffset.y

        if (scrollY) scrollY.value = y

        if (y > TOP_REVEAL_OFFSET) {
          hideTabBar()
        } else {
          showTabBar()
        }
      },
    },
    [scrollY],
  )
}
