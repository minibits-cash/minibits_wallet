import { verticalScale } from "@gocodingnow/rn-size-matters"
import { I18nOptions } from "i18n-js"
import React from "react"
import { StyleProp, Text as RNText, TextProps as RNTextProps, TextStyle } from "react-native"
import { translate, TxKeyPath } from "../i18n"
import { useThemeColor, typography } from "../theme"

type Sizes = keyof typeof $sizeStyles
type Weights = keyof typeof typography.primary
type Presets = keyof typeof $presets

export interface TextProps extends RNTextProps {
  /**
   * Text which is looked up via i18n.
   */
  tx?: TxKeyPath
  /**
   * The text to display if not using `tx` or nested components.
   */
  text?: string
  /**
   * Optional options to pass to i18n. Useful for interpolation
   * as well as explicitly setting locale or translation fallbacks.
   */
  txOptions?: I18nOptions
  /**
   * An optional style override useful for padding & margin.
   */
  style?: StyleProp<TextStyle>
  /**
   * One of the different types of text presets.
   */
  preset?: Presets
  /**
   * Text weight modifier.
   */
  weight?: Weights
  /**
   * Text size modifier.
   */
  size?: Sizes
  /**
   * Children components.
   */
  children?: React.ReactNode
}

/**
 * For your text displaying needs.
 * This component is a HOC over the built-in React Native one.
 *
 * - [Documentation and Examples](https://github.com/infinitered/ignite/blob/master/docs/Components-Text.md)
 */
export function Text(props: TextProps) {  
  const { weight, size, tx, txOptions, text, children, style: $styleOverride, ...rest } = props

  const i18nText = tx && translate(tx, txOptions)
  const content = i18nText || text || children

  const preset: Presets = $presets[props.preset] ? props.preset : "default"
  const $styles = [    
    $presets[preset],
    weight ? {fontFamily: weight} : null,
    size ? $sizeStyles[size] : null,
    { color: useThemeColor('text') },
    $styleOverride,    
  ]

  const $baseFontFamily = { fontFamily: typography.primary.normal } as TextStyle

  return (
    <RNText {...rest} style={[$baseFontFamily, $styles]}>
      {content}
    </RNText>
  )
}

export const $sizeStyles = {
  xxl: { fontSize: verticalScale(36), lineHeight: verticalScale(44) } as TextStyle,
  xl: { fontSize: verticalScale(24), lineHeight: verticalScale(34) } as TextStyle,
  lg: { fontSize: verticalScale(20), lineHeight: verticalScale(32) } as TextStyle,
  md: { fontSize: verticalScale(18), lineHeight: verticalScale(26) } as TextStyle,
  sm: { fontSize: verticalScale(16), lineHeight: verticalScale(24) } as TextStyle,
  xs: { fontSize: verticalScale(14), lineHeight: verticalScale(21) } as TextStyle,
  xxs: { fontSize: verticalScale(12), lineHeight: verticalScale(18) } as TextStyle,
}


// does not work
/* const $fontWeightStyles = Object.entries(typography.primary).reduce((acc, [weight, fontFamily]) => {
  return { ...acc, [weight]: { fontFamily } }
}, {}) as Record<Weights, TextStyle> */

const $baseStyle: StyleProp<TextStyle> = [  
  $sizeStyles.sm,
  {fontFamily: typography.primary?.normal}
]

const $presets = {
  default: $baseStyle,

  bold: [$baseStyle, {fontFamily: typography.primary?.medium}] as StyleProp<TextStyle>,

  heading: [$baseStyle, $sizeStyles.xxl, {fontFamily: typography.primary?.medium}] as StyleProp<TextStyle>,

  subheading: [$baseStyle, $sizeStyles.lg] as StyleProp<TextStyle>,

  formLabel: [$baseStyle] as StyleProp<TextStyle>,

  formHelper: [$baseStyle, $sizeStyles.sm, {fontFamily: typography.primary?.light}] as StyleProp<TextStyle>,
}

