import {observer} from 'mobx-react-lite'
import React, {useEffect, useRef, useState} from 'react'
import {FlatList, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import {colors, spacing, useThemeColor} from '../../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../../components'
import {useStores} from '../../models'
import {ContactsStackParamList} from '../../navigation'
import { MinibitsClient, NostrClient, NostrProfile } from '../../services'
import AppError, { Err } from '../../utils/AppError'
import {MINIBITS_NIP05_DOMAIN} from '@env'
import { log } from '../../utils/logger'
import { ContactListItem } from './ContactListItem'
import { Contact, ContactType } from '../../models/Contact'
import { StackNavigationProp } from '@react-navigation/stack'
import { ReceiveOption } from '../ReceiveOptionsScreen'
import { SendOption } from '../SendOptionsScreen'
import { infoMessage } from '../../utils/utils'



export const PrivateContacts = observer(function (props: {
    navigation: StackNavigationProp<ContactsStackParamList, "Contacts", undefined>,     
    paymentOption: ReceiveOption | SendOption | undefined}
) { 
    const {contactsStore, relaysStore} = useStores()
    const {navigation} = props
    const contactNameInputRef = useRef<TextInput>(null)
 
    const [info, setInfo] = useState('')
    const [newContactName, setNewContactName] = useState<string>('')    
    const [isLoading, setIsLoading] = useState(false) 
    const [isExternalDomain, setIsExternalDomain] = useState(false)        
    const [isNewContactModalVisible, setIsNewContactModalVisible] = useState(false)            
    const [error, setError] = useState<AppError | undefined>()
   
    useEffect(() => {        
        const { paymentOption } = props

        if (paymentOption && paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST) {
            infoMessage('Select contact to send your payment request to.')
        }

        if (paymentOption && paymentOption === SendOption.SEND_TOKEN) {
            infoMessage('Select contact to send your ecash to.')
        }
    }, [])
    
    useEffect(() => {        
        const focus = () => {
            contactNameInputRef && contactNameInputRef.current
            ? contactNameInputRef.current.focus()
            : false
        }

        // contactsStore.removeAllContacts()
  
        if (isNewContactModalVisible) {
          setTimeout(() => focus(), 100)
        }
    }, [isNewContactModalVisible])

    
    const toggleNewContactModal = () => {
        setIsNewContactModalVisible(previousState => !previousState)
    }


    const toggleExternalDomain = () => {
        setIsExternalDomain(previousState => !previousState)
    }


    const saveNewContact = async function () {      
        log.trace('Start', newContactName, 'saveNewContact')
        
        if(!newContactName) {
            setInfo(`Please enter a wallet profile name in name@domain.com format`)
            return
        }

        toggleNewContactModal() // close
        setIsLoading(true)
        const contactNip05 = (isExternalDomain) ? newContactName : newContactName + MINIBITS_NIP05_DOMAIN

        try {

            let newContact: Contact | undefined = undefined
            
            if (isExternalDomain) {
                // validate and get profile data from nip05 server + relays
                const profile = await getNostrProfile(contactNip05) as NostrProfile
                const {pubkey, npub, nip05, name, picture} = profile

                newContact = {
                    type: ContactType.PRIVATE,
                    pubkey,
                    npub,
                    nip05,
                    name,
                    picture,
                    isExternalDomain,
                } as Contact

            } else {
                // do it with single api call for minibts.cash profiles
                const profileRecord = await MinibitsClient.getWalletProfileByNip05(contactNip05)
                const npub = NostrClient.getNpubkey(profileRecord.pubkey)
                const {pubkey, nip05, name, avatar: picture} = profileRecord

                newContact = {
                    type: ContactType.PRIVATE,
                    pubkey,
                    npub,
                    nip05,
                    name,
                    picture,
                    isExternalDomain
                } as Contact
            }        
            
            contactsStore.addContact(newContact)

            setNewContactName('')
            setIsExternalDomain(false)
            setIsLoading(false)

        } catch(e: any) {
            handleError(e)
        }
    }


    const getNostrProfile = async function (contactNip05: string) {        
        let relaysToConnect: string[] = []
        // get nip05 record from the .well-known server
        const {nip05Pubkey, nip05Relays} = await NostrClient.getNip05PubkeyAndRelays(contactNip05)

        if(nip05Relays.length > 0) {
            for (const relay of nip05Relays) {
                relaysStore.addOrUpdateRelay({
                    url: relay,
                    status: WebSocket.CLOSED
                })
            }
        }

        relaysToConnect = relaysStore.allUrls       

        const profile: NostrProfile = await NostrClient.getProfileFromRelays(nip05Pubkey, relaysToConnect)

        if(!profile) {
            setNewContactName('')
            toggleNewContactModal()
            setInfo(`Wallet profile for ${contactNip05} could not be found. Check that the name is correct.`)
            return
        }

        if(profile.nip05 !== contactNip05) {
            throw new AppError(Err.VALIDATION_ERROR, 'Profile from the relay does not match the given nip05 identifier', {contactNip05, profile})
        }

        if(!profile.name) {
            profile.name = NostrClient.getNameFromNip05(contactNip05) as string
        }

        if(!profile.pubkey) {
            profile.pubkey = nip05Pubkey
        }            
        
        const npub = NostrClient.getNpubkey(profile.pubkey)

        return {...profile, npub} as NostrProfile
    }
    

    const gotoNew = function () {        
        toggleNewContactModal()
    }

    const gotoContactDetail = async function (contact: Contact) {
        try {
            const {paymentOption} = props        
            
            log.trace('paymentOption', {paymentOption}, 'gotoContactDetail')
            
            const relays = relaysStore.allUrls
            
            if(paymentOption && paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST) { // Topup tx contact selection
                
                if(contact.nip05) {                
                    await NostrClient.verifyNip05(contact.nip05 as string, contact.pubkey) // throws
                }
                
                navigation.navigate('WalletNavigator', { 
                    screen: 'Topup',
                    params: {
                        paymentOption, 
                        contact, 
                        relays // TODO remove, switch to relaysStore
                    },
                })

                //reset
                navigation.setParams({
                    paymentOption: undefined,
                })
                
                return

            }

            if(paymentOption && paymentOption === SendOption.SEND_TOKEN) { // Send tx contact selection
            
                if(contact.nip05) {                
                    await NostrClient.verifyNip05(contact.nip05 as string, contact.pubkey) // throws
                }
                
                navigation.navigate('WalletNavigator', { 
                    screen: 'Send',
                    params: {
                        paymentOption, 
                        contact, 
                        relays // TODO remove, switch to relaysStore
                    },
                })

                //reset
                navigation.setParams({
                    paymentOption: undefined,
                })
                
                return
            }

            navigation.navigate('ContactDetail', {                   
                contact, 
                relays    // TODO remove, switch to relaysStore 
            })
        } catch (e: any) {
            handleError(e)
        }
    }

    const gotoProfile = function () {        
        navigation.navigate('Profile')
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const domainText = useThemeColor('textDim')
    const inputBg = useThemeColor('background')

    return (
    <Screen contentContainerStyle={$screen}>        
        <View style={$contentContainer}>
            {contactsStore.count > 0 ? (
            <Card
                ContentComponent={
                    <>  
                        <FlatList<Contact>
                            data={contactsStore.all as Contact[]}
                            renderItem={({ item, index }) => {                                
                                return(
                                    <ContactListItem                                        
                                        contact={item}
                                        isFirst={index === 0}
                                        gotoContactDetail={() => gotoContactDetail(item)}                  
                                    />
                                )
                            }}
                            keyExtractor={(item) => item.pubkey} 
                            style={{ flexGrow: 0  }}
                        />
                    </>
                }
                style={$card}
            />
            ) : (
                <Card
                    ContentComponent={
                        <>
                        <ListItem
                            leftIcon='faComment'
                            leftIconInverse={true}
                            leftIconColor={colors.palette.iconGreen200}
                            text='Private contacts'
                            subText={"Add other Minibits users as your private contacts. Every user gets sharable wallet name in an email-like format. You can pay privately to your contacts anytime without cumbersome token copying / pasting."}
                            onPress={gotoNew}
                        />
                        <ListItem
                            leftIcon='faCircleUser'
                            leftIconInverse={true}
                            leftIconColor={colors.palette.iconMagenta200}
                            text="Switch your wallet name and picture?"
                            subText={"Get cooler wallet name or profile picture. Select from an array of random names and images or opt for your own @minibits.cash wallet name."}
                            onPress={gotoProfile}
                            topSeparator={true}
                        />                     
                        </>
                    }
                    style={$card}                
                /> 
            )}            
            {isLoading && <Loading />}
        </View>
        <View style={$bottomContainer}>
            <View style={$buttonContainer}>
                <Button
                    tx={'contactsScreen.new'}
                    LeftAccessory={() => (
                        <Icon
                        icon='faCircleUser'
                        color='white'
                        size={spacing.medium}                  
                        />
                    )}
                    onPress={gotoNew}
                    style={$buttonNew}
                    />                
            </View>
        </View>       
        <BottomModal
            isVisible={isNewContactModalVisible ? true : false}            
            ContentComponent={
                <View style={$newContainer}>
                    <Text tx='contactsScreen.newTitle' preset="subheading" />
                    <Text size='xxs' style={{color: domainText}} text='Private contacts are unique identifiers of other Minibits wallets. You can use them to send or request ecash and you can safely share your own with others. Like account numbers, just better.' />
                    <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                        <TextInput
                            ref={contactNameInputRef}
                            onChangeText={newContactName => setNewContactName(newContactName)}
                            value={newContactName}
                            autoCapitalize='none'
                            keyboardType='default'
                            maxLength={16}                            
                            selectTextOnFocus={true}
                            style={[$contactInput, {backgroundColor: inputBg}, (isExternalDomain) && {marginRight: spacing.small, borderTopRightRadius: spacing.small, borderBottomRightRadius: spacing.small}]}                        
                        />
                        {!isExternalDomain && (
                            <View style={[$contactDomain, { backgroundColor: inputBg}]}>
                                <Text size='xxs' style={{color: domainText}} text={MINIBITS_NIP05_DOMAIN}/>
                            </View>
                        )}
                        <Button
                            tx={'common.save'}
                            style={{
                                borderRadius: spacing.small,
                                marginRight: spacing.small,
                            }}
                            onPress={saveNewContact}
                        />
                    </View>                    
                    <Button
                        preset='tertiary'
                        text={isExternalDomain ? 'Use minibits.cash domain' : 'Use another NIP05 domain'}
                        onPress={toggleExternalDomain}
                        style={{alignSelf: 'flex-start', minHeight: verticalScale(30)}}
                        textStyle={{lineHeight: verticalScale(16), fontSize: 12}}   
                    />
                </View>
            }
            onBackButtonPress={toggleNewContactModal}
            onBackdropPress={toggleNewContactModal}
        /> 
        {info && <InfoModal message={info} />}
        {error && <ErrorModal error={error} />}
    </Screen>
    )
  })


const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'row',
  paddingBottom: spacing.medium,
  // height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
    // flex: 1,
    padding: spacing.extraSmall,
  }

const $card: ViewStyle = {
  marginBottom: 0,
  // flex: 1,
  
}

const $bottomModal: ViewStyle = {
  // flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.large,
  paddingHorizontal: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $newContainer: TextStyle = {
    //padding: spacing.small,
    alignItems: 'center',
}

const $contactInput: TextStyle = {
    flex: 1,    
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $contactDomain: TextStyle = {    
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
  
  const $buttonNew: ViewStyle = {
    borderRadius: 30,    
    minWidth: verticalScale(110),    
  }  
