import {observer} from 'mobx-react-lite'
import React, {FC, useRef, useState} from 'react'
import {Image, LayoutAnimation, Platform, ScrollView, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {getPublicKey} from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, Loading} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import Clipboard from '@react-native-clipboard/clipboard'
import { log } from '../services/logService'
import { KeyChain, NostrKeyPair, NostrClient, NostrProfile } from '../services'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { ProfileHeader } from '../components/ProfileHeader'
import { translate } from '../i18n'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'
import FastImage from 'react-native-fast-image'
import { nip19 } from 'nostr-tools'


type Props = StaticScreenProps<{}>

export const OwnKeysScreen = observer(function OwnKeysScreen({ route }: Props) {    

    const navigation = useNavigation()
    const {walletProfileStore, walletStore, relaysStore} = useStores() 

    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        title: walletProfileStore.nip05,
        titleStyle: {fontFamily: typography.primary?.medium, fontSize: 16}      
    })

    const ownNip05InputRef = useRef<TextInput>(null)
    const ownNsecInputRef = useRef<TextInput>(null)        

    const [ownNip05, setOwnNip05] = useState<string>('')
    const [ownNsec, setOwnNsec] = useState<string>('')
    const [ownProfile, setOwnProfile] = useState<NostrProfile | undefined>(undefined)
    const [ownKeyPair, setOwnKeyPair] = useState<NostrKeyPair | undefined>(undefined)
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
          setInfo(translate("nostr_pasteError"))
          return
        }  
        setOwnNip05(nip.trim())        
    }


    const onConfirmOwnNip05 = async function () {
        try {
            const nip05Name = NostrClient.getNameFromNip05(ownNip05)
            const nip05Domain = NostrClient.getDomainFromNip05(ownNip05)

            if(!nip05Name || !nip05Domain) {
              setInfo(translate("nostr_invalidAddressFormat"))
            }

            if(MINIBITS_NIP05_DOMAIN.includes(nip05Domain as string)) {
              setInfo(translate("nostr_minibitsNameKeyReuseError", { domain: MINIBITS_NIP05_DOMAIN }))
              return
            }

            setIsLoading(true)
            // get nip05 record from the .well-known server
            const {nip05Pubkey, nip05Relays} = await NostrClient.getNip05PubkeyAndRelays(ownNip05)

            if(nip05Relays.length > 0) {
                let counter: number = 0
                for (const relay of nip05Relays) {
                    if(counter < 5) {
                        relaysStore.addRelay({
                            url: relay,
                            status: WebSocket.CLOSED
                        })
                        counter++
                    } else {
                        break
                    }
                }
            }

            const relaysToConnect = relaysStore.allPublicUrls
            setOwnProfileRelays(relaysToConnect)

            const profile: NostrProfile | undefined = await NostrClient.getProfileFromRelays(nip05Pubkey, relaysToConnect)
            
            if(!profile) {
              throw new AppError(Err.VALIDATION_ERROR, "Could not retrieve profile from relays", {
                nip05Pubkey, relaysToConnect
              })
            }
            
            // check that the profile's nip05 matches the one given by user and living on nip05 .well-known server
            if(!profile.nip05) {
                if(profile.name && profile.name.toLowerCase() === nip05Name) {
                  profile.nip05 = ownNip05
                } else {
                  throw new AppError(
                    Err.VALIDATION_ERROR, 
                    translate("nostr_profileRelayMismatchedIdentifierError"), 
                    { ownNip05, profile }
                  )
                }
            }

            if(profile.nip05 !== ownNip05) {
              throw new AppError(
                Err.VALIDATION_ERROR, 
                translate("nostr_profileRelayMismatchedIdentifierError"), 
                { ownNip05, profile }
              )
            }

            if(!profile.name) {
              profile.name = nip05Name as string
            }

            LayoutAnimation.easeInEaseOut()

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
          setInfo(translate("nsecPasteError"))
          return
        }  
        setOwnNsec(key)        
    }


    const onConfirmOwnNsec = async function () {
        try {
            if(!ownProfile) {
                throw new AppError(Err.VALIDATION_ERROR, translate("nsecMissingProfileError"))
            }
            // validate that nsec matches profile pubkey
            const privateKey = NostrClient.getHexkey(ownNsec)
            log.trace('Got private key', privateKey)
            const publicKey = getPublicKey(hexToBytes(privateKey))
            log.trace('Got public key', publicKey)

            if(publicKey !== ownProfile.pubkey) {
                throw new AppError(Err.VALIDATION_ERROR, translate("nsecPrivatePublicKeyMismatchError"), {publicKey})
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
              throw new AppError(Err.VALIDATION_ERROR, translate('nsecMissingProfileError'))
            }

            setIsLoading(true)
            // update wallet profile
            const updatedProfile = await walletProfileStore.updateNip05(
                ownProfile.pubkey,
                ownProfile.name as string,
                ownProfile.nip05 as string,                
                ownProfile.lud16 || '',
                ownProfile.picture as string,
                true // isOwnProfile                
            )

            // update Nostr keys
            const cachedKeys = await walletStore.getCachedWalletKeys()
            const keys = { ...cachedKeys } // Create a shallow copy to avoid modifying readonly properties
            keys['NOSTR'] = ownKeyPair

            await KeyChain.saveWalletKeys(keys)
            walletStore.cleanCachedWalletKeys()

            setIsLoading(false)
            setIsProfileChangeCompleted(true)
            
        } catch(e: any) {
            handleError(e)
        }
    }


    const onCancelChange = async function () {
        resetState()
    }

    const onProfileChangeClose = async function () {
        resetState()
        // @ts-ignore
        navigation.navigate('ContactsNavigator', {
            screen: 'Profile'
        })  
    }


    const handleError = function (e: AppError): void { 
        resetState()      
        setError(e)
    }

    const iconNip05 = useThemeColor('textDim')
    const textResult = useThemeColor('textDim')
    const inputBg = useThemeColor('background')
    const inputText = useThemeColor('text')
    const placeholderTextColor = useThemeColor('textDim')
    
    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
            <ScrollView style={$contentContainer}>
            <Card
                style={$card}
                ContentComponent={
                    <>
                    {!ownProfile ? (
                        <View style={$nip05Container}>                    
                            <ListItem
                              LeftComponent={<View style={[$numIcon, {backgroundColor: iconNip05}]}><Text text='1'/></View>}
                              tx="nostr_enterAddress"
                              subTx="nostr_enterAddressDesc"
                              bottomSeparator={true}
                              style={{}}
                            />                    
                            <View style={{
                              flexDirection: 'row', 
                              alignItems: 'center', 
                              marginVertical: spacing.medium
                            }}>                            
                                <TextInput
                                  ref={ownNip05InputRef}
                                  onChangeText={(name) => setOwnNip05(name.trim())}
                                  value={ownNip05}
                                  autoCapitalize='none'
                                  keyboardType='default'
                                  maxLength={30}
                                  placeholder='name@domain.com'
                                  placeholderTextColor={placeholderTextColor}
                                  selectTextOnFocus={true}
                                  style={[$nip05Input, {backgroundColor: inputBg, color: inputText}]}                                                   
                                />
                                <Button
                                  tx='commonPaste'
                                  preset='secondary'
                                  style={$pasteButton}                                
                                  onPress={onPasteOwnNip05}
                                />
                                <Button
                                  tx='commonConfirm'
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
                                            <FastImage 
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
                                    tx='relays'
                                    subText={ownProfileRelays.toString()}                        
                                    topSeparator={true}
                                    style={{}}
                                />
                            )}
                            {isSetupCompleted && (
                                <ListItem
                                    leftIcon='faKey'
                                    tx='privateKey'
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
                                tx="nsecEnterPrivateKey"
                                subTx="nsecEnterPrivateKeyDesc"
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
                                placeholderTextColor={placeholderTextColor}
                                selectTextOnFocus={true}
                                style={[$nip05Input, {backgroundColor: inputBg, color: inputText}]}                                                
                            />
                            <Button
                                tx='commonPaste'
                                preset='secondary'
                                style={$pasteButton}                            
                                onPress={onPasteOwnNsec}
                            />
                            <Button
                                tx='commonConfirm'
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
                            tx="nostr_lastStandDialog_title"
                            subTx="nostr_lastStandDialog_desc"
                        />
                        <ListItem
                            leftIcon='faCheckCircle'
                            leftIconColor={colors.palette.success200}
                            tx="nostr_lastStandDialog_readyTitle"
                            subText="nostr_lastStandDialog_readyDesc"
                            style={{}}
                        />
                    </>
                    }
                    />
                    <View style={$buttonContainer}>
                        <Button
                            preset="default"
                            tx='nostr_lastStandDialog_confirm'
                            onPress={onConfirmChange}
                        />
                        <Button
                            preset="secondary"
                            tx='nostr_lastStandDialog_cancel'
                            onPress={onCancelChange}
                        />
                    </View>
                </>

            )}

        </ScrollView>
        <BottomModal
            isVisible={isProfileChangeCompleted ? true : false}            
            ContentComponent={
                <View style={$bottomModal}>                
                    <ProfileHeader headerBg='transparent' headerTextStyle={{color: textResult}}/>
                    <Text 
                        style={{color: textResult, textAlign: 'center', marginTop: spacing.small}} 
                        tx="nostr_lastStandDialog_complete"
                    />
                    <View style={$buttonContainer}>
                    <Button
                        preset="secondary"
                        tx='commonClose'
                        onPress={onProfileChangeClose}
                    />
                    </View>             
                </View>
            }
            onBackButtonPress={onProfileChangeClose}
            onBackdropPress={onProfileChangeClose}
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
    paddingBottom: spacing.medium,
    height: spacing.screenHeight * 0.15,
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

