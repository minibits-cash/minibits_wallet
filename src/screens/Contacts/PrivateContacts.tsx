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
import { log } from '../../services/logService'
import { ContactListItem } from './ContactListItem'
import { Contact, ContactType } from '../../models/Contact'
import { StackNavigationProp } from '@react-navigation/stack'
import { ReceiveOption } from '../ReceiveOptionsScreen'
import { SendOption } from '../SendOptionsScreen'
import { infoMessage, warningMessage } from '../../utils/utils'
import { IncomingDataType, IncomingParser } from '../../services/incomingParser'
import { translate } from '../../i18n'
import { RouteProp } from '@react-navigation/native'



export const PrivateContacts = observer(function (props: {
    navigation: StackNavigationProp<ContactsStackParamList, "Contacts", undefined>,             
    paymentOption: ReceiveOption | SendOption | undefined},    
) { 
    const {contactsStore, relaysStore, userSettingsStore} = useStores()
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
            // infoMessage('Select contact to send your payment request to.')
        }

        if (paymentOption && paymentOption === SendOption.SEND_TOKEN) {
            // infoMessage('Select contact to send your ecash to.')
        }

        if (paymentOption && paymentOption === SendOption.LNURL_ADDRESS) {
            // infoMessage('Select contact to send Lightning payment to.')
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
            setInfo(translate("contactsScreen.privateContacts.saveNewFormat"))
            return
        }

        toggleNewContactModal() // close
        setIsLoading(true)
        
        try {

            let newContact: Contact | undefined = undefined
            
            if (isExternalDomain) {
                // validate and get profile data from nip05 server + relays

                const profile = await NostrClient.getNormalizedNostrProfile(newContactName, relaysStore.allPublicUrls) as NostrProfile

                log.trace('[saveNewContact]', 'Server profile', profile)

                const {pubkey, npub, name, picture, nip05, lud16} = profile

                newContact = {
                    type: ContactType.PRIVATE,
                    pubkey,
                    npub,
                    name,
                    picture,
                    nip05,
                    lud16,
                    isExternalDomain,
                } as Contact

            } else {
                // do it with single api call for minibts.cash profiles                
                const profileRecord = await MinibitsClient.getWalletProfileByNip05(newContactName + MINIBITS_NIP05_DOMAIN)

                if(!profileRecord) {
                    warningMessage(translate("contactsScreen.privateContacts.profileNotFound", { name: newContactName + MINIBITS_NIP05_DOMAIN }))
                    setIsLoading(false)
                    return
                }

                const npub = NostrClient.getNpubkey(profileRecord.pubkey)
                const {pubkey, nip05, name, avatar: picture} = profileRecord

                newContact = {
                    type: ContactType.PRIVATE,
                    pubkey,
                    npub,
                    nip05,
                    lud16: nip05, // minibits addresses are both nostr and lightning addresses
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


    
    const gotoNew = function () {        
        toggleNewContactModal()
    }

    const gotoContactDetail = async function (contact: Contact) {
        try {
            const {paymentOption} = props        
            
            log.trace('paymentOption', {paymentOption}, 'gotoContactDetail')
            
            if(paymentOption && paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST) { // Topup tx contact selection
                setIsLoading(true)
                
                if(contact.nip05) {                
                    await NostrClient.verifyNip05(contact.nip05 as string, contact.pubkey) // throws
                }

                // contactsStore.selectContact(contact)
                navigation.navigate('WalletNavigator', { 
                    screen: 'Topup',
                    params: {
                        paymentOption,
                        contact                             
                    },                                            
                })
                
                setIsLoading(false)
                return
            }


            if(paymentOption && paymentOption === SendOption.SEND_TOKEN) { // Send tx contact selection
                setIsLoading(true)

                if(contact.nip05) {                
                    await NostrClient.verifyNip05(contact.nip05 as string, contact.pubkey) // throws
                }
                
                navigation.navigate('WalletNavigator', { 
                    screen: 'Send',
                    params: {
                        paymentOption, 
                        contact                        
                    },
                })

                setIsLoading(false)
                return
            }


            if(paymentOption && paymentOption === SendOption.LNURL_ADDRESS) {
                if(!contact.lud16) {
                    setInfo(translate("contactsScreen.privateContacts.noLightningAddress"))
                    return
                }

                await IncomingParser.navigateWithIncomingData({
                    type: IncomingDataType.LNURL_ADDRESS,
                    encoded: contact.lud16
                }, navigation, userSettingsStore.preferredUnit)

                //reset
                navigation.setParams({
                    paymentOption: undefined,
                })

                return
            }

            navigation.navigate('ContactDetail', {contact})

        } catch (e: any) {
            // reset so that invalid contact can be deleted
            navigation.setParams({
                paymentOption: undefined,
            })

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
    const iconColor = useThemeColor('textDim')
    const inputBg = useThemeColor('background')
    const iconBottom = useThemeColor('button')

    return (
      <Screen contentContainerStyle={$screen}>
        <View style={$contentContainer}>
          {contactsStore.count > 0 ? (
            <Card
              ContentComponent={
                <FlatList<Contact>
                  data={contactsStore.all as Contact[]}
                  renderItem={({item, index}) => {
                    return (
                      <ContactListItem
                        contact={item}
                        isFirst={index === 0}
                        gotoContactDetail={() => gotoContactDetail(item)}
                      />
                    )
                  }}
                  keyExtractor={item => item.pubkey}
                  style={{flexGrow: 0}}
                />
              }
              style={$card}
            />
          ) : (
            <Card
              ContentComponent={
                <>
                  <ListItem
                    leftIcon="faComment"
                    leftIconInverse={true}
                    leftIconColor={colors.palette.iconGreen200}
                    tx='contactsScreen.privateContacts.explainerText'
                    subTx="contactsScreen.privateContacts.explainerSubText"
                    onPress={gotoNew}
                  />
                  <ListItem
                    leftIcon="faCircleUser"
                    leftIconInverse={true}
                    leftIconColor={colors.palette.iconMagenta200}
                    tx="contactsScreen.privateContacts.switchName"
                    subTx='contactsScreen.privateContacts.switchNameSubText'
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
                    LeftAccessory={() => (
                        <Icon
                            icon='faPlus'
                            size={spacing.large}
                            color={iconBottom}
                        />
                    )}
                    onPress={gotoNew}                        
                    style={$buttonNew}
                    preset='tertiary'
                    text='Add'
                />            
            </View>
        </View>       
        <BottomModal
          isVisible={isNewContactModalVisible ? true : false}
          ContentComponent={
            <View style={$newContainer}>
              <Text tx="contactsScreen.newTitle" preset="subheading" />
              <Text
                size="xxs"
                style={{color: domainText}}
                tx="contactsScreen.privateContacts.bottomModal"
              />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: spacing.small,
                }}>
                <TextInput
                  ref={contactNameInputRef}
                  onChangeText={newContactName =>
                    setNewContactName(newContactName)
                  }
                  value={newContactName}
                  autoCapitalize="none"
                  keyboardType="default"
                  maxLength={60}
                  selectTextOnFocus={true}
                  style={[
                    $contactInput,
                    {backgroundColor: inputBg},
                    isExternalDomain && {
                      marginRight: spacing.small,
                      borderTopRightRadius: spacing.small,
                      borderBottomRightRadius: spacing.small,
                    },
                  ]}
                />
                {!isExternalDomain && (
                  <View style={[$contactDomain, {backgroundColor: inputBg}]}>
                    <Text
                      size="xxs"
                      style={{color: domainText}}
                      text={MINIBITS_NIP05_DOMAIN}
                    />
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
                preset="tertiary"
                tx={
                  isExternalDomain
                    ? 'contactsScreen.privateContacts.domainMinibits'
                    : 'contactsScreen.privateContacts.domainExternal'
                }
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

const $contentContainer: TextStyle = {
    flex: 1,
    padding: spacing.extraSmall,
}

const $card: ViewStyle = {
  marginBottom: 0,
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
    //marginVertical: spacing.medium,
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
  
  const $buttonNew: ViewStyle = {
    // borderRadius: 30,    
    minWidth: verticalScale(60), 
  }  
