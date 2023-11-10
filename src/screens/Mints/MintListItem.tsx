import React, { useState } from "react"
import { ColorValue, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { observer } from "mobx-react-lite"
import { Button, Icon, ListItem, Screen, Text } from "../../components"
import { Mint, MintStatus } from "../../models/Mint"
import { MintBalance } from "../../models/Mint"
import { colors, spacing, typography, useThemeColor } from "../../theme"

export const MintListItem = observer(function(props: {  
    mint: Mint,
    mintBalance?: MintBalance,    
    onMintSelect?: any,
    isSelected?: boolean,
    isSelectable: boolean
    isBlocked?: boolean
    separator: 'bottom' | 'top' |  'both' | undefined 
  }) {    
    
    const iconSelectedColor = useThemeColor('button')
    const iconColor = useThemeColor('textDim')
    const iconBlockedColor = colors.palette.angry500
  
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
              RightComponent={props.mintBalance && <Text text={`${props.mintBalance?.balance}`} style={{alignSelf: 'center', marginRight: spacing.medium}}/>}            
              style={{paddingHorizontal: spacing.small}}
              containerStyle={{alignSelf: 'stretch'}}
              bottomSeparator={props.separator === 'bottom' || props.separator === 'both'}
              topSeparator={props.separator === 'top' || props.separator === 'both'}
          />
    )})