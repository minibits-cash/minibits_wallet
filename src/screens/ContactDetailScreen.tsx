import {observer} from 'mobx-react-lite'
import React, {FC, useRef, useState} from 'react'
import {Image, Share, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import { colors, spacing, useThemeColor} from '../theme'
import {ContactsStackScreenProps} from '../navigation'
import {Icon, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, ListItem} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import Clipboard from '@react-native-clipboard/clipboard'
import { ContactType } from '../models/Contact'
import { NostrClient, log } from '../services'
import { getImageSource } from '../utils/utils'
import { moderateVerticalScale, verticalScale } from '@gocodingnow/rn-size-matters'
import { ReceiveOption } from './ReceiveOptionsScreen'
import { SendOption } from './SendOptionsScreen'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'
import { translate } from '../i18n'


interface ContactDetailScreenProps extends ContactsStackScreenProps<'ContactDetail'> {}

export const ContactDetailScreen: FC<ContactDetailScreenProps> = observer(
  function ContactScreen({route, navigation}) {
    const {contact} = route.params
    const {contactsStore, userSettingsStore} = useStores()
    const noteInputRef = useRef<TextInput>(null)

    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        rightIcon:  'faEllipsisVertical',
        onRightPress: () => toggleContactModal()
    })    
    
       
    const [isContactModalVisible, setIsContactModalVisible] = useState(false) 
    const [isShareModalVisible, setIsShareModalVisible] = useState(false) 
    const [isNoteEditing, setIsNoteEditing] = useState(contact.noteToSelf ? false : true)
    const [note, setNote] = useState(contact.noteToSelf || '')
    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()
    
    const toggleContactModal = () => {
        setIsContactModalVisible(previousState => !previousState)
    }

    const toggleShareModal = () => {
        setIsShareModalVisible(previousState => !previousState)
    }

    
    const gotoTopup = () => {
        
        navigation.navigate('WalletNavigator', { 
            screen: 'Topup',
            params: {
                paymentOption: ReceiveOption.SEND_PAYMENT_REQUEST,
                contact,
                unit: userSettingsStore.preferredUnit               
            },            
        })
    }


    const gotoSend = () => {
        log.trace('[gotoSend] start')
        navigation.navigate('WalletNavigator', { 
            screen: 'Send',            
            params: {
                paymentOption: SendOption.SEND_TOKEN,
                contact,
                unit: userSettingsStore.preferredUnit                
            },
        })
    }


    const gotoTransfer = async () => {
        try {                         
            await IncomingParser.navigateWithIncomingData({
                type: IncomingDataType.LNURL_ADDRESS,
                encoded: contact.lud16                
            }, 
            navigation,
            userSettingsStore.preferredUnit
        )    
            
            return          
        } catch (e: any) {
            handleError(e)            
        }
    }


    const onNoteSave = function () {        
        try {
          contactsStore.saveNote(contact.pubkey, note || '')
          setIsNoteEditing(false)           
        } catch (e: any) {
          setInfo(translate('common.saveFailParam', { param: e.message }))
        }
    }


    const onNoteEdit = function () {        
        setIsNoteEditing(true)

        setTimeout(() => {
            noteInputRef && noteInputRef.current
            ? noteInputRef.current.focus()
            : false
        }, 100)

    }

    const onCopyNpub = function () {        
        try {
          Clipboard.setString(contact.npub)
        } catch (e: any) {
          setInfo(translate('common.copyFailParam', { param: e.message }))
        }
    }


    const onShareContact = async () => {
        try {
            const result = await Share.share({
                message: `${contact.nip05}`,
            })

        } catch (e: any) {
            handleError(e)
        }
    }

    
    const onSyncPrivateContact = async function () {
        try {
            if(contact.nip05) {                
                await NostrClient.verifyNip05(contact.nip05 as string, contact.pubkey) // throws
            }

            contactsStore.refreshPicture(contact.pubkey)

            toggleContactModal()            
            setInfo(translate("syncCompleted"))
            return
        } catch (e: any) {
            toggleContactModal()      
            handleError(e)
        }        
    }

    const saveToPrivateContacts = async function () {
        if(contact.type === ContactType.PUBLIC) {            
            contactsStore.addContact({...contact})
            toggleContactModal()            
            setInfo('Contact saved.')
        }
    }


    const onDeleteContact = function () {
        contactsStore.removeContact(contact)
        navigation.goBack()
    }


    const handleError = function (e: AppError): void {
        setError(e)
    }

    const iconNpub = useThemeColor('textDim')
    const addressColor = useThemeColor('textDim')
    const headerBg = useThemeColor('header')    
    const screenBg = useThemeColor('background')
    const mainButtonColor = useThemeColor('card')
    const mainButtonIcon = useThemeColor('button')
    const mainButtonText = useThemeColor('text')
  

    const {type, name, display_name, npub, nip05, picture, about, lud16} = contact
    
    return (
      <Screen contentContainerStyle={$screen} preset='auto'>        
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
            {picture ? (
                <View style={{borderRadius: 48, overflow: 'hidden'}}>
                    <Image style={{width: 96, height: 96}} source={{uri: getImageSource(picture)}} />
                </View>
            ) : (
                <Icon
                    icon='faCircleUser'                                
                    size={80}                    
                    color={'white'}                
                />
            )}
            <Text preset='bold' text={(nip05) ? nip05 : name} style={{color: 'white', marginBottom: spacing.small}} />          
        </View>
        <View style={$contentContainer}>
            {type === ContactType.PUBLIC ? (
                <Card
                    style={$card}
                    ContentComponent={
                        <ListItem
                            text={display_name || name}
                            subText={about?.slice(0, 120) || ''}
                            leftIcon='faCircleUser'    
                        />
                    }
                />
            ) : (
                <Card
                    style={[$card, {minHeight: 80}]}
                    ContentComponent={
                        <View style={$noteContainer}>    
                            <TextInput
                                ref={noteInputRef}
                                onChangeText={note => setNote(note)}                                    
                                value={`${note}`}
                                style={$noteInput}
                                onEndEditing={onNoteSave}
                                maxLength={200}
                                keyboardType="default"
                                selectTextOnFocus={true}
                                placeholder={translate("privateNotePlaceholder")}
                                editable={
                                    isNoteEditing
                                    ? true
                                    : false
                                }
                            />
                            {isNoteEditing ? (
                                <Button
                                    preset="secondary"
                                    style={$noteButton}
                                    text="Save"
                                    onPress={onNoteSave}
                                    
                                />
                            ) : (
                                <Button
                                    preset="secondary"
                                    style={$noteButton}
                                    text="Edit"
                                    onPress={onNoteEdit}
                                    
                                />
                            )}
                        
                        </View>
                    }
                />
            )}
            <Card
                style={[$card, {marginTop: spacing.small}]}                
                ContentComponent={
                    <>
                    {lud16 && (
                        <ListItem                                    
                            text={lud16}
                            subTx='lightningAddress'                  
                            leftIcon='faBolt'
                            leftIconColor={colors.palette.orange200}                          
                        />
                        )}
                        <ListItem                                                                
                            LeftComponent={
                                <Button
                                    tx="payCommon.requestPayment"
                                    style={{marginLeft: spacing.small, alignSelf: 'center', minHeight: verticalScale(20)}}
                                    textStyle={{fontSize: moderateVerticalScale(14), lineHeight: moderateVerticalScale(16)}}
                                    onPress={gotoTopup}
                                    preset='tertiary'
                                />
                            }
                            RightComponent={lud16 ? (
                                <Button
                                    tx="payCommon.payToAddress"
                                    style={{marginLeft: spacing.small, alignSelf: 'center', minHeight: verticalScale(20)}}
                                    textStyle={{fontSize: moderateVerticalScale(14), lineHeight: moderateVerticalScale(16)}}
                                    onPress={gotoTransfer}
                                    preset='tertiary'
                                />
                            ) : undefined}
                            topSeparator={lud16 ? true : false}                             
                        />                        
                    </>
                }
            />            
        </View>
        <View style={[$bottomContainer]}>
            <View style={$buttonContainer}>
                {contact.nip05 ? (
                    <Button
                        preset='secondary'
                        text={`Send ecash`}
                        LeftAccessory={() => (
                            <Icon
                            icon='faArrowUp'
                            color={mainButtonIcon}
                            size={spacing.medium}                  
                            />
                        )}
                        onPress={gotoSend} 
                        textStyle={{color: mainButtonText}}
                        style={[{backgroundColor: mainButtonColor}, $buttonSend]}                        
                    />
                ) : (
                    <Text 
                        size='xs' 
                        style={{color: addressColor, marginHorizontal: spacing.large, textAlign: 'center'}} 
                        tx="profileMissingNostrAddress"
                    />
                )}                
            </View>
        </View>
        <BottomModal
          isVisible={isContactModalVisible}
          style={{alignItems: 'stretch'}}          
          ContentComponent={
            <>
            <ListItem
                tx="share.contactAddress"
                subText={nip05}
                leftIcon='faShareNodes'
                onPress={onShareContact}
                bottomSeparator={true}
            /> 
            <ListItem
                tx="copyContactPublicKey"
                subText={npub}
                leftIcon='faCopy'                            
                onPress={onCopyNpub}                                      
            />
            {type === ContactType.PRIVATE && (
                <>
                    <ListItem
                        tx="checkAndSync"
                        subTx="checkAndSyncDesc"
                        leftIcon='faRotate'                            
                        onPress={onSyncPrivateContact}
                        topSeparator={true}
                        bottomSeparator={true}                            
                    />
                    <ListItem
                        tx="deleteContact"
                        subTx="deleteContactDesc"
                        leftIcon='faXmark'                            
                        onPress={onDeleteContact}                                                  
                    />
                </>
            )}
            {type === ContactType.PUBLIC && (                
                <ListItem
                    tx="saveContactPrivate"
                    subText={translate('saveContactPrivateDesc', { nip05: contact.nip05 })}
                    leftIcon='faClipboard'                            
                    onPress={saveToPrivateContacts}
                    topSeparator={true}                    
                />
            )}
            </>
          }
          onBackButtonPress={toggleContactModal}
          onBackdropPress={toggleContactModal}
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
    height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
    flex: 1,
    padding: spacing.extraSmall,
    // alignItems: 'center',
}
  
const $noteContainer: ViewStyle = {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
}

const $noteInput: TextStyle = {
    flex: 1,
    borderRadius: spacing.small,
    fontSize: 16,
    textAlignVertical: 'center',
    marginRight: spacing.small,
}


const $noteButton: ViewStyle = {
    maxHeight: 50,
    minWidth: 70,
}


const $bottomContainer: ViewStyle = {
    /* position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',    
    alignSelf: 'stretch', */   
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',    
    marginVertical: spacing.medium,
    justifyContent: 'center',
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

/* const $bottomContainer: ViewStyle = {  
  position: 'absolute',
  bottom: 20,
  justifyContent: 'flex-start',
  marginBottom: spacing.medium,
  alignSelf: 'stretch',
  // opacity: 0,
} */

const $buttonReceive: ViewStyle = {
  borderTopLeftRadius: 30,
  borderBottomLeftRadius: 30,
  borderTopRightRadius: 0,
  borderBottomRightRadius: 0,
  minWidth: verticalScale(130),
  borderRightWidth: 1,  
}

const $buttonScan: ViewStyle = {
  borderRadius: 0,
  minWidth: verticalScale(60),
}

const $buttonSend: ViewStyle = {
  borderRadius: moderateVerticalScale(60 / 2),
  height: moderateVerticalScale(60),
  minWidth: verticalScale(140),  
}

