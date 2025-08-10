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

// due to Metro bundler not currently supporting tree-shaking, we take the safe routes and use "deep imports" for icons
// metro bundler tree-shaking issue: https://github.com/facebook/metro/issues/132
// relevant font-awesome docs: https://docs.fontawesome.com/apis/javascript/tree-shaking

import { faTwitter } from "@fortawesome/free-brands-svg-icons/faTwitter"
import { faTelegramPlane } from "@fortawesome/free-brands-svg-icons/faTelegramPlane"
import { faDiscord } from "@fortawesome/free-brands-svg-icons/faDiscord"
import { faGithub } from "@fortawesome/free-brands-svg-icons/faGithub"
import { faReddit } from "@fortawesome/free-brands-svg-icons/faReddit"
 
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
import { faMoneyBill1 } from '@fortawesome/free-solid-svg-icons/faMoneyBill1'
import { faGears } from '@fortawesome/free-solid-svg-icons/faGears'
import { faTag } from '@fortawesome/free-solid-svg-icons/faTag'
import { faBank } from '@fortawesome/free-solid-svg-icons/faBank'
import { faChevronDown } from '@fortawesome/free-solid-svg-icons/faChevronDown'
import { faChevronUp } from '@fortawesome/free-solid-svg-icons/faChevronUp'
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons/faCircleExclamation'
import { faCircleQuestion } from '@fortawesome/free-solid-svg-icons/faCircleQuestion'
import { faEnvelope } from '@fortawesome/free-solid-svg-icons/faEnvelope'
import { faCircleArrowUp } from "@fortawesome/free-solid-svg-icons/faCircleArrowUp"
import { faCircleArrowDown } from "@fortawesome/free-solid-svg-icons/faCircleArrowDown"
import { faGlobe } from "@fortawesome/free-solid-svg-icons/faGlobe"
import { faCubes } from "@fortawesome/free-solid-svg-icons/faCubes"
import { faClock } from "@fortawesome/free-regular-svg-icons/faClock"
import { faArrowRotateLeft } from "@fortawesome/free-solid-svg-icons/faArrowRotateLeft"
import { faHeartPulse } from "@fortawesome/free-solid-svg-icons/faHeartPulse"
import { faSeedling } from "@fortawesome/free-solid-svg-icons/faSeedling"
import { faChevronLeft } from '@fortawesome/free-solid-svg-icons/faChevronLeft'
import { faArrowRightArrowLeft } from "@fortawesome/free-solid-svg-icons"


export type IconTypes = keyof typeof iconRegistry

// TODO remove need for manual iconregistry? 
// would be best to just import all of them, i guess, or figure out something smart
export const iconRegistry = { faAddressCard, faAddressBook, faWallet, faQrcode, faClipboard, faSliders, faCoins, faEllipsisVertical, faEllipsis, faArrowUp, faArrowDown, faArrowLeft, faXmark, faInfoCircle, faBug, faCheckCircle, faArrowTurnUp, faArrowTurnDown, faPencil, faTags, faShareFromSquare, faRotate, faCode, faBan, faCircle, faPaperPlane, faBolt, faArrowUpFromBracket, faArrowRightToBracket, faPlus, faShieldHalved, faCloudArrowUp, faPaintbrush, faCopy, faBurst, faUserShield, faLock, faLockOpen, faTriangleExclamation, faDownload, faUpload, faRecycle, faListUl, faExpand, faFingerprint, faWandMagicSparkles, faCircleUser, faComment, faKey, faCircleNodes, faBullseye, faEyeSlash, faUpRightFromSquare, faShareNodes, faPaste, faKeyboard, faMoneyBill1, faGears, faTag, faBank, faChevronDown, faChevronUp, faCircleExclamation, faCircleQuestion, faEnvelope, faTwitter, faTelegramPlane, faDiscord, faGithub, faReddit, faCircleArrowUp, faCircleArrowDown, faGlobe, faCubes, faClock, faArrowRotateLeft, faHeartPulse, faSeedling, faChevronLeft, faArrowRightArrowLeft }


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
