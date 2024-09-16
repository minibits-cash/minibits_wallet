import React, { ComponentType } from "react"
import {
  Pressable,
  PressableProps,
  PressableStateCallbackType,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native"
import {moderateScale, moderateVerticalScale, scale, verticalScale} from '@gocodingnow/rn-size-matters'
import { colors, spacing, typography, useThemeColor } from "../theme"
import { Text, TextProps } from "./Text"

type Presets = keyof typeof $viewPresets

export interface ButtonAccessoryProps {
  style: StyleProp<any>
  pressableState: PressableStateCallbackType
}

export interface ButtonProps extends PressableProps {
  /**
   * Text which is looked up via i18n.
   */
  tx?: TextProps["tx"]
  /**
   * The text to display if not using `tx` or nested components.
   */
  text?: TextProps["text"]
  /**
   * Optional options to pass to i18n. Useful for interpolation
   * as well as explicitly setting locale or translation fallbacks.
   */
  txOptions?: TextProps["txOptions"]
  /**
   * An optional style override useful for padding & margin.
   */
  style?: StyleProp<ViewStyle>
  /**
   * An optional style override for the "pressed" state.
   */
  pressedStyle?: StyleProp<ViewStyle>
  /**
   * An optional style override for the button text.
   */
  textStyle?: StyleProp<TextStyle>
  /**
   * An optional style override for the button text when in the "pressed" state.
   */
  pressedTextStyle?: StyleProp<TextStyle>
  /**
   * One of the different types of button presets.
   */
  preset?: Presets
  /**
   * An optional component to render on the right side of the text.
   * Example: `RightAccessory={(props) => <View {...props} />}`
   */
  RightAccessory?: ComponentType<ButtonAccessoryProps>
  /**
   * An optional component to render on the left side of the text.
   * Example: `LeftAccessory={(props) => <View {...props} />}`
   */
  LeftAccessory?: ComponentType<ButtonAccessoryProps>
  /**
   * Children components.
   */
  children?: React.ReactNode
}

/**
 * A component that allows users to take actions and make choices.
 * Wraps the Text component with a Pressable component.
 *
 * - [Documentation and Examples](https://github.com/infinitered/ignite/blob/master/docs/Components-Button.md)
 */
export function Button(props: ButtonProps) {
  const {
    tx,
    text,
    txOptions,
    preset = "default",
    style: $viewStyleOverride,
    pressedStyle: $pressedViewStyleOverride,
    textStyle: $textStyleOverride,
    pressedTextStyle: $pressedTextStyleOverride,
    children,
    RightAccessory,
    LeftAccessory,
    ...rest
  } = props

  const textColor = useThemeColor("text")
  const defaultBg = useThemeColor("button")
  const defaultBgPressed = useThemeColor("buttonPressed")
  const secondaryBg = useThemeColor("buttonSecondary")
  const secondaryBgPressed = useThemeColor("buttonSecondaryPressed")
  const tertiaryBg = useThemeColor("buttonTertiary")
  const tertiaryBgPressed = useThemeColor("buttonTertiaryPressed")

  const $pressedViewPresets: Record<Presets, StyleProp<ViewStyle>> = {
    default: { backgroundColor: defaultBgPressed },
    secondary: { backgroundColor: secondaryBgPressed },
    tertiary: { backgroundColor: tertiaryBgPressed },
  }
  
  function $viewStyle({ pressed }) {
    return [
      $viewPresets[preset],
      { backgroundColor: defaultBg },
      preset === "secondary" && { backgroundColor: secondaryBg },
      preset === "tertiary" && { backgroundColor: tertiaryBg },
      !!LeftAccessory && (text || tx) && {paddingLeft: spacing.tiny},
      $viewStyleOverride,
      !!pressed && [$pressedViewPresets[preset], $pressedViewStyleOverride],
    ]
  }
  function $textStyle({ pressed }) {
    return [
      $textPresets[preset],
      { color: textColor },
      preset === "default" && { color: 'white' },      
      $textStyleOverride,
      !!pressed && [$pressedTextPresets[preset], $pressedTextStyleOverride],
    ]
  }

  return (
    <Pressable style={$viewStyle} accessibilityRole="button" {...rest}>
      {(state) => (
        <>
          {!!LeftAccessory && <LeftAccessory style={$leftAccessoryStyle} pressableState={state} />}

          <Text tx={tx} text={text} txOptions={txOptions} style={$textStyle(state)}>
            {children}
          </Text>

          {!!RightAccessory && (
            <RightAccessory style={$rightAccessoryStyle} pressableState={state} />
          )}
        </>
      )}
    </Pressable>
  )
}


const $baseViewStyle: ViewStyle = {
  minHeight: moderateVerticalScale(50),
  borderRadius: spacing.extraSmall,
  justifyContent: "center",
  alignItems: "center",
  flexDirection: "row",
  paddingVertical: spacing.small,
  paddingLeft: spacing.small,  
  paddingRight: spacing.small,
  overflow: "hidden",
}

const $baseTextStyle: TextStyle = {
  fontSize: moderateVerticalScale(16),
  lineHeight: moderateVerticalScale(20),
  fontFamily: typography.primary?.light,
  textAlign: "center",
  flexShrink: 1,
  flexGrow: 0,
  zIndex: 2,
}

const $rightAccessoryStyle: ViewStyle = { zIndex: 1 }
const $leftAccessoryStyle: ViewStyle = { zIndex: 1 }

const $viewPresets = {
  default: [
    $baseViewStyle,    
  ] as StyleProp<ViewStyle>,

  secondary: [
    $baseViewStyle,     
  ] as StyleProp<ViewStyle>,

  tertiary: [
    $baseViewStyle,    
  ] as StyleProp<ViewStyle>,
}

const $textPresets: Record<Presets, StyleProp<TextStyle>> = {
  default: $baseTextStyle,
  secondary: $baseTextStyle,
  tertiary: $baseTextStyle,
}

const $pressedTextPresets: Record<Presets, StyleProp<TextStyle>> = {
  default: { opacity: 0.9 },
  secondary: { opacity: 0.9 },
  tertiary: { opacity: 0.9 },
}
