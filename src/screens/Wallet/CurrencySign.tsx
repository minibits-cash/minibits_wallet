import React from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import { SvgXml } from "react-native-svg"
import { BtcIcon, Text } from "../../components"
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
  
    const textColor = useThemeColor('amount')
    const bgColor = colors.palette.primary200
  
    return (
        <View
            style={[{
                alignSelf:'center',                
                paddingHorizontal: spacing.tiny,
                // borderRadius: spacing.tiny,
                // borderColor: bgColor,
                // borderWidth: 1,
                flexDirection: 'row',
                alignItems: 'center',
            }, props.containerStyle || {}]}
        >
        <SvgXml        
            width={spacing.medium}
            height={spacing.medium}
            style={{marginRight: spacing.tiny}}
            xml={BtcIcon}            
        />
        <Text 
            text={CurrencyCode.SATS}            
            style={[{
                color: textColor,
                fontSize: 10,
                fontFamily: typography.primary?.light,
                lineHeight: spacing.large
            }, props.textStyle || {}]}
        />
        </View>
    )
  }

