import { verticalScale } from '@gocodingnow/rn-size-matters'
import {Dimensions} from 'react-native'

/**
  Use these spacings for margins/paddings and other whitespace throughout your app.
 */
export const spacing = {
  micro: 2,
  tiny: 4,
  extraSmall: verticalScale(8),
  small: verticalScale(12),
  medium: verticalScale(16),
  large: verticalScale(24),
  extraLarge: verticalScale(32),
  huge: verticalScale(48),
  massive: verticalScale(64),
  screenWidth: Dimensions.get('window').width,
  screenHeight: Dimensions.get('window').height,
} as const

export type Spacing = keyof typeof spacing
