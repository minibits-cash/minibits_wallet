import React from "react"
import { observer } from "mobx-react-lite"
import { ListItem, Text } from "../../components"
import { Mint, MintStatus } from "../../models/Mint"
import { MintBalance } from "../../models/Mint"
import { colors, spacing, typography, useThemeColor } from "../../theme"
import { MintUnit } from "../../services"
import { TextStyle } from "react-native"

export const MintListItem = observer(function(props: {  
    mint: Mint,
    mintBalance?: MintBalance,
    mintUnits?: MintUnit[],    
    onMintSelect?: any,
    isSelected?: boolean,
    isSelectable: boolean
    isBlocked?: boolean
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
  
    return (
          <ListItem
              key={props.mint.mintUrl}
              text={props.mint.hostname || ''}
              subText={props.mint.shortname || ''}
              leftIcon={props.isSelectable ? props.isSelected ? 'faCheckCircle' : 'faCircle' : undefined}          
              leftIconColor={props.isSelected ? iconSelectedColor as string : iconColor as string}
              rightIcon={props.isBlocked ? 'faShieldHalved' : props.mint.status === MintStatus.OFFLINE ? 'faTriangleExclamation' : undefined}
              rightIconColor={props.isBlocked ? iconBlockedColor : iconColor as string}          
              onPress={props.onMintSelect ? () => props.onMintSelect(props.mint, props.mintBalance) : undefined}                    
              RightComponent={props.mintBalance && <Text text={`${props.mintBalance?.balance.toLocaleString()}`} style={{alignSelf: 'center', marginRight: spacing.medium}}/>}
              BottomComponent={props.mintUnits && (<>{props.mintUnits.map(unit => <Text key={unit} text={unit.toUpperCase()} style={$mintUnit}/>)}</>)}
              style={{paddingHorizontal: spacing.tiny}}
              containerStyle={{alignSelf: 'stretch'}}
              bottomSeparator={props.separator === 'bottom' || props.separator === 'both'}
              topSeparator={props.separator === 'top' || props.separator === 'both'}
          />
    )})

