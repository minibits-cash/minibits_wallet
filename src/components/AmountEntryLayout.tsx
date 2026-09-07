import React, {ReactNode, useEffect, useRef, useState} from 'react'
import {ColorValue, Keyboard, Pressable, StyleSheet, View, ViewStyle} from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import {spacing} from '../theme'
import {useKeyboardTop} from '../utils/useKeyboardTop'

// ─── Amount-entry layout ─────────────────────────────────────────────────────
//
// The shape shared by every screen that asks for an amount. Such a screen has two
// states. While the amount is being entered it is nothing but the amount: the header
// colour fills everything the keyboard leaves visible and the amount block sits in the
// middle of it, landing close to where the wallet balance was on the screen the user came
// from. Once the amount is confirmed it settles into the familiar layout — header band on
// top, cards and buttons below.
//
// Both states are the SAME tree. Nothing is mounted, unmounted or re-laid-out to switch
// between them: the amount block and the content are translated, the content is faded,
// and only the colour band's height actually animates. That keeps the whole transition on
// the UI thread, so it can stay in step with the keyboard instead of racing it.

/** Header band height in the settled layout — the height these screens have always had. */
const COLLAPSED_HEADER_HEIGHT = spacing.screenHeight * 0.20

const ENTRY_ANIMATION_DURATION = 320

/**
 * How long a blur is allowed to be "on the way to" another focus before it counts as
 * leaving the amount behind.
 *
 * Tapping the converted amount blurs one field and focuses the other, and without this
 * the screen would collapse and re-expand between those two events.
 */
const FOCUS_SWAP_GRACE = 120

/**
 * How long a screen that opened in entry mode waits for the focus it expected.
 *
 * Entry mode is otherwise driven entirely by focus, so a screen that opens expanded and
 * never receives one would sit there with no keyboard, no content and no way out but the
 * back button. Screens autofocus their amount within a few hundred milliseconds; missing
 * that deadline means it is not going to happen, whatever the reason, and the settled
 * layout is the right place to land.
 */
const ENTRY_FOCUS_TIMEOUT = 1500

/**
 * How far the amount block has to travel to sit in the middle of what the keyboard leaves
 * visible. All three inputs are in the same space: `wrapperTop` and `keyboardTop` are
 * window coordinates, `amountCentre` is relative to the top of the animated area.
 *
 * Zero until both measurements are in, so the first frame is drawn in the settled
 * position rather than against a half-known geometry.
 *
 * Module-level, so both animated styles share one stable worklet instead of rebuilding
 * themselves around a new closure on every render.
 */
function entryShift(wrapperTop: number, keyboardTop: number, amountCentre: number) {
  'worklet'
  if (wrapperTop <= 0 || amountCentre <= 0) return 0
  return Math.max(0, (keyboardTop - wrapperTop) / 2 - amountCentre)
}

export interface AmountEntryOptions {
  /**
   * Whether the amount can be entered at all — mirror the AmountInput's `editable`.
   *
   * Turning this off collapses the screen and keeps it collapsed, which covers the
   * amounts that arrive already decided: a scanned invoice, a payment request that names
   * its own amount, a transaction that has moved on to pending.
   */
  isEnabled?: boolean
  /**
   * Whether the screen opens in entry mode. Default true, matching a screen that
   * autofocuses its amount on load; pass the same condition as that autofocus where it is
   * conditional.
   */
  initiallyExpanded?: boolean
}

/**
 * Owns the entry/settled state and the geometry the animation runs on. Feed
 * `inputProps` to the AmountInput and the whole object to <AmountEntryLayout>.
 */
export function useAmountEntry({
  isEnabled = true,
  initiallyExpanded = true,
}: AmountEntryOptions = {}) {
  // Driven off focus rather than off the screen's submit handler: "done" on the keyboard
  // blurs the field, so a focus-driven collapse rides the keyboard down for free, and an
  // amount that fails validation puts the layout back too instead of stranding the user
  // on a screen with no keyboard and nothing else on it.
  const [isExpanded, setIsExpanded] = useState<boolean>(initiallyExpanded)
  const isAmountEntry = isEnabled && isExpanded

  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasEverFocused = useRef<boolean>(false)
  const wrapperRef = useRef<View>(null)

  /** 0 = settled layout, 1 = amount fills the screen. */
  const entryProgress = useSharedValue(initiallyExpanded ? 1 : 0)
  /** Window Y of the keyboard's top edge — the bottom of the area we centre in. */
  const keyboardTop = useSharedValue(0)
  /** Window Y of the animated area (i.e. just below the screen's header). */
  const wrapperTop = useSharedValue(0)
  /**
   * Centre of the whole visible amount block — amount, converted value, swap hint and
   * any caption — relative to the top of the animated area.
   */
  const amountCentre = useSharedValue(0)
  /**
   * 0 until the geometry above is known.
   *
   * onLayout and measureInWindow both report a frame AFTER the one they describe, so the
   * screen's first paint would place the amount in the settled position and then snap it
   * to the centre. Fading in over that gap costs nothing on a screen that is being pushed
   * in anyway, and removes the snap.
   */
  const isMeasured = useSharedValue(0)

  const settleMeasurement = function () {
    if (isMeasured.value !== 0) return
    if (wrapperTop.value > 0 && amountCentre.value > 0) {
      isMeasured.value = withTiming(1, {duration: 150})
    }
  }

  useKeyboardTop((top, duration) => {
    // Only the OPEN position is recorded. Following the keyboard down would swing the
    // amount block towards the bottom of the screen at exactly the moment the screen is
    // collapsing, which reads as the two animations fighting.
    if (top >= spacing.screenHeight) return
    keyboardTop.value = duration > 0 ? withTiming(top, {duration}) : top
  })

  useEffect(() => {
    entryProgress.value = withTiming(isAmountEntry ? 1 : 0, {
      duration: ENTRY_ANIMATION_DURATION,
      easing: Easing.out(Easing.cubic),
    })
  }, [isAmountEntry, entryProgress])

  useEffect(() => {
    if (!initiallyExpanded) return

    const timer = setTimeout(() => {
      if (!hasEverFocused.current) setIsExpanded(false)
    }, ENTRY_FOCUS_TIMEOUT)

    return () => clearTimeout(timer)
  }, [initiallyExpanded])

  useEffect(() => {
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
    }
  }, [])

  const onFocus = function () {
    hasEverFocused.current = true
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
    setIsExpanded(true)
  }

  const onBlur = function () {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null
      setIsExpanded(false)
    }, FOCUS_SWAP_GRACE)
  }

  const $animatedAmountStyle = useAnimatedStyle(() => ({
    opacity: isMeasured.value,
    transform: [
      {
        translateY:
          entryProgress.value *
          entryShift(wrapperTop.value, keyboardTop.value, amountCentre.value),
      },
    ],
  }))

  // The content travels with the amount block instead of on a shift of its own, so the
  // whole screen reads as one movement rather than two overlapping ones. It is well below
  // the fold long before the fade finishes.
  const $animatedContentStyle = useAnimatedStyle(() => ({
    opacity: isMeasured.value * (1 - entryProgress.value),
    transform: [
      {
        translateY:
          entryProgress.value *
          entryShift(wrapperTop.value, keyboardTop.value, amountCentre.value),
      },
    ],
  }))

  const $animatedBackdropStyle = useAnimatedStyle(() => {
    const visibleHeight = keyboardTop.value - wrapperTop.value
    const expandedHeight = Math.max(COLLAPSED_HEADER_HEIGHT, visibleHeight)
    return {
      opacity: isMeasured.value,
      height:
        COLLAPSED_HEADER_HEIGHT +
        entryProgress.value * (expandedHeight - COLLAPSED_HEADER_HEIGHT),
    }
  })

  const onWrapperLayout = function () {
    // Window coordinates, because that is the space the keyboard reports itself in.
    wrapperRef.current?.measureInWindow((_x, y) => {
      if (y > 0) wrapperTop.value = y
      settleMeasurement()
    })
  }

  const onAmountBlockLayout = function (y: number, height: number) {
    // The backdrop is absolute, so this block's offset within the header band is also its
    // offset within the animated area.
    //
    // Re-measured as the swap hint opens and closes, which is what we want: the block is
    // centred as it actually appears at the time.
    const centre = y + height / 2
    if (Math.abs(centre - amountCentre.value) > 0.5) {
      amountCentre.value = centre
    }
    settleMeasurement()
  }

  return {
    isAmountEntry,
    /** Spread onto the AmountInput. */
    inputProps: {
      onFocus,
      onBlur,
      isSwapHintVisible: isAmountEntry,
    },
    /** Consumed by <AmountEntryLayout>. */
    layout: {
      wrapperRef,
      onWrapperLayout,
      onAmountBlockLayout,
      $animatedAmountStyle,
      $animatedContentStyle,
      $animatedBackdropStyle,
    },
  }
}

export type AmountEntry = ReturnType<typeof useAmountEntry>

export interface AmountEntryLayoutProps {
  entry: AmountEntry
  /** The screen's header colour — the band, and the fill during entry. */
  headerBackgroundColor: ColorValue
  /** The amount block: the AmountInput and whatever caption travels with it. */
  AmountComponent: ReactNode
  /** The settled layout: cards, selectors, buttons. Hidden during entry. */
  children: ReactNode
}

/**
 * Everything below the screen's own header. Drop the amount block and the content in and
 * it handles both states; see the note at the top of this file for how.
 */
export function AmountEntryLayout(props: AmountEntryLayoutProps) {
  const {entry, headerBackgroundColor, AmountComponent, children} = props
  const {isAmountEntry, layout} = entry

  return (
    <View
      ref={layout.wrapperRef}
      style={$animationWrapper}
      onLayout={layout.onWrapperLayout}
    >
      {/* The header colour as a layer of its own, so it can grow to cover everything the
          keyboard leaves visible without the amount block's position depending on how tall
          it currently is. */}
      <Animated.View
        style={[
          $headerBackdrop,
          {backgroundColor: headerBackgroundColor},
          layout.$animatedBackdropStyle,
        ]}
      >
        {/* Tapping the empty space around the amount confirms it, and on iOS it is the
            ONLY way to: the amount fields use a decimal pad, which has no return key
            there, and entry mode has hidden everything else that could have taken focus.
            Dismissing the keyboard blurs the amount, and the blur collapses the screen.

            Live only during entry — the settled layout draws this band behind the amount
            and its caption, and a tap target over those would be a trap of its own. The
            amount block is a later sibling, so it stays on top and keeps its own taps. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          pointerEvents={isAmountEntry ? 'auto' : 'none'}
          onPress={() => Keyboard.dismiss()}
          accessible={false}
        />
      </Animated.View>
      <Animated.View style={[$headerContainer, layout.$animatedAmountStyle]}>
        {/* Everything on screen during amount entry, in one box that hugs its content —
            centring the amount alone would leave a caption below it hanging past the
            middle and the whole thing reading as too low. */}
        <View
          style={$amountBlock}
          onLayout={e =>
            layout.onAmountBlockLayout(
              e.nativeEvent.layout.y,
              e.nativeEvent.layout.height,
            )
          }
        >
          {AmountComponent}
        </View>
      </Animated.View>
      <Animated.View
        style={[$contentContainer, layout.$animatedContentStyle]}
        pointerEvents={isAmountEntry ? 'none' : 'auto'}
      >
        {children}
      </Animated.View>
    </View>
  )
}

const $animationWrapper: ViewStyle = {
  flex: 1,
}

/**
 * The header colour, drawn behind everything else in the animated area. Absolute so that
 * growing it to cover the whole visible screen moves nothing: the amount block and the
 * content keep the offsets the settled layout gives them, and only travel by transform.
 */
const $headerBackdrop: ViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
}

const $headerContainer: ViewStyle = {
  alignItems: 'center',
  padding: spacing.extraSmall,
  paddingTop: 0,
  height: COLLAPSED_HEADER_HEIGHT,
}

/**
 * Hugs the amount block's content, so its measured centre is the centre of what is
 * actually drawn. $headerContainer cannot serve: it has a fixed height, so its own centre
 * is a property of the settled layout rather than of the content.
 */
const $amountBlock: ViewStyle = {
  alignSelf: 'stretch',
  alignItems: 'center',
}

const $contentContainer: ViewStyle = {
  flex: 1,
  padding: spacing.extraSmall,
  marginTop: -spacing.extraLarge * 1.5,
}
