import { useCallback, useContext, useSyncExternalStore } from 'react'
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
 * Force the bar back into view from the JS thread, regardless of its current
 * state. Called on every focus change so that navigating — including Back to a
 * screen with no scroll handler — always brings the bar back.
 */
export function revealTabBar() {
  isHidden.value = false
  tabBarHiddenProgress.value = withTiming(0, { duration: SHOW_DURATION })
}

// Screens can force the bar out of view entirely while focused (e.g. to give a
// non-scrolling screen the full height). A count rather than a boolean keeps the
// state correct when a focus transition briefly overlaps two hiding screens.
let forcedHiddenCount = 0
const forcedHiddenListeners = new Set<() => void>()

function setForcedHidden(delta: number) {
  forcedHiddenCount = Math.max(0, forcedHiddenCount + delta)
  forcedHiddenListeners.forEach(listener => listener())
}

/** Reactive read of whether any focused screen is forcing the bar hidden. */
export function useIsTabBarForcedHidden(): boolean {
  return useSyncExternalStore(
    listener => {
      forcedHiddenListeners.add(listener)
      return () => forcedHiddenListeners.delete(listener)
    },
    () => forcedHiddenCount > 0,
  )
}

/**
 * Hide the floating tab bar for as long as the calling screen is focused, and
 * restore it on blur. Use case-by-case, for screens that want the full height.
 * While hidden, the bar reports only the safe-area inset as its height, so screens
 * reserve just that instead of the bar's footprint — see `useTabBarInset`.
 *
 * `enabled` may be toggled; the hook is always called so the rules of hooks hold.
 */
export function useHideTabBar(enabled = true) {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return
      setForcedHidden(1)
      return () => setForcedHidden(-1)
    }, [enabled]),
  )
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
  // Revealing on focus change is handled centrally in FloatingTabBar, so a screen
  // blurred mid-scroll doesn't leave the bar parked — see revealTabBar.
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
