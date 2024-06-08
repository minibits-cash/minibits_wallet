import { observer } from "mobx-react-lite"
import React from "react"
import { Image, TextStyle, View } from "react-native"
import { Icon, Text } from "."
import { spacing, useThemeColor } from "../theme"
import { getImageSource } from '../utils/utils'
import { iconRegistry } from '.'


export interface ProfileHeaderProps {
  heading?: string,
  text?: string,
  picture?: string
  /** default is 96 for pic, 80 for icon - another option is 90 or 80 */
  pictureHeight?: number,
  fallbackIcon?: keyof typeof iconRegistry
  headerBgColor?: string
}

export const AvatarHeader = observer(function (props: ProfileHeaderProps) {
  const headerBg = useThemeColor('header')

  return (
    <View style={[$headerContainer, { backgroundColor: props.headerBgColor || headerBg }]}>
      {props.picture ? (
        <Image
          style={{
            width: 90,
            height: props.pictureHeight ?? 96,
            borderRadius: 45,
          }}
          source={{ uri: getImageSource(props.picture) }}
        />
      ) : (
        <Icon
          icon={props.fallbackIcon ?? 'faCircleUser'}
          size={props.pictureHeight ?? 80}
          color='white'
        />
      )}
      {props.heading && <Text style={{ fontSize: 24, lineHeight: 32 }} text={props.heading} />}
      {props.text && <Text preset='bold' text={props.text} style={{ color: 'white', marginBottom: spacing.small }} />}
    </View>
  )
})


const $headerContainer: TextStyle = {
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingHorizontal: spacing.medium,
  height: spacing.screenHeight * 0.20,
}