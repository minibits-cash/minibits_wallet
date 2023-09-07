import formatDistance from "date-fns/formatDistance"
import { observer } from "mobx-react-lite"
import React from "react"
import { Image, TextStyle, View } from "react-native"
import { Icon, Text } from "../../components"
import { useStores } from "../../models"
import { spacing, useThemeColor } from "../../theme"
import { getImageSource } from '../../utils/utils'


export interface ProfileHeaderProps {
}

export const ProfileHeader = observer(function (props: ProfileHeaderProps) {
  
    const { walletProfileStore } = useStores()
    const { picture, nip05 } = walletProfileStore
    const headerBg = useThemeColor('header')

    return (
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
            {picture ? (
                <Image 
                    style={{
                        width: 90, 
                        height: (walletProfileStore.isOwnProfile) ? 90 : 96, 
                        borderRadius: 45,                        
                    }} 
                    source={{uri: getImageSource(picture)}} 
                />
            ) : (
                <Icon
                    icon='faCircleUser'                                
                    size={80}                    
                    color={'white'}                
                />
            )}
            <Text preset='bold' text={nip05} style={{color: 'white', marginBottom: spacing.small}} />          
        </View>
    )
})


const $headerContainer: TextStyle = {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.medium,
    height: spacing.screenHeight * 0.18,
}
  
