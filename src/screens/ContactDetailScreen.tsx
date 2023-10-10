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
import { MinibitsClient, NostrClient } from '../services'
import { getImageSource } from '../utils/utils'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { ReceiveOption } from './ReceiveOptionsScreen'
import { SendOption } from './SendOptionsScreen'


interface ContactDetailScreenProps extends ContactsStackScreenProps<'ContactDetail'> {}

export const ContactDetailScreen: FC<ContactDetailScreenProps> = observer(
  function ContactScreen({route, navigation}) {
    const {contact, relays} = route.params
    const amountToSendInputRef = useRef<TextInput>(null)
    const amountToRequestInputRef = useRef<TextInput>(null)    
    const {proofsStore, contactsStore} = useStores()

    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        rightIcon: 'faEllipsisVertical',
        onRightPress: () => toggleContactModal(),       
    })    
    
       
    const [isContactModalVisible, setIsContactModalVisible] = useState(false) 
    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()
    
    const toggleContactModal = () => {
        setIsContactModalVisible(previousState => !previousState)
    }

    
    const gotoTopup = () => {
        navigation.navigate('WalletNavigator', { 
            screen: 'Topup',
            params: {
                paymentOption: ReceiveOption.SEND_PAYMENT_REQUEST, 
                contact, 
                relays
            },
        })
    }


    const gotoSend = () => {
        navigation.navigate('WalletNavigator', { 
            screen: 'Send',
            params: {
                paymentOption: SendOption.SEND_TOKEN, 
                contact, 
                relays
            },
        })
    }

    const onCopyNpub = function () {        
        try {
            Clipboard.setString(contact.npub)
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
        }
    }

    
    const onSyncPrivateContact = async function () {
        try {
            if(contact.nip05) {                
                await NostrClient.verifyNip05(contact.nip05 as string, contact.pubkey) // throws
            }

            contactsStore.refreshPicture(contact.pubkey)

            toggleContactModal()            
            setInfo('Sync completed')
            return
        } catch (e: any) {
            toggleContactModal()      
            handleError(e)
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
    const balanceColor = useThemeColor('textDim')
    const headerBg = useThemeColor('header')
    const inputBg = useThemeColor('background')
    const screenBg = useThemeColor('background')

    const {type, name, npub, nip05, picture, about} = contact
    
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
            {about && (
                <Card
                    style={$card}
                    content={about}
                />
            )}
        </View>
        <View style={[$bottomContainer]}>
          <View style={$buttonContainer}>
          <Button
              text={`Request ecash`}
              LeftAccessory={() => (
                <Icon
                  icon='faArrowDown'
                  color='white'
                  size={spacing.medium}                  
                />
              )}
              onPress={gotoTopup}
              style={[$buttonReceive, {borderRightColor: screenBg}]}
            />
            <Button
              text={`Send ecash`}
              RightAccessory={() => (
                <Icon
                  icon='faArrowUp'
                  color='white'
                  size={spacing.medium}                  
                />
              )}
              onPress={gotoSend}
              style={$buttonSend}            
            />
            </View>
        </View>
        <BottomModal
          isVisible={isContactModalVisible}
          style={{alignItems: 'stretch'}}          
          ContentComponent={               
            <>
                <ListItem
                    text="Copy contact's public key (npub)"
                    subText={npub.slice(0,30)+'...'}
                    leftIcon='faCopy'                            
                    onPress={onCopyNpub}
                    bottomSeparator={true}
                    style={{paddingHorizontal: spacing.medium}}
                />
                {type === ContactType.PRIVATE && (
                    <>
                        <ListItem
                            text='Check and sync'
                            subText='Checks that contact name is still linked to the same pubkey and updates picture if it was changed.'
                            leftIcon='faRotate'                            
                            onPress={onSyncPrivateContact}
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
    bottom: 20,
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
  borderTopLeftRadius: 0,
  borderBottomLeftRadius: 0,
  borderTopRightRadius: 30,
  borderBottomRightRadius: 30,
  minWidth: verticalScale(130),  
}

