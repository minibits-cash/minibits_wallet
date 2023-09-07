import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useState} from 'react'
import {ColorValue, Share, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {ContactsStackScreenProps} from '../navigation'
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, Loading} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import { ProfileHeader } from './Contacts/ProfileHeader'
import Clipboard from '@react-native-clipboard/clipboard'
import { log } from '../utils/logger'
import { KeyChain, MinibitsClient } from '../services'
import { getRandomUsername } from '../utils/usernames'
import { MINIBITS_NIP05_DOMAIN } from '@env'

interface ProfileScreenProps extends ContactsStackScreenProps<'Profile'> {}

export const ProfileScreen: FC<ProfileScreenProps> = observer(
  function ProfileScreen({navigation}) {    
    
    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        rightIcon: 'faShareFromSquare',
        onRightPress: () => onShareContact()
    })

    const {walletProfileStore, userSettingsStore} = useStores() 
    const {npub, name, picture, nip05} = walletProfileStore    

    const [isLoading, setIsLoading] = useState<boolean>(false) 
    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()


    const onShareContact = async () => {
        try {
            const result = await Share.share({
                message: `${nip05}`,
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
        
    const gotoAvatar = function() {
      navigation.navigate('Picture')
    }

    const gotoWalletName = function() {
      navigation.navigate('WalletName')
    }


    const gotoOwnKeys = function() {
      navigation.navigate('OwnKeys')
    }

    const onCopyNpub = function () {        
        try {
            Clipboard.setString(npub)
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
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
            const updatedProfile =  await walletProfileStore.updateNip05(
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
            <ProfileHeader />        
            <View style={$contentContainer}>
            {!walletProfileStore.isOwnProfile && (
            <Card
                style={$card}
                ContentComponent={
                    <WalletProfileActionsBlock 
                        gotoAvatar={gotoAvatar}
                        gotoWalletName={gotoWalletName}
                    />
                }
            />
            )}
            {walletProfileStore.isOwnProfile ? (
                <Card
                    style={[$card, {marginTop: spacing.medium}]}
                    ContentComponent={
                        <ListItem
                            text='Reset own profile'
                            subText='Stop using your own NOSTR profile and re-create Minibits wallet profile with random NOSTR address.'
                            leftIcon='faRotate'
                            leftIconInverse={true}
                            leftIconColor={colors.palette.iconViolet200}              
                            onPress={resetProfile}                    
                            style={{paddingRight: spacing.medium}}
                        />
                    }
                />
            ) : (
                <Card
                    style={[$card, {marginTop: spacing.medium}]}
                    ContentComponent={
                        <ListItem
                            text='Use your own profile'
                            subText='Use existing NOSTR profile as your wallet profile. You can then use Minibits to send and receive coins using your public identity on NOSTR social network.'
                            leftIcon='faKey'
                            leftIconInverse={true}
                            leftIconColor={colors.palette.iconViolet200}              
                            onPress={gotoOwnKeys}                    
                            style={{paddingRight: spacing.medium}}
                        />
                    }
                />
            )}           
            </View>
            <View style={$bottomContainer}>
                    <View style={$buttonContainer}>
                        <Icon icon='faCopy' size={spacing.small} color={iconNpub as ColorValue} />
                        <Button
                            preset='secondary'
                            textStyle={{fontSize: 12}}
                            text={npub.slice(0,15)+'...'}
                            onPress={onCopyNpub}
                        /> 
                    </View>    
            </View>
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
            leftIconInverse={true}
            leftIconColor={colors.palette.iconMagenta200}              
            onPress={props.gotoAvatar}
            bottomSeparator={true}
            style={{paddingRight: spacing.medium}}
        />
        <ListItem
            tx='profileScreen.changeWalletname'
            subTx='profileScreen.changeWalletnameSubtext'
            leftIcon='faPencil'
            leftIconInverse={true} 
            leftIconColor={colors.palette.iconBlue200}
            onPress={props.gotoWalletName}
            style={{paddingRight: spacing.medium}}
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

