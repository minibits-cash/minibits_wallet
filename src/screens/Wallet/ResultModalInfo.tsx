import React, { useEffect } from "react"
import { View, ViewStyle } from "react-native"
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated"
import { Icon, IconTypes, Text } from "../../components"
import { spacing, useThemeColor } from "../../theme"


export const ResultModalInfo = function(props: {
    icon: IconTypes,
    iconColor: string,
    title: string,
    message: string
  }
  ) {

    const textColor = useThemeColor('textDim')

    const glowOpacity = useSharedValue(0)
    const iconScale = useSharedValue(0.8)

    useEffect(() => {
      // Delay animation start to allow modal to fully appear

      iconScale.value = withDelay(
        300,
        withSequence(
          withTiming(1.15, { duration: 400, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) })
        )
      )
    }, [])

    const iconAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: iconScale.value }],
    }))

    return (
      <View style={$bottomModal}>
        <View style={$iconContainer}>
          <Animated.View style={iconAnimatedStyle}>
            <Icon icon={props.icon} size={80} color={props.iconColor} />
          </Animated.View>
        </View>
        <Text style={{marginTop: spacing.small, textAlign: 'center'}} text={props.title} />
        <Text
            style={{color: textColor, textAlign: 'center', marginTop: spacing.small}}
            text={props.message}
        />
      </View>
    )
  }

  const $bottomModal: ViewStyle = {
    // flex:1,
    alignItems: 'center',
    paddingVertical: spacing.large,
    paddingHorizontal: spacing.small,
  }

  const $iconContainer: ViewStyle = {
    alignItems: 'center',
    justifyContent: 'center',
    width: 120,
    height: 120,
  }