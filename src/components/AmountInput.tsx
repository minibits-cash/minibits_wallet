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
import { round, toNumber } from "../utils/number"
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

    const amountInputColor = useThemeColor("amountInput")
    const convertedAmountColor = useThemeColor("headerSubTitle")
    const symbolColor = useThemeColor("headerSubTitle")

    // which fiat are we converting to/from (major units)
    const fiatCode = userSettingsStore.exchangeCurrency
    const fiatPrecision = Currencies[fiatCode]!.precision ?? 100 // cents per unit
    const topIsSat = getCurrency(unit).code === CurrencyCode.SAT

    // values shown in inputs
    const [topValue, setTopValue] = useState(value)
    const [bottomValue, setBottomValue] = useState("0")

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
      if (!walletStore.exchangeRate) return "0"

      if (topIsSat) {
        // top is sat/msat etc. Convert to sats first, then sats -> cents -> major
        const satPrecision = getCurrency(unit).precision // usually 1 for sat
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
      if (!walletStore.exchangeRate) return "0"

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
    useEffect(() => {
      log.trace(`[useEffect] setTopValue call`, value)
      setTopValue(value)

      const canShow =
        !!walletStore.exchangeRate &&
        // only show if the "other" currency makes sense:
        (topIsSat || getCurrency(unit).code === fiatCode)

      setIsConvertedValueVisible(!!canShow)

      if (canShow) {
        log.trace(`[useEffect] recalcBottom call`, value)
        setBottomValue(recalcBottom(value)) // ✅ always compute bottom from current top
      } else {
        setBottomValue("0")
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
      log.trace(`[useEffect] setTopValue call`, value)
      setTopValue(value)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    // input change handlers (bi-directional)
    const handleTopChange = (text: string) => {
      setTopValue(text)
      if (focused === "top") {
        setBottomValue(recalcBottom(text))
        onChangeText?.(text) // parent receives "top" value (sat or fiat, as per `unit`)
      }
    }

    const handleBottomChange = (text: string) => {
      log.trace(`[AmountInput] handleBottomChange: ${text}`)
      setBottomValue(text)
      if (focused === "bottom") {
        const newTop = recalcTop(text)
        setTopValue(newTop)
        onChangeText?.(newTop) // keep parent synced to "top" side
      }
    }


    const onAmountEndEditing = () => {
      // const formattedTop = recalcTop(bottomValue)
      const formattedBottom = recalcBottom(topValue)
      // setTopValue(formattedTop)
      setBottomValue(formattedBottom)
      return onEndEditing?.()
    }

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

    const defaultTopStyle: TextStyle = {
      margin: 0,
      padding: 0,
      fontSize: verticalScale(48),
      fontFamily: typography.primary?.medium,
      textAlign: "center",
      color: amountInputColor,
    }

    const animatedTopStyle = useAnimatedStyle(() => ({
      transform: [{ scale: topScale.value }],
      fontSize: 48 * topScale.value,
    }))


    const defaultBottomStyle: TextStyle = {
      margin: 0,
      padding: 0,
      fontSize: spacing.medium,
      fontFamily: typography.primary?.medium,
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
      marginRight: focused === 'bottom' ? spacing.medium + bottomValue.length * 4.5 : spacing.tiny,       
    }))

    const bottomCurrencyCode = topIsSat ? fiatCode : CurrencyCode.SAT
    const currencySymbol = Currencies[bottomCurrencyCode]!.symbol

    return (
      <>
        {/* Top input */}
        <AnimatedTextInput
          ref={ref}
          value={topValue}
          onChangeText={handleTopChange}
          onEndEditing={onAmountEndEditing}
          onFocus={handleTopFocus}
          onBlur={handleTopBlur}
          style={[defaultTopStyle, style, animatedTopStyle]}
          maxLength={9}
          keyboardType="numeric"
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
            value={bottomValue}
            onChangeText={handleBottomChange}
            onEndEditing={onAmountEndEditing}
            onFocus={handleBottomFocus}
            onBlur={handleBottomBlur}
            style={[
              defaultBottomStyle,
              style,
              { color: convertedAmountColor },
              animatedBottomStyle,
            ]}
            maxLength={9}
            keyboardType="numeric"
            returnKeyType="done"
            selectTextOnFocus={selectTextOnFocus !== undefined ? selectTextOnFocus : !hasBottomAmountFocusedOnce}
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
