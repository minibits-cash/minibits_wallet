import { observer } from "mobx-react-lite"
import React from "react"
import { ColorValue, Image, ImageStyle, TextStyle, View, ViewStyle } from "react-native"
import { Icon, Text } from "."
import { spacing, useThemeColor } from "../theme"
import { getImageSource } from '../utils/utils'
import { iconRegistry } from '.'


export interface ProfileHeaderProps {
  heading?: string,
  text?: string,
  picture?: string
  /** default is 96 for pic, 48 for icon - another option is 90 or 80 */
  pictureHeight?: number,
  /** @default 0.2 */
  headerHeightModifier?: number,
  fallbackIcon?: keyof typeof iconRegistry
  headerBgColor?: string
  encircle?: boolean
}

export const AvatarHeader = observer(function (props: ProfileHeaderProps) {
  const headerBg = useThemeColor('header')
  const textDim = useThemeColor('textDim')

  return (
    <View style={[$headerContainer(props.headerHeightModifier ?? 0.2), { backgroundColor: props.headerBgColor || headerBg }]}>
      {props.picture ? (
        <Image
          style={{
            width: 90,
            height: props.pictureHeight ?? 96,
            borderRadius: 100,
          }}
          source={{ uri: getImageSource(props.picture) }}
        />
      ) : (
        <View style={(props?.encircle ?? true) ? $encircledIcon(textDim) : {}}>
          <Icon
            icon={props?.fallbackIcon ?? 'faCircleUser'}
            size={props?.pictureHeight ?? 48}
            color='white'
          />
        </View> 
      )}
      {props.heading && <Text style={{ fontSize: 26, lineHeight: 40 }} text={props.heading} adjustsFontSizeToFit={true} numberOfLines={1} />}
      {props.text && <Text preset='bold' text={props.text} style={{ color: 'white', marginBottom: spacing.small }} />}
    </View>
  )
})


const $headerContainer = (heightModifier: number) => ({
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingHorizontal: spacing.medium,
  height: spacing.screenHeight * heightModifier,
} satisfies TextStyle)

const $encircledIcon = (borderColor: ColorValue) => ({
  padding: spacing.small,
  borderWidth: 2,
  borderColor: borderColor,
  borderRadius: 100
})