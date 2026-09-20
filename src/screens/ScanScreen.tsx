import React, {FC, useState, useEffect, useRef} from 'react'
import {
    Platform,
    PermissionsAndroid,
    Alert,
    ViewStyle,
    View,
    TextStyle,
} from 'react-native'
// @ts-ignore
import {Camera, CameraType} from 'react-native-camera-kit'
import { URDecoder } from '@gandlaf21/bc-ur'
import {spacing, typography, useThemeColor} from '../theme'
import {log} from '../services/logService'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'
import AppError, { Err } from '../utils/AppError'
import { Button, ErrorModal, Header, Icon, Screen } from '../components'
import { LnurlUtils } from '../services/lnurl/lnurlUtils'
import { infoMessage } from '../utils/utils'
import Clipboard from '@react-native-clipboard/clipboard'
import { useStores } from '../models'
import { translate } from '../i18n'
import { MintUnit } from '../services/wallet/currency'
import { Mint } from '../models/Mint'
import { CashuUtils } from '../services/cashu/cashuUtils'
import { BitcoinUtils } from '../services/bitcoin/bitcoinUtils'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'

const hasAndroidCameraPermission = async () => {
    const cameraPermission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
    return cameraPermission !== PermissionsAndroid.RESULTS.DENIED
}

type Props = StaticScreenProps<{
    unit: MintUnit    
    mintUrl?: string,      
}>

export const ScanScreen = function ScanScreen({ route }: Props) {
    const navigation = useNavigation()
    const {mintsStore} = useStores()

    const [shouldLoad, setShouldLoad] = useState<boolean>(false)        
    const [prevRouteName, setPrevRouteName] = useState<string>('')
    const [urDecoderProgress, setUrDecoderProgress] = useState<number>(0)
    /*
     * Refs, not state: with scanThrottleDelay={0} onReadCode fires on every camera
     * frame (~30/s), so a state flag would still be stale on the next few frames and
     * let a completed scan navigate several times.
     */
    const urDecoder = useRef<URDecoder>(new URDecoder())
    const isScanned = useRef<boolean>(false)
    const lastPart = useRef<string>('')
    const [unit, setUnit] = useState<MintUnit>('sat')
    const [mint, setMint] = useState<Mint | undefined>(undefined) 
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = async () => {
          setShouldLoad(Platform.OS !== 'android' || (await hasAndroidCameraPermission()))
          
          const routes = navigation.getState()?.routes
          let prevRoute: string = ''

          if(routes && routes.length >= 2) {
            prevRoute = routes[routes.length - 2].name
              log.trace('prevRouteName', prevRoute)
              setPrevRouteName(prevRoute)
          }

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
        if (isScanned.current) { return }

        const scanned = event.nativeEvent.codeStringValue

        // The camera reads the same QR many times while it is on screen. Skipping the
        // repeats keeps receivePart() and the progress re-render off the hot path.
        if (scanned === lastPart.current) { return }
        lastPart.current = scanned

        if (scanned.toLowerCase().startsWith("ur:")) {
            urDecoder.current.receivePart(scanned)
            setUrDecoderProgress(Math.floor(urDecoder.current.estimatedPercentComplete() * 100))

            if (!urDecoder.current.isComplete()) {
				return;
			}

            if (urDecoder.current.isSuccess()) {
                isScanned.current = true
                setUrDecoderProgress(0)

                const ur = urDecoder.current.resultUR()
                const decodedBuffer = ur.decodeCBOR()                

                const decodedData = Buffer.from(decodedBuffer).toString('utf8')

                log.trace('[ScanScreen] Scanned animated', {scanned: decodedData})

                return onIncomingData(decodedData)
            } else {
                setError(new AppError(Err.SCAN_ERROR, urDecoder.current.resultError()))
            }
        }

        isScanned.current = true        
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
            case 'Send':     
                try {               
                    const pubkey = IncomingParser.findAndExtract(incoming, IncomingDataType.NPUB_OR_HEX) // throws
                    return IncomingParser.navigateWithIncomingData(pubkey, navigation, unit, mint && mint.mintUrl)
                    
                } catch (e: any) {
                    e.params = incoming                    
                    handleError(e)  
                    break
                } 
            case 'Pay':     
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

                    const maybeCashuPaymentRequest = CashuUtils.findEncodedCashuPaymentRequest(incoming)

                    if(maybeCashuPaymentRequest) {
                        try {
                            log.trace('Found Cashu Payment request instead of an invoice', maybeCashuPaymentRequest, 'onIncomingData')
                            const encodedPr = CashuUtils.extractEncodedCashuPaymentRequest(maybeCashuPaymentRequest)

                            if(encodedPr) {
                                await IncomingParser.navigateWithIncomingData({
                                    type: IncomingDataType.CASHU_PAYMENT_REQUEST,
                                    encoded: encodedPr
                                }, navigation, unit, mint && mint.mintUrl)
                            }
                            return
                        } catch (e3: any) {
                            handleError(e3)
                            break
                        }
                    }

                    // Bitcoin address / BIP21, last in the chain so a unified QR carrying a
                    // lightning invoice is taken as an invoice — lightning wins.
                    const maybeBtcAddress = BitcoinUtils.findBitcoinAddress(incoming)

                    if(maybeBtcAddress) {
                        try {
                            log.trace('Found Bitcoin address instead of an invoice', 'onIncomingData')
                            // Throws (and reports) on a non-mainnet address, which is the
                            // likely mistake: fakewallet topup addresses are regtest.
                            const btcResult = IncomingParser.findAndExtract(maybeBtcAddress, IncomingDataType.BTC_ADDRESS)
                            await IncomingParser.navigateWithIncomingData(btcResult, navigation, unit, mint && mint.mintUrl)
                            return
                        } catch (e4: any) {
                            handleError(e4)
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
            infoMessage(translate("scanScreen_onPasteEmptyClipboard"))
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
        <Screen contentContainerStyle={$screen} contentUnderTabBar>
            <Header 
                title={urDecoderProgress > 0 ? `Progress ${urDecoderProgress} %`: 'Scan QR code'}
                titleStyle={{fontFamily: typography.primary?.medium}}
                leftIcon='faArrowLeft'
                onLeftPress={() => navigation.goBack()}
            />
            <Camera
                cameraType={CameraType.Back}                      
                scanBarcode
                scanThrottleDelay={0}
                onReadCode={onReadCode}                
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
                            tx='commonPaste'
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
    bottom: spacing.extraLarge * 3,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.medium,
    alignSelf: 'stretch',
    // opacity: 0,
}

