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
import { ResultModalInfo } from '../Wallet/ResultModalInfo'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { SendOption } from '../SendScreen'
import { translate } from '../../i18n'
import { CurrencyAmount } from '../Wallet/CurrencyAmount'
import { CurrencyCode } from '../../services/wallet/currency'
import { QRCodeBlock } from '../Wallet/QRCode'
import { MintBalance } from '../../models/Mint'
import { MintListItem } from '../Mints/MintListItem'
import Clipboard from '@react-native-clipboard/clipboard'
import { round, roundUp } from '../../utils/number'

const DEFAULT_DONATION_AMOUNT = 500

export const OwnName = observer(function (props: {navigation: any, pubkey: string}) { 
    // const navigation = useNavigation() 
    const ownNameInputRef = useRef<TextInput>(null)
    const {proofsStore, walletProfileStore, userSettingsStore, mintsStore} = useStores()
    const {pubkey, navigation} = props 
    
    const [ownName, setOwnName] = useState<string>('')
    const [info, setInfo] = useState('')        
    const [selectedBalance, setSelectedBalance] = useState<MintBalance | undefined>(undefined)
    const [donationAmount, setDonationAmount] = useState(DEFAULT_DONATION_AMOUNT)
    const [donationInvoice, setDonationInvoice] = useState<{payment_hash: string, payment_request: string} | undefined>(undefined)
    const [isLoading, setIsLoading] = useState(false)    
    const [isQRcodeVisible, setIsQRCodeVisible] = useState(false)
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
                maxPolls: 120,
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
          message: translate("contactsScreen.ownName.donationSuccess", { receiver: ownName + MINIBITS_NIP05_DOMAIN })
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
        setIsQRCodeVisible(false)
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
            setInfo(translate('contactsScreen.ownName.tooShort'))
            return
        }

        if(!isValidName(ownName)) {
            setInfo(translate('contactsScreen.ownName.illegalChar'))
            return
        }

        try {            
            const profileExists = await MinibitsClient.getWalletProfileByNip05(ownName + MINIBITS_NIP05_DOMAIN)

            if(profileExists) {
                setInfo(translate("contactsScreen.ownName.profileExists"))
                return
            }

            setIsChecked(true)
            // setIsNameInputEnabled(false)
            // setIsPaymentModalVisible(true)
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
                const feeReserve = roundUp(donationAmount / 100, 0)

                if(!selectedBalance || donationAmount >= selectedBalance.balances['sat']! + feeReserve) {
                    setIsQRCodeVisible(true)
                }
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


    const onPayDonation = async function () {
        try {            
            return navigation.navigate('WalletNavigator', { 
                screen: 'Transfer',
                params: { 
                    encodedInvoice: donationInvoice?.payment_request,
                    unit:  userSettingsStore.preferredUnit || 'sat',
                    paymentOption: SendOption.DONATION
                },
            })
        } catch (e: any) {
            handleError(e)
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
    const small = 1000
    const medium = 1500
    const large = 2000
    const invoiceBg = useThemeColor('background')
    const invoiceTextColor = useThemeColor('textDim')
    const domainText = useThemeColor('textDim')
    
    return (
      <Screen contentContainerStyle={$screen} preset='auto'>
        <View style={$contentContainer}>
            {!isChecked ? (
                <Card
                    style={[$card, {marginTop: spacing.small}]}
                                    headingTx='contactsScreen.ownName.chooseOwnName'
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
                    footerTx='contactsScreen.ownName.chooseOwnNameFooter'
                    footerStyle={{color: hint, textAlign: 'center'}}                
                />
            ) : (
                <Card
                    style={[$card, {marginTop: spacing.small}]}
                    HeadingComponent={                    
                        <View style={$iconContainer}>
                            <Icon icon='faCheckCircle' size={50} color={colors.palette.success200} />
                            <Text
                                text={translate('contactsScreen.ownName.available',{ name: ownName })}
                                style={{fontSize: 18}}   
                            />
                        </View>
                    }      
                    ContentComponent={       
                        <View>
                            {donationInvoice ? (
                                <>
                                    <Text 
                                        text={translate("contactsScreen.ownName.payToGetOwnName", { name: ownName+MINIBITS_NIP05_DOMAIN })}
                                        style={[$supportText, {color: hint}]} 
                                    />
                                    {isQRcodeVisible && (                                        
                                        <QRCodeBlock 
                                            qrCodeData={donationInvoice.payment_request}
                                            title='Lightning invoice to pay'
                                            type='Bolt11Invoice'
                                            size={270}
                                        />
                                    )}
                                    {(!!selectedBalance && selectedBalance.balances['sat']! > donationAmount) ? (
                                        <>                                        
                                        <ListItem 
                                            text='Invoice'
                                            subText={donationInvoice.payment_request.slice(0, 20) + '...'}
                                            RightComponent={
                                                <CurrencyAmount
                                                    amount={donationAmount}
                                                    currencyCode={CurrencyCode.SAT}
                                                    size='medium'                                                    
                                                /> 
                                            }
                                            topSeparator={true}
                                            bottomSeparator={true}
                                            leftIcon='faBolt'
                                            onPress={onCopyInvoice}
                                        />
                                        <Text style={[$supportText, {color: hint}]}  text={`Pay from`} />                                        
                                        <MintListItem                             
                                            mint={mintsStore.findByUrl(selectedBalance.mintUrl)!}
                                            mintBalance={selectedBalance}
                                            selectedUnit='sat'
                                            isSelectable={true}
                                            isSelected={true}
                                            separator='both'                                            
                                        />
                                        <View style={$buttonContainer}>                            
                                            <Button
                                                preset="default"
                                                style={{marginRight: spacing.small}}
                                                tx='contactsScreen.ownName.ctaPay'
                                                onPress={onPayDonation}                            
                                            />                                                
                                            <Button
                                                preset="secondary"                            
                                                tx='common.cancel'
                                                onPress={resetState}                            
                                            />   
                                        </View>
                                        </>
                                    ) : (
                                        <View>
                                            <Text                                
                                                size='xs'
                                                style={{textAlign: 'center', margin: spacing.medium}}
                                                tx="contactsScreen.ownName.insufficient"
                                            />
                                            <View style={$buttonContainer}>                                            
                                                <Button
                                                    preset="secondary"                            
                                                    tx='common.cancel'
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
                                        kindly asks you for a small donation for your {ownName+MINIBITS_NIP05_DOMAIN} wallet address.
                                    </RNText>                                    
                                    <CurrencyAmount
                                        amount={DEFAULT_DONATION_AMOUNT}
                                        currencyCode={CurrencyCode.SAT}
                                        size='extraLarge'
                                        containerStyle={{alignSelf: 'center', marginTop: spacing.medium}}
                                    />                                    
                                    <RNText style={$supportText}>
                                        Ready to donate more?
                                    </RNText>
                                    <View style={$buttonContainer}>
                                        <Button
                                            preset="secondary"
                                            style={{marginRight: spacing.small}}
                                            text={`${small.toLocaleString()}`}
                                            onPress={() => setDonationAmount(1000)}                            
                                        />
                                        <Button
                                            preset="secondary"
                                            style={{marginRight: spacing.small}}
                                            text={`${medium.toLocaleString()}`}
                                            onPress={() => setDonationAmount(1500)}                            
                                        />
                                        <Button
                                            preset="secondary"                            
                                            text={`${large.toLocaleString()}`}
                                            onPress={() => setDonationAmount(2000)}                            
                                        />   
                                    </View>
                                    <View style={$buttonContainer}>
                                        {(donationAmount === 1000) && (                        
                                            <Text text={`♥`}  size='lg' />
                                        )}
                                        {(donationAmount === 1500) && (                        
                                            <Text text={`♥ ♥`}  size='lg' />
                                        )}
                                        {(donationAmount === 2000) && (                        
                                            <Text text={`♥ ♥ ♥`}  size='lg' />
                                        )}
                                    </View>
                                    <View style={$buttonContainer}>
                                        <Button
                                            preset="default"
                                            style={{marginRight: spacing.small}}
                                            tx='contactsScreen.getInvoice'
                                            onPress={onCreateDonation}                            
                                        /> 
                                        <Button
                                            preset="secondary"                            
                                            tx='common.cancel'
                                            onPress={resetState}                            
                                        />   
                                    </View>
                                    <View style={{flexDirection: 'row', alignItems: 'center', margin: spacing.medium}}>
                                        <Icon icon='faInfoCircle' />
                                        <Text style={{color: hint}} size='xxs' tx='contactsScreen.ownName.betaWarning'/>
                                    </View>
                                </>
                            )}
                        </View>
                    }
                />
            )}
        {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isResultModalVisible ? true : false}
          ContentComponent={            
            <>             
                <ResultModalInfo
                    icon="faCheckCircle"
                    iconColor={colors.palette.success200}
                    title={translate("common.success")}
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

  
const $screen: ViewStyle = {
    // flex: 1
}


const $contentContainer: TextStyle = {    
    // flex:1,
    padding: spacing.extraSmall,
}

const $iconContainer: ViewStyle = {
    // marginTop: -spacing.extraLarge * 2,
    alignItems: 'center',
}

const $supportText: TextStyle = {
    padding: spacing.small,
    // textAlign: 'center',
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
    marginVertical: spacing.small,    
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

  const $qrCodeContainer: ViewStyle = {
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: spacing.small,    
    marginHorizontal: spacing.small,
    marginBottom: spacing.small,
    borderRadius: spacing.small
}

const $bottomModal: ViewStyle = {    
    alignItems: 'center',
    paddingVertical: spacing.large,
}