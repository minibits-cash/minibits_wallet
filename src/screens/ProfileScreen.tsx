import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Platform, ScrollView, Share, Switch, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, Loading, Header} from '../components'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import { ProfileHeader } from '../components/ProfileHeader'
import Clipboard from '@react-native-clipboard/clipboard'
import { log } from '../services/logService'
import { KeyChain, MinibitsClient, NostrClient, NostrProfile } from '../services'
import { translate, TxKeyPath } from '../i18n'
import { CollapsibleText } from '../components/CollapsibleText'
import { CommonActions, StaticScreenProps, useNavigation } from '@react-navigation/native'
import { QRShareModal } from '../components/QRShareModal'

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

    const [isBatchClaimOn, setIsBatchClaimOn] = useState<boolean>(
        userSettingsStore.isBatchClaimOn,
    )
    const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false)
    const [isShareModalVisible, setIsShareModalVisible] = useState<boolean>(false)
    const [isQrCodeModalVisible, setIsQrCodeModalVisible] = useState(false)
    const [qrCodeData, setQrCodeData] = useState<{title: TxKeyPath, data: string}>(undefined)
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()

    const onShareContact = async () => {
        try {
            const result = await Share.share({
                message: `${nip05}`,
            })

        } catch (e: any) {
            handleError(e)
        }
    }

    const toggleUpdateModal = () => {
        setIsUpdateModalVisible(previousState => !previousState)
    }

    const toggleQrCodeModal = () => {
        setIsQrCodeModalVisible(previousState => !previousState)
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

    const toggleShareModal = () => {      
        setIsShareModalVisible(previousState => !previousState)      
    }

    const onShareNpub = function () { 
        toggleShareModal()
        setQrCodeData({
            title: 'shareWalletNpub',
            data: npub,
        })
        
        if(Platform.OS === 'ios') {
            setTimeout(() => {
                toggleQrCodeModal()
            }, 500) // ios fix
        } else {
            toggleQrCodeModal()
        }
    }


    const onSharePubkey = function () {
        toggleShareModal()
        setQrCodeData({
            title: 'shareWalletPubkey',
            data: pubkey,
        })

        if(Platform.OS === 'ios') {
            setTimeout(() => {
                toggleQrCodeModal()
            }, 500) // ios fix
        } else {
            toggleQrCodeModal()
        }
    }

    const onCopyNip05 = function () {        
        try {
          Clipboard.setString(nip05)
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
            await MinibitsClient.updateWalletProfile(profile.pubkey, {
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

    
    const toggleBatchClaimSwitch = () => {
        try {          
          const result = userSettingsStore.setIsBatchClaimOn(!isBatchClaimOn)
          setIsBatchClaimOn(result)
        } catch (e: any) {
          handleError(e)
        }
      }

    const handleError = function (e: AppError): void {
        setIsLoading(false)      
        setError(e)
    }

    const icon = useThemeColor('textDim')
    const $subText = {color: useThemeColor('textDim'), fontSize: 14}
    const $itemRight = {color: useThemeColor('textDim')}
    
    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
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
                rightIcon='faCopy'
                onRightPress={onCopyNip05}
            />        
            <ProfileHeader />        
            <ScrollView style={$contentContainer}>
                <Card
                    ContentComponent={                        
                        <>
                            {walletProfileStore.isOwnProfile ? (
                                <ListItem
                                    tx="profileOnboarding_ownAddrTitle"
                                    subTx="profileOnboarding_ownAddrDesc"
                                    leftIcon='faCircleUser'
                                    bottomSeparator={true}
                                    style={{paddingRight: spacing.small}}
                                />
                            ) : (
                                <ListItem
                                    tx="profileOnboarding_minibitsTitle"
                                    //subTx="profileOnboarding_minibitsDesc"
                                    leftIcon='faCircleUser'
                                    BottomComponent={
                                        <CollapsibleText
                                            collapsed={true}                                
                                            text={translate('profileOnboarding_minibitsDesc')}
                                            textProps={{style: $subText}}
                                        />}
                                    bottomSeparator={true}
                                    style={{paddingRight: spacing.small}}
                                />   
                            )}
                            <View style={$buttonContainer}>                            
                                <Button
                                    preset='secondary'                                
                                    tx='commonShare'
                                    LeftAccessory={() => <Icon icon='faShareNodes'/>}
                                    onPress={toggleShareModal}
                                />
                                <Button
                                    preset='secondary'                                
                                    tx="commonChange"
                                    style={{marginLeft: spacing.small}}
                                    LeftAccessory={() => <Icon icon='faRotate'/>}
                                    onPress={toggleUpdateModal}
                                />  
                            </View>
                        </>
                    }  
                />
                <Card
                    style={[$card, {marginTop: spacing.small}]}
                    ContentComponent={
                    <>
                        <ListItem
                            text='Batch receive'                            
                            leftIcon='faCubes'                            
                            style={$item}                        
                            RightComponent={
                                <View style={$rightContainer}>
                                    <Switch
                                        onValueChange={toggleBatchClaimSwitch}
                                        value={isBatchClaimOn}
                                    />
                                </View>
                            }
                            BottomComponent={
                                <CollapsibleText
                                    collapsed={true}                                
                                    text={'Recommended for heavy zap collectors. If there are more payments or zaps received to your lightning address, batch them into a single one.'}
                                    textProps={{style: $subText}}
                                />}
                            bottomSeparator={false}                            
                        />
                    </>
                    }
                />
            </ScrollView>
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
                isVisible={isShareModalVisible ? true : false}
                style={{alignItems: 'stretch'}}
                ContentComponent={
                    <>   
                        <ListItem
                            tx="shareWalletAddress"
                            subText={nip05}
                            leftIcon='faShareNodes'
                            onPress={onShareContact}
                            bottomSeparator={true}
                        />    
                        <ListItem
                            tx="shareWalletNpub"
                            subText={npub}
                            leftIcon='faQrcode'
                            onPress={onShareNpub}
                            bottomSeparator={true}
                        />
                        <ListItem
                            tx="shareWalletPubkey"
                            subText={pubkey}
                            leftIcon='faQrcode'
                            onPress={onSharePubkey}
                        />
                    </>
                }
                onBackButtonPress={toggleShareModal}
                onBackdropPress={toggleShareModal}
            />
            {qrCodeData && (
                <QRShareModal
                    data={qrCodeData.data}
                    subHeadingTx={qrCodeData.title}
                    type='PUBKEY'
                    isVisible={isQrCodeModalVisible}
                    onClose={toggleQrCodeModal}
                />
            )}
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
    flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.medium,
    height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
    // flex: 1,
    padding: spacing.extraSmall,
    // alignItems: 'center',
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

const $buttonContainer: ViewStyle = {
    marginTop: spacing.small,
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

