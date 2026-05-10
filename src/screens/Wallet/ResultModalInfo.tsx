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

    const contentOpacity = useSharedValue(0)
    const iconScale = useSharedValue(0.8)

    useEffect(() => {
      contentOpacity.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.ease) })
      iconScale.value = withDelay(
        150,
        withSequence(
          withTiming(1.15, { duration: 350, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 250, easing: Easing.inOut(Easing.ease) })
        )
      )
    }, [])

    const containerAnimatedStyle = useAnimatedStyle(() => ({
      opacity: contentOpacity.value,
    }))

    const iconAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: iconScale.value }],
    }))

    return (
      <Animated.View style={[$bottomModal, containerAnimatedStyle]}>
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
      </Animated.View>
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