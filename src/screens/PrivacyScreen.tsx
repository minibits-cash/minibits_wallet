import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Switch, TextStyle, View, ViewStyle} from 'react-native'
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
            const routes = navigation.getState()?.routes
            let prevRouteName: string = ''

            if(routes && routes.length >= 2) {
                prevRouteName = routes[routes.length - 2].name
            }

            if(prevRouteName === 'Settings') {
                navigation.navigate('Settings')
            } else {
                navigation.dispatch(
                    StackActions.replace('Settings')                    
                )
                navigation.navigate('Wallet', {})
            }  
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
        navigation.navigate('OwnKeys', {})
    }

    const resetProfile = async function() {
        setIsLoading(true)        

        try {
            // overwrite with new keys
            const newKeyPair = KeyChain.generateNostrKeyPair()

            // update Nostr keys
            const keys = await walletStore.getCachedWalletKeys()
            keys.NOSTR = newKeyPair

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


            navigation.navigate('Profile')
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
      <Screen style={$screen} preset='auto'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Privacy" style={{color: headerTitle}} />
        </View>
        <View style={$contentContainer}>
            {/*<Card
                style={[$card, {marginTop: spacing.medium}]}
                ContentComponent={
                <>
                    <ListItem
                        tx="privacyScreen.torDaemon"
                        subTx="privacyScreen.torDaemonDescription"
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
                            tx="privacyScreen.torStatus"
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
                        tx="nostr.useOwnProfile.title"
                        subText={walletProfileStore.isOwnProfile 
                          ? walletProfileStore.nip05 
                          : translate("nostr.useOwnProfile.desc")
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
                                    tx="common.reset"
                                    onPress={resetProfile}
                                />
                            ) : (
                                <Button
                                    style={{maxHeight: 10, marginTop: spacing.medium}}
                                    preset="secondary"
                                    tx="common.import"
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
                        tx="privacyScreen.logger"
                        subTx="privacyScreen.loggerDescription"
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
        </View>
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
  padding: spacing.medium,
  height: spacing.screenHeight * 0.1,
}

const $contentContainer: TextStyle = {
  // flex: 1,
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
