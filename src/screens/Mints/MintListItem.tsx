import React from "react"
import { observer } from "mobx-react-lite"
import { ListItem, Text } from "../../components"
import { Mint, MintStatus } from "../../models/Mint"
import { MintBalance } from "../../models/Mint"
import { colors, spacing, typography, useThemeColor } from "../../theme"
import { TextStyle, ViewStyle } from "react-native"
import { CurrencySign } from "../Wallet/CurrencySign"
import { MintUnit } from "../../services/wallet/currency"
import { log } from "../../services"
import { CurrencyAmount } from "../Wallet/CurrencyAmount"

export const MintListItem = observer(function(props: {
    mint: Mint,
    mintBalance?: MintBalance,
    selectedUnit?: MintUnit,
    onMintSelect?: any,
    isSelected?: boolean,
    isSelectable: boolean,
    isBlocked?: boolean,
    /**
     * The mint cannot serve the operation being offered (e.g. it does not support
     * this payment method for this unit). The row stays visible but is inert and
     * dimmed, and `disabledReason` says why — hiding it instead would leave the
     * user wondering where their mint went.
     *
     * Distinct from `isBlocked`, which flags a user-blocked mint and only changes
     * the right icon.
     */
    isDisabled?: boolean,
    disabledReason?: string,
    isUnitVisible?: boolean,
    separator?: 'bottom' | 'top' |  'both'
    style?: ViewStyle
  }) {

    const iconSelectedColor = useThemeColor('mainButtonIcon')
    const iconColor = useThemeColor('textDim')
    const iconBlockedColor = colors.palette.angry500

    const $mintUnit: TextStyle = {
      color: iconColor,
      fontSize: 10,
      fontFamily: typography.primary?.light,
      padding: 0,
      lineHeight: 16,
      margin: spacing.extraSmall                             
    }

    const {mint, mintBalance, selectedUnit, onMintSelect, isSelected, isSelectable, isBlocked, isDisabled, disabledReason, isUnitVisible, separator, style} = props

    // log.trace('[MintListItem]', props)

    return (
          <ListItem
              key={mint.mintUrl}
              text={mint.shortname}
              // Keep the name (and the line below it) to a single line, truncating with
              // an ellipsis — long mint names would otherwise wrap and push the row's
              // height around, which is very visible in a list of them. Passing an
              // ellipsize mode is what makes ListItem apply numberOfLines={1}; the
              // same pairing TransactionListItem uses.
              textStyle={$oneLine}
              textEllipsizeMode='tail'
              // when disabled, the reason replaces the hostname: it is the one thing
              // the user needs to read on this row
              subText={isDisabled && disabledReason ? disabledReason : mint.hostname}
              subTextEllipsizeMode='tail'
              leftIcon={isSelectable ? isSelected ? 'faCheckCircle' : 'faCircle' : undefined}
              leftIconColor={isSelected ? iconSelectedColor as string : iconColor as string}
              rightIcon={isBlocked ? 'faShieldHalved' : mint.status === MintStatus.OFFLINE ? 'faTriangleExclamation' : undefined}
              rightIconColor={isBlocked ? iconBlockedColor : iconColor as string}
              onPress={isDisabled ? undefined : onMintSelect ? () => onMintSelect(mint, mintBalance) : undefined}
              RightComponent={mintBalance && selectedUnit &&
                <CurrencyAmount
                      amount={mintBalance?.balances[selectedUnit] || 0}
                      mintUnit={selectedUnit}
                      size='medium'
                />
              }
              BottomComponent={isUnitVisible && mint.units ? (<>{mint.units.map(unit => <CurrencySign containerStyle={{paddingLeft: 0, marginRight: spacing.small}} key={unit} mintUnit={unit}/>)}</>) : undefined}
              containerStyle={{alignSelf: 'stretch'}}
              bottomSeparator={separator === 'bottom' || separator === 'both'}
              topSeparator={separator === 'top' || separator === 'both'}
              style={[{paddingHorizontal: spacing.tiny}, isDisabled ? $disabled : null, style]}
          />
    )})

/** Truncate rather than wrap, so every row keeps the same height. */
const $oneLine: TextStyle = {
  overflow: 'hidden',
}

/** Dim an unusable mint without hiding it. */
const $disabled: ViewStyle = {
  opacity: 0.45,
}

