import React, {FC, useEffect, useState} from 'react'
import {
  ImageStyle,
  TextStyle,
  View,
  ViewStyle,
  useColorScheme,
  StyleSheet,
  Alert,
} from 'react-native'
import {WalletStackScreenProps} from '../navigation'
import {CameraScreen} from 'react-native-camera-kit'
import {spacing, typography} from '../theme'
import {Token} from '../models/Token'
import {useHeader} from '../utils/useHeader'
import {log} from '../utils/logger'
import AppError, {Err} from '../utils/AppError'
import {decodeInvoice, decodeToken} from '../services/cashuHelpers'

export const ScanScreen: FC<WalletStackScreenProps<'Scan'>> = function ScanScreen(_props) {
    const {navigation, route} = _props
    useHeader({
      title: 'Scan to receive',
      titleStyle: {fontFamily: typography.primary?.medium},
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const [isScanned, setIsScanned] = useState<boolean>(false)
    const [error, setError] = useState<AppError | undefined>()


    const onReadCode = function(event: any) {
        setIsScanned(true)
        const scanned = event.nativeEvent.codeStringValue
        log.trace('Scanned', scanned)

        const routes = navigation.getState()?.routes
        const prevRouteName = routes[routes.length - 2].name

        switch (prevRouteName) {
            case 'Receive':
                const tokenResult = handleToken(scanned)
                if (tokenResult?.isToken) {
                    log.trace('Got token')
                    return navigation.navigate('Receive', {
                        scannedEncodedToken: tokenResult.token,
                    })
                }
                handleError(scanned, 'This is not a valid cashu token')
                break
            case 'Transfer':
                const invoiceResult = handleInvoice(scanned)
                if (invoiceResult?.isInvoice) {
                    log.trace('Got invoice')
                    return navigation.navigate('Transfer', {
                        scannedEncodedInvoice: invoiceResult.invoice,
                    })
                }
                handleError(scanned, 'This is not a valid lightning invoice')
                break
            default:
                // generic scan button on wallet screen
                const tokenResult2 = handleToken(scanned)
                if (tokenResult2?.isToken) {
                    log.trace('Got token')
                    return navigation.navigate('Receive', {
                        scannedEncodedToken: tokenResult2.token,
                    })
                }


                const invoiceResult2 = handleInvoice(scanned)
                log.trace('Got invoice')
                if (invoiceResult2?.isInvoice) {
                    return navigation.navigate('Transfer', {
                        scannedEncodedInvoice: invoiceResult2.invoice,
                    })
                }

                handleError(
                    scanned,
                    'This is not a valid cashu token nor lightning invoice',
                )
        }
    }           

    const handleToken = function (scanned: string) {
        try {
            let validToken: Token | undefined = undefined

            // URL token format
            const urlToken: string = extractTokenFromURL(scanned) as string

            if (urlToken) {
                validToken = decodeToken(urlToken) //throws

                return {
                    isToken: true,
                    token: urlToken,
                }
            }

            // raw encoded token
            const token: Token = decodeToken(scanned) // throws

            if (token) {
            return {
                isToken: true,
                token: scanned,
            }
            }

        } catch (tokenError: any) {
            return {
                isToken: false,
                error: tokenError.message,
            }
        }
    }


    const handleInvoice = function (scanned: string) {
        try {
            // Attempt to decode the scanned content as a lightning invoice
            let invoice: any = {}

            if (scanned.startsWith('lightning:')) {
                const trimmed = scanned.replace('lightning:', '')
                invoice = decodeInvoice(trimmed)

                if (invoice) {
                    return {
                        isInvoice: true,
                        invoice: trimmed,
                    }
                }
            } else {
                invoice = decodeInvoice(scanned)

                if (invoice) {
                    return {
                        isInvoice: true,
                        invoice: scanned
                    }

                }
            }
        } catch (invoiceError: any) {
            return {
                isInvoice: false,
                error: invoiceError.message,
            }
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

    const extractTokenFromURL = (url: string) => {
        try {
            const parsedURL = new URL(url)
            const tokenParam = parsedURL.searchParams.get('token')

            if (tokenParam) {
                return tokenParam
            }

            return undefined // No token parameter found
        } catch (e: any) {
            return undefined // Invalid URL
        }
    }

    return (
        <CameraScreen
            actions={{rightButtonText: 'Done', leftButtonText: 'Cancel'}}
            // onBottomButtonPressed={(event) => onBottomButtonPressed(event)}
            scanBarcode
            onReadCode={event => (isScanned ? undefined : onReadCode(event))}
            hideControls
            // showFrame
        />
    )
}

const $container: ViewStyle = {
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
}
