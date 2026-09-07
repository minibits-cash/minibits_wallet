import {useEffect, useRef} from 'react'
import {Keyboard, KeyboardEvent, Platform} from 'react-native'
import {spacing} from '../theme'

/**
 * Where the top edge of the software keyboard sits, in window coordinates.
 *
 * Screens that centre content in the keyboard-free area need this as a NUMBER, not as
 * a layout side effect: on Android the app window is not resized under edge-to-edge, so
 * nothing shrinks on its own and the visible area has to be computed.
 */

/** Fraction of the screen the keyboard is assumed to cover before we have ever seen one. */
const ASSUMED_KEYBOARD_RATIO = 0.42

/**
 * Last measured keyboard top, kept for the lifetime of the JS context.
 *
 * The first frame of an amount screen is drawn BEFORE the keyboard opens, so without a
 * remembered value the content would be placed against a guess and then slide when the
 * real height arrives. After the first keyboard of the session that jump is gone.
 */
let lastKeyboardTop: number | null = null

export const DEFAULT_KEYBOARD_ANIMATION_DURATION = 280

/**
 * `isEstimate` marks the value reported on mount — a remembered or assumed height, not a
 * keyboard that is on screen. Callers that place content can use it right away; callers
 * that draw to the keyboard's edge should wait for the real thing.
 */
export type KeyboardTopHandler = (
  top: number,
  duration: number,
  isEstimate: boolean,
) => void

/**
 * Calls `onChange` with the window Y of the keyboard's top edge whenever it moves, plus
 * once on mount with the best value known so far. `duration` is the keyboard's own
 * animation duration where the platform reports one, so callers can stay in step with it.
 *
 * The callback is held in a ref, so an inline arrow function does not resubscribe.
 */
export function useKeyboardTop(onChange: KeyboardTopHandler) {
  const handlerRef = useRef(onChange)
  handlerRef.current = onChange

  useEffect(() => {
    const screenBottom = spacing.screenHeight

    handlerRef.current(
      lastKeyboardTop ?? screenBottom * (1 - ASSUMED_KEYBOARD_RATIO),
      0,
      true,
    )

    // iOS reports `will` events ahead of the movement and carries a duration; Android
    // only reports `did`, after the fact.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const onShow = (e: KeyboardEvent) => {
      const top = e.endCoordinates.screenY
      if (top > 0) lastKeyboardTop = top
      handlerRef.current(top, e.duration || DEFAULT_KEYBOARD_ANIMATION_DURATION, false)
    }

    const onHide = (e: KeyboardEvent) => {
      handlerRef.current(
        screenBottom,
        e?.duration || DEFAULT_KEYBOARD_ANIMATION_DURATION,
        false,
      )
    }

    const showSub = Keyboard.addListener(showEvent, onShow)
    const hideSub = Keyboard.addListener(hideEvent, onHide)

    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])
}
