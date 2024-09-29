import React from "react"
import { Header, Text } from "../../components"
import { spacing, useThemeColor } from "../../theme"
import { Mint } from "../../models/Mint"
import { MintUnit } from "../../services/wallet/currency"
import { CurrencySign } from "../Wallet/CurrencySign"
import { CurrencyAmount } from "../Wallet/CurrencyAmount"
import { observer } from "mobx-react-lite"
import { StackNavigationProp } from "@react-navigation/stack"
import { moderateScale } from "@gocodingnow/rn-size-matters"

export const MintHeader = observer(function(props: {
    unit: MintUnit,
    mint?: Mint,    
    navigation: StackNavigationProp<any>
  }
) {
  
    const {mint, unit, navigation} = props

    const getActiveUnitColor = () => {
        /* switch (props.unit) {
            case 'usd':
                return useThemeColor('usd')              
            case 'eur':
                return useThemeColor('eur')                 
            default:
                return useThemeColor('btc') 
          } */

          return useThemeColor('headerTitle') 
          
    }

    const tabWidth = moderateScale(80)
    const headerTitle = useThemeColor('headerTitle')
  
    return (
        <Header                
            TitleActionComponent={
                <>
                    {mint && (<Text 
                        text={mint && mint.shortname} 
                        style={{color: headerTitle}}
                        size='xxs'
                    />)}
                    <CurrencySign 
                        mintUnit={unit && unit}
                        textStyle={{color: 'white'}}
                        containerStyle={{
                            borderBottomWidth: 2, 
                            paddingVertical: mint ? spacing.tiny : spacing.small,                            
                            borderBottomColor: getActiveUnitColor(),
                            width: tabWidth
                        }}
                    />
                </>
            }
            leftIcon='faArrowLeft'
            onLeftPress={() => navigation.goBack()}                
            RightActionComponent={mint && unit ? (
                <CurrencyAmount 
                    mintUnit={unit}
                    amount={mint?.balances?.balances[unit as MintUnit] || 0}
                    amountStyle={{color: 'white'}}
                    symbolStyle={{color: 'white'}}
                    containerStyle={{marginRight: spacing.medium}}
                    size='medium'
                />
            ) : undefined}
        />
    )

})