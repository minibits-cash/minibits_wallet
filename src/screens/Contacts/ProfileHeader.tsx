import formatDistance from "date-fns/formatDistance"
import { observer } from "mobx-react-lite"
import React from "react"
import { Image, ImageStyle, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { Button, Icon, ListItem, Screen, Text } from "../../components"
import { Contact, ContactType } from "../../models/Contact"
import { colors, spacing, typography, useThemeColor } from "../../theme"
import {MINIBITS_NIP05_DOMAIN} from '@env'


export interface ProfileHeaderProps {
  picture: string
  name: string  
}

export const ProfileHeader = observer(function (props: ProfileHeaderProps) {
  
    const { picture, name } = props
    const headerBg = useThemeColor('header')

    const getImageSource = function(img: string) {
        if(img.startsWith('http') || img.startsWith('https')) {
            return img
        } else {
            return `data:image/png;base64,${img}`
        }
    }

    return (
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
            {picture ? (
                <Image style={{width: 90, height: 96}} source={{uri: getImageSource(picture)}} />
            ) : (
                <Icon
                    icon='faCircleUser'                                
                    size={80}                    
                    color={'white'}                
                />
            )}
            <Text preset='bold' text={name+MINIBITS_NIP05_DOMAIN} style={{color: 'white', marginBottom: spacing.small}} />          
        </View>
    )
})


const $headerContainer: TextStyle = {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.medium,
    height: spacing.screenHeight * 0.18,
}
  
