import {observer} from 'mobx-react-lite'
import React, {FC, useRef, useState} from 'react'
import {Image, LayoutAnimation, Platform, Share, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {getPublicKey} from 'nostr-tools'
import RNExitApp from 'react-native-exit-app'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {ContactsStackScreenProps} from '../navigation'
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, Header, Loading, $sizeStyles} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import Clipboard from '@react-native-clipboard/clipboard'
import { log } from '../services/logService'
import { KeyChain, KeyPair, NostrClient, NostrEvent, NostrFilter, NostrProfile } from '../services'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { ProfileHeader } from './Contacts/ProfileHeader'


if (Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true)
}

interface OwnKeysScreenProps extends ContactsStackScreenProps<'OwnKeys'> {}

export const OwnKeysScreen: FC<OwnKeysScreenProps> = observer(function OwnKeysScreen({navigation}) {    

    const {walletProfileStore, contactsStore, relaysStore} = useStores() 

    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        title: walletProfileStore.nip05,
        titleStyle: {fontFamily: typography.primary?.medium, fontSize: 16}      
    })

    const ownNip05InputRef = useRef<TextInput>(null)
    const ownNsecInputRef = useRef<TextInput>(null) 
    const {npub, name, picture, nip05} = walletProfileStore   

    const [ownNip05, setOwnNip05] = useState<string>('')
    const [ownNsec, setOwnNsec] = useState<string>('')
    const [ownProfile, setOwnProfile] = useState<NostrProfile | undefined>(undefined)
    const [ownKeyPair, setOwnKeyPair] = useState<KeyPair | undefined>(undefined)
    const [ownProfileRelays, setOwnProfileRelays] = useState<string[]>([])
    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState<boolean>(false) 
    const [isSetupCompleted, setIsSetupCompleted] = useState<boolean>(false)
    const [isProfileChangeCompleted, setIsProfileChangeCompleted] = useState<boolean>(false)


    const resetState = function () {
        setOwnNip05('')
        setOwnNsec('')
        setOwnProfile(undefined)
        setOwnProfileRelays([])
        setInfo('')
        setIsLoading(false)
        setIsSetupCompleted(false)
        setIsProfileChangeCompleted(false)
    }
    
    const onPasteOwnNip05 = async function () {
        const nip = await Clipboard.getString()
        if (!nip) {
          setInfo('Copy your NOSTR address first, then paste.')
          return
        }  
        setOwnNip05(nip)        
    }


    const onConfirmOwnNip05 = async function () {
        try {
            const nip05Name = NostrClient.getNameFromNip05(ownNip05)
            const nip05Domain = NostrClient.getDomainFromNip05(ownNip05)

            if(!nip05Name || !nip05Domain) {
                setInfo(`Invalid NOSTR address, please check that it follows name@domain.com format`)
            }

            if(MINIBITS_NIP05_DOMAIN.includes(nip05Domain as string)) {
                setInfo(`${MINIBITS_NIP05_DOMAIN} names and keys can't be used with multiple wallets.`)
                return
            }

            setIsLoading(true)
            // get nip05 record from the .well-known server
            const {nip05Pubkey, nip05Relays} = await NostrClient.getNip05PubkeyAndRelays(ownNip05)

            if(nip05Relays.length > 0) {
                for (const relay of nip05Relays) {
                    relaysStore.addOrUpdateRelay({
                        url: relay,
                        status: WebSocket.CLOSED
                    })
                }
            }

            const relaysToConnect = relaysStore.allPublicUrls
            setOwnProfileRelays(relaysToConnect)

            const profile: NostrProfile = await NostrClient.getProfileFromRelays(nip05Pubkey, relaysToConnect)

            // check that the profile's nip05 matches the one given by user and living on nip05 .well-known server
            if(!profile.nip05) {
                if(profile.name && profile.name.toLowerCase() === nip05Name) {
                    profile.nip05 = ownNip05
                } else {
                    throw new AppError(Err.VALIDATION_ERROR, 'Profile from the relay does not match the given nip05 identifier', {ownNip05, profile})
                }
            }

            if(profile.nip05 !== ownNip05) {
                throw new AppError(Err.VALIDATION_ERROR, 'Profile from the relay does not match the given nip05 identifier', {ownNip05, profile})
            }

            if(!profile.name) {
                profile.name = nip05Name as string
            }

            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)

            log.trace('Got valid profile', profile)    
            setOwnProfile(profile)
            
            setIsLoading(false)
        } catch(e: any) {
            handleError(e)
        }
    }


    const onPasteOwnNsec = async function () {
        const key = await Clipboard.getString()
        if (!key) {
          setInfo('Copy your nsec key first, then paste.')
          return
        }  
        setOwnNsec(key)        
    }


    const onConfirmOwnNsec = async function () {
        try {
            if(!ownProfile) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing profile to update')
            }
            // validate that nsec matches profile pubkey
            const privateKey = NostrClient.getHexkey(ownNsec)
            const publicKey = getPublicKey(privateKey)

            if(publicKey !== ownProfile.pubkey) {
                throw new AppError(Err.VALIDATION_ERROR, 'Provided private key does not match your new profile public key.', {publicKey})
            }

            setOwnKeyPair({publicKey, privateKey})
            setIsSetupCompleted(true)
        } catch(e: any) {
            handleError(e)
        }
    }


    const onConfirmChange = async function () {
        try {
            if(!ownProfile || !ownKeyPair) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing profile to update')
            }

            setIsLoading(true)
            // update wallet profile
            const updatedProfile = await walletProfileStore.updateNip05(
                ownProfile.pubkey,
                ownProfile.nip05 as string,
                ownProfile.name as string,
                ownProfile.picture as string,
                true // isOwnProfile
            )

            // update keys
            await KeyChain.saveNostrKeyPair(ownKeyPair)

            setIsLoading(false)
            setIsProfileChangeCompleted(true)
            // restart
            // setTimeout(() => {RNExitApp.exitApp()}, 1000)            
            
        } catch(e: any) {
            handleError(e)
        }
    }


    const onCancelChange = async function () {
        resetState()
    }


    const handleError = function (e: AppError): void { 
        resetState()      
        setError(e)
    }

    const iconNip05 = useThemeColor('textDim')
    const textResult = useThemeColor('textDim')
    const inputBg = useThemeColor('background')
    
    return (
      <Screen contentContainerStyle={$screen} preset='auto'>
            <View style={$contentContainer}>
            <Card
                style={$card}
                ContentComponent={
                    <>
                    {!ownProfile ? (
                        <View style={$nip05Container}>                    
                            <ListItem
                                LeftComponent={<View style={[$numIcon, {backgroundColor: iconNip05}]}><Text text='1'/></View>}
                                text='Enter your NOSTR address'
                                subText={'Minibits uses NOSTR address (nip05) as a sharable contact to send and receive ecash.'}                        
                                bottomSeparator={true}
                                style={{}}
                            />                    
                            <View style={{flexDirection: 'row', alignItems: 'center', marginVertical: spacing.medium}}>                            
                                <TextInput
                                    ref={ownNip05InputRef}
                                    onChangeText={(name) => setOwnNip05(name.trim())}
                                    value={ownNip05}
                                    autoCapitalize='none'
                                    keyboardType='default'
                                    maxLength={30}
                                    placeholder='name@domain.com'
                                    selectTextOnFocus={true}
                                    style={[$nip05Input, {backgroundColor: inputBg}]}                                                   
                                />
                                <Button
                                    tx={'common.paste'}
                                    preset='secondary'
                                    style={$pasteButton}                                
                                    onPress={onPasteOwnNip05}
                                />
                                <Button
                                    tx={'common.confirm'}
                                    style={$saveButton}
                                    onPress={onConfirmOwnNip05}                                
                                />                        
                            </View>     
                        </View>
                    ) : (
                        <>
                            <ListItem                            
                                LeftComponent={
                                    <View style={{marginRight: spacing.medium, borderRadius: 20, overflow: 'hidden'}}>
                                        {ownProfile.picture ? (
                                            <Image 
                                                source={{uri: ownProfile.picture}}
                                                style={{width: 40, height: 40}}
                                            />
                                        ) : (
                                            <Icon icon='faCircleUser' size={35} color={inputBg} />
                                        )}
                                    </View>}
                                text={ownProfile.nip05}
                                subText={NostrClient.getNpubkey(ownProfile.pubkey)}                            
                            />
                            {ownProfileRelays.length > 0 && (
                                <ListItem
                                    leftIcon='faCircleNodes'
                                    text='Relays'
                                    subText={ownProfileRelays.toString()}                        
                                    topSeparator={true}
                                    style={{}}
                                />
                            )}
                            {isSetupCompleted && (
                                <ListItem
                                    leftIcon='faKey'
                                    text='Private key'
                                    subText={ownNsec}                        
                                    topSeparator={true}
                                    style={{}}
                                />
                            )}
                        </>
                    )}
                    </>
                }
            />
            {ownProfile && !isSetupCompleted && (
                <Card
                    style={[$card, {marginTop: spacing.medium}]}
                    ContentComponent={
                        <View style={$nip05Container}>                       
                            <ListItem
                                LeftComponent={<View style={[$numIcon, {backgroundColor: iconNip05}]}><Text text='2'/></View>}
                                text='Enter your private key'
                                subText={'Minibits needs your private key in nsec format in order to decrypt messages containing incoming payments. Your key will be stored in your device secure key vault.'}                        
                                bottomSeparator={true}
                                style={{}}
                            />
                            <View style={{flexDirection: 'row', alignItems: 'center', marginVertical: spacing.medium}}>
                            
                            <TextInput
                                ref={ownNsecInputRef}
                                onChangeText={(name) => setOwnNsec(name.trim())}
                                value={ownNsec}
                                autoCapitalize='none'
                                keyboardType='default'
                                maxLength={64}
                                placeholder='nsec...'
                                selectTextOnFocus={true}
                                style={[$nip05Input, {backgroundColor: inputBg}]}                                                
                            />
                            <Button
                                tx={'common.paste'}
                                preset='secondary'
                                style={$pasteButton}                            
                                onPress={onPasteOwnNsec}
                            />
                            <Button
                                tx={'common.confirm'}
                                style={$saveButton}
                                onPress={onConfirmOwnNsec}                            
                            />                        
                        </View>
                        </View>
                    }
                />
            )}

            {ownProfile && isSetupCompleted && (
                <>
                <Card
                    style={[$card, {marginTop: spacing.medium}]}
                    ContentComponent={
                    <>
                        <ListItem
                            leftIcon='faTriangleExclamation'
                            text='Consider before change'
                            subText={'Using your own Nostr address will disable Lightning address features unique to minibits.cash address.'}                        
                        />
                        <ListItem
                            leftIcon='faCheckCircle'
                            leftIconColor={colors.palette.success200}
                            text='Profile change is ready'
                            subText='Wallet needs to restart to apply this change.'                      
                            style={{}}
                        />
                    </>
                    }
                    />
                    <View style={$buttonContainer}>
                        <Button
                            preset="default"
                            text={'Apply change'}
                            onPress={onConfirmChange}
                        />
                        <Button
                            preset="secondary"
                            text={'Save my soul'}
                            onPress={onCancelChange}
                        />
                    </View>
                </>

            )}

        </View>
        <BottomModal
            isVisible={isProfileChangeCompleted ? true : false}            
            ContentComponent={
                <View style={$bottomModal}>                
                    <ProfileHeader headerBg='transparent' />
                    <Text 
                        style={{color: textResult, textAlign: 'center', marginTop: spacing.small}} 
                        text={'Profile change is complete.'} 
                    />
                    <View style={$buttonContainer}>
                    <Button
                        preset="secondary"
                        tx={'common.close'}
                        onPress={() => {
                            navigation.navigate('Contacts', {})
                        }}
                    />
                    </View>             
                </View>
            }
            onBackButtonPress={() => navigation.navigate('Contacts', {})}
            onBackdropPress={() => navigation.navigate('Contacts', {})}
        />
        {isLoading && <Loading />}
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)


const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.medium,
    height: spacing.screenHeight * 0.18,
}

const $numIcon: ViewStyle = {
    width: 30, 
    height: 30, 
    borderRadius: 15, 
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.medium
}

const $contentContainer: TextStyle = {
    // flex: 1,
    padding: spacing.extraSmall,
    // alignItems: 'center',
}

const $nip05Container: TextStyle = {
    // padding: spacing.small,
    // alignItems: 'center',
}

const $pasteButton: ViewStyle = {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    alignSelf: 'stretch',
    justifyContent: 'center', 
}

const $saveButton: ViewStyle = {
    borderRadius: spacing.small,
    marginLeft: spacing.small,
}

const $nip05Input: TextStyle = {
    flex: 1,    
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $bottomModal: ViewStyle = {
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
    marginTop: spacing.large,
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

