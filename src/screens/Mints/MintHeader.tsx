import React, { useState } from "react"
import { TouchableOpacity } from "react-native"
import { Header, Text } from "../../components"
import { spacing, useThemeColor } from "../../theme"
import { Mint } from "../../models/Mint"
import { MintUnit } from "../../services/wallet/currency"
import { CurrencySign } from "../Wallet/CurrencySign"
import { CurrencyAmount } from "../Wallet/CurrencyAmount"
import { observer } from "mobx-react-lite"
import { StackNavigationProp } from "@react-navigation/stack"
import { moderateScale } from "@gocodingnow/rn-size-matters"
import { useNavigation } from "@react-navigation/native"

export const MintHeader = observer(function(props: {
    unit: MintUnit,
    mint?: Mint
    hideBalance?: boolean
    onBackPress?: () => void
    backgroundColor?: string
    textColor?: string
    leftIconColor?: string
}
) {
    const navigation = useNavigation()
    const {mint, unit, hideBalance, onBackPress, backgroundColor, textColor, leftIconColor} = props
    const [isBalanceHidden, setIsBalanceHidden] = useState(false)

    const tabWidth = moderateScale(80)
    const headerTitle = useThemeColor('headerTitle')

    const resolvedTextColor = textColor || 'white'

    return (
        <Header
            backgroundColor={backgroundColor}
            leftIconColor={leftIconColor}
            TitleActionComponent={
                <>
                    {mint && (<Text
                        text={mint && mint.shortname}
                        style={{color: textColor || headerTitle}}
                        size='xxs'
                    />)}
                    <CurrencySign
                        mintUnit={unit}
                        textStyle={{color: resolvedTextColor}}
                        containerStyle={{
                            borderBottomWidth: 2,
                            paddingVertical: mint ? spacing.tiny : spacing.small,
                            borderBottomColor: resolvedTextColor,
                            width: tabWidth
                        }}
                    />
                </>
            }
            leftIcon='faArrowLeft'
            onLeftPress={() => {
                onBackPress ? onBackPress() : navigation.goBack()
            }}
            RightActionComponent={mint && unit && !hideBalance ? (
                <TouchableOpacity
                    onPress={() => setIsBalanceHidden(!isBalanceHidden)}
                    style={{marginRight: spacing.medium}}
                >
                    {isBalanceHidden ? (
                        <Text
                            text="***"
                            style={{color: resolvedTextColor}}
                            size='md'
                        />
                    ) : (
                        <CurrencyAmount
                            mintUnit={unit}
                            amount={mint?.balances?.balances[unit as MintUnit] || 0}
                            amountStyle={{color: resolvedTextColor}}
                            symbolStyle={{color: resolvedTextColor}}
                            size='medium'
                        />
                    )}
                </TouchableOpacity>
            ) : undefined}
        />
    )

})