import React from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import { Button, Header, Icon, IconTypes, ListItem, Screen, Text } from "../../components"
import { colors, spacing, typography, useThemeColor } from "../../theme"
import { Mint } from "../../models/Mint"
import { MintUnit } from "../../services/wallet/currency"
import { CurrencySign } from "../Wallet/CurrencySign"
import { CurrencyAmount } from "../Wallet/CurrencyAmount"
import { observer } from "mobx-react-lite"
import { StackNavigationProp } from "@react-navigation/stack"

export const MintHeader = observer(function(props: {
    unit: MintUnit,
    mint?: Mint,    
    navigation: StackNavigationProp<any>
  }
) {
  
    const {mint, unit, navigation} = props
  
    return (
        <Header                
            TitleActionComponent={
                <>
                    {mint && (<Text 
                        text={mint && mint.shortname} 
                        style={{color: 'white'}}
                        size='xxs'
                    />)}
                    <CurrencySign 
                        mintUnit={unit && unit}
                        textStyle={{color: 'white'}}
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