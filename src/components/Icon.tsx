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


import { faWallet } from '@fortawesome/free-solid-svg-icons/faWallet'
import { faAddressCard } from '@fortawesome/free-solid-svg-icons/faAddressCard'
import { faAddressBook } from '@fortawesome/free-solid-svg-icons/faAddressBook'
import { faQrcode } from '@fortawesome/free-solid-svg-icons/faQrcode'
import { faClipboard } from '@fortawesome/free-solid-svg-icons/faClipboard'
import { faSliders } from '@fortawesome/free-solid-svg-icons/faSliders'
import { faCoins } from '@fortawesome/free-solid-svg-icons/faCoins'
import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons/faEllipsisVertical'
import { faEllipsis } from '@fortawesome/free-solid-svg-icons/faEllipsis'
import { faArrowUp } from '@fortawesome/free-solid-svg-icons/faArrowUp'
import { faArrowDown } from '@fortawesome/free-solid-svg-icons/faArrowDown'
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons/faArrowLeft'
import { faXmark } from '@fortawesome/free-solid-svg-icons/faXmark'
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons/faInfoCircle'
import { faBug } from '@fortawesome/free-solid-svg-icons/faBug'
import { faCheckCircle } from '@fortawesome/free-solid-svg-icons/faCheckCircle'
import { faArrowTurnUp } from '@fortawesome/free-solid-svg-icons/faArrowTurnUp'
import { faArrowTurnDown } from '@fortawesome/free-solid-svg-icons/faArrowTurnDown'
import { faPencil } from '@fortawesome/free-solid-svg-icons/faPencil'
import { faTags } from '@fortawesome/free-solid-svg-icons/faTags'
import { faShareFromSquare } from '@fortawesome/free-solid-svg-icons/faShareFromSquare'
import { faRotate } from '@fortawesome/free-solid-svg-icons/faRotate'
import { faCode } from '@fortawesome/free-solid-svg-icons/faCode'
import { faBan } from '@fortawesome/free-solid-svg-icons/faBan'
import { faCircle } from '@fortawesome/free-solid-svg-icons/faCircle'
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons/faPaperPlane'
import { faBolt } from '@fortawesome/free-solid-svg-icons/faBolt'
import { faArrowUpFromBracket } from '@fortawesome/free-solid-svg-icons/faArrowUpFromBracket'
import { faArrowRightToBracket } from '@fortawesome/free-solid-svg-icons/faArrowRightToBracket'
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus'
import { faShieldHalved } from '@fortawesome/free-solid-svg-icons/faShieldHalved'
import { faCloudArrowUp } from '@fortawesome/free-solid-svg-icons/faCloudArrowUp'
import { faPaintbrush } from '@fortawesome/free-solid-svg-icons/faPaintbrush'
import { faCopy } from '@fortawesome/free-solid-svg-icons/faCopy'
import { faBurst } from '@fortawesome/free-solid-svg-icons/faBurst'
import { faUserShield } from '@fortawesome/free-solid-svg-icons/faUserShield'
import { faLock } from '@fortawesome/free-solid-svg-icons/faLock'
import { faLockOpen } from '@fortawesome/free-solid-svg-icons/faLockOpen'
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons/faTriangleExclamation'
import { faDownload } from '@fortawesome/free-solid-svg-icons/faDownload'
import { faUpload } from '@fortawesome/free-solid-svg-icons/faUpload'
import { faRecycle } from '@fortawesome/free-solid-svg-icons/faRecycle'
import { faListUl } from '@fortawesome/free-solid-svg-icons/faListUl'
import { faExpand } from '@fortawesome/free-solid-svg-icons/faExpand'
import { faFingerprint } from '@fortawesome/free-solid-svg-icons/faFingerprint'
import { faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons/faWandMagicSparkles'
import { faCircleUser } from '@fortawesome/free-solid-svg-icons/faCircleUser'
import { faComment } from '@fortawesome/free-solid-svg-icons/faComment'
import { faKey } from '@fortawesome/free-solid-svg-icons/faKey'
import { faCircleNodes } from '@fortawesome/free-solid-svg-icons/faCircleNodes'
import { faBullseye } from '@fortawesome/free-solid-svg-icons/faBullseye'
import { faEyeSlash } from '@fortawesome/free-solid-svg-icons/faEyeSlash'
import { faUpRightFromSquare } from '@fortawesome/free-solid-svg-icons/faUpRightFromSquare'
import { faShareNodes } from '@fortawesome/free-solid-svg-icons/faShareNodes'
import { faPaste } from '@fortawesome/free-solid-svg-icons/faPaste'
import { faKeyboard } from '@fortawesome/free-solid-svg-icons/faKeyboard'


export type IconTypes = keyof typeof iconRegistry

export const iconRegistry = {
  faAddressCard: faAddressCard,
  faAddressBook: faAddressBook,
  faWallet: faWallet,
  faQrcode: faQrcode,
  faClipboard: faClipboard,
  faSliders: faSliders,
  faCoins: faCoins,
  faEllipsisVertical: faEllipsisVertical,
  faEllipsis: faEllipsis,
  faArrowUp: faArrowUp,
  faArrowDown: faArrowDown,
  faArrowLeft: faArrowLeft,
  faXmark: faXmark,
  faInfoCircle: faInfoCircle,
  faBug: faBug,
  faCheckCircle: faCheckCircle,
  faArrowTurnUp: faArrowTurnUp,
  faArrowTurnDown: faArrowTurnDown,
  faPencil: faPencil,
  faTags: faTags,
  faShareFromSquare: faShareFromSquare,
  faRotate: faRotate,
  faCode: faCode,
  faBan: faBan,
  faCircle: faCircle,
  faPaperPlane: faPaperPlane,
  faBolt: faBolt,
  faArrowUpFromBracket: faArrowUpFromBracket,
  faArrowRightToBracket: faArrowRightToBracket,
  faPlus: faPlus,
  faShieldHalved: faShieldHalved,
  faCloudArrowUp: faCloudArrowUp,
  faPaintbrush: faPaintbrush,
  faCopy: faCopy,
  faBurst: faBurst,
  faUserShield: faUserShield,
  faLock: faLock,
  faLockOpen: faLockOpen,
  faTriangleExclamation: faTriangleExclamation,
  faDownload: faDownload,
  faUpload: faUpload,
  faRecycle: faRecycle,
  faListUl: faListUl,
  faExpand: faExpand,
  faFingerprint: faFingerprint,
  faWandMagicSparkles: faWandMagicSparkles,
  faCircleUser: faCircleUser,
  faComment: faComment,
  faKey: faKey,
  faCircleNodes: faCircleNodes,
  faBullseye: faBullseye,
  faEyeSlash: faEyeSlash,
  faUpRightFromSquare: faUpRightFromSquare,
  faShareNodes: faShareNodes,
  faPaste: faPaste,
  faKeyboard: faKeyboard,
  }


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
