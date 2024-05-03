import React from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import { Text } from "../../components"
import { Spacing, spacing, typography, useThemeColor } from "../../theme"
import { CurrencyCode, Currencies, MintUnit, getCurrency } from "../../services/wallet/currency"
import { observer } from "mobx-react-lite"
import { formatNumber } from "../../utils/number"


export const CurrencyAmount = observer(function (props: {
    amount: number
    currencyCode?: CurrencyCode,
    mintUnit?: MintUnit,
    containerStyle?: ViewStyle,
    symbolStyle?: TextStyle,
    amountStyle?: TextStyle | TextStyle[],
    size?: Spacing
  }) 
{
    const {currencyCode, mintUnit, amount, symbolStyle, amountStyle, containerStyle, size} = props
    let currencySymbol: string = Currencies.SATS!.symbol
    let currencyPrecision: number = Currencies.SATS!.precision
    let currencyCode2: CurrencyCode = Currencies.SATS!.code

    if(!!currencyCode) {
        currencySymbol = Currencies[currencyCode]!.symbol
        currencyPrecision = Currencies[currencyCode]!.precision
        currencyCode2 = currencyCode
    }

    if(!!mintUnit) {
        currencySymbol = getCurrency(mintUnit).symbol
        currencyPrecision = getCurrency(mintUnit).precision
        currencyCode2 = getCurrency(mintUnit).code
    }
    
    const amountColor = useThemeColor('amount')
    const symbolColor = useThemeColor('textDim')    
  
    return (
        <View
            style={[{                
                paddingHorizontal: spacing.tiny,
                // borderColor: 'red',
                // borderWidth: 1,
                flexDirection: 'row',                
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
                text={`${(formatNumber((amount / currencyPrecision).toLocaleString(), Currencies[currencyCode2]!.mantissa))}`}                
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