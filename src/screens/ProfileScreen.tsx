import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useState} from 'react'
import {ColorValue, Share, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {ContactsStackScreenProps} from '../navigation'
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, Loading, Header} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import { ProfileHeader } from './Contacts/ProfileHeader'
import Clipboard from '@react-native-clipboard/clipboard'
import { log } from '../services/logService'
import { KeyChain, MinibitsClient, NostrClient, NostrProfile } from '../services'
import { getRandomUsername } from '../utils/usernames'
import { MINIBITS_NIP05_DOMAIN } from '@env'

interface ProfileScreenProps extends ContactsStackScreenProps<'Profile'> {}

export const ProfileScreen: FC<ProfileScreenProps> = observer(
  function ProfileScreen({navigation}) {    
    
    const {walletProfileStore, userSettingsStore, relaysStore} = useStores() 
    const {npub, name, picture, nip05} = walletProfileStore    

    const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false)
    const [isShareModalVisible, setIsShareModalVisible] = useState<boolean>(false)
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()

    // Re-attempt to create profile if it failed before
    useEffect(() => {
        const load = async () => {            
            try {                
                await createProfile()
            } catch(e: any) {   
                log.error(e.name, e.message || '')             
                return false // silent
            }
        }
        load()
        return () => {}        
    }, [])

    const createProfile = async () => {
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


    const gotoOwnKeys = function() {
        toggleUpdateModal()
        navigation.navigate('OwnKeys')
    }

    const onCopyNpub = function () {        
        try {
            Clipboard.setString(npub)
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
        }
    }


    const onSyncOwnProfile = async function () {
        try {
            setIsLoading(true)
            toggleUpdateModal()
            
            if(!walletProfileStore.nip05) {                
                throw new AppError(Err.VALIDATION_ERROR, 'Missing address', {caller: 'onSyncOwnProfile'})
            }
            
            const profile: NostrProfile = await NostrClient.getNormalizedNostrProfile(walletProfileStore.nip05, relaysStore.allUrls)
            
            if(profile.pubkey !== walletProfileStore.pubkey) {
                throw new AppError(Err.VALIDATION_ERROR, 'Profile from relays public key differs from your pubkey. Remove profile and import again with new keys.', {caller: 'onSyncOwnProfile', profile, pubkey: walletProfileStore.pubkey})
            }

            log.trace('[onSyncOwnProfile]', {profile})

            // update name and pic based on data from relays
            await MinibitsClient.updateWalletProfileAvatar(profile.pubkey, {avatar: profile.picture || ''})
            await MinibitsClient.updateWalletProfileName(profile.pubkey, {name: profile.name || ''})
                 
            setIsLoading(false)
            setInfo('Sync completed')
            return
        } catch (e: any) {                 
            handleError(e)
        }        
    }

    
    const resetProfile = async function() {
        setIsLoading(true)

        try {
            // overwrite with new keys
            const keyPair = KeyChain.generateNostrKeyPair()
            await KeyChain.saveNostrKeyPair(keyPair)

            // set name to defualt walletId
            const name = userSettingsStore.walletId as string

            // get random image
            const pictures = await MinibitsClient.getRandomPictures() // TODO PERF

            // update wallet profile
            await walletProfileStore.updateNip05(
                keyPair.publicKey,
                name + MINIBITS_NIP05_DOMAIN,
                name,
                pictures[0],
                false // isOwnProfile
            )

            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)      
        setError(e)
    }

    const iconNpub = useThemeColor('textDim')
    
    return (
      <Screen contentContainerStyle={$screen} preset='auto'>
            <Header 
                leftIcon='faArrowLeft'
                onLeftPress={navigation.goBack}
            />        
            <ProfileHeader />        
            <View style={$contentContainer}>
                <Card
                    ContentComponent={
                        <>
                        {!walletProfileStore.pubkey || !walletProfileStore.picture ? (
                            <>
                            <ListItem 
                                text='Create wallet address'
                                subText='Your wallet address allows you to receive encrypted ecash over Nostr. At the same time it serves as your Lightning address, so that you can receive payments from any Lightning wallet.'
                            />
                            <View style={$buttonContainer}> 
                                <Button
                                    preset='secondary'                                
                                    text={'Create'}                                    
                                    LeftAccessory={() => <Icon icon='faCircleUser'/>}
                                    onPress={createProfile}
                                />                                                            
                            </View>
                            </>
                        ) : (
                            <>
                                <ListItem
                                    text='Your Minibits wallet address'
                                    subText={`Share your wallet address to receive encrypted ecash over Nostr. At the same time it serves as your Lightning address, so that you can receive payments from any Lightning wallet.`}
                                    leftIcon='faCircleUser'
                                    bottomSeparator={true}
                                    style={{paddingRight: spacing.small}}
                                />
                                <View style={$buttonContainer}>                            
                                    <Button
                                        preset='secondary'                                
                                        text={'Share'}
                                        LeftAccessory={() => <Icon icon='faShareNodes'/>}
                                        onPress={toggleShareModal}
                                    />
                                    <Button
                                        preset='secondary'                                
                                        text={'Change'}
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
                        {walletProfileStore.isOwnProfile ? (
                            <>
                            <ListItem
                                text='Sync own profile'
                                subText='Synchronize your profile name and picture with up to date information from Nostr relays.'
                                leftIcon='faRotate'
                                onPress={onSyncOwnProfile}
                                bottomSeparator={true}
                            />
                            <ListItem
                                text='Reset own profile'
                                subText='Stop using your own NOSTR address and re-create Minibits wallet profile with random NOSTR address.'
                                leftIcon='faXmark'
                                onPress={resetProfile}
                            />
                            </>
                        ) : (
                            <ListItem
                                text='Use own Nostr profile'
                                subText='Use existing NOSTR address as your wallet address. You can then use Minibits to send and receive ecash using your public identity on NOSTR social network.'
                                leftIcon='faKey'          
                                onPress={gotoOwnKeys}
                            />
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
                            text='Share wallet address'
                            subText={nip05}
                            leftIcon='faShareNodes'
                            onPress={onShareContact}
                            bottomSeparator={true}
                        />    
                        <ListItem
                            text='Copy Nostr public key'
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
            bottomSeparator={true}            
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
    height: spacing.screenHeight * 0.18,
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

