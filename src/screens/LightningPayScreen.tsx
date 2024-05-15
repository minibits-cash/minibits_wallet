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
import { Button, Card, ErrorModal, Header, Icon, InfoModal, ListItem, ScanIcon, Screen, Text } from '../components'
import { LnurlUtils } from '../services/lnurl/lnurlUtils'
import { infoMessage } from '../utils/utils'
import Clipboard from '@react-native-clipboard/clipboard'
import { SvgXml } from 'react-native-svg'
import { SendOption } from './SendOptionsScreen'
import { CurrencyCode, MintUnit } from '../services/wallet/currency'
import { useStores } from '../models'
import { Mint } from '../models/Mint'
import { MintHeader } from './Mints/MintHeader'
import { moderateVerticalScale } from '@gocodingnow/rn-size-matters'
import useIsInternetReachable from '../utils/useIsInternetReachable'


export const LightningPayScreen: FC<WalletStackScreenProps<'LightningPay'>> = function LightningPayScreen(_props) {
    const {navigation, route} = _props
    const lightningInputRef = useRef<TextInput>(null)
    const {mintsStore} = useStores()
    const isInternetReachable = useIsInternetReachable()

    /* useEffect(() => {
        const focus = () => {
            lightningInputRef && lightningInputRef.current
            ? lightningInputRef.current.focus()
            : false
        }        
        const timer = setTimeout(() => focus(), 100)
        return () => {
            clearTimeout(timer)
        }
    }, []) */

    useEffect(() => {
        const setUnitAndMint = () => {
            try {
                const {unit, mintUrl} = route.params
                if(!unit) {
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing mint unit in route params')
                }

                setUnit(unit)

                if(mintUrl) {
                    const mint = mintsStore.findByUrl(mintUrl)    
                    setMint(mint)
                }

                if(!isInternetReachable) {
                    setInfo('Your device is currently offline.')
                }
            } catch (e: any) {
                handleError(e)
            }
        }
        
        setUnitAndMint()
        return () => {}
    }, [])

       
    
    const [prevRouteName, setPrevRouteName] = useState<string>('')
    const [lightningData, setLightningData] = useState<string | undefined>(undefined)
    const [unit, setUnit] = useState<MintUnit>('sat')
    const [mint, setMint] = useState<Mint | undefined>(undefined)    
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')


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
            return IncomingParser.navigateWithIncomingData(invoiceResult, navigation, unit, mint && mint.mintUrl)
            
        } catch (e: any) {
            const maybeLnurlAddress = LnurlUtils.findEncodedLnurlAddress(lightningData as string)

            if(maybeLnurlAddress) {
                try {
                    log.trace('Found Lightning address instead of an invoice', maybeLnurlAddress, 'onIncomingData')        
                    const validAddress = LnurlUtils.extractLnurlAddress(maybeLnurlAddress)
            
                    if(validAddress) {                            
                        await IncomingParser.navigateWithIncomingData({
                            type: IncomingDataType.LNURL_ADDRESS,
                            encoded: validAddress,
                        }, navigation, unit, mint && mint.mintUrl)    
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
                        }, navigation, unit, mint && mint.mintUrl)
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


    const gotoSend = async function () {
        navigation.navigate('Send', {
            unit,
            mintUrl: mint?.mintUrl            
        })
    }
    

    const handleError = function(e: AppError): void {        
        // lightningInputRef.current?.blur()
        setError(e)
    }

    const hintText = useThemeColor('textDim')
    const scanIcon = useThemeColor('text')    
    const inputBg = useThemeColor('background')
    const contactIcon = useThemeColor('button')
    const headerBg = useThemeColor('header')
    
    

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
                    text={'Pay'}
                    style={{color: 'white'}}
                    // style={$tranAmount}
                />                
            </View> 
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
                                    LeftAccessory={() => <Icon color={contactIcon} containerStyle={{paddingVertical: 0}} icon='faAddressBook' />}
                                    onPress={gotoContacts}
                                    text='Contacts'
                                    textStyle={{fontSize: 12, color: contactIcon}}
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
                        <View style={{alignItems: 'center', marginTop: spacing.small}}>
                            <TextInput
                                ref={lightningInputRef}
                                onChangeText={data => setLightningData(data)}
                                value={lightningData}
                                autoCapitalize='none'
                                keyboardType='default'
                                maxLength={500}
                                numberOfLines={4}
                                multiline={true}                         
                                selectTextOnFocus={true}
                                style={[$addressInput, {backgroundColor: inputBg}]}                        
                            />
                        </View>                        
                            {!!lightningData && lightningData?.length > 1 ? (
                                <View style={$buttonContainer}>
                                    <Button
                                        preset='default'
                                        tx={'common.confirm'}
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
                                        tx={'common.scan'}
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
                    text={'Send as ecash'}
                    LeftAccessory={() => (
                        <Icon
                        icon='faMoneyBill1'
                        color={hintText}
                        size={spacing.large}                  
                        />
                    )}
                    textStyle={{fontSize: 14, color: hintText}}
                    preset='secondary'
                    onPress={gotoSend}
                    style={{
                        minHeight: moderateVerticalScale(40), 
                        paddingVertical: moderateVerticalScale(spacing.tiny),
                        marginRight: spacing.tiny,
                        alignSelf: 'center',
                        marginTop: spacing.medium
                    }}                    
                />
            {info && <InfoModal message={info} />}
            {error && <ErrorModal error={error} />}
            </View>
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

