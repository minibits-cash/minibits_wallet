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
import {CameraScreen, CameraType} from 'react-native-camera-kit'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'
import AppError, { Err } from '../utils/AppError'
import { BottomModal, Button, Card, ErrorModal, Icon, ListItem, ScanIcon, Screen, Text } from '../components'
import { LnurlUtils } from '../services/lnurl/lnurlUtils'
import { infoMessage } from '../utils/utils'
import Clipboard from '@react-native-clipboard/clipboard'
import { SvgXml } from 'react-native-svg'
import { SendOption } from './SendOptionsScreen'


export const LightningPayScreen: FC<WalletStackScreenProps<'LightningPay'>> = function LightningPayScreen(_props) {
    const {navigation} = _props
    useHeader({
        leftIcon: 'faArrowLeft',        
        onLeftPress: () => navigation.goBack(),
    })

    const lightningInputRef = useRef<TextInput>(null)   

    useEffect(() => {
        const focus = () => {
            lightningInputRef && lightningInputRef.current
            ? lightningInputRef.current.focus()
            : false
        }        
        const timer = setTimeout(() => focus(), 100)
        return () => {
            clearTimeout(timer)
        }
    }, [])

       
    
    const [prevRouteName, setPrevRouteName] = useState<string>('')
    const [lightningData, setLightningData] = useState<string | undefined>(undefined)    
    const [error, setError] = useState<AppError | undefined>()


    const onPaste = async function() {        
        const clipboard = await Clipboard.getString()
        if (clipboard.length === 0) {
            infoMessage('First copy Lightning invoice, address or pay code to pay to. Then paste.')
            return
        }

        setLightningData(clipboard)
        lightningInputRef.current?.blur()
    }


    const gotoScan = async function () {
        lightningInputRef.current?.blur()
        navigation.navigate('Scan')
    }


    const gotoContacts = function () {
        navigation.navigate('ContactsNavigator', {
            screen: 'Contacts', 
            params: {paymentOption: SendOption.LNURL_ADDRESS}})
    }


    const onConfirm = async function() {
        if(!lightningData) {
            setError({name: Err.VALIDATION_ERROR, message: 'Missing Lightning invoice, paycode or address.'})
            return
        }

        try {
            const invoiceResult = IncomingParser.findAndExtract(lightningData as string, IncomingDataType.INVOICE)
            return IncomingParser.navigateWithIncomingData(invoiceResult, navigation)
            
        } catch (e: any) {
            const maybeLnurlAddress = LnurlUtils.findEncodedLnurlAddress(lightningData as string)

            if(maybeLnurlAddress) {
                try {
                    log.trace('Found Lightning address instead of an invoice', maybeLnurlAddress, 'onIncomingData')        
                    const validAddress = LnurlUtils.extractLnurlAddress(maybeLnurlAddress)
            
                    if(validAddress) {                            
                        await IncomingParser.navigateWithIncomingData({
                            type: IncomingDataType.LNURL_ADDRESS,
                            encoded: validAddress
                        }, navigation)    
                    }
                    return          
                } catch (e3: any) {
                    handleError(e3)
                    return
                }
            }

            const maybeLnurl = LnurlUtils.findEncodedLnurl(lightningData as string)
            
            if(maybeLnurl) {
                try {
                    log.trace('Found LNURL link instead of an invoice', maybeLnurl, 'onIncomingData')
                    const encodedLnurl = LnurlUtils.extractEncodedLnurl(maybeLnurl)
    
                    if(encodedLnurl) {                            
                        await IncomingParser.navigateWithIncomingData({
                            type: IncomingDataType.LNURL,
                            encoded: encodedLnurl
                        }, navigation)
                    }
                    return
                } catch (e2: any) {
                    handleError(e2)
                    return
                }
            }           
            
            e.params = lightningData
            handleError(e)  
            return
        }
    }
    

    const handleError = function(e: AppError): void {        
        // lightningInputRef.current?.blur()
        setError(e)
    }

    const hintText = useThemeColor('textDim')
    const inputBg = useThemeColor('background')

    return (
        <Screen preset="fixed" contentContainerStyle={$screen}>
            <View style={$contentContainer}>              
                <Card                    
                    HeadingComponent={
                        <ListItem
                            leftIcon='faBolt'
                            leftIconColor={colors.palette.orange400}
                            text='Pay with Lightning'
                            bottomSeparator={true}
                            RightComponent={
                                <Button
                                    preset='tertiary'                                    
                                    LeftAccessory={() => <Icon containerStyle={{paddingVertical: 0}} icon='faAddressBook' />}
                                    onPress={gotoContacts}
                                    text='Contacts'
                                    textStyle={{fontSize: 12, color: hintText}}
                                />
                            }
                        />
                    }
                    ContentComponent={
                        <>
                        <Text 
                            size='xs' 
                            style={{color: hintText, padding: spacing.extraSmall}} 
                            text='Enter or paste Lightning address, invoice or LNURL pay code you want to pay to.' 
                        />
                        <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                            <TextInput
                                ref={lightningInputRef}
                                onChangeText={data => setLightningData(data)}
                                value={lightningData}
                                autoCapitalize='none'
                                keyboardType='default'
                                maxLength={200}                            
                                selectTextOnFocus={true}
                                style={[$addressInput, {backgroundColor: inputBg}]}                        
                            />
                            <Button
                                preset='secondary'
                                tx={'common.paste'}       
                                style={{                                    
                                    marginLeft: 1,
                                    borderTopLeftRadius: 0,
                                    borderBottomLeftRadius: 0,                                
                                }}
                                onPress={onPaste}
                            />
                        </View>
                        <View style={$buttonContainer}>
                            <Button
                                preset='default'
                                tx={'common.confirm'}
                                onPress={onConfirm}
                                style={{marginLeft: spacing.small}}
                                LeftAccessory={() => <Icon icon='faCheckCircle'/>}
                            />
                            <Button
                                preset='secondary'
                                tx={'common.scan'}
                                onPress={gotoScan}
                                style={{marginLeft: spacing.small}}
                                LeftAccessory={() => {
                                    return(
                                        <SvgXml 
                                            width={spacing.medium} 
                                            height={spacing.medium} 
                                            xml={ScanIcon}
                                            fill='white'
                                            style={{marginHorizontal: spacing.extraSmall}}
                                        />
                                    )
                                }}
                            />
                        </View>
                        </>
                    }
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
    padding: spacing.extraSmall,
    // alignItems: 'center',
}

const $buttonContainer: ViewStyle = {
    marginTop: spacing.large,
    flexDirection: 'row',
    alignSelf: 'center',
}


const $addressInput: TextStyle = {
    flex: 1,    
    borderTopLeftRadius: spacing.extraSmall,
    borderBottomLeftRadius: spacing.extraSmall,    
    // fontSize: 16,
    padding: spacing.extraSmall,
    paddingRight: 0,    
    alignSelf: 'stretch',    
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

