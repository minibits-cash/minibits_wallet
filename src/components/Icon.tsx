import * as React from "react"
import { ComponentType } from "react"
import {
  ColorValue,
  Image,
  ImageStyle,
  StyleProp,
  TouchableOpacity,
  TouchableOpacityProps,
  View,
  ViewStyle,
} from "react-native"
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome'
import { colors, spacing, useThemeColor } from "../theme"
import { IconDefinition, Transform } from "@fortawesome/fontawesome-svg-core"

import {
  faAddressBook,
  faAddressCard,
  faArrowDown,
  faArrowLeft,
  faArrowRightToBracket,
  faArrowTurnDown,
  faArrowTurnUp,
  faArrowUp,
  faArrowUpFromBracket,
  faBan,
  faBolt,
  faBug,
  faBullseye,
  faBurst,
  faCheckCircle,
  faCircle,
  faCircleNodes,
  faCircleUser,
  faClipboard,
  faCloudArrowUp,
  faCode,
  faCoins,
  faComment,
  faCopy,
  faDownload,
  faEllipsis,
  faEllipsisVertical,
  faExpand,
  faEyeSlash,
  faFingerprint,
  faGears,
  faInfoCircle,
  faKey,
  faKeyboard, 
  faListUl,
  faLock,
  faLockOpen,
  faMoneyBill1, 
  faPaintbrush,
  faPaperPlane,
  faPaste, 
  faPencil,
  faPlus,
  faQrcode,
  faRecycle,
  faRotate,
  faShareFromSquare,
  faShareNodes,
  faShieldHalved,
  faSliders,
  faTags,
  faTriangleExclamation,
  faUpload,
  faUpRightFromSquare,
  faUserShield,
  faWallet,
  faWandMagicSparkles,
  faXmark,
  faTag,
} from '@fortawesome/free-solid-svg-icons'


export type IconTypes = keyof typeof iconRegistry

// TODO remove need for manual iconregistry? 
// would be best to just import all of them, i guess, or figure out something smart
export const iconRegistry = { faAddressCard, faAddressBook, faWallet, faQrcode, faClipboard, faSliders, faCoins, faEllipsisVertical, faEllipsis, faArrowUp, faArrowDown, faArrowLeft, faXmark, faInfoCircle, faBug, faCheckCircle, faArrowTurnUp, faArrowTurnDown, faPencil, faTags, faShareFromSquare, faRotate, faCode, faBan, faCircle, faPaperPlane, faBolt, faArrowUpFromBracket, faArrowRightToBracket, faPlus, faShieldHalved, faCloudArrowUp, faPaintbrush, faCopy, faBurst, faUserShield, faLock, faLockOpen, faTriangleExclamation, faDownload, faUpload, faRecycle, faListUl, faExpand, faFingerprint, faWandMagicSparkles, faCircleUser, faComment, faKey, faCircleNodes, faBullseye, faEyeSlash, faUpRightFromSquare, faShareNodes, faPaste, faKeyboard, faMoneyBill1, faGears, faTag }


interface IconProps extends TouchableOpacityProps {
  /**
   * The name of the icon
   */
  icon: IconTypes

  /**
   * An optional tint color for the icon
   */
  color?: ColorValue

  /**
   * An optional size for the icon. If not provided, the icon will be sized to the icon's resolution.
   */
  size?: number

  /**
   * An inverse style with white icon on colored rounded background.
   */
  inverse?: boolean

  /**
   * Style overrides for the icon image
   */
  style?: StyleProp<ImageStyle>

  /**
   * Style overrides for the icon container
   */
  containerStyle?: StyleProp<ViewStyle>

  /**
   * Transform style
   */
  transform?: string | Transform | undefined

  /**
   * An optional function to be called when the icon is pressed
   */
  onPress?: TouchableOpacityProps["onPress"]
}

/**
 * A component to render a registered icon.
 * It is wrapped in a <TouchableOpacity /> if `onPress` is provided, otherwise a <View />.
 *
 * - [Documentation and Examples](https://github.com/infinitered/ignite/blob/master/docs/Components-Icon.md)
 */
export function Icon(props: IconProps) {
  const {
    icon,
    color = useThemeColor('text'),
    size,
    inverse = false,
    transform,
    style: $imageStyleOverride,
    containerStyle: $containerStyleOverride,
    ...WrapperProps
  } = props

  const isPressable = !!WrapperProps.onPress
  const Wrapper: ComponentType<TouchableOpacityProps> = WrapperProps?.onPress
    ? TouchableOpacity
    : View

  return (
    <Wrapper
      accessibilityRole={isPressable ? "imagebutton" : undefined}
      {...WrapperProps}
      style={inverse ? [$inverseContainer, {backgroundColor: color}, $containerStyleOverride] : [$container, $containerStyleOverride]}
    >
      <FontAwesomeIcon 
        icon={iconRegistry[icon]}
        size={size}
        color={inverse ? 'white' : color as string}
        transform={transform}        
      />   
    </Wrapper>
  )
}



const $imageStyle: ImageStyle = {
  resizeMode: "contain",
}

const $container: ImageStyle = {    
    padding: spacing.extraSmall,    
}

const $inverseContainer: ImageStyle = {
  flex: 0,
  borderRadius: spacing.small,
  padding: spacing.extraSmall,  
}
