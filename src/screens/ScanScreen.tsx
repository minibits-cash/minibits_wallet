import React, {FC, useState, useEffect, useRef} from 'react'
import {
    Platform,
    PermissionsAndroid,
    Alert,
    ViewStyle,
    View,
    TextStyle,
    TextInput,
} from 'react-native'
import {WalletStackScreenProps} from '../navigation'
import {Camera, CameraType} from 'react-native-camera-kit'
import {spacing, typography, useThemeColor} from '../theme'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'
import AppError, { Err } from '../utils/AppError'
import { BottomModal, Button, ErrorModal, Icon, Text } from '../components'
import { LnurlUtils } from '../services/lnurl/lnurlUtils'
import { infoMessage } from '../utils/utils'
import Clipboard from '@react-native-clipboard/clipboard'
import { useStores } from '../models'
import { translate } from '../i18n'

const hasAndroidCameraPermission = async () => {
    const cameraPermission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
    return cameraPermission !== PermissionsAndroid.RESULTS.BLOCKED && cameraPermission !== PermissionsAndroid.RESULTS.DENIED
}


export const ScanScreen: FC<WalletStackScreenProps<'Scan'>> = function ScanScreen(_props) {
    const {navigation} = _props
    useHeader({
        title: 'Scan QR code',
        titleStyle: {fontFamily: typography.primary?.medium},
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const addressInputRef = useRef<TextInput>(null)
    const {userSettingsStore} = useStores()

    const [shouldLoad, setShouldLoad] = useState<boolean>(false)    
    const [isScanned, setIsScanned] = useState<boolean>(false)
    const [prevRouteName, setPrevRouteName] = useState<string>('')
    const [lnurlAddress, setLnurlAddress] = useState<string | undefined>(undefined)
    const [isLnurlAddressModalVisible, setIsLnurlddressModalVisible] = useState<boolean>(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = async () => {
          setShouldLoad(Platform.OS !== 'android' || (await hasAndroidCameraPermission()))
          
          const routes = navigation.getState()?.routes
          let prevRoute: string = ''
          if(routes.length >= 2) {
            prevRoute = routes[routes.length - 2].name
              log.trace('prevRouteName', prevRoute)
              setPrevRouteName(prevRoute)
          }
        }
        load()
    }, [])

    const toggleLnurlAddressModal = () => {
        if (isLnurlAddressModalVisible === false) {       
            setTimeout(() => {
                addressInputRef && addressInputRef.current
                ? addressInputRef.current.focus()
                : false
            }, 500)
        }
        setIsLnurlddressModalVisible(previousState => !previousState)
    }

    const onReadCode = async function(event: any) {
        setIsScanned(true)
        const scanned = event.nativeEvent.codeStringValue
        log.trace('Scanned', scanned)

        return onIncomingData(scanned)
    }


    const onIncomingData = async function(incoming: any) {
        
        const {preferredUnit: unit} = userSettingsStore

        switch (prevRouteName) {
            case 'TokenReceive':  
                log.trace('TokenReceive')
                try {     
                    const tokenResult = IncomingParser.findAndExtract(incoming, IncomingDataType.CASHU)
                    return IncomingParser.navigateWithIncomingData(tokenResult, navigation, unit)
                    
                } catch (e: any) {
                    const maybeLnurl = LnurlUtils.findEncodedLnurl(incoming)

                    if(maybeLnurl) {
                        try {
                            log.trace('Found LNURL link instead of a token', maybeLnurl, 'onIncomingData')
                            const encodedLnurl = LnurlUtils.extractEncodedLnurl(maybeLnurl)
            
                            if(encodedLnurl) {                            
                                await IncomingParser.navigateWithIncomingData({
                                    type: IncomingDataType.LNURL,
                                    encoded: encodedLnurl
                                }, navigation, unit)
                            }
                            return
                        } catch (e2: any) {
                            handleError(e2)
                            break
                        }
                    }

                    // temp validation
                    if(incoming.startsWith('ur:bytes')) {
                        log.trace('[findAndExtract] Got animated QR', incoming)

                        e.params = incoming
                        e.message = 'Minibits does not yet support animated QR codes.'
                        handleError(e)
                        break
                    }

                    e.params = incoming
                    e.message = translate("scanReceiveExtractFail")
                    handleError(e)
                    break
                }   
            case 'LightningPay':     
                try {               
                    const invoiceResult = IncomingParser.findAndExtract(incoming, IncomingDataType.INVOICE)
                    return IncomingParser.navigateWithIncomingData(invoiceResult, navigation, unit)
                    
                } catch (e: any) {
                    const maybeLnurlAddress = LnurlUtils.findEncodedLnurlAddress(incoming)
        
                    if(maybeLnurlAddress) {
                        try {
                            log.trace('Found Lightning address instead of an invoice', maybeLnurlAddress, 'onIncomingData')        
                            const validAddress = LnurlUtils.extractLnurlAddress(maybeLnurlAddress)
                    
                            if(validAddress) {                            
                                await IncomingParser.navigateWithIncomingData({
                                    type: IncomingDataType.LNURL_ADDRESS,
                                    encoded: validAddress
                                }, navigation, unit)    
                            }
                            return          
                        } catch (e3: any) {
                            handleError(e3)
                            break
                        }
                    }
                    
                    const maybeLnurl = LnurlUtils.findEncodedLnurl(incoming)
                    
                    if(maybeLnurl) {
                        try {
                            log.trace('Found LNURL link instead of an invoice', maybeLnurl, 'onIncomingData')
                            const encodedLnurl = LnurlUtils.extractEncodedLnurl(maybeLnurl)
            
                            if(encodedLnurl) {                            
                                await IncomingParser.navigateWithIncomingData({
                                    type: IncomingDataType.LNURL,
                                    encoded: encodedLnurl
                                }, navigation, unit)
                            }
                            return
                        } catch (e2: any) {
                            handleError(e2)
                            break
                        }
                    }
                    
                    e.params = incoming
                    handleError(e)  
                    break
                }                          
            default:
                try {
                // generic scan button on wallet screen
                  const incomingData = IncomingParser.findAndExtract(incoming)              
                  return IncomingParser.navigateWithIncomingData(incomingData, navigation, unit)   
                } catch (e: any) {
                  e.name = Err.VALIDATION_ERROR
                  e.params = {caller: 'onIncomingData', clipboard: incoming.slice(0, 100)}
                  handleError(e)
                }
        }

    }
    
    const onPaste = async function() {        
        const clipboard = await Clipboard.getString()
        if (clipboard.length === 0) {
            infoMessage(translate("scanScreen.onPasteEmptyClipboard"))
            return
        }

        return onIncomingData(clipboard)
    }


    const handleError = function(e: AppError): void {        
        setError(e)
    }

    const hintText = useThemeColor('textDim')
    const inputBg = useThemeColor('background')

    return (shouldLoad ? (
        <>
            <Camera
                cameraType={CameraType.Back}                      
                scanBarcode
                onReadCode={(event: any) => (isScanned ? undefined : onReadCode(event))}
                hideControls            
            />
            <View style={$bottomContainer}>                
                {prevRouteName !== 'SendOptions' && (
                    <View style={$buttonContainer}>
                        <Button                        
                            onPress={() => onPaste()}
                            LeftAccessory={() => (
                                <Icon icon='faPaste'/>
                            )}
                            tx='common.paste'
                            preset='secondary'
                            style={{marginTop: spacing.medium, minWidth: 120}}                        
                        />
                    </View>
                )}                
            </View>            
            {error && <ErrorModal error={error} />}
        </>
        ) : null
    )
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
}

const $modalContainer: TextStyle = {    
    alignItems: 'center',
}

const $addressInput: TextStyle = {
    flex: 1,    
    borderRadius: spacing.small,    
    fontSize: 16,
    padding: spacing.small,
    marginRight: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $bottomContainer: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.medium,
    alignSelf: 'stretch',
    // opacity: 0,
}

