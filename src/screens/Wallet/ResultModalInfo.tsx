import React from "react"
import { View, ViewStyle } from "react-native"
import { Button, Icon, IconTypes, ListItem, Screen, Text } from "../../components"
import { colors, spacing, typography, useThemeColor } from "../../theme"


export const ResultModalInfo = function(props: {
    icon: IconTypes, 
    iconColor: string,
    title: string,
    message: string
  }
  ) {
  
    const textColor = useThemeColor('textDim')
  
    return (
      <View style={$bottomModal}>                
        <Icon icon={props.icon} size={80} color={props.iconColor} />
        <Text style={{marginTop: spacing.small, textAlign: 'center'}} text={props.title} />
        <Text 
            style={{color: textColor, textAlign: 'center', marginTop: spacing.small}} 
            text={props.message} 
        />              
      </View>
    )
  }

  const $bottomModal: ViewStyle = {
    // flex:1,
    alignItems: 'center',  
    paddingVertical: spacing.large,
    paddingHorizontal: spacing.small,  
  }