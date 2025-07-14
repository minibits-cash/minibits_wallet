import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Text as RNText, TextStyle, View, ViewStyle, TextInput, ScrollView } from 'react-native'
import {colors, spacing, typography, useThemeColor} from '../../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../../components'
import {useStores} from '../../models'
import { MinibitsClient} from '../../services'
import AppError, { Err } from '../../utils/AppError'
import {log} from '../../services/logService'
import { TransactionStatus } from '../../models/Transaction'
import { poller, stopPolling } from '../../utils/poller'
import { ResultModalInfo } from '../Wallet/ResultModalInfo'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { translate } from '../../i18n'
import { CurrencyAmount } from '../Wallet/CurrencyAmount'
import { CurrencyCode } from '../../services/wallet/currency'
import { QRCodeBlock } from '../Wallet/QRCode'
import { MintBalance } from '../../models/Mint'
import Clipboard from '@react-native-clipboard/clipboard'
import { roundUp } from '../../utils/number'
import { LNURLPayParams, LnurlClient } from '../../services/lnurlService'
import { useNavigation } from '@react-navigation/native'
import { TransferOption } from '../TransferScreen'

const DEFAULT_DONATION_AMOUNT = 500
const DONATION_LNURL_ADDRESS = 'minibits@minibits.cash'

export const OwnName = observer(function (props: {pubkey: string}) { 
    const navigation = useNavigation() 
    const ownNameInputRef = useRef<TextInput>(null)
    const {proofsStore, walletProfileStore} = useStores()
    const {pubkey} = props 
    
    const [ownName, setOwnName] = useState<string>('')
    const [info, setInfo] = useState('')        
    const [selectedBalance, setSelectedBalance] = useState<MintBalance | undefined>(undefined)
    const [donationAmount, setDonationAmount] = useState(DEFAULT_DONATION_AMOUNT)
    const [donationInvoice, setDonationInvoice] = useState<{payment_hash: string, payment_request: string} | undefined>(undefined)
    const [isLoading, setIsLoading] = useState(false)
    const [isChecked, setIsChecked] = useState(false)
    // const [isNameInputEnabled, setIsNameInputEnabled] = useState(true)
    const [isInvoicePaid, setIsInvoicePaid] = useState<boolean>(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus, message: string} | undefined
    >()
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = async () => {
            const maxBalance = proofsStore.getMintBalanceWithMaxBalance('sat')            

            if(maxBalance && maxBalance.balances['sat']! > 0) {
                setSelectedBalance(maxBalance)                
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

            poller(`checkDonationPaidPoller-${donationInvoice.payment_hash}`, 
            checkDonationPaid,
            {
                interval: 2 * 1000, // every 2s to make it responsive.
                maxPolls: 60,
                maxErrors: 10
            })            
            .then(() => log.trace('[checkDonationPaid]', 'Polling completed'))
            .catch(error =>
                log.trace('[checkDonationPaid]', error.message),
            )
           
        }
        initPoller()
        return () => {
            if(donationInvoice) {
                stopPolling(`checkDonationPaidPoller-${donationInvoice.payment_hash}`)
            }            
        }        
    }, [donationInvoice])


    useEffect(() => {
      const handleIsInvoicePaid = async () => {
        if (!isInvoicePaid || !donationInvoice) {
          return
        }

        stopPolling(`checkDonationPaidPoller-${donationInvoice.payment_hash}`)
        setResultModalInfo({
          status: TransactionStatus.COMPLETED,
          message: translate("contactsScreen_ownName_donationSuccess", { receiver: ownName + MINIBITS_NIP05_DOMAIN })
        })
        toggleResultModal()
        //resetState()     
      }
      handleIsInvoicePaid()
      return () => {
      }
    }, [isInvoicePaid])

    const toggleResultModal = () =>
        setIsResultModalVisible(previousState => !previousState)

    const resetState = function () {          
        setIsChecked(false)
        setOwnName('')        
        setInfo('')
        setIsLoading(false)                
        setDonationInvoice(undefined)
        setDonationAmount(DEFAULT_DONATION_AMOUNT)
        setIsInvoicePaid(false)         
    }


    const onOwnNameChange = function (name: string) {   
        const filtered = name.replace(/[^\w.-_]/g, '') 
        const lowercase = filtered.toLowerCase()    
        setOwnName(lowercase)
    }


    const isValidName = function (name: string) {
        // Define a regular expression pattern
        const pattern = /^[^.-].*[^.-]$/;
      
        // Test the input string against the pattern
        return pattern.test(name)
    }
  
    
    const onOwnNameCheck = async function () {
        if(!ownName || ownName.length < 2) {
            setInfo(translate('contactsScreen_ownName_tooShort'))
            return
        }

        if(!isValidName(ownName)) {
            setInfo(translate('contactsScreen_ownName_illegalChar'))
            return
        }

        try {            
            const profileExists = await MinibitsClient.getWalletProfileByNip05(ownName + MINIBITS_NIP05_DOMAIN)

            if(profileExists) {
                setInfo(translate("contactsScreen_ownName_profileExists"))
                return
            }

            
            // setIsNameInputEnabled(false)
            // setIsPaymentModalVisible(true)
        } catch (e: any) {
            if(e.name === Err.NOTFOUND_ERROR) {
                setIsChecked(true)
                return
            }

            handleError(e)
        }  
    }


    const onCreateDonation = async function () {
        try {
            setIsLoading(true)

            const comment = `Donation for ${ownName+MINIBITS_NIP05_DOMAIN}`
            const feeReserve = roundUp(donationAmount / 100, 0)

            if(selectedBalance && selectedBalance.balances['sat']! + feeReserve >= donationAmount) {

                const addressParamsResult = await LnurlClient.getLnurlAddressParams(DONATION_LNURL_ADDRESS) // throws
                //@ts-ignore
                return navigation.navigate('WalletNavigator', {
                    screen: 'Transfer', 
                    params: { 
                        lnurlParams: addressParamsResult.lnurlParams as LNURLPayParams,                
                        paymentOption: TransferOption.LNURL_PAY,
                        fixedAmount: donationAmount,
                        unit: 'sat',
                        comment,
                        mintUrl: selectedBalance.mintUrl,
                        isDonation: true,
                        donationForName: ownName                    
                    }
                })
            } else {
                const invoice = await MinibitsClient.createDonation(
                    donationAmount, 
                    comment, 
                    pubkey
                )

                setDonationInvoice(invoice)                
            }

            setIsLoading(false)
            
        } catch (e: any) {
            handleError(e)
        }  
    }


    const onCopyInvoice = function () {
        try {
          Clipboard.setString(donationInvoice?.payment_request as string)
        } catch (e: any) {
          setError(e)
        }
      }

    // poll handler
    const checkDonationPaid = async function (): Promise<void> {   
        try {
            if(!donationInvoice) {
                return
            }
            
            const { paid } = await MinibitsClient.checkDonationPaid(
                donationInvoice.payment_hash as string,
                pubkey as string
            )

            if(paid) {                
                setIsLoading(true)                    
                await walletProfileStore.updateName(ownName)                
                setIsLoading(false)
                setIsInvoicePaid(true)
                return
            }
        } catch (e: any) {
            return // silent
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
    const inputText = useThemeColor('text')
    const small = DEFAULT_DONATION_AMOUNT * 2
    const medium = DEFAULT_DONATION_AMOUNT * 3
    const large = DEFAULT_DONATION_AMOUNT * 4
    const invoiceBg = useThemeColor('background')
    const invoiceTextColor = useThemeColor('textDim')
    const domainText = useThemeColor('textDim')
    
    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
        <ScrollView style={$contentContainer}>
            {!isChecked ? (
                <Card
                    style={[$card, {marginTop: spacing.small}]}
                                    headingTx='contactsScreen_ownName_chooseOwnName'
                    headingStyle={{textAlign: 'center'}}
                    ContentComponent={                                
                        <View style={$ownNameContainer}>
                            <TextInput
                                ref={ownNameInputRef}
                                onChangeText={(name) => onOwnNameChange(name)}                        
                                value={`${ownName}`}
                                style={[$ownNameInput, {backgroundColor: inputBg, color: inputText}]}
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
                                tx="buttonCheck"
                                onPress={onOwnNameCheck}
                                // disabled={!isNameInputEnabled}
                            />                    
                        </View>                
                    }
                    footerTx='contactsScreen_ownName_chooseOwnNameFooter'
                    footerStyle={{color: hint, textAlign: 'center'}}                
                />
            ) : (
                <Card
                    style={[$card, {marginTop: spacing.small}]}
                    HeadingComponent={                    
                        <View style={$iconContainer}>
                            <Icon icon='faCheckCircle' size={50} color={colors.palette.success200} />
                            <Text
                                text={translate('contactsScreen_ownName_available',{ name: ownName })}
                                style={{fontSize: 18}}   
                            />
                        </View>
                    }      
                    ContentComponent={       
                        <View>
                            {donationInvoice ? (
                                <>
                                    <Text 
                                        text={translate("contactsScreen_ownName_payToGetOwnName", { name: ownName+MINIBITS_NIP05_DOMAIN })}
                                        style={[$supportText, {color: hint}]} 
                                    />
                                                                     
                                    <QRCodeBlock 
                                        qrCodeData={donationInvoice.payment_request}
                                        titleTx="contactsScreen_ownName_lightningInvoiceToPayQR"
                                        type='Bolt11Invoice'
                                        size={270}
                                    />                                
                                </>
                            ) : (
                                <>
                                    <RNText style={$supportText}>                            
                                        <Text
                                            text='Minibits'
                                            style={{fontFamily: 'Gluten-Regular', fontSize: 18}}
                                        />{' '}
                                        <Text tx="contactsScreen_ownName_donationSubtext" />
                                    </RNText>                                    
                                    <CurrencyAmount
                                        amount={donationAmount}
                                        currencyCode={CurrencyCode.SAT}
                                        size='extraLarge'
                                        containerStyle={{alignSelf: 'center', marginTop: spacing.medium}}
                                    />                                    
                                    <Text style={$supportText} tx='readyToDonateMore' />
                                    
                                    <View style={$buttonContainer}>
                                        <Button
                                            preset="secondary"
                                            style={{marginRight: spacing.small}}
                                            text={`${small.toLocaleString()}`}
                                            onPress={() => setDonationAmount(DEFAULT_DONATION_AMOUNT * 2)}                            
                                        />
                                        <Button
                                            preset="secondary"
                                            style={{marginRight: spacing.small}}
                                            text={`${medium.toLocaleString()}`}
                                            onPress={() => setDonationAmount(DEFAULT_DONATION_AMOUNT * 3)}                            
                                        />
                                        <Button
                                            preset="secondary"                            
                                            text={`${large.toLocaleString()}`}
                                            onPress={() => setDonationAmount(DEFAULT_DONATION_AMOUNT * 4)}                            
                                        />   
                                    </View>
                                    <View style={$buttonContainer}>
                                        {(donationAmount === DEFAULT_DONATION_AMOUNT * 2) && (                        
                                            <Text text={`♥`}  size='lg' />
                                        )}
                                        {(donationAmount === DEFAULT_DONATION_AMOUNT * 3) && (                        
                                            <Text text={`♥ ♥`}  size='lg' />
                                        )}
                                        {(donationAmount === DEFAULT_DONATION_AMOUNT * 4) && (                        
                                            <Text text={`♥ ♥ ♥`}  size='lg' />
                                        )}
                                    </View>
                                    <View style={$buttonContainer}>
                                        <Button
                                            preset="default"
                                            style={{marginRight: spacing.small}}
                                            tx='contactsScreen_getInvoice'
                                            onPress={onCreateDonation}                            
                                        /> 
                                        <Button
                                            preset="secondary"                            
                                            tx='commonCancel'
                                            onPress={resetState}                            
                                        />   
                                    </View>
                                    <ListItem
                                        textStyle={{fontSize: 12, color: hint}}
                                        leftIcon='faInfoCircle'
                                        tx='contactsScreen_ownName_betaWarning'
                                    />
                                </>
                            )}
                        </View>
                    }
                />
            )}
        {isLoading && <Loading />}
        </ScrollView>
        <BottomModal
          isVisible={isResultModalVisible ? true : false}
          ContentComponent={            
            <>             
                <ResultModalInfo
                    icon="faCheckCircle"
                    iconColor={colors.palette.success200}
                    title={translate("commonSuccess")}
                    message={resultModalInfo?.message as string}
                />
                <View style={$payButtonContainer}>
                <Button
                    preset="secondary"
                    tx={'commonClose'}
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

  
const $screen: ViewStyle = {
    // flex: 1

}


const $contentContainer: TextStyle = {    
    // flex:1,
    padding: spacing.extraSmall,
    //marginBottom: spacing.medium
}

const $iconContainer: ViewStyle = {
    // marginTop: -spacing.extraLarge * 2,
    alignItems: 'center',
}

const $supportText: TextStyle = {
    padding: spacing.small,
    textAlign: 'center',
    fontSize: 16,
}

const $card: ViewStyle = {
    //marginBottom: 0,
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
    flexDirection: 'row',
    // justifyContent: 'center',
    // alignItems: 'center',
    // alignSelf: 'stretch',
    padding: spacing.extraSmall,
}

const $ownNameInput: TextStyle = {  
    flex: 1,    
    borderTopLeftRadius: spacing.extraSmall,
    borderBottomLeftRadius: spacing.extraSmall,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $ownNameDomain: TextStyle = {    
    marginRight: spacing.small,
    marginLeft: -spacing.small,
    borderTopRightRadius: spacing.extraSmall,
    borderBottomRightRadius: spacing.extraSmall,    
    padding: spacing.extraSmall,
    alignSelf: 'stretch',
    justifyContent: 'center'
}
  
const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.extraSmall,    
}

const $ownNameButton: ViewStyle = {
    maxHeight: 50,
}
