import React, {FC, useState, useEffect} from 'react'
import {
    Platform,
    PermissionsAndroid,
    Alert,
} from 'react-native'
import {WalletStackScreenProps} from '../navigation'
import {CameraScreen} from 'react-native-camera-kit'
import {typography} from '../theme'
import {useHeader} from '../utils/useHeader'
import {log} from '../utils/logger'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'

const hasAndroidCameraPermission = async () => {
    const cameraPermission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
    return cameraPermission !== PermissionsAndroid.RESULTS.BLOCKED && cameraPermission !== PermissionsAndroid.RESULTS.DENIED
}


export const ScanScreen: FC<WalletStackScreenProps<'Scan'>> = function ScanScreen(_props) {
    const {navigation, route} = _props
    useHeader({
        title: 'Scan QR code',
        titleStyle: {fontFamily: typography.primary?.medium},
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const [shouldLoad, setShouldLoad] = useState<boolean>(false)
    const [isScanned, setIsScanned] = useState<boolean>(false)    

    useEffect(() => {
        (async () => {
          setShouldLoad(Platform.OS !== 'android' || (await hasAndroidCameraPermission()))
        })()
    }, [])



    const onReadCode = function(event: any) {
        setIsScanned(true)
        const scanned = event.nativeEvent.codeStringValue
        log.trace('Scanned', scanned)

        const routes = navigation.getState()?.routes
        const prevRouteName = routes[routes.length - 2].name
        log.trace('prevRouteName', prevRouteName)

        try {
            switch (prevRouteName) {
                case 'ReceiveOptions':               
                        const tokenResult = IncomingParser.findAndExtract(scanned, IncomingDataType.CASHU)                
                        log.trace('Got token')
                        return navigation.navigate('Receive', {
                            encodedToken: tokenResult.encoded,
                        })    
                case 'SendOptions':                    
                        const invoiceResult = IncomingParser.findAndExtract(scanned, IncomingDataType.INVOICE)                 
                        log.trace('Got invoice')
                        return navigation.navigate('Transfer', {
                            encodedInvoice: invoiceResult.encoded,
                        })    
                default:
                    // generic scan button on wallet screen
                    const incomingData = IncomingParser.findAndExtract(scanned)    
                    IncomingParser.navigateWithIncomingData(incomingData, navigation)   
            }

        } catch (e: any) {
            handleError(scanned, e.message)
        }
    }           


    const handleError = (scanned: string, message: string) => {
      Alert.alert(message, scanned, [
        {
          text: 'OK',
          onPress: () => setIsScanned(false),
        },
      ])
    }


    return (shouldLoad ? (
        <CameraScreen
            actions={{rightButtonText: 'Done', leftButtonText: 'Cancel'}}            
            scanBarcode
            onReadCode={event => (isScanned ? undefined : onReadCode(event))}
            hideControls            
        />
        ) : null
    )
}

