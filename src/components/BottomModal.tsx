import React, { ComponentType, Fragment, ReactElement } from "react"
import Modal from 'react-native-modal'
import {
  StyleProp,
  TextStyle,
  ViewProps,
  View,
  ViewStyle,
  ColorValue,  
} from "react-native"
import { colors, useThemeColor, spacing } from "../theme"
import { Text, TextProps } from "./Text"


interface ModalProps extends ViewProps {
  isVisible?: boolean
  top?: number
  onBackdropPress?: any
  onBackButtonPress?: any
  backdropOpacity?: number  
  /**
   * The heading text to display if not using `headingTx`.
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
 * Modal
 */
export function BottomModal(props: ModalProps) {    
  
  // TODO based on number of childs
  const defaultTop = spacing.screenHeight * 0.8

  const {
    isVisible = true,
    top = defaultTop,
    onBackdropPress,
    onBackButtonPress,
    backdropOpacity = 0.1,   
    content,
    contentTx,
    contentTxOptions,
    footer,
    footerTx,
    footerTxOptions,
    heading,
    headingTx,
    headingTxOptions,
    ContentComponent,
    HeadingComponent,
    FooterComponent,
    style: $containerStyleOverride,    
    contentStyle: $contentStyleOverride,
    headingStyle: $headingStyleOverride,
    footerStyle: $footerStyleOverride,
    ContentTextProps,
    HeadingTextProps,
    FooterTextProps,
    ...otherProps
  } = props

  const $innerContainerStyle = [    
    $innerContainerBase, { backgroundColor: useThemeColor('card') }, $containerStyleOverride   
  ]
  
  const isHeadingPresent = !!(HeadingComponent || heading || headingTx)
  const isContentPresent = !!(ContentComponent || content || contentTx)
  const isFooterPresent = !!(FooterComponent || footer || footerTx)
 
  const $headingStyle = [    
    (isFooterPresent || isContentPresent) && { marginBottom: spacing.micro },
    $headingStyleOverride,
    HeadingTextProps?.style,
  ]
  const $contentStyle = [    
    isHeadingPresent && { marginTop: spacing.micro },
    isFooterPresent && { marginBottom: spacing.micro },
    $contentStyleOverride,
    ContentTextProps?.style,
  ]
  const $footerStyle = [    
    (isHeadingPresent || isContentPresent) && { marginTop: spacing.micro },
    $footerStyleOverride,
    FooterTextProps?.style,
  ]


  return (
    <Modal      
      isVisible={isVisible}
      // avoidKeyboard={true}     
      onBackdropPress={onBackdropPress}
      onBackButtonPress={onBackButtonPress}
      backdropOpacity={backdropOpacity}
      style={[$outerContainerBase, { top }]}      
      {...otherProps}
    >     

      <View style={[$innerContainerBase, $innerContainerStyle]}>        
          {HeadingComponent ||
            (isHeadingPresent && (
              <Text
                weight="bold"
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
                weight="normal"
                text={content}
                tx={contentTx}
                txOptions={contentTxOptions}
                {...ContentTextProps}
                style={$contentStyle}
              />
            ))}
        

        {FooterComponent ||
          (isFooterPresent && (
            <Text
              weight="normal"
              size="xs"
              text={footer}
              tx={footerTx}
              txOptions={footerTxOptions}
              {...FooterTextProps}
              style={$footerStyle}
            />
          ))}
      </View>      
    </Modal>
  )
}

const $outerContainerBase: ViewStyle = {    
  margin: 0,    
  bottom: 0,
  borderTopLeftRadius: spacing.large,
  borderTopRightRadius: spacing.large,  
  shadowColor: colors.palette.neutral900,
  //shadowOffset: { width: 10, height: -50 },
  shadowOpacity: 1,
  shadowRadius: 10,
  elevation: 10,    
}

const $innerContainerBase: ViewStyle = {
  flex: 1,
  borderTopLeftRadius: spacing.large,
  borderTopRightRadius: spacing.large,  
}


