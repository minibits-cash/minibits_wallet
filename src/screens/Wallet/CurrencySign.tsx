import React from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import { SvgXml } from "react-native-svg"
import { Text } from "../../components"
import { Spacing, colors, spacing, typography, useThemeColor } from "../../theme"
import { CurrencyCode, Currencies, MintUnit, getCurrency } from "../../services/wallet/currency"


export const CurrencySign = function(props: {
    currencyCode?: CurrencyCode,
    mintUnit?: MintUnit,
    containerStyle?: ViewStyle,
    textStyle?: TextStyle
    size?: Spacing
  }
) {
    const {currencyCode, mintUnit, containerStyle, textStyle, size} = props
    let code = currencyCode || CurrencyCode.SAT

    if(!!mintUnit) {
        code = getCurrency(mintUnit).code
    }
  
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
                justifyContent: 'center',
            }, containerStyle || {}]}
        >
        <SvgXml        
            width={size && spacing[size] * 1.5 || spacing.small * 1.5}
            height={size && spacing[size] * 1.5 || spacing.small * 1.5}
            style={{marginRight: spacing.tiny}}
            xml={Currencies[code]?.icon || null}            
        />
        <Text 
            text={Currencies[code]?.code}            
            style={[{
                color: textColor,
                fontSize: props.size && spacing[props.size] || spacing.small,
                fontFamily: typography.primary?.light,
                lineHeight: props.size && spacing[props.size] * 1.5 || spacing.small * 1.5

            }, textStyle || {}]}
        />
        </View>
    )
  }

