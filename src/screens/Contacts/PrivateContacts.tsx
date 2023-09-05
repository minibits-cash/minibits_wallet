import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {FlatList, Image, Pressable, ScrollView, Share, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import {colors, spacing, typography, useThemeColor} from '../../theme'
import {BottomModal, Button, Card, ErrorModal, Header, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../../components'
import {useStores} from '../../models'
import {ContactsStackParamList, ContactsStackScreenProps} from '../../navigation'
import { MinibitsClient, NostrClient, KeyPair, Database } from '../../services'
import AppError, { Err } from '../../utils/AppError'
import {MINIBITS_NIP05_DOMAIN} from '@env'
import { log } from '../../utils/logger'
import { useFocusEffect } from '@react-navigation/native'
import { ContactListItem } from './ContactListItem'
import { Contact, ContactType } from '../../models/Contact'
import { StackNavigationProp } from '@react-navigation/stack'
import { WalletProfileRecord } from '../../models/WalletProfileStore'



export const PrivateContacts = observer(function (props: {
    navigation: StackNavigationProp<ContactsStackParamList, "Contacts", undefined>, 
    amountToSend: string | undefined}
) { 
    const {contactsStore} = useStores()
    const {navigation} = props
    const contactIdInputRef = useRef<TextInput>(null)
 
    const [info, setInfo] = useState('')
    const [newContactId, setNewContactId] = useState<string>('') 
    const [isLoading, setIsLoading] = useState(false)        
    const [isNewContactModalVisible, setIsNewContactModalVisible] = useState(false)            
    const [error, setError] = useState<AppError | undefined>()
   
    useEffect(() => {        
        const focus = () => {
            contactIdInputRef && contactIdInputRef.current
            ? contactIdInputRef.current.focus()
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

    const saveNewContact = async function () {        
        const profileRecord: WalletProfileRecord = 
            await MinibitsClient.getWalletProfileByWalletId(newContactId)

        if(!profileRecord) {
            setNewContactId('')
            toggleNewContactModal()
            setInfo(`Wallet profile for ${newContactId + MINIBITS_NIP05_DOMAIN} could not be found. Check that the name is correct.`)
            return
        }

        setNewContactId('')
        toggleNewContactModal()

        const npub = NostrClient.getNpubkey(profileRecord.pubkey)
        const {pubkey, nip05, avatar: picture, walletId: name} = profileRecord       
        
        const newContact: Contact = {
            type: ContactType.PRIVATE,
            pubkey,
            npub,
            nip05,
            name,
            picture
        }

        log.trace('New private contact', newContact, 'saveNewContact')
        
        contactsStore.addContact(newContact)
    }
    

    const gotoNew = function () {        
        toggleNewContactModal()
    }

    const gotoContactDetail = async function (contact: Contact) {
        const {amountToSend} = props 
        
        log.trace('amountToSend', amountToSend)
        if(amountToSend) { // Send tx contact selection
            try {
                if(contact.nip05) {                
                    await NostrClient.verifyNip05(contact.nip05 as string, contact.pubkey) // throws
                }
                
                navigation.navigate('WalletNavigator', { 
                    screen: 'Send',
                    params: {
                        amountToSend, 
                        contact, 
                        relays: NostrClient.getMinibitsRelays()
                    },
                })

                //reset
                navigation.setParams({
                    amountToSend: '',
                })
                
                return
            } catch (e: any) {
                handleError(e)
            }
        }

        navigation.navigate('ContactDetail', {                   
            contact, 
            relays: NostrClient.getMinibitsRelays()        
        })
    }

    const gotoProfile = function () {        
        navigation.navigate('Profile')
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const rightIcon = useThemeColor('textDim')
    const domainText = useThemeColor('textDim')
    const screenBg = useThemeColor('background')
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
            top={spacing.screenHeight * 0.4}
            ContentComponent={
                <View style={$newContainer}>
                    <Text tx='contactsScreen.newTitle' preset="subheading" />
                    <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                        <TextInput
                            ref={contactIdInputRef}
                            onChangeText={newContactId => setNewContactId(newContactId)}
                            value={newContactId}
                            autoCapitalize='none'
                            keyboardType='default'
                            maxLength={16}
                            selectTextOnFocus={true}
                            style={[$contactInput, {backgroundColor: inputBg}]}                        
                        />
                        <View style={[$contactDomain, { backgroundColor: inputBg}]}>
                            <Text size='xxs' style={{color: domainText}} text={MINIBITS_NIP05_DOMAIN}/>
                        </View>
                        <Button
                            tx={'common.save'}
                            style={{
                                borderRadius: spacing.small,
                                marginRight: spacing.small,
                            }}
                            onPress={saveNewContact}
                        />
                    </View>
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
    padding: spacing.small,
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
