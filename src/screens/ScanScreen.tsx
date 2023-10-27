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
import { LnurlUtils } from '../services/lnurl/lnurlUtils'
import { infoMessage } from '../utils/utils'

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
                    const maybeLnurl = LnurlUtils.findEncodedLnurl(scanned)
                    
                    if(maybeLnurl) {
                        log.trace('Found LNURL link instead of an invoice', maybeLnurl, 'onPaste')
                        const encodedLnurl = LnurlUtils.extractEncodedLnurl(maybeLnurl)
        
                        if(encodedLnurl) {
                            infoMessage('Found LNURL link in the clipboard.')   
                            return setTimeout(async() => IncomingParser.navigateWithIncomingData({
                                type: IncomingDataType.LNURL,
                                encoded: encodedLnurl
                            }, navigation), 500)                               
                        }
                        return
                    }
        
                    const maybeLnurlAddress = LnurlUtils.findEncodedLnurlAddress(scanned)
        
                    if(maybeLnurlAddress) {
                        log.trace('Found Lightning address instead of an invoice', maybeLnurlAddress, 'onPaste')        
                        const lnurlAddress = LnurlUtils.extractLnurlAddress(maybeLnurlAddress)
                
                        if(lnurlAddress) {
                            infoMessage('Found Lightning address in the clipboard.') 
                            return setTimeout(async() => IncomingParser.navigateWithIncomingData({
                                type: IncomingDataType.LNURL_ADDRESS,
                                encoded: lnurlAddress
                            }, navigation), 500)      
                        }
                        return          
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

