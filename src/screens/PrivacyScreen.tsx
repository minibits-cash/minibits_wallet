import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Switch, TextStyle, View, ViewStyle, ScrollView} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {
  ListItem,
  Screen,
  Text,
  Card,
  Loading,
  ErrorModal,
  InfoModal,
  BottomModal,
  Button,
} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import { KeyChain, MinibitsClient, } from '../services'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { StackActions, StaticScreenProps, useNavigation } from '@react-navigation/native'
import { translate } from '../i18n'

type Props = StaticScreenProps<undefined>

export const PrivacyScreen = observer(function PrivacyScreen({ route }: Props) {
    const navigation = useNavigation()
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {
            navigation.goBack() 
        }
    })

    const {userSettingsStore, walletProfileStore, walletStore} = useStores()
    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isLoggerOn, setIsLoggerOn] = useState<boolean>(
        userSettingsStore.isLoggerOn,
    )
    const [error, setError] = useState<AppError | undefined>()       

    const toggleLoggerSwitch = async () => {
        try {
            const result = userSettingsStore.setIsLoggerOn(
                !isLoggerOn,
            )

            setIsLoggerOn(result)
            
        } catch (e: any) {
            handleError(e)
        }
    }

    const gotoOwnKeys = function() { 
        //@ts-ignore       
        navigation.navigate('ContactsNavigator', {screen: 'OwnKeys'})
    }

    const resetProfile = async function() {
        setIsLoading(true)        

        try {
            // overwrite with new keys
            const newKeyPair = KeyChain.generateNostrKeyPair()

            // update Nostr keys
            const cachedKeys = await walletStore.getCachedWalletKeys()
            const keys = { ...cachedKeys } // Create a shallow copy to avoid modifying readonly properties
            keys['NOSTR'] = newKeyPair

            await KeyChain.saveWalletKeys(keys)
            walletStore.cleanCachedWalletKeys()

            // set name to default walletId
            const name = walletProfileStore.walletId as string

            // get random image
            const pictures = await MinibitsClient.getRandomPictures() // TODO PERF

            // update wallet profile
            await walletProfileStore.updateNip05(
                newKeyPair.publicKey,                
                name,
                name + MINIBITS_NIP05_DOMAIN, // nip05
                name + MINIBITS_NIP05_DOMAIN, // lud16
                pictures[0],
                false // isOwnProfile
            )
            // @ts-ignore
            navigation.navigate('ContactsNavigator', {
                screen: 'Profile'
            })
            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const headerTitle = useThemeColor('headerTitle') 

    return (
      <Screen style={$screen} preset='fixed'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" tx="privacyScreen_title" style={{color: headerTitle}} />
        </View>
        <ScrollView style={$contentContainer}>
            {/*<Card
                style={[$card, {marginTop: spacing.medium}]}
                ContentComponent={
                <>
                    <ListItem
                        tx="privacyScreen_torDaemon"
                        subTx="privacyScreen_torDaemonDescription"
                        leftIcon={'faBullseye'}
                        leftIconColor={
                            isTorDaemonOn
                            ? colors.palette.iconViolet200
                            : iconColor as string
                        }
                        leftIconInverse={true}
                        RightComponent={
                        <View style={$rightContainer}>
                            <Switch
                                onValueChange={toggleTorDaemonSwitch}
                                value={isTorDaemonOn}
                            />
                        </View>
                        }
                        style={$item}
                    />
                    {isTorDaemonOn && (
                        <ListItem
                            tx="privacyScreen_torStatus"
                            subText={`${torStatus}`}
                            leftIcon={torStatus === TorStatus.NOTINIT ? (
                                'faBan'
                            ) : (torStatus ===  TorStatus.STARTING) ? (
                                'faRotate'
                            ) : (torStatus ===  `"${TorStatus.DONE}"`) ? (
                                'faCheckCircle'
                            ) : (
                                'faTriangleExclamation'
                            )}
                            leftIconColor={torStatus === TorStatus.NOTINIT ? (
                               colors.palette.neutral400
                            ) : (torStatus ===  TorStatus.STARTING) ? (
                                colors.palette.accent300
                            ) : (torStatus ===  `"${TorStatus.DONE}"`) ? (
                                colors.palette.success200
                            ) : (
                                colors.palette.accent300
                            )}                        
                            topSeparator={true}
                            style={$item}
                            RightComponent={
                                <>
                                {torStatus === TorStatus.NOTINIT ? (
                                    <Button
                                        style={{maxHeight: 10, marginTop: spacing.medium}}
                                        preset="secondary"
                                        text="Start"
                                        onPress={startTor}
                                    />
                                ) : (
                                    <Button
                                        style={{maxHeight: 10, marginTop: spacing.medium}}
                                        preset="secondary"
                                        text="Stop"
                                        onPress={stopTor}
                                    />
                                )}
                                </>                                
                            }
                        /> 
                    )}                        
                </>
                }
            />*/}
            <Card
                style={[$card, {marginTop: spacing.medium}]}
                ContentComponent={
                <>                    
                    <ListItem
                        tx="nostr_useOwnProfile_title"
                        subText={walletProfileStore.isOwnProfile 
                          ? walletProfileStore.nip05 
                          : translate("nostr_useOwnProfile_desc")
                        }
                        leftIcon={'faShareNodes'}
                        leftIconColor={
                            walletProfileStore.isOwnProfile
                            ? colors.palette.iconViolet200
                            : iconColor as string
                        }
                        leftIconInverse={true}
                        RightComponent={                                   
                            <>
                            {walletProfileStore.isOwnProfile ? (
                                <Button
                                    style={{maxHeight: 10, marginTop: spacing.medium}}
                                    preset="secondary"
                                    tx="commonReset"
                                    onPress={resetProfile}
                                />
                            ) : (
                                <Button
                                    style={{maxHeight: 10, marginTop: spacing.medium}}
                                    preset="secondary"
                                    tx="commonImport"
                                    onPress={gotoOwnKeys}
                                />
                            )}
                            </>                        
                        }
                        style={$item}
                    />
                </>
                }
            />
            <Card
                style={[$card, {marginTop: spacing.medium}]}
                ContentComponent={
                <>                    
                    <ListItem
                        tx="privacyScreen_logger"
                        subTx="privacyScreen_loggerDescription"
                        leftIcon={'faBug'}
                        leftIconColor={
                            isLoggerOn
                            ? colors.palette.angry500
                            : iconColor as string
                        }
                        leftIconInverse={true}
                        RightComponent={
                        <View style={$rightContainer}>
                            <Switch
                                onValueChange={toggleLoggerSwitch}
                                value={isLoggerOn}
                            />
                        </View>
                        }
                        style={$item}
                    />
                </>
                }
            />
          {isLoading && <Loading />}
        </ScrollView>
        {/*<BottomModal
            isVisible={isTorModalVisible ? true : false}            
            ContentComponent={
                <ResultModalInfo
                icon={'faBullseye'}
                iconColor={
                    isTorDaemonOn
                    ? colors.palette.iconViolet200
                    : colors.palette.neutral400
                }
                title={
                    isTorDaemonOn ? 'Tor daemon is on' : 'Tor daemon is off'
                }
                message={torResultMessage as string}
                />
            }
            onBackButtonPress={toggleTorModal}
            onBackdropPress={toggleTorModal}
        />*/}
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}      
      </Screen>
    )
  })

const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.15,
}

const $contentContainer: TextStyle = {
  flex: 1,
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,
  // alignItems: 'center',
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

const $rightContainer: ViewStyle = {
  // padding: spacing.extraSmall,
  alignSelf: 'center',
  //marginLeft: spacing.small,
}
