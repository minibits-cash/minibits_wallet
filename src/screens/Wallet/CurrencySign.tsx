import React from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import { SvgXml } from "react-native-svg"
import { Text } from "../../components"
import { colors, spacing, typography, useThemeColor } from "../../theme"
import { CurrencyCode, Currencies } from "../../services/wallet/currency"


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
                // alignSelf:'center',                
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
            xml={Currencies[props.currencyCode]?.icon || null}            
        />
        <Text 
            text={Currencies[props.currencyCode]?.code}            
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

