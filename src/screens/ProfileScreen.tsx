import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {ScrollView, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, Loading, Header} from '../components'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import { ProfileHeader } from '../components/ProfileHeader'
import Clipboard from '@react-native-clipboard/clipboard'
import { log } from '../services/logService'
import { KeyChain, MinibitsClient, NostrClient, NostrProfile } from '../services'
import { translate } from '../i18n'
import { CollapsibleText } from '../components/CollapsibleText'
import { CommonActions, StaticScreenProps, useNavigation } from '@react-navigation/native'
import { QRCodeBlock } from './Wallet/QRCode'
import { useTabBarInset } from '../navigation/tabBarVisibility'

type Props = StaticScreenProps<{
    prevScreen: 'Contacts' | 'Wallet'
}>

export const ProfileScreen = observer(function ProfileScreen({ route }: Props) {    
    const navigation = useNavigation()
    const {
        prevScreen
    } = route.params 
    const {walletProfileStore, userSettingsStore, relaysStore, walletStore} = useStores() 
    const {npub, nip05, pubkey} = walletProfileStore    

    const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false)
    const [isKeysModalVisible, setIsKeysModalVisible] = useState<boolean>(false)
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()

    const toggleUpdateModal = () => {
        setIsUpdateModalVisible(previousState => !previousState)
    }

    const gotoAvatar = function() {
        toggleUpdateModal()
        //@ts-ignore
        navigation.navigate('Picture')
    }

    const gotoWalletName = function() {
        toggleUpdateModal()
        //@ts-ignore
        navigation.navigate('WalletName')
    }


    const gotoPrivacy = function() {
        toggleUpdateModal()
        //@ts-ignore
        navigation.navigate('Privacy')
    }

    const toggleKeysModal = () => {
        setIsKeysModalVisible(previousState => !previousState)
    }

    const onCopy = function (value: string) {
        try {
          Clipboard.setString(value)
        } catch (e: any) {
          setInfo(translate('commonCopyFailParam', { param: e.message }))
        }
    }


    const onSyncOwnProfile = async function () {
        try {
            setIsLoading(true)
            toggleUpdateModal()
            
            if(!walletProfileStore.nip05) {                
                throw new AppError(
                  Err.VALIDATION_ERROR, 
                  translate("profileMissingAddressError"), 
                  { caller: 'onSyncOwnProfile' }
                )
            }
            
            const profile: NostrProfile = await NostrClient.getNormalizedNostrProfile(walletProfileStore.nip05, relaysStore.allUrls)
            
            if(profile.pubkey !== walletProfileStore.pubkey) {
              throw new AppError(
                Err.VALIDATION_ERROR, 
                translate("profilePublicKeyMismatchError"),
                {caller: 'onSyncOwnProfile', profile, pubkey: walletProfileStore.pubkey}
              )
            }

            log.trace('[onSyncOwnProfile]', {profile})

            // update own profile based on data from relays
            await MinibitsClient.updateWalletProfile({
                avatar: profile.picture || '', // this is https:// link
                lud16: profile.lud16 || '',
                name: profile.name
            })            
                 
            setIsLoading(false)
            setInfo(translate('syncCompleted'))
            return
        } catch (e: any) {                 
            handleError(e)
        }        
    }


    const handleError = function (e: AppError): void {
        setIsLoading(false)      
        setError(e)
    }

    const tabBarInset = useTabBarInset()
    const textDim = useThemeColor('textDim')
    const $subText = {color: useThemeColor('textDim'), fontSize: 14}
    
    return (
      <Screen contentContainerStyle={$screen} preset='auto'>
            <Header 
                leftIcon='faArrowLeft'
                onLeftPress={() => {
                    if(prevScreen === 'Wallet') {
                        navigation.dispatch(                
                            CommonActions.reset({
                                index: 1,
                                routes: [{
                                    name: 'WalletNavigator'
                                }]
                            })
                        )
                    } else {
                        navigation.goBack()
                    } 
                }}
                rightIcon='faPencil'
                onRightPress={toggleUpdateModal}
            />        
            <ProfileHeader />        
            <View style={$contentContainer}>
                
                            <View style={$qrContainer}>
                                <QRCodeBlock
                                    qrCodeData={nip05}
                                    type='PUBKEY'
                                    size={spacing.screenWidth * 0.6}
                                    containerStyle={{paddingTop: spacing.huge}}
                                />
                            </View>
                            <Button
                                preset='tertiary'
                                tx='profileScreen_nostrKeys'
                                onPress={toggleKeysModal}
                                LeftAccessory={() => <Icon icon='faKey' size={spacing.small} color={textDim} />}
                                textStyle={{color: textDim, fontSize: 12}}
                                style={{alignSelf: 'center'}}
                            />
            </View>
            <BottomModal
                isVisible={isUpdateModalVisible ? true : false}
                style={{alignItems: 'stretch'}}
                ContentComponent={
                    <>       
                        {!walletProfileStore.isOwnProfile && (
                            <WalletProfileActionsBlock 
                                gotoAvatar={gotoAvatar}
                                gotoWalletName={gotoWalletName}
                            />
                        )}
                        {walletProfileStore.isOwnProfile && (
                            <>
                            <ListItem
                                tx="syncOwnProfile"
                                subTx="syncOwnProfileDesc"
                                leftIcon='faRotate'
                                onPress={onSyncOwnProfile}
                                bottomSeparator={true}
                            />
                            <ListItem
                                tx="resetOwnProfile"
                                subTx="resetOwnProfileDesc"
                                leftIcon='faXmark'
                                onPress={gotoPrivacy}
                            />
                            </>
                        )} 
                    </>
                }
                onBackButtonPress={toggleUpdateModal}
                onBackdropPress={toggleUpdateModal}
            />
            <BottomModal
                isVisible={isKeysModalVisible}
                style={{alignItems: 'stretch'}}
                ContentComponent={
                    <>
                        <ListItem
                            text='NPUB'
                            subText={npub}
                            subTextEllipsizeMode='middle'
                            leftIcon='faKey'
                            rightIcon='faCopy'
                            onPress={() => onCopy(npub)}
                            bottomSeparator={true}
                        />
                        <ListItem
                            text='HEX'
                            subText={pubkey}
                            subTextEllipsizeMode='middle'
                            leftIcon='faKey'
                            rightIcon='faCopy'
                            onPress={() => onCopy(pubkey)}
                        />
                    </>
                }
                onBackButtonPress={toggleKeysModal}
                onBackdropPress={toggleKeysModal}
            />
            {isLoading && <Loading />}
            {error && <ErrorModal error={error} />}
            {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)

const WalletProfileActionsBlock = function (props: {
    gotoAvatar: any
    gotoWalletName: any
}) {
return (
    <>
        <ListItem
            tx='profileScreen_changeAvatar'
            subTx='profileScreen_changeAvatarSubtext'
            leftIcon='faCircleUser'            
            onPress={props.gotoAvatar}
            bottomSeparator={true}            
        />
        <ListItem
            tx='profileScreen_changeWalletaddress'
            subTx='profileScreen_changeWalletaddressSubtext'
            leftIcon='faPencil'
            onPress={props.gotoWalletName}
            // bottomSeparator={true}            
        />
    </>
)
}

const $screen: ViewStyle = {
    // flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.medium,
    height: spacing.screenHeight * 0.22,
}

const $contentContainer: TextStyle = {
    // flex: 1,
    padding: spacing.small,
    marginTop: -spacing.large * 1.5,
}

const $bottomModal: ViewStyle = {
    // flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.large,
    paddingHorizontal: spacing.small,
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

const $qrContainer: ViewStyle = {
    //paddingTop: spacing.large,
    //marginVertical: spacing.small,
}

const $card: ViewStyle = {
    // marginVertical: 0,
}

const $item: ViewStyle = {
    // paddingHorizontal: spacing.small,
    paddingLeft: 0,
}
