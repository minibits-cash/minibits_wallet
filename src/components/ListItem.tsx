import { verticalScale } from "@gocodingnow/rn-size-matters"
import { ReactElement } from "react"
import { ColorValue, useColorScheme } from "react-native"
import {
  StyleProp,
  TextStyle,
  TouchableOpacity,
  TouchableOpacityProps,
  View,
  ViewStyle,
} from "react-native"
import { useThemeColor, spacing } from "../theme"
import { Icon, IconTypes } from "./Icon"
import { Text, TextProps } from "./Text"

export interface ListItemProps extends TouchableOpacityProps {
  /**
   * How tall the list item should be.
   * Default: 56
   */
  height?: number
  /**
   * Whether to show the top separator.
   * Default: false
   */
  topSeparator?: boolean
  /**
   * Whether to show the bottom separator.
   * Default: false
   */
  bottomSeparator?: boolean
  /**
   * Text to display if not using `tx` or nested components.
   */
  text?: TextProps["text"]
  /**
   * Text which is looked up via i18n.
   */
  tx?: TextProps["tx"]
  /**
   * Sub text to display if not using `tx` or nested components.
   */
  subText?: TextProps["text"]
  /**
   * Sub text which is looked up via i18n.
   */
  subTx?: TextProps["tx"]
  /**
   * Children components.
   */
  children?: TextProps["children"]
  /**
   * Optional options to pass to i18n. Useful for interpolation
   * as well as explicitly setting locale or translation fallbacks.
   */
  txOptions?: TextProps["txOptions"]
  /**
   * Optional text style override.
   */
  textStyle?: StyleProp<TextStyle>
  /**
   * Pass any additional props directly to the Text component.
   */
  TextProps?: TextProps
  /**
   * Optional View container style override.
   */
  containerStyle?: StyleProp<ViewStyle>
  /**
   * Optional TouchableOpacity style override.
   */
  style?: StyleProp<ViewStyle>
  /**
   * Icon that should appear on the left.
   */
  leftIcon?: IconTypes
  /**
   * An optional tint color for the left icon
   */
  leftIconColor?: string
  leftIconTransform?: string 
  leftIconInverse?: boolean 
  /**
   * Icon that should appear on the right.
   */
  rightIcon?: IconTypes
  /**
   * An optional tint color for the right icon
   */
  rightIconColor?: string
  rightIconTransform?: string
  rightIconInverse?: boolean 
  /**
   * Right action custom ReactElement.
   * Overrides `rightIcon`.
   */
  RightComponent?: ReactElement
  /**
   * Left action custom ReactElement.
   * Overrides `leftIcon`.
   */
  LeftComponent?: ReactElement
  /**
   * Bottom ReactElement.
   * 
   */
  BottomComponent?: ReactElement
}

interface ListItemActionProps {
  icon: IconTypes | undefined
  iconColor?: ColorValue
  iconTransform?: string
  iconInverse?: boolean
  Component?: ReactElement
  size: number
  side: "left" | "right"
}

/**
 * A styled row component that can be used in FlatList, SectionList, or by itself.
 *
 * - [Documentation and Examples](https://github.com/infinitered/ignite/blob/master/docs/Components-ListItem.md)
 */
export const ListItem = function (props: ListItemProps) {
  const colorScheme = useColorScheme()  

  const {
    bottomSeparator,
    children,
    height = verticalScale(56),
    LeftComponent,
    leftIcon,
    leftIconColor = useThemeColor('textDim'),
    leftIconTransform,
    leftIconInverse = false,
    RightComponent,
    rightIcon,
    rightIconColor = useThemeColor('textDim'),
    rightIconTransform,
    rightIconInverse = false,
    BottomComponent,
    style,
    text,
    subText,
    TextProps,
    topSeparator,
    tx,
    subTx,
    txOptions,
    textStyle: $textStyleOverride,
    containerStyle: $containerStyleOverride,
    ...TouchableOpacityProps
  } = props

  const $textStyles = [$textStyle, $textStyleOverride, TextProps?.style]
  
  const separatorColor = useThemeColor('separator')
  const subTextColor = useThemeColor('textDim')

  const $subTextStyles = [$subTextStyle, TextProps?.style]

  const $containerStyles = [
    topSeparator && $separatorTop, { borderTopColor: separatorColor },
    bottomSeparator && $separatorBottom, { borderBottomColor: separatorColor },
    $containerStyleOverride,
  ]

  const $touchableStyles = [$touchableStyle, { minHeight: height }, style]

  return (
    <View style={$containerStyles}>
      <TouchableOpacity {...TouchableOpacityProps} style={$touchableStyles}>
        <ListItemAction
          side="left"
          size={height}
          icon={leftIcon}
          iconColor={leftIconColor}
          iconTransform={leftIconTransform}
          iconInverse={leftIconInverse}
          Component={LeftComponent}          
        />
        <View style={$subTextContainer}>
          <>
        {(subText || subTx) ? (
          <>
            <Text {...TextProps} tx={tx} text={text} txOptions={txOptions} style={$textStyles}>
              {children}
            </Text>
            <Text {...TextProps} size="xs" tx={subTx} text={subText} txOptions={txOptions} style={[$subTextStyles, {color: subTextColor}]}>              
            </Text>
          </>
        ) : (
          <Text {...TextProps} tx={tx} text={text} txOptions={txOptions} style={$textStyles}>
            {children}
          </Text>  
        )}
        {(BottomComponent) && (
          <View style={$bottomComponentContainer}>
            {BottomComponent}
          </View>
        )} 
        </> 
        </View>
        <ListItemAction
          side="right"
          size={height}
          icon={rightIcon}
          iconColor={rightIconColor}
          iconTransform={rightIconTransform}
          iconInverse={rightIconInverse}
          Component={RightComponent}
        />
      </TouchableOpacity>
    </View>
  )
}

function ListItemAction(props: ListItemActionProps) {
  const { icon, Component, iconColor, iconTransform, iconInverse, size, side } = props  

  if (Component) return (
    <View style={$componentContainer}>
    {Component}
    </View>
  )

  if (icon) {
    return (
      <Icon
        size={spacing.medium}
        icon={icon}
        color={iconColor}
        transform={iconTransform}
        inverse={iconInverse}
        containerStyle={[            
          $iconContainer,
          side === "left" && $iconContainerLeft,
          side === "right" && $iconContainerRight,
          iconInverse === true && {marginRight: spacing.medium},
          { height: size },
        ]}
      />
    )
  }

  return null
}

const $separatorTop: ViewStyle = {
  borderTopWidth: 1,  
}

const $separatorBottom: ViewStyle = {
  borderBottomWidth: 1,  
}

const $textStyle: TextStyle = {
  // alignSelf: 'flex-start',
  paddingVertical: spacing.extraSmall,
  // alignSelf: "center",
  textAlignVertical: 'center',
  flexGrow: 1,
  flexShrink: 1,
}

const $subTextContainer: ViewStyle = {  
  flex: 1,
  flexDirection: 'column',  
  // borderColor: 'red',
  // borderWidth: 1,
}

const $subTextStyle: TextStyle = {
  flexGrow: 1,
  flexShrink: 1,  
  paddingBottom: spacing.extraSmall,
}

const $touchableStyle: ViewStyle = {
  flexDirection: "row",
  alignItems: "flex-start",  
}

const $componentContainer: ViewStyle = {
    flex: 0,
    alignSelf: 'center',      
}

const $bottomComponentContainer: ViewStyle = {
  flex: 0,
  flexDirection: 'row',
  paddingBottom: spacing.extraSmall,
}

const $iconContainer: ViewStyle = {
  flex: 0,
  alignSelf: 'center',  
  maxHeight: spacing.medium + spacing.extraSmall * 2,  
}

const $iconContainerLeft: ViewStyle = {
  marginEnd: spacing.small,
}

const $iconContainerRight: ViewStyle = {
  marginStart: spacing.small,
}
