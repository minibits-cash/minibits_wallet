import React, { FC, useState, useEffect } from 'react'
import { Platform, View } from 'react-native'
import { BottomModal, Icon, Text } from '../components'
import { spacing, useThemeColor } from '../theme'
import { useSafeAreaInsets } from 'react-native-safe-area-context'


type InfoModalProps = {
    message: string 
}

export const InfoModal: FC<InfoModalProps> = function ({ message }) {        

    const [isInfoVisible, setIsInfoVisible] = useState<boolean>(true)

    // needed for info to re-appear
    useEffect(() => {
        setIsInfoVisible(true)
        // setTimeout(() => setIsInfoVisible(false), 3000) //
    }, [message])


    const onClose = () => {
        setIsInfoVisible(false)
    }   

    const backgroundColor = useThemeColor('info')
    const iconColor = useThemeColor('textDim')
     const insets = useSafeAreaInsets()

    return (
        <BottomModal
            isVisible={isInfoVisible}
            onBackdropPress={() => onClose()}
            onBackButtonPress={() => onClose()}
            // style={{ marginBottom: Platform.OS === 'android' ? -(insets.top + insets.bottom) : 0 }}   
            ContentComponent={                
                <View style={{ padding: spacing.small, flexDirection: 'row', alignItems: 'center', marginRight: spacing.medium}}>
                    <Icon icon="faInfoCircle" size={spacing.large} color={iconColor} />
                    <Text style={{ marginHorizontal: spacing.extraSmall}}>{message}</Text>                                    
                </View>                
            }
        >            
        </BottomModal>        
    )
}
