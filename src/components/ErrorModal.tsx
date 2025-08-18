import React, { FC, useState, useEffect } from 'react'
import { View, ScrollView, LayoutAnimation, Platform, UIManager, ViewStyle } from 'react-native'
import { BottomModal, Button, Icon, ListItem, Text } from '../components'
import AppError, { Err } from '../utils/AppError'
import { spacing, useThemeColor, colors } from '../theme'
import { isObj } from '@cashu/cashu-ts/src/utils'
import JSONTree from 'react-native-json-tree'
import Clipboard from '@react-native-clipboard/clipboard'
import { useStores } from '../models'

type ErrorModalProps = {
    error: AppError 
}

export const ErrorModal: FC<ErrorModalProps> = function ({ error }) {    
    
    const {walletStore, authStore, walletProfileStore} = useStores()

    const [isErrorVisible, setIsErrorVisible] = useState<boolean>(true)
    const [isParamsVisible, setIsParamsVisible] = useState<boolean>(false)

    // needed for error to re-appear
    useEffect(() => {
        setIsErrorVisible(true)
    }, [error])

    const toggleParams = () => {
        LayoutAnimation.easeInEaseOut()
        setIsParamsVisible(previousState => !previousState)
    }

    const onClose = () => {
        setIsErrorVisible(false)
    }

    const onCopy = function () {
        try {
          Clipboard.setString(JSON.stringify(error.params))
        } catch (e: any) {
          return false
        }
    }

    const enrollDevice = async () => {
        const keys = await walletStore.getCachedWalletKeys()
        if (keys.NOSTR) {
            authStore.enrollDevice(keys.NOSTR, walletProfileStore.device)
                .then(() => {
                    setIsErrorVisible(false)
                })
                .catch((e: any) => {
                    error = new AppError(Err.AUTH_ERROR, 'Failed to re-enroll device', { message: e.message })
                })
        }
    }

    const bg = useThemeColor('error')

    return (
        <BottomModal
            isVisible={isErrorVisible}
            onBackdropPress={onClose}
            onBackButtonPress={onClose}            
            ContentComponent={
            <>                
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.small }}>
                    <Icon icon="faTriangleExclamation" size={spacing.large} color={bg} />
                    <Text style={{ marginLeft: spacing.small }}>{error.name}</Text>                
                </View>
                <ScrollView 
                    style={{ 
                        //height: spacing.screenHeight * 0.1,                       
                        maxHeight: spacing.screenHeight * 0.07,                        
                    }}>
                    <Text style={{ marginBottom: spacing.small }}>{error.message}</Text>
                </ScrollView>
                {error.name === Err.AUTH_ERROR && (error.message?.includes('re-authenticate') || error.message.includes('expired refresh token')) ? (
                    <Button
                        onPress={enrollDevice}
                        text='Login again'
                        preset='secondary'
                    />
                ) : (
                    <>
                    {error.params && isObj(error.params) && (
                    <>
                        {isParamsVisible ? (
                            <>
                                <ScrollView style={{
                                        alignSelf: 'stretch',
                                        borderRadius: spacing.small, 
                                        backgroundColor: '#fff', 
                                        padding: spacing.tiny, 
                                        maxHeight: spacing.screenHeight * 0.3, 
                                        maxWidth: spacing.screenWidth * 0.9
                                    }}>
                                    <JSONTree
                                        hideRoot
                                        data={error.params}                                        
                                        theme={{
                                            scheme: 'codeschool',
                                            author: 'brettof86',
                                            base00: '#000000',
                                            base01: '#2e2f30',
                                            base02: '#515253',
                                            base03: '#737475',
                                            base04: '#959697',
                                            base05: '#b7b8b9',
                                            base06: '#dadbdc',
                                            base07: '#fcfdfe',
                                            base08: '#e31a1c',
                                            base09: '#e6550d',
                                            base0A: '#dca060',
                                            base0B: '#31a354',
                                            base0C: '#80b1d3',
                                            base0D: '#3182bd',
                                            base0E: '#756bb1',
                                            base0F: '#b15928'
                                        }}                  
                                    />
                                </ScrollView>
                                <View style={$buttonContainer}>
                                    <Button
                                        onPress={toggleParams}
                                        text='Hide details'
                                        preset='tertiary'
                                    />
                                    <Button
                                        onPress={onCopy}
                                        text='Copy'
                                        preset='tertiary'
                                    />
                                </View>
                            </>
                            ) : (
                                <Button
                                    onPress={toggleParams}
                                    text='Show details'
                                    preset='tertiary'
                                />
                        )}
                        </>                      
                    )}
                    </>
                )}
                
            </>
            }
        />
    )
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',    
    marginTop: spacing.small,
}
