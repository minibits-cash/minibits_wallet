import React, { FC, useState, useEffect } from 'react'
import { View, ScrollView } from 'react-native'
import { BottomModal, Icon, Text } from '../components'
import AppError from '../utils/AppError'
import { spacing, useThemeColor, colors } from '../theme'


type ErrorModalProps = {
    error: AppError 
}

export const ErrorModal: FC<ErrorModalProps> = function ({ error }) {    
    

    const [isErrorVisible, setIsErrorVisible] = useState<boolean>(true)

    // needed for error to re-appear
    useEffect(() => {
        setIsErrorVisible(true)
    }, [error])


    const onClose = () => {
        setIsErrorVisible(false)
    }

    const backgroundColor = useThemeColor('error')

    return (
        <BottomModal
            isVisible={isErrorVisible}
            onBackdropPress={onClose}
            onBackButtonPress={onClose}
            style={{ backgroundColor }}            
            ContentComponent={
            <>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.small }}>
                    <Icon icon="faInfoCircle" size={spacing.large} color="white" />
                    <Text style={{ color: 'white', marginLeft: spacing.small }}>{error.name}</Text>                
                </View>
                <ScrollView style={error.params ? {minHeight: 150} : {}}>
                    <Text style={{ color: 'white', marginBottom: spacing.small }}>{error.message}</Text>
                    <Text style={{ color: colors.dark.textDim }} size="xs">{JSON.stringify(error.params)}</Text> 
                </ScrollView>
            </>
            }
        />           
        
    )
}
