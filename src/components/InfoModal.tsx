import React, { FC, useState, useEffect } from 'react'
import { View } from 'react-native'
import { BottomModal, Icon, Text } from '../components'
import { spacing, useThemeColor } from '../theme'


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

    return (
        <BottomModal
            isVisible={isInfoVisible}
            onBackdropPress={() => onClose()}
            onBackButtonPress={() => onClose()}
            ContentComponent={                
                <View style={{ padding: spacing.small, flexDirection: 'row', alignItems: 'center', marginRight: spacing.medium}}>
                    <Icon icon="faInfoCircle" size={spacing.large} color="white" />
                    <Text style={{ marginHorizontal: spacing.extraSmall}}>{message}</Text>                                    
                </View>                
            }
        >            
        </BottomModal>        
    )
}
