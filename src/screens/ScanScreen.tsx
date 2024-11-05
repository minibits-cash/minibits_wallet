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
import { URDecoder } from '@gandlaf21/bc-ur'
import {spacing, typography, useThemeColor} from '../theme'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'
import AppError, { Err } from '../utils/AppError'
import { BottomModal, Button, ErrorModal, Header, Icon, Screen, Text } from '../components'
import { LnurlUtils } from '../services/lnurl/lnurlUtils'
import { infoMessage } from '../utils/utils'
import Clipboard from '@react-native-clipboard/clipboard'
import { useStores } from '../models'
import { translate } from '../i18n'
import { MintUnit } from '../services/wallet/currency'
import { Mint } from '../models/Mint'

const hasAndroidCameraPermission = async () => {
    const cameraPermission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
    return cameraPermission !== PermissionsAndroid.RESULTS.BLOCKED && cameraPermission !== PermissionsAndroid.RESULTS.DENIED
}


export const ScanScreen: FC<WalletStackScreenProps<'Scan'>> = function ScanScreen(_props) {
    const {navigation, route} = _props
    const {mintsStore} = useStores()

    const [shouldLoad, setShouldLoad] = useState<boolean>(false)        
    const [isScanned, setIsScanned] = useState<boolean>(false)
    const [prevRouteName, setPrevRouteName] = useState<string>('')
    const [urDecoder, setUrDecoder] = useState<URDecoder | undefined>(undefined)
    const [urDecoderProgress, setUrDecoderProgress] = useState<number>(0)
    const [unit, setUnit] = useState<MintUnit>('sat')
    const [mint, setMint] = useState<Mint | undefined>(undefined) 
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

          const decoder = new URDecoder()
          setUrDecoder(decoder)
        }
        load()
    }, [])


    useEffect(() => {
        const setUnitAndMint = () => {
            try {
                const {unit, mintUrl} = route.params
                if (!unit) throw new AppError(Err.VALIDATION_ERROR, 'Missing mint unit in route params');

                setUnit(unit)

                if (mintUrl) {
                  const mint = mintsStore.findByUrl(mintUrl)    
                  setMint(mint)
                }

            } catch (e: any) {
                handleError(e)
            }
        }

        setUnitAndMint()        
        return () => {}
    }, [])  


    const onReadCode = async function(event: any) {
        const scanned = event.nativeEvent.codeStringValue
        
        if (scanned.toLowerCase().startsWith("ur:")) {
            if(!urDecoder) { return }

            urDecoder.receivePart(scanned)
            setUrDecoderProgress(Math.floor(urDecoder.estimatedPercentComplete() * 100))

            if (!urDecoder.isComplete()) {
				return;
			}

            if (urDecoder.isSuccess()) {
                setIsScanned(true) 
                setUrDecoderProgress(0)

                const ur = urDecoder.resultUR()
                const decodedBuffer = ur.decodeCBOR()                

                const decodedData = Buffer.from(decodedBuffer).toString('utf8')

                log.trace('Scanned animated', {scanned: decodedData})

                return onIncomingData(decodedData)
            } else {
                setError(new AppError(Err.SCAN_ERROR, urDecoder.resultError()))
            }
        }

        setIsScanned(true)        
        log.trace('Scanned', {scanned})

        return onIncomingData(scanned)
    }


    const onIncomingData = async function(incoming: any) {

        switch (prevRouteName) {
            case 'TokenReceive':  
                log.trace('TokenReceive')
                try {     
                    const tokenResult = IncomingParser.findAndExtract(incoming, IncomingDataType.CASHU)
                    return IncomingParser.navigateWithIncomingData(tokenResult, navigation, unit, mint && mint.mintUrl)
                    
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
                                }, navigation, unit, mint && mint.mintUrl)
                            }
                            return
                        } catch (e2: any) {
                            handleError(e2)
                            break
                        }
                    }

                    e.params = incoming
                    e.message = translate("scanReceiveExtractFail")
                    handleError(e)
                    break
                }   
            case 'LightningPay':     
                try {               
                    const invoiceResult = IncomingParser.findAndExtract(incoming, IncomingDataType.INVOICE)
                    return IncomingParser.navigateWithIncomingData(invoiceResult, navigation, unit, mint && mint.mintUrl)
                    
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
                                }, navigation, unit, mint && mint.mintUrl)    
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
                                }, navigation, unit, mint && mint.mintUrl)
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
                  return IncomingParser.navigateWithIncomingData(incomingData, navigation, unit, mint && mint.mintUrl)   
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


    if(!shouldLoad) {
        return null
    }
    
    return (
        <Screen contentContainerStyle={$screen}>
            <Header 
                title={urDecoderProgress > 0 ? `Progress ${urDecoderProgress} %`: 'Scan QR code'}
                titleStyle={{fontFamily: typography.primary?.medium}}
                leftIcon='faArrowLeft'
                onLeftPress={() => navigation.goBack()}
            />
            <Camera
                cameraType={CameraType.Back}                      
                scanBarcode
                onReadCode={(event: any) => (isScanned ? undefined : onReadCode(event))}
                hideControls
                style={{flex: 1}}            
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
        </Screen>  
    )
}

const $screen: ViewStyle = {
    flex: 1,
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

