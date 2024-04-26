import React from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import { SvgXml } from "react-native-svg"
import { Text } from "../../components"
import { Spacing, colors, spacing, typography, useThemeColor } from "../../theme"
import { CurrencyCode, Currencies, MintUnit, MintUnitCurrencyPairs } from "../../services/wallet/currency"
import { observer } from "mobx-react-lite"
import { verticalScale } from "@gocodingnow/rn-size-matters"


export const CurrencyAmount = observer(function (props: {
    amount?: number
    currencyCode?: CurrencyCode,
    mintUnit?: MintUnit,
    containerStyle?: ViewStyle,
    symbolStyle?: TextStyle,
    amountStyle?: TextStyle,
    size?: Spacing
  }) 
{
    const {currencyCode, mintUnit, amount, symbolStyle, amountStyle, containerStyle, size} = props
    let currencySymbol: string = Currencies.SATS?.symbol!

    if(!!currencyCode) {
        currencySymbol = Currencies[currencyCode]?.symbol!
    }

    if(!!mintUnit) {
        currencySymbol = Currencies[MintUnitCurrencyPairs[mintUnit]]?.symbol!
    }
    
    const amountColor = useThemeColor('amount')
    const symbolColor = useThemeColor('textDim')    
  
    return (
        <View
            style={[{
                // alignSelf:'center',                
                paddingHorizontal: spacing.tiny,
                // borderRadius: spacing.tiny,
                borderColor: 'red',
                borderWidth: 1,
                flexDirection: 'row',               
                // justifyContent: 'space-between',
            }, containerStyle || {}]}
        >
            <Text         
                style={[$symbol, {
                    color: symbolColor,
                    fontSize: size && spacing[size] * 0.5 || spacing.small * 0.5,
                    fontFamily: typography.primary?.light,
                    // lineHeight: size && spacing[size] * 1 || spacing.small * 1
    
                }, symbolStyle || {}]}            
                text={currencySymbol}
                size="xxs"
            />
            <Text 
                style={[$amount, {
                    color: amountColor,
                    fontSize: props.size && spacing[props.size] * 1.2 || spacing.small * 1.2,
                    lineHeight: size && spacing[size] * 1.2 || spacing.small * 1.2
                }, amountStyle || {}]} 
                text={`${amount || 0}`}                
            />
        </View>
    )
  })

  const $symbol: TextStyle = {    
    
    alignSelf: 'flex-start',
    marginRight: spacing.tiny,
    marginBottom: spacing.small,
  }

  const $amount: TextStyle = {
    // fontSize: verticalScale(20),
    fontFamily: typography.primary?.medium,    
    alignSelf: 'center',
    // marginLeft: spacing.extraSmall
  }