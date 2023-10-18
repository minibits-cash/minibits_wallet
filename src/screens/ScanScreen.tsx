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
import AppError from '../utils/AppError'
import { ErrorModal } from '../components'

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
    const [expected, setExpected] = useState<IncomingDataType>()
    const [isScanned, setIsScanned] = useState<boolean>(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        (async () => {
          setShouldLoad(Platform.OS !== 'android' || (await hasAndroidCameraPermission()))
        })()
    }, [])


    useEffect(() => {
        const setExpectedType = async () => {   
          const {expectedType} = route.params

          if(expectedType) {
            log.trace('Got expectedType', expectedType)
            setExpected(expectedType)
          }
        }

        setExpectedType()
    }, [route.params?.expectedType])



    const onReadCode = async function(event: any) {
        setIsScanned(true)
        const scanned = event.nativeEvent.codeStringValue
        log.trace('Scanned', scanned)

        const routes = navigation.getState()?.routes
        const prevRouteName = routes[routes.length - 2].name
        log.trace('prevRouteName', prevRouteName)


        switch (prevRouteName) {
            case 'ReceiveOptions':  
            log.trace('ReceiveOptions')
                try {
                    if(expected === IncomingDataType.CASHU) {
                        const tokenResult = IncomingParser.findAndExtract(scanned, IncomingDataType.CASHU)                
                        log.trace('Got token')
                        return IncomingParser.navigateWithIncomingData(tokenResult, navigation)                        
                    }
                    
                    if(expected === IncomingDataType.LNURL) {
                        const lnurlResult = IncomingParser.findAndExtract(scanned, IncomingDataType.LNURL)
                        log.trace('Got LNURL')
                        await IncomingParser.navigateWithIncomingData(lnurlResult, navigation)
                        return                        
                    }
                } catch (e: any) {
                    e.params = scanned
                    handleError(e)
                }   
            case 'SendOptions':     
                try {               
                    const invoiceResult = IncomingParser.findAndExtract(scanned, IncomingDataType.INVOICE)                 
                    log.trace('Got invoice')
                    return IncomingParser.navigateWithIncomingData(invoiceResult, navigation)
                    
                } catch (e: any) {
                    const lnurlResult = IncomingParser.findAndExtract(scanned, IncomingDataType.LNURL)
                    
                    if(lnurlResult) {
                        log.trace('Got LNURL instead of an invoice')
                        return IncomingParser.navigateWithIncomingData(lnurlResult, navigation)                        
                    }

                    const lnurlAddress = IncomingParser.findAndExtract(scanned, IncomingDataType.LNURL_ADDRESS)

                    if(lnurlAddress) {
                        log.trace('Found LNURL address instead of an invoice')
                        return IncomingParser.navigateWithIncomingData(lnurlAddress, navigation)                
                    }
                    
                    e.params = scanned
                    handleError(e)
                    break
                }                          
            default:
                try {
                // generic scan button on wallet screen
                    const incomingData = IncomingParser.findAndExtract(scanned)                    
                    return IncomingParser.navigateWithIncomingData(incomingData, navigation)   
                } catch (e: any) {
                    e.params = scanned
                    handleError(e)
                }
        }

    }           


    /* const handleError = (scanned: string, message: string) => {
      Alert.alert(message, scanned, [
        {
          text: 'OK',
          onPress: () => setIsScanned(false),
        },
      ])
    } */

    const handleError = function(e: AppError): void {        
        setError(e)
    }


    return (shouldLoad ? (
        <>
            <CameraScreen
                actions={{rightButtonText: 'Done', leftButtonText: 'Cancel'}}            
                scanBarcode
                onReadCode={event => (isScanned ? undefined : onReadCode(event))}
                hideControls            
            />
            {error && <ErrorModal error={error} />}
        </>
        ) : null
    )
}

