import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, Image, Share, TextStyle, View, ViewStyle, InteractionManager, TextInput , Text as RNText, ScrollView,} from 'react-native'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../components'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import { WalletNameStackScreenProps } from '../navigation'
import { MinibitsClient, WalletProfile, NostrClient, KeyPair } from '../services'
import AppError from '../utils/AppError'
import {log} from '../utils/logger'
import {$sizeStyles} from '../components/Text'
import {getRandomUsername} from '../utils/usernames'
import QRCode from 'react-native-qrcode-svg'

interface OwnNameScreenProps extends WalletNameStackScreenProps<'OwnName'> {}

export const OwnNameScreen: FC<OwnNameScreenProps> = observer(function OwnNameScreen({navigation}) {    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(), 
    })

    const ownNameInputRef = useRef<TextInput>(null)
    const {userSettingsStore, proofsStore} = useStores()

    
    
    const [ownName, setOwnName] = useState<string>('')
    const [info, setInfo] = useState('')
    const [npubKey, setNpubKey] = useState<string>('')        
    const [availableBalance, setAvailableBalance] = useState(0)
    const [donationAmount, setDonationAmount] = useState(1000)
    const [donationInvoice, setDonationInvoice] = useState<{payment_hash: string, payment_request: string} | undefined>(undefined)
    const [isLoading, setIsLoading] = useState(false)
    const [isPaymentModalVisible, setIsPaymentModalVisible] = useState(false)
    const [isQRcodeVisible, setIsQRCodeVisible] = useState(false)
    const [isChecked, setIsChecked] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = async () => { 
            const keyPair = await NostrClient.getOrCreateKeyPair()               
            setNpubKey(keyPair.publicKey)           
            
            const maxBalance = proofsStore.getMintBalanceWithMaxBalance()
            if(maxBalance && maxBalance.balance > 0) {
                setAvailableBalance(maxBalance.balance)
            }            
        }
        load()
        return () => {}        
    }, [])


    const togglePaymentModal = () =>
        setIsPaymentModalVisible(previousState => !previousState)
    /* const toggleResultModal = () =>
        setIsResultModalVisible(previousState => !previousState) */


    const resetState = function () {        
        setOwnName('')
        setInfo('')
        setIsLoading(false)
        setIsChecked(false)
        setIsPaymentModalVisible(false)
        setDonationInvoice(undefined)
        setDonationAmount(1000)
    }


    const onOwnNameChange = function (name: string) {   
        const filtered = name.replace(/[^\w.-]/g, '') 
        const lowercase = filtered.toLowerCase()    
        setOwnName(lowercase)
    }
  
    
    const onOwnNameCheck = async function () {
        if(!ownName) {
            setInfo('Write your wallet name to the text box.')
            return
        }

        try {            
            const profileExists = await MinibitsClient.getWalletProfileByWalletId(ownName)

            if(profileExists) {
                setInfo('This public wallet name is already used, choose another one.')
                return
            }
            setIsChecked(true)
            setIsPaymentModalVisible(true)
        } catch (e: any) {
            handleError(e)
        }  
    }


    const onCreateDonation = async function () {
        try {
            setIsLoading(true)
            const memo = `Donation for ${ownName}@minibits.cash`
            const invoice = await MinibitsClient.createDonation(donationAmount, memo)

            if(invoice) {
                setDonationInvoice(invoice)
            }

            setIsLoading(false)
            
        } catch (e: any) {
            handleError(e)
        }  
    }


    const onPayDonation = async function () {
        try {
            
            
           
        } catch (e: any) {
            handleError(e)
        }  
    }


    const saveOwnName = async function () {
        if(!ownName) {
            setInfo('Write your wallet name to the text box.')
            return
        }

        try {
            await MinibitsClient.updateWalletProfile(
                npubKey,
                ownName as string,
                undefined                
            )
                                    
            userSettingsStore.setWalletId(ownName)
            setIsLoading(false)
            navigation.goBack()
            navigation.goBack()
            return
        } catch (e: any) {
            handleError(e)
        } 
    }


    const handleError = function (e: AppError): void {        
        resetState()
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const hint = useThemeColor('textDim')
    const currentNameColor = colors.palette.primary200
    const inputBg = useThemeColor('background')
    const twot = 2000
    const fivet = 5000
    const tent = 10000
    const invoiceBg = useThemeColor('background')
    const invoiceTextColor = useThemeColor('textDim')

    return (
      <Screen style={$screen} preset='auto'>
        <View style={$contentContainer}>            
            <Card
                style={[$card, {marginTop: spacing.small}]}
                heading='Choose your own name'
                headingStyle={{textAlign: 'center'}}
                ContentComponent={                                
                <View style={$ownNameContainer}>
                    <TextInput
                        ref={ownNameInputRef}
                        onChangeText={(name) => onOwnNameChange(name)}                        
                        value={`${ownName}`}
                        style={[$ownNameInput, {backgroundColor: inputBg}]}
                        maxLength={16}
                        keyboardType="default"
                        selectTextOnFocus={true}
                        placeholder="Write your wallet name"
                        autoCapitalize="none"
                        editable={
                            isChecked
                            ? false
                            : true
                        }
                    />                    
                    <Button
                        preset="default"
                        style={$ownNameButton}
                        text="Check"
                        onPress={onOwnNameCheck}
                        disabled={
                            isChecked
                            ? true
                            : false
                        }
                    />                    
                </View>                
                }
                footer={'Use lowercase letters, numbers and .-_' }
                footerStyle={{color: hint, textAlign: 'center'}}
            />         
        </View>
        <BottomModal
          isVisible={isPaymentModalVisible ? true : false}
          top={spacing.screenHeight * 0.18}
          ContentComponent={
            <View style={$bottomModal}>
                <View style={$iconContainer}>
                    <Icon icon='faBurst' size={50} color={colors.palette.accent400} />
                </View>
                <View style={{alignItems: 'center'}}>
                    <Text
                        text={`${ownName} is available!`}
                        style={{fontSize: 18}}   
                    />
                    {donationInvoice ? (
                    <>
                    <Text 
                        text={`Pay the following lightning invoice and get your ${ownName}@minibits.cash wallet profile.`}
                        style={[$supportText, {color: hint}]} 
                    />
                    {isQRcodeVisible ? (
                        <QRCode 
                            size={spacing.screenWidth - spacing.huge * 3} 
                            value={donationInvoice.payment_request} 
                        /> 
                    ) : (
                        <ScrollView
                            style={[
                            $invoiceContainer,
                            {backgroundColor: invoiceBg, marginHorizontal: spacing.small},
                            ]}>
                            <Text
                            selectable
                            text={donationInvoice.payment_request}
                            style={{color: invoiceTextColor, paddingBottom: spacing.medium}}
                            size="xxs"
                            />
                        </ScrollView>
                    )}

                    {(availableBalance > donationAmount) ? (
                        <View style={$payButtonContainer}>                            
                            <Button
                                preset="default"
                                style={{marginRight: spacing.small}}
                                text="Pay from wallet"
                                onPress={onPayDonation}                            
                            />                                                
                            <Button
                                preset="secondary"                            
                                text="Cancel"
                                onPress={resetState}                            
                            />   
                        </View>
                    ) : (
                        <View>
                            <Text                                
                                size='xs'
                                style={{textAlign: 'center', margin: spacing.medium}}
                                text='Your wallet balance is not enough to pay this invoice amount but you can still pay it from another wallet.' 
                            />
                            <View style={$payButtonContainer}>
                            {isQRcodeVisible ? (
                                <Button
                                    preset="default"
                                    style={{marginRight: spacing.small, maxHeight: 50}}                                    
                                    text="Back"
                                    onPress={() => setIsQRCodeVisible(false)}                            
                                />

                            ) : (
                                <Button
                                    preset="default"
                                    style={{marginRight: spacing.small, maxHeight: 50}}
                                    LeftAccessory={() => (
                                        <Icon
                                            icon='faQrcode'
                                            color='white'
                                            size={spacing.small}                                        
                                        />
                                    )}
                                    text="QR code"
                                    onPress={() => setIsQRCodeVisible(true)}                            
                                />
                            )}  
                            <Button
                                preset="secondary"                            
                                text="Cancel"
                                onPress={resetState}                            
                            />
                            </View>                               
                        </View>
                    )}
                    </>
                    ) : (
                    <>
                        <RNText style={$supportText}>                            
                            <Text
                                text='Minibits'
                                style={{fontFamily: 'Gluten-Regular', fontSize: 18}}
                            />{' '}
                            kindly asks you for small donation for your {ownName}@minibits.cash wallet profile.
                        </RNText>
                        <View style={{flexDirection: 'row', justifyContent: 'center'}}>
                            <Text
                                text={`${donationAmount.toLocaleString()}`}
                                preset='heading'    
                            />
                            <Text
                                text={`sats`}
                                style={{fontSize: 18, marginLeft: spacing.extraSmall}}   
                            />
                        </View>
                        <RNText style={$supportText}>
                            Ready to donate more?
                        </RNText>
                        <View style={{flexDirection: 'row', marginBottom: spacing.large}}>
                            <Button
                                preset="secondary"
                                style={{marginRight: spacing.small}}
                                text={`${twot.toLocaleString()}`}
                                onPress={() => setDonationAmount(2000)}                            
                            />
                            <Button
                                preset="secondary"
                                style={{marginRight: spacing.small}}
                                text={`${fivet.toLocaleString()}`}
                                onPress={() => setDonationAmount(5000)}                            
                            />
                            <Button
                                preset="secondary"                            
                                text={`${tent.toLocaleString()}`}
                                onPress={() => setDonationAmount(10000)}                            
                            />   
                        </View>
                        {(donationAmount === 2000) && (                        
                            <Text text={`♥`}  size='lg' />
                        )}
                        {(donationAmount === 5000) && (                        
                            <Text text={`♥ ♥`}  size='lg' />
                        )}
                        {(donationAmount === 10000) && (                        
                            <Text text={`♥ ♥ ♥`}  size='lg' />
                        )}
                        <View style={[$payButtonContainer, {marginTop: spacing.large}]}>
                            <Button
                                preset="default"
                                style={{marginRight: spacing.small}}
                                text="Get invoice"
                                onPress={onCreateDonation}                            
                            /> 
                            <Button
                                preset="secondary"                            
                                text="Cancel"
                                onPress={resetState}                            
                            />   
                        </View>
                    </>
                    )}

                </View>
                {isLoading && <Loading />}
            </View>
          }
          onBackButtonPress={togglePaymentModal}
          onBackdropPress={togglePaymentModal}
        />       
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  })



const $screen: ViewStyle = {}


const $contentContainer: TextStyle = {    
    padding: spacing.extraSmall,  
}

const $iconContainer: ViewStyle = {
    marginTop: -spacing.large * 2,
    alignItems: 'center',
}

const $supportText: TextStyle = {
    padding: spacing.small,
    textAlign: 'center',
    fontSize: 18,
}

const $card: ViewStyle = {
    marginBottom: 0,
}

const $payButtonContainer: ViewStyle = {    
    // flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.medium,
    // borderWidth: 1,
    // borderColor: 'red'
}

const $ownNameContainer: ViewStyle = {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.extraSmall,
}
  
const $ownNameInput: TextStyle = {
    flex: 1,
    borderRadius: spacing.small,
    fontSize: 16,
    textAlignVertical: 'center',
    marginRight: spacing.small,    
}

const $ownNameButton: ViewStyle = {
    maxHeight: 50,
}


const $invoiceContainer: ViewStyle = {
    borderRadius: spacing.small,
    alignSelf: 'stretch',
    padding: spacing.small,
    maxHeight: 150,
    marginTop: spacing.small,
    marginBottom: spacing.large,
  }

const $bottomModal: ViewStyle = {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.large,
    paddingHorizontal: spacing.small,
}

 
const $qrCodeContainer: ViewStyle = {
    backgroundColor: 'white',
    padding: spacing.small,
    margin: spacing.small,
}