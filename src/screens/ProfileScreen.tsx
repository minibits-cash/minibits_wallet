import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Share, Switch, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {ContactsStackScreenProps} from '../navigation'
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, Loading, Header} from '../components'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import { ProfileHeader } from '../components/ProfileHeader'
import Clipboard from '@react-native-clipboard/clipboard'
import { log } from '../services/logService'
import { MinibitsClient, NostrClient, NostrProfile } from '../services'
import { translate } from '../i18n'
import { CollapsibleText } from '../components/CollapsibleText'

interface ProfileScreenProps extends ContactsStackScreenProps<'Profile'> {}

export const ProfileScreen: FC<ProfileScreenProps> = observer(
  function ProfileScreen({navigation}) {    
    
    const {walletProfileStore, userSettingsStore, relaysStore} = useStores() 
    const {npub, nip05} = walletProfileStore    

    const [isBatchClaimOn, setIsBatchClaimOn] = useState<boolean>(
        walletProfileStore.isBatchClaimOn,
    )
    const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false)
    const [isShareModalVisible, setIsShareModalVisible] = useState<boolean>(false)
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()

    // Re-attempt to create profile if it failed before
    useEffect(() => {
        const load = async () => {            
            try {                
                await createProfileIfNotExists()
            } catch(e: any) {   
                log.error(e.name, e.message || '')             
                return false // silent
            }
        }
        load()
        return () => {}        
    }, [])

    const createProfileIfNotExists = async () => {
        log.trace(walletProfileStore)

        if(!walletProfileStore.pubkey || !walletProfileStore.picture) { // pic needed
            const walletId = userSettingsStore.walletId
            await walletProfileStore.create(walletId as string)                    
        }
    }

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

    const toggleShareModal = () => {
        setIsShareModalVisible(previousState => !previousState)
    }
        
    const gotoAvatar = function() {
        toggleUpdateModal()
        navigation.navigate('Picture')
    }

    const gotoWalletName = function() {
        toggleUpdateModal()
        navigation.navigate('WalletName')
    }


    const gotoPrivacy = function() {
        toggleUpdateModal()
        navigation.navigate('SettingsNavigator', {screen: 'Privacy'})
    }


    const gotoOwnKeys = function() {
        toggleUpdateModal()
        navigation.navigate('OwnKeys')
    }

    const onCopyNpub = function () {        
        try {
          Clipboard.setString(npub)
        } catch (e: any) {
          setInfo(translate('common.copyFailParam', { param: e.message }))
        }
    }

    const onCopyNip05 = function () {        
        try {
          Clipboard.setString(nip05)
        } catch (e: any) {
          setInfo(translate('common.copyFailParam', { param: e.message }))
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
          const result = walletProfileStore.setIsBatchClaimOn(!isBatchClaimOn)
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
      <Screen contentContainerStyle={$screen} preset='auto'>
            <Header 
                leftIcon='faArrowLeft'
                onLeftPress={() => {navigation.goBack()}}
                rightIcon='faCopy'
                onRightPress={onCopyNip05}
            />        
            <ProfileHeader />        
            <View style={$contentContainer}>
                <Card
                    ContentComponent={
                        <>
                        {!walletProfileStore.pubkey || !walletProfileStore.picture ? (
                            <>
                            <ListItem 
                                tx="profileOnboarding.title"
                                subTx="profileOnboarding.desc"
                            />
                            <View style={$buttonContainer}> 
                                <Button
                                    preset='secondary'                                
                                    tx="common.create"
                                    LeftAccessory={() => <Icon icon='faCircleUser'/>}
                                    onPress={createProfileIfNotExists}
                                />                                                            
                            </View>
                            </>
                        ) : (
                            <>
                                {walletProfileStore.isOwnProfile ? (
                                    <ListItem
                                        tx="profileOnboarding.ownAddrTitle"
                                        subTx="profileOnboarding.ownAddrDesc"
                                        leftIcon='faCircleUser'
                                        bottomSeparator={true}
                                        style={{paddingRight: spacing.small}}
                                    />
                                ) : (
                                    <ListItem
                                        tx="profileOnboarding.minibitsTitle"
                                        //subTx="profileOnboarding.minibitsDesc"
                                        leftIcon='faCircleUser'
                                        BottomComponent={
                                            <CollapsibleText
                                                collapsed={true}                                
                                                text={translate('profileOnboarding.minibitsDesc')}
                                                textProps={{style: $subText}}
                                            />}
                                        bottomSeparator={true}
                                        style={{paddingRight: spacing.small}}
                                    />   
                                )}
                                <View style={$buttonContainer}>                            
                                    <Button
                                        preset='secondary'                                
                                        tx='common.share'
                                        LeftAccessory={() => <Icon icon='faShareNodes'/>}
                                        onPress={toggleShareModal}
                                    />
                                    <Button
                                        preset='secondary'                                
                                        tx="common.change"
                                        style={{marginLeft: spacing.small}}
                                        LeftAccessory={() => <Icon icon='faRotate'/>}
                                        onPress={toggleUpdateModal}
                                    />  
                                </View>
                            </>
                        )}                          
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
                            tx="nostr.copyPubKey"
                            subText={npub}
                            leftIcon='faCopy'
                            onPress={onCopyNpub}
                        />
                    </>
                }
                onBackButtonPress={toggleShareModal}
                onBackdropPress={toggleShareModal}
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
            tx='profileScreen.changeAvatar'
            subTx='profileScreen.changeAvatarSubtext'
            leftIcon='faCircleUser'            
            onPress={props.gotoAvatar}
            bottomSeparator={true}            
        />
        <ListItem
            tx='profileScreen.changeWalletaddress'
            subTx='profileScreen.changeWalletaddressSubtext'
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

