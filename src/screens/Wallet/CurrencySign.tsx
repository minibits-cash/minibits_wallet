import React from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import { Button, Icon, IconTypes, ListItem, Screen, Text } from "../../components"
import { colors, spacing, typography, useThemeColor } from "../../theme"

export enum CurrencyCode {
    SATS = 'SATS',    
}

export const CurrencySign = function(props: {
    currencyCode: CurrencyCode,
    containerStyle?: ViewStyle,
    textStyle?: TextStyle
  }
) {
  
    const textColor = useThemeColor('header')
    const bgColor = colors.palette.primary200
  
    return (
        <View
            style={[{                
                paddingHorizontal: spacing.tiny, 
                borderRadius: spacing.tiny,
                backgroundColor: bgColor,   
            }, props.containerStyle || {}]}
        >
        <Text 
            text='₿ sats'            
            style={[{
                color: textColor,
                fontSize: 10,
                fontFamily: typography.primary?.light,
                padding: 0,
                lineHeight: 16,                             
            }, props.textStyle || {}]}
        />
        </View>
    )
  }

