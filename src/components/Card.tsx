import { verticalScale } from "@gocodingnow/rn-size-matters"
import React, { ComponentType, Fragment, ReactElement } from "react"
import {
  StyleProp,
  TextStyle,
  TouchableOpacity,
  TouchableOpacityProps,
  View,
  ViewStyle,
  useColorScheme
} from "react-native"
import { colors, useThemeColor, spacing } from "../theme"
import { $sizeStyles, Text, TextProps } from "./Text"

type Presets = keyof typeof $containerPresets

interface CardProps extends TouchableOpacityProps {
  /**
   * One of the different types of text presets.
   */
  preset?: Presets
  /**
   * How the content should be aligned vertically. This is especially (but not exclusively) useful
   * when the card is a fixed height but the content is dynamic.
   *
   * `top` (default) - aligns all content to the top.
   * `center` - aligns all content to the center.
   * `space-between` - spreads out the content evenly.
   * `force-footer-bottom` - aligns all content to the top, but forces the footer to the bottom.
   */
  verticalAlignment?: "top" | "center" | "space-between" | "force-footer-bottom"
  /**
   * Custom component added to the left of the card body.
   */
  LeftComponent?: ReactElement
  /**
   * Custom component added to the right of the card body.
   */
  RightComponent?: ReactElement
  /**
   * The label text to display if not using `headingTx`.
   */
  label?: TextProps["text"]
  /**
   * Label text which is looked up via i18n.
   */
  labelTx?: TextProps["tx"]
  /**
   * Optional label options to pass to i18n. Useful for interpolation
   * as well as explicitly setting locale or translation fallbacks.
   */
  labelTxOptions?: TextProps["txOptions"]
  /**
   * Style overrides for label text.
   */
  labelStyle?: StyleProp<TextStyle>
  /**
   * Pass any additional props directly to the label Text component.
   */
  LabelTextProps?: TextProps
  /**
   * Custom label component.
   * Overrides all other `heading*` props.
   */
  LabelComponent?: ReactElement
  /**
   * Heading text.
   */
  heading?: TextProps["text"]
  /**
   * Heading text which is looked up via i18n.
   */
  headingTx?: TextProps["tx"]
  /**
   * Optional heading options to pass to i18n. Useful for interpolation
   * as well as explicitly setting locale or translation fallbacks.
   */
  headingTxOptions?: TextProps["txOptions"]
  /**
   * Style overrides for heading text.
   */
  headingStyle?: StyleProp<TextStyle>
  /**
   * Pass any additional props directly to the heading Text component.
   */
  HeadingTextProps?: TextProps
  /**
   * Custom heading component.
   * Overrides all other `heading*` props.
   */
  HeadingComponent?: ReactElement
  /**
   * The content text to display if not using `contentTx`.
   */
  content?: TextProps["text"]
  /**
   * Content text which is looked up via i18n.
   */
  contentTx?: TextProps["tx"]
  /**
   * Optional content options to pass to i18n. Useful for interpolation
   * as well as explicitly setting locale or translation fallbacks.
   */
  contentTxOptions?: TextProps["txOptions"]
  /**
   * Style overrides for content text.
   */
  contentStyle?: StyleProp<TextStyle>
  /**
   * Pass any additional props directly to the content Text component.
   */
  ContentTextProps?: TextProps
  /**
   * Custom content component.
   * Overrides all other `content*` props.
   */
  ContentComponent?: ReactElement
  /**
   * The footer text to display if not using `footerTx`.
   */
  footer?: TextProps["text"]
  /**
   * Footer text which is looked up via i18n.
   */
  footerTx?: TextProps["tx"]
  /**
   * Optional footer options to pass to i18n. Useful for interpolation
   * as well as explicitly setting locale or translation fallbacks.
   */
  footerTxOptions?: TextProps["txOptions"]
  /**
   * Style overrides for footer text.
   */
  footerStyle?: StyleProp<TextStyle>
  /**
   * Pass any additional props directly to the footer Text component.
   */
  FooterTextProps?: TextProps
  /**
   * Custom footer component.
   * Overrides all other `footer*` props.
   */
  FooterComponent?: ReactElement
}

/**
 * Cards are useful for displaying related information in a contained way.
 * If a ListItem displays content horizontally, a Card can be used to display content vertically.
 *
 * - [Documentation and Examples](https://github.com/infinitered/ignite/blob/master/docs/Components-Card.md)
 */
export const Card = function (props: CardProps) {  

  const backgroundColor = useThemeColor('card')
  const labelColor = useThemeColor('textDim')

  const {
    preset = "default",
    content,
    contentTx,
    contentTxOptions,
    footer,
    footerTx,
    footerTxOptions,
    label,
    labelTx,
    labelTxOptions,
    heading,
    headingTx,
    headingTxOptions,
    LabelComponent,
    ContentComponent,
    HeadingComponent,
    FooterComponent,
    LeftComponent,
    RightComponent,
    verticalAlignment = "top",
    style: $containerStyleOverride,
    contentStyle: $contentStyleOverride,
    headingStyle: $headingStyleOverride,
    footerStyle: $footerStyleOverride,
    labelStyle: $labelStyleOverride,
    ContentTextProps,
    LabelTextProps,
    HeadingTextProps,    
    FooterTextProps,
    ...WrapperProps
  } = props
  
  const isPressable = !!WrapperProps.onPress
  const isLabelPresent = !!(LabelComponent || label || labelTx)
  const isHeadingPresent = !!(HeadingComponent || heading || headingTx)
  const isContentPresent = !!(ContentComponent || content || contentTx)
  const isFooterPresent = !!(FooterComponent || footer || footerTx)

  const OuterWrapper = isLabelPresent ? View : Fragment
  const Wrapper: ComponentType<TouchableOpacityProps> = isPressable ? TouchableOpacity : View
  const HeaderContentWrapper = verticalAlignment === "force-footer-bottom" ? View : Fragment

  const $containerStyle = [$containerPresets[preset], { backgroundColor }, $containerStyleOverride]

  const $labelStyle = [ 
    $labelPresets[preset],       
    $labelStyleOverride,
    LabelTextProps?.style,
    { 
      color: labelColor,
      marginHorizontal: spacing.extraSmall,
      marginVertical: spacing.tiny,
    }
  ]

  const $headingStyle = [    
    $headingPresets[preset],
    (isFooterPresent || isContentPresent) && { marginBottom: spacing.micro },
    $headingStyleOverride,
    HeadingTextProps?.style,
  ]
  const $contentStyle = [    
    $contentPresets[preset],
    isHeadingPresent && { marginTop: spacing.small },
    isFooterPresent && { marginBottom: spacing.small },
    $contentStyleOverride,
    ContentTextProps?.style,
  ]
  const $footerStyle = [
    $footerPresets[preset],
    (isHeadingPresent || isContentPresent) && { marginTop: spacing.micro },
    $footerStyleOverride,
    FooterTextProps?.style,
  ]
  const $alignmentWrapperStyle = [
    $alignmentWrapper,
    { justifyContent: $alignmentWrapperFlexOptions[verticalAlignment] },
    LeftComponent && { marginStart: spacing.medium },
    RightComponent && { marginEnd: spacing.medium },
  ]

  return (
    <OuterWrapper>
      {LabelComponent ||
        (isLabelPresent && (
          <Text
            //weight="bold"
            text={label}
            tx={labelTx}
            txOptions={labelTxOptions}
            {...LabelTextProps}
            style={$labelStyle}
          />
        ))}
      <Wrapper
        style={$containerStyle}
        activeOpacity={0.8}
        accessibilityRole={isPressable ? "button" : undefined}
        {...WrapperProps}
      >
        {LeftComponent}

        <View style={$alignmentWrapperStyle}>
          <HeaderContentWrapper>
            {HeadingComponent ||
              (isHeadingPresent && (
                <Text
                  //weight="bold"
                  text={heading}
                  tx={headingTx}
                  txOptions={headingTxOptions}
                  {...HeadingTextProps}
                  style={$headingStyle}
                />
              ))}

            {ContentComponent ||
              (isContentPresent && (
                <Text
                  //weight="normal"
                  text={content}
                  tx={contentTx}
                  txOptions={contentTxOptions}
                  {...ContentTextProps}
                  style={$contentStyle}
                />
              ))}
          </HeaderContentWrapper>

          {FooterComponent ||
            (isFooterPresent && (
              <Text
                //weight="normal"
                size="xs"
                text={footer}
                tx={footerTx}
                txOptions={footerTxOptions}
                {...FooterTextProps}
                style={$footerStyle}
              />
            ))}
        </View>

        {RightComponent}
      </Wrapper>
    </OuterWrapper>
  )
}

const $containerBase: ViewStyle = {
  borderRadius: spacing.medium,
  paddingHorizontal: spacing.medium,
  paddingVertical: spacing.small,
 // borderWidth: 1,
  shadowColor: colors.palette.neutral600,
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.2,
  shadowRadius: 8,
  elevation: 5,
  minHeight: verticalScale(64),
  flexDirection: "row",
}

const $alignmentWrapper: ViewStyle = {
  flex: 1,
  // alignSelf: "stretch",
  alignSelf: 'center'
}

const $alignmentWrapperFlexOptions = {
  top: "flex-start",
  center: "center",
  "space-between": "space-between",
  "force-footer-bottom": "space-between",
} as const

const $containerPresets = {
  default: [
    $containerBase,
    {
      backgroundColor: colors.palette.neutral100,
      borderColor: colors.palette.neutral300,
    },
  ] as StyleProp<ViewStyle>,

  reversed: [
    $containerBase,
    { backgroundColor: colors.palette.neutral800, borderColor: colors.palette.neutral500 },
  ] as StyleProp<ViewStyle>,
}

const $labelPresets: Record<Presets, TextStyle> = {
  default: {},
  reversed: { color: colors.palette.neutral100 },
}

const $headingPresets: Record<Presets, TextStyle> = {
  default: {},
  reversed: { color: colors.palette.neutral100 },
}

const $contentPresets: Record<Presets, TextStyle> = {
  default: {},
  reversed: { color: colors.palette.neutral100 },
}

const $footerPresets: Record<Presets, TextStyle> = {
  default: {},
  reversed: { color: colors.palette.neutral100 },
}
