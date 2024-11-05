import React, {FC, useState, useEffect, useRef} from 'react'
import {
    ViewStyle,
    View,
    TextStyle,
    TextInput,
} from 'react-native'
import {WalletStackScreenProps} from '../navigation'
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


export const TokenReceiveScreen: FC<WalletStackScreenProps<'TokenReceive'>> = function TokenReceiveScreen(_props) {
    const {navigation, route} = _props
    const tokenInputRef = useRef<TextInput>(null)
    const {mintsStore} = useStores()

    async function autoPaste(setter: (text: string) => void, sideEffect: () => void) {
        const clipboard = (await Clipboard.getString()).trim();
        if (clipboard.length === 0) return

        try {
            const resultFromClipboard = IncomingParser.findAndExtract(clipboard, IncomingDataType.CASHU)
            setter(resultFromClipboard.encoded)
            sideEffect()
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

    
    const [encodedToken, setEncodedToken] = useState<string | undefined>(undefined)
    const [unit, setUnit] = useState<MintUnit>('sat')
    const [mint, setMint] = useState<Mint | undefined>(undefined)    
    const [error, setError] = useState<AppError | undefined>()


    const onPaste = async function() {        
        const clipboard = await Clipboard.getString()
        if (clipboard.length === 0) {
            infoMessage(translate('tokenReceiveScreen.onPasteEmptyClipboard'))
            return
        }

        setEncodedToken(clipboard)
        tokenInputRef.current?.blur()
    }


    const gotoScan = async function () {
        tokenInputRef.current?.blur()
        navigation.navigate('Scan', {mintUrl: mint?.mintUrl, unit})
    }


    /* const gotoContacts = function () {
        navigation.navigate('ContactsNavigator', {
            screen: 'Contacts', 
            params: {paymentOption: SendOption.LNURL_ADDRESS}})
    } */


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
    const contactIcon = useThemeColor('button')
    const headerBg = useThemeColor('header')
    const headerTitle = useThemeColor('headerTitle')    

    return (
        <Screen preset="fixed" contentContainerStyle={$screen}>
            <MintHeader 
                mint={mint}
                unit={unit!}
                navigation={navigation}
            />
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>                
                <Text
                    preset="heading"
                    tx="payCommon.receiveEcash"
                    style={{color: headerTitle}}                    
                />                
            </View> 
            <View style={$contentContainer}>            
                <Card                    
                    HeadingComponent={
                        <ListItem
                            leftIcon='faMoneyBill1'
                            leftIconColor={colors.palette.iconViolet300}
                            tx="common.pasteEcashToken"
                            bottomSeparator={true}
                            /* RightComponent={
                                <Button
                                    preset='tertiary'                                    
                                    LeftAccessory={() => <Icon color={contactIcon} containerStyle={{paddingVertical: 0}} icon='faAddressBook' />}
                                    onPress={gotoContacts}
                                    text='Contacts'
                                    textStyle={{fontSize: 12, color: contactIcon}}
                                />
                            }*/
                        />
                    }
                    ContentComponent={
                        <>
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
                                numberOfLines={4}
                                multiline={true}                                                    
                                selectTextOnFocus={true}
                                style={[$addressInput, {backgroundColor: inputBg}]}                        
                            />
                        </View>                        
                            {!!encodedToken && encodedToken?.length > 1 ? (
                                <View style={$buttonContainer}>
                                    <Button
                                        preset='default'
                                        tx='common.confirm'
                                        onPress={onConfirm}
                                        style={{marginLeft: spacing.small}}
                                        LeftAccessory={() => <Icon icon='faCheckCircle' color='white'/>}
                                    />
                                </View>
                            ) : (
                                <View style={$buttonContainer}>
                                    <Button
                                        preset='secondary'
                                        tx={'common.paste'}       
                                        onPress={onPaste}
                                        LeftAccessory={() => (
                                            <Icon icon='faPaste'/>
                                        )}
                                    />
                                    <Button
                                        preset='secondary'
                                        tx='common.scan'
                                        onPress={gotoScan}
                                        style={{marginLeft: spacing.small}}
                                        LeftAccessory={() => {
                                            return(
                                                <SvgXml 
                                                    width={spacing.medium} 
                                                    height={spacing.medium} 
                                                    xml={ScanIcon}
                                                    fill={scanIcon}
                                                    style={{marginHorizontal: spacing.extraSmall}}
                                                />
                                            )
                                        }}
                                    />
                                </View>
                            )}                        
                        </>
                    }
                />
                <Button
                    tx="tokenReceiveScreen.topupWithLightning"
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
            {error && <ErrorModal error={error} />}
        </Screen>    
    )
}

const $screen: ViewStyle = {
    flex: 1,
}

const $contentContainer: ViewStyle = {
    // flex: 1,
    marginTop: -spacing.extraLarge * 2,
    padding: spacing.extraSmall,
    // alignItems: 'center',
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.medium,
    height: spacing.screenHeight * 0.20,
}

const $buttonContainer: ViewStyle = {
    marginTop: spacing.large,
    flexDirection: 'row',
    alignSelf: 'center',
}


const $addressInput: TextStyle = {     
    textAlignVertical: 'top' ,
    borderRadius: spacing.extraSmall,
    padding: spacing.extraSmall,        
    alignSelf: 'stretch',
    height: 120,
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

