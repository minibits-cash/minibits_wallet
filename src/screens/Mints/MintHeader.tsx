import React, { useState } from "react"
import { TextStyle, TouchableOpacity, ViewStyle } from "react-native"
import { Header, Text, SEGMENTED_PILL_COLOR, SEGMENTED_PILL_RADIUS } from "../../components"
import { spacing, useThemeColor } from "../../theme"
import { Mint } from "../../models/Mint"
import { MintUnit } from "../../services/wallet/currency"
import { CurrencySign } from "../Wallet/CurrencySign"
import { CurrencyAmount } from "../Wallet/CurrencyAmount"
import { observer } from "mobx-react-lite"
import { StackNavigationProp } from "@react-navigation/stack"
import { moderateScale, verticalScale } from "@gocodingnow/rn-size-matters"
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

    const isBalanceVisible = !!unit && !hideBalance

    return (
        <Header
            backgroundColor={backgroundColor}
            leftIconColor={leftIconColor}
            TitleActionComponent={
                // The pill alone. The mint name used to sit above it here, and since the
                // title block is centred as a group, the name's arrival — it is resolved
                // asynchronously, so it arrives a beat late — nudged the pill downwards
                // and broke the header's even spacing. Nothing above it now, so its
                // position no longer depends on what is known about the mint.
                <CurrencySign
                    mintUnit={unit}
                    textStyle={{color: resolvedTextColor}}
                    containerStyle={{
                        backgroundColor: SEGMENTED_PILL_COLOR,
                        borderRadius: SEGMENTED_PILL_RADIUS,
                        paddingVertical: spacing.extraSmall,
                        width: tabWidth
                    }}
                />
            }
            leftIcon='faArrowLeft'
            onLeftPress={() => {
                onBackPress ? onBackPress() : navigation.goBack()
            }}
            // Name over balance, both right-aligned. This block is present exactly when a
            // mint is, so the name cannot shift anything by appearing: it arrives with the
            // block or not at all.
            RightActionComponent={mint ? (
                <TouchableOpacity
                    onPress={() => setIsBalanceHidden(!isBalanceHidden)}
                    disabled={!isBalanceVisible}
                    style={$mintBlock}
                >
                    <Text
                        text={mint.shortname}
                        numberOfLines={1}
                        ellipsizeMode='tail'
                        style={[$mintName, {color: textColor || headerTitle}]}
                        size='xxs'
                    />
                    {isBalanceVisible && (
                        isBalanceHidden ? (
                            <Text
                                text="***"
                                style={[$hiddenBalance, {color: resolvedTextColor}]}
                                size='md'
                            />
                        ) : (
                            <CurrencyAmount
                                mintUnit={unit}
                                amount={mint?.balances?.balances[unit as MintUnit] || 0}
                                amountStyle={{color: resolvedTextColor}}
                                symbolStyle={{color: resolvedTextColor}}
                                size='medium'
                                // CurrencyAmount pads itself on all four sides, which here
                                // only pushes the balance away from the name above it. The
                                // sides are still wanted — $mintName aligns to them.
                                containerStyle={{paddingTop: 0}}
                            />
                        )
                    )}
                </TouchableOpacity>
            ) : undefined}
        />
    )

})

const $mintBlock: ViewStyle = {
    marginRight: spacing.medium,
    alignItems: 'flex-end',
}

// The balance digits sit spacing.tiny in from the block's right edge (CurrencyAmount pads
// itself), so the masked stand-in has to as well or the column jumps on toggle.
const $hiddenBalance: TextStyle = {
    paddingRight: spacing.tiny,
}

const $mintName: TextStyle = {
    // Bounded so a long mint name cannot grow this block across the centred pill, which is
    // absolutely positioned and would simply be overlapped. Past this, numberOfLines
    // ellipsises it.
    maxWidth: spacing.screenWidth * 0.28,
    // Matches CurrencyAmount's own padding, so the name's right edge lines up with the
    // balance digits rather than hanging a few pixels past them.
    paddingRight: spacing.tiny,
    // The xxs preset's line box is half again as tall as its text, and the empty half
    // below the name is spacing the two lines apart. Set to the font's own line height:
    // tight enough to close the gap, loose enough that a descender is not clipped.
    lineHeight: verticalScale(14),
}
