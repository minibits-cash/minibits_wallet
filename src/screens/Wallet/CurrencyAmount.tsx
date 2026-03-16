import React from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import { Text } from "../../components"
import { Spacing, spacing, typography, useThemeColor } from "../../theme"
import { CurrencyCode, Currencies, MintUnit, getCurrency, formatCurrency } from "../../services/wallet/currency"
import { observer } from "mobx-react-lite"
import { formatNumber } from "../../utils/number"


export const CurrencyAmount = observer(function (props: {
    amount: number
    currencyCode?: CurrencyCode | null,
    mintUnit?: MintUnit,
    containerStyle?: ViewStyle,
    symbolStyle?: TextStyle,
    amountStyle?: TextStyle | TextStyle[],
    size?: Spacing
  }) 
{
    const {currencyCode, mintUnit, amount, symbolStyle, amountStyle, containerStyle, size} = props
    let currencySymbol: string = Currencies.SAT!.symbol
    
    let currencyCode2: CurrencyCode = Currencies.SAT!.code

    if(!!currencyCode) {
        currencySymbol = Currencies[currencyCode]!.symbol    
        currencyCode2 = currencyCode
    }

    if(!!mintUnit) {
        currencySymbol = getCurrency(mintUnit).symbol        
        currencyCode2 = getCurrency(mintUnit).code
    }
    
    const amountColor = useThemeColor('amount')
    const symbolColor = useThemeColor('textDim')    
  
    return (
        <View
            style={[{                
                padding: spacing.tiny,
                flexDirection: 'row',                
            }, containerStyle || {}]}
        >
            <Text         
                style={[$symbol, {
                    color: symbolColor,
                    fontSize: size && spacing[size] * 0.7 || spacing.small * 0.7,
                    fontFamily: typography.light,
                    //lineHeight: size && spacing[size] * 0.7 || spacing.small * 0.7
    
                }, symbolStyle || {}]}            
                text={currencySymbol}
                //size="xxs"
            />
            <Text 
                style={[$amount, {
                    color: amountColor,
                    fontSize: props.size && spacing[props.size] * 1.3 || spacing.small * 1.3,
                    lineHeight: size && spacing[size] * 1.31 || spacing.small * 1.31,
                    //borderColor: 'red',
                    //borderWidth: 1,
                    //paddingTop: size && spacing[size] * 0.2 || spacing.small * 0.2,
                }, amountStyle || {}]} 
                text={`${(formatCurrency(amount, currencyCode2))}`}               
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
    fontFamily: typography.fonts?.hammersmithOne.normal,    
    alignSelf: 'center',
    // marginLeft: spacing.extraSmall
  }