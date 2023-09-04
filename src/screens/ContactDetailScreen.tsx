import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {ColorValue, Image, Share, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import { spacing, useThemeColor} from '../theme'
import {ContactsStackScreenProps} from '../navigation'
import {Icon, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, ListItem} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import Clipboard from '@react-native-clipboard/clipboard'
import { ContactType } from '../models/Contact'
import { WalletProfileRecord } from '../models/WalletProfileStore'
import { MinibitsClient } from '../services'
import { getImageSource } from '../utils/utils'


interface ContactDetailScreenProps extends ContactsStackScreenProps<'ContactDetail'> {}

export const ContactDetailScreen: FC<ContactDetailScreenProps> = observer(
  function ContactScreen({route, navigation}) {
    const {contact, relays} = route.params
    const amountToSendInputRef = useRef<TextInput>(null)    
    const {proofsStore, contactsStore} = useStores()

    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        rightIcon: 'faEllipsisVertical',
        onRightPress: () => toggleContactModal(),       
    })    
     
    const [amountToSend, setAmountToSend] = useState('')
    const [availableBalance, setAvailableBalance] = useState(0)
    const [isSendModalVisible, setIsSendModalVisible] = useState(false)    
    const [isContactModalVisible, setIsContactModalVisible] = useState(false) 
    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const focus = () => {
            amountToSendInputRef && amountToSendInputRef.current
            ? amountToSendInputRef.current.focus()
            : false
        }
  
        if (isSendModalVisible) {
          setTimeout(() => focus(), 100)
        }
    }, [isSendModalVisible])


    useEffect(() => {
        const load = async () => {
            const maxBalance = proofsStore.getMintBalanceWithMaxBalance()
            if(maxBalance && maxBalance.balance > 0) {
                setAvailableBalance(maxBalance.balance)
            }  
        }
  
        load()
    }, [isSendModalVisible])

    const toggleContactModal = () => {
        setIsContactModalVisible(previousState => !previousState)
    }

    const toggleSendModal = () => {
        setIsSendModalVisible(previousState => !previousState)
    }

    const onCopyNpub = function () {        
        try {
            Clipboard.setString(contact.npub)
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
        }
    }

    const onSendCoins = async function () {  
        if(parseInt(amountToSend) > availableBalance) {
            setInfo('Amount to send is higher than your available balance.')
            return
        }

        if(parseInt(amountToSend) === 0) {
            setInfo('Amount should be positive number.')
            return
        }

        toggleSendModal()

        try {
            if(contact.type && contact.type === ContactType.PRIVATE) {
                // check before payment that contact name is still linked to the same pubkey
                const profileRecord: WalletProfileRecord = 
                await MinibitsClient.getWalletProfileByWalletId(contact.name as string)

                if(!profileRecord || profileRecord.pubkey !== contact.pubkey) {
                    throw new AppError(Err.VALIDATION_ERROR, `${contact.name} is no longer linked to the public key stored in your contacts. Please get in touch with the payee and update your information.`)
                }
            }        
        
            navigation.navigate('WalletNavigator', { 
                screen: 'Send',
                params: {
                    amountToSend, 
                    contact, 
                    relays
                },
            })
            
            return
        } catch (e: any) {
            handleError(e)
        }
        
    }


    const onSyncContact = async function () {
        try {
            // check before payment that contact name is still linked to the same pubkey
            const profileRecord: WalletProfileRecord = 
            await MinibitsClient.getWalletProfileByWalletId(contact.name as string)

            if(!profileRecord || profileRecord.pubkey !== contact.pubkey) {
                throw new AppError(Err.VALIDATION_ERROR, `${contact.name} is no longer linked to the public key stored in your contacts. Please get in touch with the contact and update your information.`)
            }                

            contactsStore.updatePicture(contact.pubkey, profileRecord.avatar) // hm, this does not change

            toggleContactModal()            
            setInfo('Sync completed')
            return
        } catch (e: any) {
            handleError(e)
        }
        navigation.goBack()
    }

    const onDeleteContact = function () {
        contactsStore.removeContact(contact)
        navigation.goBack()
    }


    const handleError = function (e: AppError): void {        
        setError(e)
    }

    const iconNpub = useThemeColor('textDim')
    const balanceColor = useThemeColor('textDim')
    const headerBg = useThemeColor('header')
    const inputBg = useThemeColor('background')
    
    return (
      <Screen contentContainerStyle={$screen} preset='auto'>        
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
            {contact.picture ? (
                <View style={{borderRadius: 48, overflow: 'hidden'}}>
                    <Image style={{width: 96, height: 96}} source={{uri: getImageSource(contact.picture)}} />
                </View>
            ) : (
                <Icon
                    icon='faCircleUser'                                
                    size={80}                    
                    color={'white'}                
                />
            )}
            <Text preset='bold' text={contact.name} style={{color: 'white', marginBottom: spacing.small}} />          
        </View>
        <View style={$contentContainer}>
            {contact.about && (
                <Card
                    style={$card}
                    content={contact.about}
                />
            )}
            <View style={[$buttonContainer, {marginTop: spacing.medium}]}>
                <Button 
                    preset='default'
                    onPress={toggleSendModal}
                    text={`Send sats to ${contact.name}`}
                />
            </View> 
        </View>
        <View style={$bottomContainer}>
                <View style={$buttonContainer}>
                    <Icon icon='faCopy' size={spacing.small} color={iconNpub as ColorValue} />
                    <Button
                        preset='secondary'
                        textStyle={{fontSize: 12}}
                        text={contact.npub.slice(0,15)+'...'}
                        onPress={onCopyNpub}
                    /> 
                </View>    
        </View>
        <BottomModal
          isVisible={isContactModalVisible ? true : false}
          top={spacing.screenHeight * 0.55}
          ContentComponent={               
            <>
                <ListItem
                    text="Copy contact's public key (npub)"
                    subText={contact.npub.slice(0,30)+'...'}
                    leftIcon='faCopy'                            
                    onPress={onCopyNpub}
                    bottomSeparator={true}
                    style={{paddingHorizontal: spacing.medium}}
                />
                {contact.type === ContactType.PRIVATE && (
                    <>
                        <ListItem
                            text='Sync contact'
                            subText='Check that contact name is still linked to the same pubkey match and update picture if it was changed.'
                            leftIcon='faRotate'                            
                            onPress={onSyncContact}
                            bottomSeparator={true}
                            style={{paddingHorizontal: spacing.medium}}
                        />
                        <ListItem
                            text='Delete contact'
                            subText='Remove this contact from your wallet.'
                            leftIcon='faXmark'                            
                            onPress={onDeleteContact}
                            bottomSeparator={true}
                            style={{paddingHorizontal: spacing.medium}}
                        />
                    </>
                )}     
            </>
          }
          onBackButtonPress={toggleContactModal}
          onBackdropPress={toggleContactModal}
        />
        <BottomModal
          isVisible={isSendModalVisible ? true : false}
          top={spacing.screenHeight * 0.26}
          ContentComponent={
                <View style={$payContainer}>
                    {contact.type === ContactType.PUBLIC && (
                        <Text text={`Tip or donate to ${contact.name}`} preset="subheading" />
                    )}
                    {contact.type === ContactType.PRIVATE && (
                        <Text text={`Send to ${contact.name}`} preset="subheading" />
                    )}
                    <Text text={`You can send up to ${availableBalance.toLocaleString()} sats`} size='xs' style={{color: balanceColor}} />                   
                    <View style={{alignItems: 'center'}}>
                        <TextInput
                            ref={amountToSendInputRef}
                            onChangeText={(value) => setAmountToSend(value)}
                            value={amountToSend}
                            autoCapitalize='none'
                            keyboardType='numeric'
                            maxLength={9}                            
                            selectTextOnFocus={true}
                            style={[$amountInput]}                        
                        />

                    </View>
                    {contact.type === ContactType.PUBLIC && (
                        <View style={$buttonContainer}>
                            <Button preset='secondary' style={{marginRight: spacing.small}} onPress={() => setAmountToSend('100')} text='100 sats'/>
                            <Button preset='secondary' style={{marginRight: spacing.small}} onPress={() => setAmountToSend('500')} text='500 sats'/>
                            <Button preset='secondary' onPress={() => setAmountToSend('1000')} text='1000 sats'/>                    
                        </View>
                    )}
                    <View style={[$buttonContainer, {marginTop: spacing.medium}]}>
                        <Button
                                text='Continue'
                                style={$sendButton}
                                onPress={onSendCoins}                                
                        /> 
                    </View>                                 
                </View>
          }
          onBackButtonPress={toggleSendModal}
          onBackdropPress={toggleSendModal}
        />
        {info && <InfoModal message={info} />}
        {error && <ErrorModal error={error} />}
    </Screen>
    )
  },
)


const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: spacing.medium,
    height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
    // flex: 1,
    padding: spacing.extraSmall,
    // alignItems: 'center',
}

const $payContainer: TextStyle = {
    padding: spacing.small,
    alignItems: 'center',
}

const $amountInput: TextStyle = {
    // flex: 1,
    borderRadius: spacing.small,
    fontSize: 36,
    fontWeight: '400',
    textAlignVertical: 'center',
    textAlign: 'center',
    color: 'white',
}

const $satsLabel: ViewStyle = {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    alignSelf: 'stretch',
    justifyContent: 'center', 
}

const $sendButton: ViewStyle = {
    borderRadius: spacing.small,
    marginLeft: spacing.small,
    minWidth: 100,
}


const $bottomContainer: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',    
    alignSelf: 'stretch',    
  }

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
}

const $qrCodeContainer: ViewStyle = {
    backgroundColor: 'white',
    padding: spacing.small,
    margin: spacing.small,
}

const $card: ViewStyle = {
    // marginVertical: 0,
}

const $item: ViewStyle = {
    // paddingHorizontal: spacing.small,
    paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
    padding: spacing.extraSmall,
    alignSelf: 'center',
    marginLeft: spacing.small,
}

