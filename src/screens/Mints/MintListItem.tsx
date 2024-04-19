import React from "react"
import { observer } from "mobx-react-lite"
import { ListItem, Text } from "../../components"
import { Mint, MintStatus } from "../../models/Mint"
import { MintBalance } from "../../models/Mint"
import { colors, spacing, typography, useThemeColor } from "../../theme"
import { TextStyle } from "react-native"
import { CurrencySign } from "../Wallet/CurrencySign"
import { CurrencyCode, MintUnit, MintUnitCurrencyPairs, MintUnits } from "../../services/wallet/currency"
import { log } from "../../services"

export const MintListItem = observer(function(props: {  
    mint: Mint,
    mintBalance?: MintBalance,
    selectedUnit?: MintUnit,   
    onMintSelect?: any,
    isSelected?: boolean,
    isSelectable: boolean,
    isBlocked?: boolean,
    isUnitVisible?: boolean,
    separator: 'bottom' | 'top' |  'both' | undefined 
  }) {    
    
    const iconSelectedColor = useThemeColor('button')
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

    const {mint, mintBalance, selectedUnit, onMintSelect, isSelected, isSelectable, isBlocked, isUnitVisible, separator} = props

    log.trace('[MintListItem]', props)
  
    return (
          <ListItem
              key={mint.mintUrl}
              text={mint.hostname || ''}
              subText={mint.shortname || ''}
              leftIcon={isSelectable ? isSelected ? 'faCheckCircle' : 'faCircle' : undefined}          
              leftIconColor={isSelected ? iconSelectedColor as string : iconColor as string}
              rightIcon={isBlocked ? 'faShieldHalved' : mint.status === MintStatus.OFFLINE ? 'faTriangleExclamation' : undefined}
              rightIconColor={isBlocked ? iconBlockedColor : iconColor as string}          
              onPress={onMintSelect ? () => onMintSelect(mint, mintBalance) : undefined}                    
              RightComponent={mintBalance && selectedUnit && <Text text={`${mintBalance?.balances[selectedUnit]}`} style={{alignSelf: 'center', marginRight: spacing.medium}}/>}
              BottomComponent={isUnitVisible && mint.units ? (<>{mint.units.map(unit => <CurrencySign containerStyle={{paddingLeft: 0, marginRight: spacing.small}} key={unit} currencyCode={MintUnitCurrencyPairs[unit]}/>)}</>) : undefined}
              style={{paddingHorizontal: spacing.tiny}}
              containerStyle={{alignSelf: 'stretch'}}
              bottomSeparator={separator === 'bottom' || separator === 'both'}
              topSeparator={separator === 'top' || separator === 'both'}
          />
    )})

