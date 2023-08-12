import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useRef, useState} from 'react'
import {Image, Pressable, Share, TextStyle, View, ViewStyle} from 'react-native'
import { SvgUri, SvgXml } from 'react-native-svg'
import {colors, spacing, useThemeColor} from '../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../components'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {ContactsStackScreenProps} from '../navigation'
import { MinibitsClient, WalletProfile, NostrClient, KeyPair } from '../services'
import AppError from '../utils/AppError'
import {MINIBITS_NIP05_DOMAIN} from '@env'
import { log } from '../utils/logger'
import QRCode from 'react-native-qrcode-svg'
import { useFocusEffect } from '@react-navigation/native'

interface ContactsScreenProps extends ContactsStackScreenProps<'Contacts'> {}

export const ContactsScreen: FC<ContactsScreenProps> = observer(function ContactsScreen({route, navigation}) {    
    useHeader({
        leftIcon: 'faShareFromSquare',
        leftIconColor: colors.palette.primary100,
        onLeftPress: () => onShareContact(),    
        rightIcon: 'faQrcode',
        rightIconColor: colors.palette.primary100,
        onRightPress: () => toggleQRModal(),        
    })

    const npub = useRef('')      
    const {userSettingsStore} = useStores()

    const [pubkey, setPubkey] = useState<string>('')    
    const [avatarSvg, setAvatarSvg] = useState<string>('')
    const [avatarImageUri, setAvatarImageUri] = useState<string>('')
    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isQRModalVisible, setIsQRModalVisible] = useState(false) 
    const [isWalletProfileModalVisible, setIsWalletProfileModalVisible] = useState(false)    
    const [error, setError] = useState<AppError | undefined>()

    useFocusEffect(
        useCallback(() => {
            if (!route.params?.selectedAvatarUrl) {                
                return
            }
            const avatarUrl = route.params?.selectedAvatarUrl
            updateAvatar(avatarUrl)

        }, [route.params?.selectedAvatarUrl]),
    )

    const updateAvatar = async function (url: string) {
        const avatar = await MinibitsClient.fetchSvg(url, {
            method: 'GET',
            headers: MinibitsClient.getPublicHeaders(),        
        })        
        setAvatarSvg(avatar)
    }
    
    useEffect(() => {
        const load = async () => {
            try {   
                const keyPair = await NostrClient.getOrCreateKeyPair()
                setPubkey(keyPair.publicKey)
                npub.current = NostrClient.getNPubKey(keyPair.publicKey) 
                const walletId = userSettingsStore.walletId               

                const walletProfile: {profile: WalletProfile, avatarSvg: string} = 
                await MinibitsClient.getOrCreateWalletProfile(
                    keyPair.publicKey,
                    walletId as string
                )                
                
                setAvatarSvg(walletProfile.avatarSvg as string)                                          
                
            } catch(e: any) {
                return false // silent
            }
        }
        load()
        return () => {}        
    }, [])

    const toggleQRModal = () =>
      setIsQRModalVisible(previousState => !previousState)

    const toggleProfileModal = () => {
        setIsWalletProfileModalVisible(previousState => !previousState)
    }


    const onShareContact = async () => {
        try {
            const result = await Share.share({
                message: `${userSettingsStore.walletId+MINIBITS_NIP05_DOMAIN}`,
            })

            if (result.action === Share.sharedAction) {                
                setTimeout(
                    () =>
                    setInfo(
                        'Contact has been shared',
                    ),
                    500,
                )
            } else if (result.action === Share.dismissedAction) {
                setInfo(
                    'Contact sharing cancelled',
                )
            }
        } catch (e: any) {
            handleError(e)
        }
    }
    
    
    const gotoAvatar = function () {
        toggleProfileModal()
        navigation.navigate('Avatar', {avatarSvg, pubkey})
    }

    const gotoUsername = function () {
        toggleProfileModal()
        navigation.navigate('WalletName', {pubkey})
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const rightIcon = useThemeColor('textDim')

    return (
      <Screen style={$screen} preset='auto'>
        <View style={[$headerContainer, {backgroundColor: headerBg, justifyContent: 'space-around'}]}>
            
                {avatarSvg ? (
                    <Pressable
                        onPress={toggleProfileModal}                        
                    >
                        <SvgXml xml={avatarSvg} width="90" height="90" />
                    </Pressable>
                ) : avatarImageUri ? (
                    <Pressable
                        onPress={toggleProfileModal}
                        style={{borderWidth: 1, borderColor: 'red'}}
                    >
                        <Image source={{ uri: avatarImageUri }} style={{width: 90, height: 90}} />
                    </Pressable>                        
                ) : (
                    <Pressable
                        onPress={toggleProfileModal}                        
                    >
                        <Icon
                            icon='faCircleUser'                                
                            size={80}                    
                            color={'white'}                
                        />
                    </Pressable> 
                )}
                <Pressable
                    onPress={toggleProfileModal}                        
                >
                    <Text preset='bold' text={`${userSettingsStore.walletId+MINIBITS_NIP05_DOMAIN}`} style={{color: 'white', marginBottom: spacing.small}} />
                </Pressable>          
        </View>
        <View style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
            <>                
                <ListItem
                    text='Private and social payments'
                    subText='Here, you will soon be able to manage your private and public (social) contacts. This will allow you to make smooth private payments as well as tips or donations.'
                    style={$item}
                    bottomSeparator={true}
                />
                <ListItem
                    text={`Unique wallet name and avatar`}
                    subText={`Minibits provides you a unique wallet name and avatar. Don't like it? Select another random one or choose your own for a small donation. Once ready, it will be like your account number, just much better.`}
                    style={$item}
                    bottomSeparator={true}
                />
                <ListItem
                    text={`Merciless coding`}
                    subText={`Minibits is challenging open source project with the aim to figure out how (and if) the e-cash works best. Feel welcomed to join the project on Github. Help is very appreciated.`}
                    style={$item}                    
                />                                        
            </>
            }            
          />
          {isLoading && <Loading />}
        </View>        
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
        <BottomModal
            isVisible={isQRModalVisible ? true : false}
            top={spacing.screenHeight * 0.25}
            // style={{marginHorizontal: spacing.extraSmall}}
            ContentComponent={
                <View style={[$bottomModal, {marginHorizontal: spacing.small}]}>
                <Text text={'Scan to share your contact'} />
                <View style={$qrCodeContainer}>        
                    <QRCode size={spacing.screenWidth - spacing.extraLarge * 2} value={`${userSettingsStore.walletId+MINIBITS_NIP05_DOMAIN}`} />          
                </View>
                <View style={$buttonContainer}>
                <Button preset="secondary" text="Close" onPress={toggleQRModal} />
                </View>
            </View>
            }
            onBackButtonPress={toggleQRModal}
            onBackdropPress={toggleQRModal}
        />
        <BottomModal
          isVisible={isWalletProfileModalVisible ? true : false}
          top={spacing.screenHeight * 0.6}
          ContentComponent={
            <WalletProfileActionsBlock
                gotoAvatar={gotoAvatar}
                gotoUserName={gotoUsername}
            />
          }
          onBackButtonPress={toggleProfileModal}
          onBackdropPress={toggleProfileModal}
        />     
      </Screen>
    )
  })


  const WalletProfileActionsBlock = function (props: {
    gotoAvatar: any
    gotoUserName: any
  }) {
    return (
      <>
          <ListItem
              tx='contactsScreen.changeAvatar'
              subTx='contactsScreen.changeAvatarSubtext'
              leftIcon='faCircleUser'              
              onPress={props.gotoAvatar}
              bottomSeparator={true}
              style={{paddingHorizontal: spacing.medium}}
          />
          <ListItem
              tx='contactsScreen.changeWalletname'
              subTx='contactsScreen.changeWalletnameSubtext'
              leftIcon='faPencil'
              onPress={props.gotoUserName}
              style={{paddingHorizontal: spacing.medium}}
          />
      </>
    )
  }

const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingHorizontal: spacing.medium,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {  
  // marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,  
}

const $card: ViewStyle = {
  marginBottom: 0,
}

const $bottomModal: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.large,
  paddingHorizontal: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
  }
  
const $qrCodeContainer: ViewStyle = {
    backgroundColor: 'white',
    padding: spacing.small,
    margin: spacing.small,
}