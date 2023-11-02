import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Text as RNText, TextStyle, View, ViewStyle, InteractionManager, TextInput, ScrollView } from 'react-native'
import {colors, spacing, typography, useThemeColor} from '../../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../../components'
import {useStores} from '../../models'
import { MinibitsClient} from '../../services'
import AppError, { Err } from '../../utils/AppError'
import {log} from '../../services/logService'
import { TransactionStatus } from '../../models/Transaction'
import { poller, stopPolling } from '../../utils/poller'
import QRCode from 'react-native-qrcode-svg'
import { ResultModalInfo } from '../Wallet/ResultModalInfo'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { useFocusEffect } from '@react-navigation/native'
import { SendOption } from '../SendOptionsScreen'

const DEFAULT_DONATION_AMOUNT = 100

export const OwnName = observer(function (props: {navigation: any, pubkey: string}) { 
    // const navigation = useNavigation() 
    const ownNameInputRef = useRef<TextInput>(null)
    const {userSettingsStore, proofsStore, walletProfileStore} = useStores()
    const {pubkey, navigation} = props 
    
    const [ownName, setOwnName] = useState<string>('')
    const [info, setInfo] = useState('')        
    const [availableBalance, setAvailableBalance] = useState(0)
    const [donationAmount, setDonationAmount] = useState(DEFAULT_DONATION_AMOUNT)
    const [donationInvoice, setDonationInvoice] = useState<{payment_hash: string, payment_request: string} | undefined>(undefined)
    const [isLoading, setIsLoading] = useState(false)
    const [isPaymentModalVisible, setIsPaymentModalVisible] = useState(false)
    const [isQRcodeVisible, setIsQRCodeVisible] = useState(false)
    const [isChecked, setIsChecked] = useState(false)
    // const [isNameInputEnabled, setIsNameInputEnabled] = useState(true)
    const [isPaidFromWallet, setIsPaidFromWallet] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus, message: string} | undefined
    >()
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = async () => { 
            const maxBalance = proofsStore.getMintBalanceWithMaxBalance()
            if(maxBalance && maxBalance.balance > 0) {
                setAvailableBalance(maxBalance.balance)
            }            
        }
        load()
        return () => {}        
    }, [])



    useLayoutEffect(() => { // not working
        const focus = () => {
            ownNameInputRef && ownNameInputRef.current
            ? ownNameInputRef.current.focus()
            : false
        }
            
        const timer = setTimeout(() => focus(), 100)
    })


    useEffect(() => {        
        const initPoller = async () => { 
            if(!donationInvoice || !ownName) {
                return
            }

            poller('checkDonationPaidPoller', checkDonationPaid, 2 * 1000, 120, 10) // every 2s to make it responsive. Total 4 min
            .then(() => log.trace('Polling completed', {}, 'checkDonationPaid'))
            .catch(error =>
                log.trace(error.message, {}, 'checkPendingTopups'),
            )
           
        }
        initPoller()
        return () => {
            stopPolling('checkDonationPaidPoller')
        }        
    }, [donationInvoice])



    const togglePaymentModal = () =>
        setIsPaymentModalVisible(previousState => !previousState)
    const toggleResultModal = () =>
        setIsResultModalVisible(previousState => !previousState)


    const resetState = function () {  
        // setIsNameInputEnabled(true)      
        setIsChecked(false)
        setOwnName('')        
        setInfo('')
        setIsLoading(false)        
        setIsPaymentModalVisible(false)
        setDonationInvoice(undefined)
        setDonationAmount(DEFAULT_DONATION_AMOUNT)
        setIsResultModalVisible(false)
        setIsQRCodeVisible(false)
        setIsPaidFromWallet(false)
        // stopPolling('checkDonationPaidPoller') // ??
    }


    const onOwnNameChange = function (name: string) {   
        const filtered = name.replace(/[^\w.-_]/g, '') 
        const lowercase = filtered.toLowerCase()    
        setOwnName(lowercase)
    }
  
    
    const onOwnNameCheck = async function () {
        if(!ownName) {
            setInfo('Write your wallet profile name to the text box.')
            return
        }

        try {            
            const profileExists = await MinibitsClient.getWalletProfileByNip05(ownName + MINIBITS_NIP05_DOMAIN)

            if(profileExists) {
                setInfo('This wallet profile name is already in use, choose another one.')
                return
            }
            setIsChecked(true)
            // setIsNameInputEnabled(false)
            setIsPaymentModalVisible(true)
        } catch (e: any) {
            handleError(e)
        }  
    }


    const onCreateDonation = async function () {
        try {
            setIsLoading(true)
            const memo = `Donation for ${ownName+MINIBITS_NIP05_DOMAIN}`
            const invoice = await MinibitsClient.createDonation(
                donationAmount, 
                memo, 
                pubkey
            )

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
            setIsPaidFromWallet(true)            
            return navigation.navigate('WalletNavigator', { 
                screen: 'Transfer',
                params: { 
                    encodedInvoice: donationInvoice?.payment_request, 
                    paymentOption: SendOption.DONATION
                },
            })
           
        } catch (e: any) {
            handleError(e)
        }  
    }


    const checkDonationPaid = async function () {   
        try {
            if(!donationInvoice) {
                return
            }
            
            const { paid } = await MinibitsClient.checkDonationPaid(
                donationInvoice?.payment_hash as string,
                pubkey as string
            )

            if(paid) {                
                setIsLoading(true)
                    
                await walletProfileStore.updateName(ownName)                

                setIsLoading(false)
                setResultModalInfo({
                    status: TransactionStatus.COMPLETED, 
                    message: `Thank you! Donation for ${ownName+MINIBITS_NIP05_DOMAIN} has been successfully paid.`
                })
                toggleResultModal()
                togglePaymentModal()
                stopPolling('checkDonationPaidPoller')
                return
            }
        } catch (e: any) {
            return false // silent
        }  
    }

    const onResultModalClose = async function () {
        resetState()
        navigation.goBack()
    }


    const handleError = function (e: AppError): void {        
        resetState()
        setError(e)
    }
    
    // TODO refactor whole below mess
    
    const headerBg = useThemeColor('header')
    const hint = useThemeColor('textDim')
    const currentNameColor = colors.palette.primary200
    const inputBg = useThemeColor('background')
    const two = 200
    const five = 500
    const ten = 1000
    const invoiceBg = useThemeColor('background')
    const invoiceTextColor = useThemeColor('textDim')
    const domainText = useThemeColor('textDim')
    
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
                        autoCapitalize="none"
                        // editable={isNameInputEnabled}
                    />
                    <View style={[$ownNameDomain, { backgroundColor: inputBg}]}>
                        <Text size='xxs' style={{color: domainText}} text={MINIBITS_NIP05_DOMAIN}/>
                    </View>                 
                    <Button
                        preset="default"
                        style={$ownNameButton}
                        text="Check"
                        onPress={onOwnNameCheck}
                        // disabled={!isNameInputEnabled}
                    />                    
                </View>                
                }
                footer={'Use lowercase letters, numbers and .-_' }
                footerStyle={{color: hint, textAlign: 'center'}}
            />         
        </View>
        <BottomModal
          isVisible={isPaymentModalVisible}          
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
                        text={`Pay the following lightning invoice and get your ${ownName+MINIBITS_NIP05_DOMAIN} wallet profile.`}
                        style={[$supportText, {color: hint}]} 
                    />
                    {isQRcodeVisible ? (
                        <View style={{borderWidth: spacing.medium, borderColor: 'white'}}>
                            <QRCode 
                                size={spacing.screenWidth - spacing.huge * 3} 
                                value={donationInvoice.payment_request} 
                            />
                        </View>
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
                            kindly asks you for a small donation for your {ownName+MINIBITS_NIP05_DOMAIN} wallet name.
                        </RNText>
                        <View style={{flexDirection: 'row', justifyContent: 'center'}}>
                            <Text
                                text={`${donationAmount.toLocaleString()}`}
                                preset='heading'    
                            />
                            <Text
                                text={`SATS`}
                                style={{fontSize: 18, marginLeft: spacing.extraSmall}}   
                            />
                        </View>
                        <RNText style={$supportText}>
                            Ready to donate more?
                        </RNText>
                        <View style={$buttonContainer}>
                            <Button
                                preset="secondary"
                                style={{marginRight: spacing.small}}
                                text={`${two.toLocaleString()}`}
                                onPress={() => setDonationAmount(200)}                            
                            />
                            <Button
                                preset="secondary"
                                style={{marginRight: spacing.small}}
                                text={`${five.toLocaleString()}`}
                                onPress={() => setDonationAmount(500)}                            
                            />
                            <Button
                                preset="secondary"                            
                                text={`${ten.toLocaleString()}`}
                                onPress={() => setDonationAmount(1000)}                            
                            />   
                        </View>
                        {(donationAmount === 200) && (                        
                            <Text text={`♥`}  size='lg' />
                        )}
                        {(donationAmount === 500) && (                        
                            <Text text={`♥ ♥`}  size='lg' />
                        )}
                        {(donationAmount === 1000) && (                        
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
                        <View style={{flexDirection: 'row', alignItems: 'center', margin: spacing.medium}}>
                            <Icon icon='faInfoCircle' />
                            <Text style={{color: hint}} size='xxs' text='Please accept this is an early beta software. Your data can still be lost due to a bug or unexpected data loss.'/>
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
        <BottomModal
          isVisible={isResultModalVisible ? true : false}
          ContentComponent={            
            <>             
                <ResultModalInfo
                    icon="faCheckCircle"
                    iconColor={colors.palette.success200}
                    title="Success!"
                    message={resultModalInfo?.message as string}
                />
                <View style={$payButtonContainer}>
                <Button
                    preset="secondary"
                    tx={'common.close'}
                    onPress={onResultModalClose}
                />
                </View>
            </>
          }
          onBackButtonPress={onResultModalClose}
          onBackdropPress={onResultModalClose}
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
    fontSize: 16,
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
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $ownNameDomain: TextStyle = {    
    marginRight: spacing.small,
    borderTopRightRadius: spacing.small,
    borderBottomRightRadius: spacing.small,    
    padding: spacing.extraSmall,
    alignSelf: 'stretch',
    justifyContent: 'center'
    // textAlignVertical: 'center',
}
  
const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.medium,
    marginBottom: spacing.large,
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
    alignItems: 'center',
    paddingVertical: spacing.large,
}