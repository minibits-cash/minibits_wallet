import React, {useState, useEffect, useRef} from 'react'
import {
    ViewStyle,
    View,
    TextStyle,
    TextInput,
    TouchableOpacity,
} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {log} from '../services/logService'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'
import AppError, { Err } from '../utils/AppError'
import { Button, Card, ErrorModal, Icon, ListItem, ScanIcon, Screen, Text } from '../components'
import { infoMessage } from '../utils/utils'
import Clipboard from '@react-native-clipboard/clipboard'
import { SvgXml } from 'react-native-svg'
import { useStores } from '../models'
import { Mint } from '../models/Mint'
import { MintHeader } from './Mints/MintHeader'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { translate } from '../i18n'
import { MintUnit } from '../services/wallet/currency'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'

type Props = StaticScreenProps<{
    unit: MintUnit    
    mintUrl?: string
}>

export const TokenReceiveScreen = function TokenReceiveScreen({ route }: Props) {
    const navigation = useNavigation()
    const tokenInputRef = useRef<TextInput>(null)
    const {mintsStore} = useStores()

    // New: controls visibility of token input
    const [showTokenInput, setShowTokenInput] = useState(false)
    const [encodedToken, setEncodedToken] = useState<string | undefined>(undefined)
    const [unit, setUnit] = useState<MintUnit>('sat')
    const [mint, setMint] = useState<Mint | undefined>(undefined)    
    const [error, setError] = useState<AppError | undefined>()

    async function autoPaste(setter: (text: string) => void, sideEffect: () => void) {
        const clipboard = (await Clipboard.getString()).trim();
        if (clipboard.length === 0) return

        try {
            const resultFromClipboard = IncomingParser.findAndExtract(clipboard, IncomingDataType.CASHU)
            setter(resultFromClipboard.encoded)
            sideEffect()
            // Show input if autopaste sets encodedToken
            setShowTokenInput(true)
        } catch (e: any) {
            return
        }      
    }

    useEffect(() => {
        const setUnitAndMint = () => {
            try {
                log.trace('[TokenReceiveScreen.setUnitAndMint]')
                const {unit, mintUrl} = route.params
                if(!unit) {
                    throw new AppError(Err.VALIDATION_ERROR, translate("missingMintUnitRouteParamsError"))
                }

                setUnit(unit)

                if(mintUrl) {
                    const mint = mintsStore.findByUrl(mintUrl)    
                    setMint(mint)
                }
            } catch (e: any) {
                handleError(e)
            }
        }
        
        setUnitAndMint()
        autoPaste(setEncodedToken, () => tokenInputRef.current?.blur())
        return () => {}
    }, [])

    // If encodedToken is set (by autopaste), show input
    useEffect(() => {
        if (encodedToken && encodedToken.length > 0) {
            setShowTokenInput(true)
        }
    }, [encodedToken])

    const onPaste = async function() {        
        const clipboard = await Clipboard.getString()
        if (clipboard.length === 0) {
            infoMessage(translate('tokenReceiveScreen_onPasteEmptyClipboard'))
            return
        }

        setEncodedToken(clipboard)
        tokenInputRef.current?.blur()
        setShowTokenInput(true)
    }

    const gotoScan = async function () {
        tokenInputRef.current?.blur()
        //@ts-ignore
        navigation.navigate('Scan', {
            mintUrl: mint?.mintUrl, 
            unit
        })
    }

    const gotoCashuPaymentRequest = async function () {    
        //@ts-ignore
        navigation.navigate('CashuPaymentRequest', {
            mintUrl: mint?.mintUrl, 
            unit
        })
    }

    const onConfirm = async function() {
        if(!encodedToken) {
            setError({name: Err.VALIDATION_ERROR, message: translate("missingEcashTokenToReceiveError")})
            return
        }

        try {
            const tokenResult = IncomingParser.findAndExtract(encodedToken, IncomingDataType.CASHU)
            return IncomingParser.navigateWithIncomingData(tokenResult, navigation, unit, mint && mint.mintUrl)
            
        } catch (e: any) {            
            handleError(e)  
            return
        }
    }

    const gotoTopup = async function () {
        //@ts-ignore
        navigation.navigate('Topup', {
            unit,
            mintUrl: mint?.mintUrl            
        })
    }
    
    const handleError = function(e: AppError): void {
        setError(e)
    }

    const hintText = useThemeColor('textDim')
    const scanIcon = useThemeColor('text')    
    const inputBg = useThemeColor('background')
    const inputText = useThemeColor('text')
    const contactIcon = useThemeColor('button')
    const headerBg = useThemeColor('header')
    const headerTitle = useThemeColor('headerTitle')
    const mainButtonColor = useThemeColor('card') 

    return (
        <Screen preset="fixed" contentContainerStyle={$screen}>
            <MintHeader 
                mint={mint}
                unit={unit!}                
            />
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>                
                <Text
                    preset="heading"
                    tx="payCommon_receiveEcash"
                    style={{color: headerTitle}}                    
                />                
            </View> 
            <View style={$contentContainer}>            
                <Card
                    ContentComponent={
                        <>
                            <ListItem
                                leftIcon='faMoneyBill1'
                                tx="commonPasteEcashToken"
                                bottomSeparator={showTokenInput}
                                onPress={() => setShowTokenInput((v) => !v)}
                            />
                            {/* Token Input */}
                            {showTokenInput && (
                                <View style={{paddingVertical: spacing.extraSmall}}>
                                    <Text 
                                        size='xs' 
                                        style={{color: hintText, padding: spacing.extraSmall}} 
                                        tx="pasteEcashTokenDesc"
                                    />
                                    <View style={{alignItems: 'center', marginTop: spacing.small}}>
                                        <TextInput
                                            ref={tokenInputRef}
                                            onChangeText={data => setEncodedToken(data)}
                                            value={encodedToken}
                                            autoCapitalize='none'
                                            keyboardType='default'
                                            maxLength={5000}
                                            numberOfLines={3}
                                            multiline={true}                                                    
                                            selectTextOnFocus={true}
                                            style={[$addressInput, {backgroundColor: inputBg, color: inputText}]}                        
                                        />
                                    </View>                        
                                    {!!encodedToken && encodedToken?.length > 1 ? (
                                        <View style={[$buttonContainer, {marginTop: spacing.small}]}>
                                            <Button
                                                preset='default'
                                                tx='commonConfirm'
                                                onPress={onConfirm}
                                                // style={{marginLeft: spacing.small}}
                                                LeftAccessory={() => <Icon icon='faCheckCircle' color='white'/>}
                                            />
                                        </View>
                                    ) : (
                                        <View style={[$buttonContainer, {marginTop: spacing.small}]}>
                                            <Button
                                                preset='secondary'
                                                tx={'commonPaste'}       
                                                onPress={onPaste}
                                                LeftAccessory={() => (
                                                    <Icon icon='faPaste'/>
                                                )}
                                            />
                                        </View>
                                    )}  
                                </View>
                            )}
                            {/* Create Payment Request */}
                            <ListItem
                                leftIcon='faQrcode'
                                tx="commonCreateCashuPaymentRequest"
                                onPress={gotoCashuPaymentRequest}
                                topSeparator={true}
                            />
                        </>
                    }
                    style={$card}
                    //style={{marginBottom: spacing.medium}}
                />
                <Button
                    tx="tokenReceiveScreen_topupWithLightning"
                    LeftAccessory={() => (
                        <Icon
                        icon='faBolt'
                        color={hintText}
                        size={spacing.medium}                  
                        />
                    )}
                    textStyle={{fontSize: 14, color: hintText}}
                    preset='secondary'
                    onPress={gotoTopup}
                    style={{
                        minHeight: verticalScale(40), 
                        paddingVertical: verticalScale(spacing.tiny),
                        marginRight: spacing.tiny,
                        alignSelf: 'center',
                        marginTop: spacing.medium
                    }}                    
                />
 
            </View>
            <View style={$bottomContainer}>
                <View style={$buttonContainer}>
                    <Button
                        preset='tertiary'                                    
                        LeftAccessory={() => (
                            <SvgXml 
                                width={spacing.medium} 
                                height={spacing.medium} 
                                xml={ScanIcon}
                                fill={scanIcon}
                                style={{marginHorizontal: spacing.extraSmall}}
                            />
                        )}
                        onPress={gotoScan}
                        style={{backgroundColor: mainButtonColor}}
                        text='Scan'
                    />      
                </View>
                </View> 
            {error && <ErrorModal error={error} />}
        </Screen>    
    )
}

const $screen: ViewStyle = {
    flex: 1,
}

const $contentContainer: ViewStyle = {
    marginTop: -spacing.extraLarge * 2,
    padding: spacing.extraSmall,
    flex: 1
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    paddingBottom: spacing.medium,
    height: spacing.screenHeight * 0.15,
}

const $buttonContainer: ViewStyle = {
    //marginTop: spacing.large,
    flexDirection: 'row',
    alignSelf: 'center',
}

const $addressInput: TextStyle = {     
    textAlignVertical: 'top' ,
    borderRadius: spacing.extraSmall,
    padding: spacing.extraSmall,        
    alignSelf: 'stretch',
    height: verticalScale(70),
}


const $card: ViewStyle = {
  marginBottom: 0,
}

const $bottomContainer: ViewStyle = {
    /*position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.medium,*/
    alignSelf: 'center',
    // opacity: 0,
  }
  

