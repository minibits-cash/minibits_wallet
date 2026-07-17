import React, { forwardRef, useState, useEffect } from "react"
import { TextInput, TextStyle, View } from "react-native"
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated"
import { spacing, useThemeColor, typography } from "../theme"
import { verticalScale } from "@gocodingnow/rn-size-matters"
import {
  Currencies,
  CurrencyCode,
  MintUnit,
  convertToFromSats,
  formatCurrency,
  getCurrency,
} from "../services/wallet/currency"
import { formatNumber, round, toNumber } from "../utils/number"
import { useStores } from "../models"
import { Text } from "./Text"
import { format } from "util"
import { log } from "../services"

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

interface AmountInputProps {
  value: string
  onChangeText: (text: string) => void
  unit?: MintUnit
  onEndEditing?: () => void
  editable?: boolean
  selectTextOnFocus?: boolean
  onFocus?: () => void
  onBlur?: () => void
  style?: TextStyle
}

export const AmountInput = forwardRef<TextInput, AmountInputProps>(
  (
    {
      value,
      onChangeText,
      unit = "sat",
      onEndEditing,
      editable = true,
      selectTextOnFocus,
      onFocus,
      onBlur,
      style,
      ...rest
    },
    ref
  ) => {
    const { walletStore, userSettingsStore } = useStores()

    const [focused, setFocused] = useState<"top" | "bottom">("top")
    const [isConvertedValueVisible, setIsConvertedValueVisible] = useState<boolean>(false)
    const [hasTopAmountFocusedOnce, setHasTopAmountFocusedOnce] = useState(false)
    const [hasBottomAmountFocusedOnce, setHasBottomAmountFocusedOnce] = useState(false)
    const [hasBeenFirstTimeConverted, setHasBeenFirstTimeConverted] = useState<boolean>(false)

    const focusedInputColor = useThemeColor("amountInput")
    const convertedAmountColor = useThemeColor("headerSubTitle")
    const symbolColor = useThemeColor("headerSubTitle")

    // which fiat are we converting to/from (major units)
    const fiatCode = userSettingsStore.exchangeCurrency
    const fiatPrecision = fiatCode ? Currencies[fiatCode]!.precision ?? 100 : null// cents per unit
    const topIsSat = getCurrency(unit).code === CurrencyCode.SAT

    // values shown in inputs
    const [topValue, setTopValue] = useState(value)
    const [bottomValue, setBottomValue] = useState("0")

    // --- grouping separators ---
    //
    // A confirmed amount is SHOWN grouped ("12,345"), but state always holds the plain
    // number. Formatting is a render concern, derived from the value, never written back
    // into it.
    //
    // That split is not tidiness, it is the fix. These are controlled TextInputs, and
    // Android echoes a programmatically-set `value` back out through `onChangeText` —
    // where `handleTopChange` rewrites the first comma to a dot, because a decimal-comma
    // keyboard types "1,5" and means 1.5. Store a grouped string and that echo turns
    // "1,000" into "1.000" and then, re-formatted, into something shorter still. Keep the
    // grouping out of state and the round trip cannot happen: what the change handler sees
    // is always what the user typed.
    const stripGrouping = (v: string) => v.replace(/,/g, '')

    /** Group and pad an amount for DISPLAY: 12345 -> "12,345". Never stored. */
    const formatForDisplay = (v: string, mantissa: number) => {
      const n = toNumber(stripGrouping(v))
      if (n === undefined || !Number.isFinite(n)) return v
      return formatNumber(n, mantissa)
    }

    // Cap on what may be TYPED. Applied in the change handlers rather than via maxLength,
    // because maxLength also clips programmatically-set text on Android — and the grouped
    // display is longer than the number it shows ("999,999,999" is 11 characters, or 14
    // with a fiat mantissa), so a maxLength that fit the typing limit would truncate the
    // very value it had just formatted.
    const MAX_TYPED_LENGTH = 9

    const handleTopFocus = () => {
      setHasTopAmountFocusedOnce(true)
      setFocused('top')
      onFocus?.()
    }

    const handleTopBlur = () => {
      setHasTopAmountFocusedOnce(false)
      onBlur?.()
    }

    const handleBottomFocus = () => {
      setHasBottomAmountFocusedOnce(true)
      setFocused('bottom')
      onFocus?.()
    }

    const handleBottomBlur = () => {
      setHasBottomAmountFocusedOnce(false)
      onBlur?.()
    }

    // --- conversion helpers (IMPORTANT: cents ↔ major handling) ---

    // SAT (or other top unit) -> bottom display value
    const recalcBottom = (v: string) => {
      log.trace(`[AmountInput] recalcBottom: ${v}`)
      if (!walletStore.exchangeRate || !fiatCode || !fiatPrecision) return "0"

      if (topIsSat) {
        // top is sat/msat etc. Convert to sats first, then sats -> cents -> major
        const satPrecision = getCurrency(unit).precision // 1
        const sats = round(toNumber(v) * satPrecision, 0) || 0

        // convertToFromSats(from SAT) returns FIAT PRECISION UNITS (cents)
        const cents = convertToFromSats(sats, CurrencyCode.SAT, walletStore.exchangeRate)        
        return formatCurrency(cents, fiatCode, true)
      } else {
        // top is FIAT major -> cents -> sats (bottom shows sats)
        const cents = round(toNumber(v) * fiatPrecision, 0) || 0

        // convertToFromSats(from FIAT) returns SATS
        const sats = convertToFromSats(cents, fiatCode, walletStore.exchangeRate)
        return formatCurrency(sats, CurrencyCode.SAT, true)// bottom is sats in this branch
      }
    }

    // bottom (display) -> top value
    const recalcTop = (v: string) => {
      if (!walletStore.exchangeRate || !fiatCode || !fiatPrecision) return "0"

      if (topIsSat) {
        // bottom is FIAT major. Convert major -> cents -> sats -> top (sat/msat)
        const cents = round(toNumber(v) * fiatPrecision, 0) || 0
        const sats = convertToFromSats(cents, fiatCode, walletStore.exchangeRate)
        return formatCurrency(sats, CurrencyCode.SAT, true)
      } else {
        // bottom is SATS. Convert sats -> cents -> FIAT major (top)
        const sats = round(toNumber(v), 0) || 0
        const cents = convertToFromSats(sats, CurrencyCode.SAT, walletStore.exchangeRate)
        return formatCurrency(cents, fiatCode, true)
      }
    }

    // keep internal state in sync with external `value`
    //
    // Stripped on the way in: a parent may hand us an already-grouped string (several
    // screens pre-fill with numbro's thousandSeparated), and state must stay plain.
    useEffect(() => {
      log.trace(`[AmountInput.useEffect:mount] setTopValue`, value)
      setTopValue(stripGrouping(value))

      // only show if
      // - user has set conversion currency in settings
      // - we have an exchange rate  
      // - mint unit is SATS or mint unit is the one we have exchange rate for (so we convert to SATS):
      const canShow =
        fiatCode &&  
        !!walletStore.exchangeRate &&
        (topIsSat || getCurrency(unit).code === fiatCode)

          setIsConvertedValueVisible(!!canShow)

      if (canShow) {
        log.trace(`[AmountInput.useEffect:mount] recalcBottom`, value)
        setBottomValue(stripGrouping(recalcBottom(value))) // ✅ always compute bottom from current top
      } else {
        setBottomValue("0")
      }
    }, [])

    useEffect(() => {
      log.trace(`[AmountInput.useEffect:value] setTopValue`, value)
      setTopValue(stripGrouping(value))
      if(!hasBeenFirstTimeConverted && value && toNumber(value) > 0) {
        setBottomValue(stripGrouping(recalcBottom(value)))
        setHasBeenFirstTimeConverted(true)
      }

    }, [value])

    // input change handlers (bi-directional)
    const handleTopChange = (text: string) => {
      // "," -> "." so a decimal-comma keyboard can type "1,5" and mean 1.5. Safe only
      // because state never holds a grouped value for this to collide with.
      const normalized = text.replace(',', '.')
      if (normalized.length > MAX_TYPED_LENGTH) return

      setTopValue(normalized)
      if (focused === "top") {
        setBottomValue(stripGrouping(recalcBottom(normalized)))
        onChangeText?.(normalized) // parent receives "top" value (sat or fiat, as per `unit`)
      }
    }

    const handleBottomChange = (text: string) => {
      const normalized = text.replace(',', '.')
      if (normalized.length > MAX_TYPED_LENGTH) return

      setBottomValue(normalized)
      if (focused === "bottom") {
        const newTop = stripGrouping(recalcTop(normalized))
        setTopValue(newTop)
        onChangeText?.(newTop) // keep parent synced to "top" side
      }
    }


    /**
     * The amount is confirmed (keyboard "done", or focus left the field).
     *
     * Nothing is reformatted here, and nothing is pushed back to the parent: losing focus
     * is all it takes for the field to render grouped, and the parent keeps the plain
     * number it has had all along. The only work is recomputing the converted value from
     * the CONFIRMED top rather than from whatever the bottom field holds — the two can be
     * a keystroke apart.
     */
    const onAmountEndEditing = () => {
      setBottomValue(stripGrouping(recalcBottom(topValue)))
      return onEndEditing?.()
    }

    const bottomCurrencyCode = topIsSat ? fiatCode : CurrencyCode.SAT
    const currencySymbol = bottomCurrencyCode ? Currencies[bottomCurrencyCode]!.symbol : null

    // Grouped only when the field is NOT being edited. This is the whole of the "format on
    // confirm" behaviour: losing focus is what confirms an amount, and the grouped text is
    // derived at render time, so it can never be read back in as input.
    const topDisplayValue = hasTopAmountFocusedOnce
      ? topValue
      : formatForDisplay(topValue, getCurrency(unit).mantissa)

    const bottomMantissa = bottomCurrencyCode ? Currencies[bottomCurrencyCode]!.mantissa : 0
    const bottomDisplayValue = hasBottomAmountFocusedOnce
      ? bottomValue
      : formatForDisplay(bottomValue, bottomMantissa)

    // --- animations (unchanged behavior) ---
    const topScale = useSharedValue(1)
    const bottomScale = useSharedValue(1)

    useEffect(() => {
      if (focused === "top") {
        topScale.value = withTiming(1, { duration: 250 })
        bottomScale.value = withTiming(1, { duration: 250 })
      } else {
        topScale.value = withTiming(0.6, { duration: 250 })
        bottomScale.value = withTiming(1.65, { duration: 250 })
      }
    }, [focused, topScale, bottomScale])

    const TOP_FONT_SIZE = verticalScale(56)

    const defaultTopStyle: TextStyle = {
      //marginTop: spacing.small,
      padding: 0,
      fontSize: TOP_FONT_SIZE,
      fontFamily: typography.primary?.bold,
      fontWeight: 'bold', // android
      textAlign: "center",
      color: focusedInputColor,
      // A DEFINITE width, so the field is never sized by measuring its own text.
      //
      // These inputs sit in a header with `alignItems: 'center'`, so with no width Yoga
      // asks the text how wide it is — and that measurement is made from the LAYOUT style,
      // while what is actually drawn comes from the animated style below. The two only have
      // to disagree slightly for the last glyph to fall outside the measured box: a
      // confirmed "1,000" rendered as "1,00". Typing hid it, because the text is measured
      // and drawn afresh on every keystroke; formatting on blur is what made the box and
      // its contents disagree.
      width: spacing.screenWidth * 0.9,
      alignSelf: 'center',
    }

    // Same base size as the layout style. Reanimated applies fontSize outside Yoga, so a
    // different number here means the text is drawn at one size and measured at another.
    const animatedTopStyle = useAnimatedStyle(() => ({
      transform: [{ scale: topScale.value }],
      fontSize: TOP_FONT_SIZE * topScale.value,
    }))


    const defaultBottomStyle: TextStyle = {
      margin: 0,
      marginBottom: spacing.tiny,
      padding: 0,
      fontSize: spacing.medium,
      fontFamily: typography.primary?.bold,
      fontWeight: 'bold', // android
      color: convertedAmountColor,      
    }

    const animatedBottomStyle = useAnimatedStyle(() => ({
      transform: [{ scale: bottomScale.value }],
      fontSize: spacing.medium * bottomScale.value,  
    }))

    // symbol style
    const defaultSymbolStyle: TextStyle = {
      color: symbolColor,
      fontSize: spacing.extraSmall,
      fontFamily: typography.primary?.light,
      alignSelf: "center",
      marginLeft: focused === 'bottom' ? - spacing.large * 1.7: undefined
    }

    // animated scale for symbol
    const animatedSymbolStyle = useAnimatedStyle(() => ({
      transform: [{ scale: bottomScale.value }], // sync with bottom input
      fontSize: spacing.extraSmall * bottomScale.value, // scale font size
      marginRight: focused === 'bottom' ? spacing.medium + bottomDisplayValue.length * 4.5 : spacing.tiny,       
    }))


    return (
      <>
        {/* Top input */}
        <AnimatedTextInput
          ref={ref}
          value={topDisplayValue}
          onChangeText={handleTopChange}
          onEndEditing={onAmountEndEditing}
          onFocus={handleTopFocus}
          onBlur={handleTopBlur}
          style={[
            defaultTopStyle, 
            style, 
            animatedTopStyle, 
            { color: focused === 'top' ? focusedInputColor : convertedAmountColor }
          ]}
          keyboardType="decimal-pad"
          returnKeyType="done"
          selectTextOnFocus={!hasTopAmountFocusedOnce}
          editable={editable}
          {...rest}
        />

        {isConvertedValueVisible && (
          <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
          }}
        >
          <Animated.Text
            style={[defaultSymbolStyle, animatedSymbolStyle, 
            ]}
          >
            {currencySymbol}
          </Animated.Text>
        
          <AnimatedTextInput
            value={bottomDisplayValue}
            onChangeText={handleBottomChange}
            onEndEditing={onAmountEndEditing}
            onFocus={handleBottomFocus}
            onBlur={handleBottomBlur}
            style={[
              defaultBottomStyle,
              style,
              { color: convertedAmountColor },
              animatedBottomStyle,
              { color: focused === 'bottom' ? focusedInputColor : convertedAmountColor }
            ]}
            keyboardType="decimal-pad"
            returnKeyType="done"
            selectTextOnFocus={!hasBottomAmountFocusedOnce}
            editable={editable}
            {...rest}
          />
        </View>
        )}
      </>
    )
  }
)

AmountInput.displayName = "AmountInput"
