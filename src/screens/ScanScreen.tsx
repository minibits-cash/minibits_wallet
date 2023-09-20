import React, {FC, useState, useEffect} from 'react'
import {
    Platform,
    PermissionsAndroid,
    Alert,
} from 'react-native'
import {WalletStackScreenProps} from '../navigation'
import {CameraScreen} from 'react-native-camera-kit'
import {spacing, typography} from '../theme'
import {Token} from '../models/Token'
import {useHeader} from '../utils/useHeader'
import {log} from '../utils/logger'
import AppError, {Err} from '../utils/AppError'
import {decodeInvoice, decodeToken, extractEncodedCashuToken, extractEncodedLightningInvoice} from '../services/cashuHelpers'

const hasAndroidCameraPermission = async () => {
    const cameraPermission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
    return cameraPermission !== PermissionsAndroid.RESULTS.BLOCKED && cameraPermission !== PermissionsAndroid.RESULTS.DENIED
}


export const ScanScreen: FC<WalletStackScreenProps<'Scan'>> = function ScanScreen(_props) {
    const {navigation, route} = _props
    useHeader({
      title: 'Scan to receive',
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

        switch (prevRouteName) {
            case 'Receive':
                const tokenResult = handleToken(scanned)
                if (tokenResult && tokenResult.token) {
                    log.trace('Got token')
                    return navigation.navigate('Receive', {
                        scannedEncodedToken: tokenResult.token,
                    })
                }                
                break
            case 'Transfer':
                const invoiceResult = handleInvoice(scanned)
                if (invoiceResult && invoiceResult.isInvoice) {
                    log.trace('Got invoice')
                    return navigation.navigate('Transfer', {
                        scannedEncodedInvoice: invoiceResult.invoice,
                    })
                }                
                break
            default:
                // generic scan button on wallet screen
                const tokenResult2 = handleToken(scanned)
                if (tokenResult2 && tokenResult2.isToken) {
                    log.trace('Got token')
                    return navigation.navigate('Receive', {
                        scannedEncodedToken: tokenResult2.token,
                    })
                }


                const invoiceResult2 = handleInvoice(scanned)
                
                if (invoiceResult2 && invoiceResult2.isInvoice) {
                    log.trace('Got invoice')
                    return navigation.navigate('Transfer', {
                        scannedEncodedInvoice: invoiceResult2.invoice,
                    })
                }

                // this handles scanning from both WalletScreen and MintsScreen,
                // can't get prevRouteName 'Mints' as it belongs to different navigator
                const mintResult = handleMintUrl(scanned)                
                if (mintResult && mintResult.isMintUrl) {
                    log.trace('Got mintUrl')
                    return navigation.navigate('Wallet', {
                        scannedMintUrl: mintResult.mintUrl,
                    })
                }

                handleError(
                    scanned,
                    'This is not a valid cashu token, lightning invoice nor mint URL address',
                )
        }
    }           


    const handleToken = function (scanned: string) {
        try {
            const encoded = extractEncodedCashuToken(scanned)
            return encoded
        } catch (tokenError: any) {
            handleError(scanned, tokenError.message)
        }
    }


    const handleInvoice = function (scanned: string) {
        try {
            const invoice = extractEncodedLightningInvoice(scanned)
            return invoice
        } catch (invoiceError: any) {
            handleError(scanned, invoiceError.message)
        }
    }


    const handleMintUrl = (mintUrl: string) => {
        try {
            new URL(mintUrl) // throws
            return { 
                isMintUrl: true,
                mintUrl
            }        
        } catch (urlError: any) {
            handleError(mintUrl, urlError.message)
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

/* const $container: ViewStyle = {
  alignItems: 'center',
}

const $barcodes: TextStyle = {
  fontSize: 20,
  color: 'white',
  fontWeight: 'bold',
}

const $bottomContainer: ViewStyle = {
  flex: 1,
  justifyContent: 'flex-end',
  alignSelf: 'stretch',
} */
