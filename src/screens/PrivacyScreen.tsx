import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState, useLayoutEffect} from 'react'
import {Switch, TextStyle, View, ViewStyle} from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
} from 'react-native-reanimated'
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
  Header,
  AnimatedHeader,
} from '../components'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import { KeyChain, MinibitsClient, log } from '../services'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { StackActions, StaticScreenProps, useNavigation } from '@react-navigation/native'
import { translate } from '../i18n'

type Props = StaticScreenProps<undefined>

export const PrivacyScreen = observer(function PrivacyScreen({ route }: Props) {
    const navigation = useNavigation()
    const scrollY = useSharedValue(0)
    const HEADER_SCROLL_DISTANCE = spacing.screenHeight * 0.07

    useLayoutEffect(() => {
      navigation.setOptions({
        headerShown: true,
        header: () => (
          <Header
            titleTx="privacyScreen_title"
            leftIcon="faArrowLeft"
            onLeftPress={() => navigation.goBack()}
            scrollY={scrollY}
            scrollDistance={HEADER_SCROLL_DISTANCE}
          />
        ),
      })
    }, [])

    const {userSettingsStore, walletProfileStore, walletStore, authStore} = useStores()
    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [statusMessage, setStatusMessage] = useState<string>('')
    const [isLoggerOn, setIsLoggerOn] = useState<boolean>(
        userSettingsStore.isLoggerOn,
    )
    const [isDerivedKeys, setIsDerivedKeys] = useState<boolean>(false)
    const [error, setError] = useState<AppError | undefined>()

    // Check if Nostr keys are derived from seed on mount
    useEffect(() => {
        const checkDerivedKeys = async () => {
            try {
                const keys = await walletStore.getCachedWalletKeys()
                if (keys) {
                    setIsDerivedKeys(KeyChain.areNostrKeysDerived(keys))
                }
            } catch (e) {
                log.error('[PrivacyScreen] Error checking derived keys', e)
            }
        }
        checkDerivedKeys()
    }, [])       

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

    const upgradeToNostrDerivedKeys = async () => {
        setIsLoading(true)
        setStatusMessage(translate('privacyScreen_upgradingKeys'))

        try {
            const keys = await walletStore.getCachedWalletKeys()
            if (!keys || !keys.SEED?.mnemonic) {
                throw new Error('Wallet keys or mnemonic not available')
            }

            // Derive Nostr keys from mnemonic using NIP-06
            const derivedNostrKeys = KeyChain.deriveNostrKeyPair(keys.SEED.mnemonic)

            log.trace('[upgradeToNostrDerivedKeys]', {
                oldPubkey: keys.NOSTR.publicKey,
                newPubkey: derivedNostrKeys.publicKey
            })

            // Update server profile with the new derived pubkey
            // Uses recover endpoint with same seedHash to atomically rotate pubkey
            await walletProfileStore.recover(                
                keys.SEED.seedHash,
                derivedNostrKeys.publicKey
            )

            // Update local keys
            const keysCopy = { ...keys }
            keysCopy.NOSTR = derivedNostrKeys

            await KeyChain.saveWalletKeys(keysCopy)
            walletStore.cleanCachedWalletKeys()

            // Re-authenticate with new derived keys to get fresh JWT tokens
            await authStore.clearTokens()
            await authStore.enrollDevice(derivedNostrKeys)

            // Update state
            setIsDerivedKeys(true)
            setStatusMessage('')
            setIsLoading(false)
            setInfo(translate('privacyScreen_derivedKeysDescription'))

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
            const cachedKeys = await walletStore.getCachedWalletKeys()
            if (!cachedKeys || !cachedKeys.SEED?.mnemonic) {
                throw new Error('Wallet keys or mnemonic not available')
            }

            // Derive Nostr keys from mnemonic (NIP-06) instead of generating random keys
            const derivedKeyPair = KeyChain.deriveNostrKeyPair(cachedKeys.SEED.mnemonic)

            // update Nostr keys
            const keys = { ...cachedKeys }
            keys['NOSTR'] = derivedKeyPair

            await KeyChain.saveWalletKeys(keys)
            walletStore.cleanCachedWalletKeys()

            // set name to default walletId
            const name = walletProfileStore.walletId as string

            // get random image
            const pictures = await MinibitsClient.getRandomPictures() // TODO PERF

            // update wallet profile on server
            await walletProfileStore.updateNip05(
                derivedKeyPair.publicKey,
                name,
                name + MINIBITS_NIP05_DOMAIN, // nip05
                name + MINIBITS_NIP05_DOMAIN, // lud16
                pictures[0],
                false // isOwnProfile
            )

            // Re-authenticate with derived keys to get fresh JWT tokens
            await authStore.clearTokens()
            await authStore.enrollDevice(derivedKeyPair)

            // Update derived keys state
            setIsDerivedKeys(true)

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
    
    const iconColor = useThemeColor('textDim')

    const scrollHandler = useAnimatedScrollHandler({
      onScroll: (event) => {
        scrollY.value = event.contentOffset.y
      },
    })

    return (
      <Screen style={$screen} preset='fixed'>
        <AnimatedHeader
          titleTx="privacyScreen_title"
          scrollY={scrollY}
          scrollDistance={HEADER_SCROLL_DISTANCE}
        />
        <Animated.ScrollView
          style={$contentContainer}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
        >
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
                        tx="privacyScreen_derivedKeys"
                        subTx={isDerivedKeys
                          ? "privacyScreen_derivedKeysDescription"
                          : "privacyScreen_legacyKeysDescription"
                        }
                        leftIcon={'faKey'}
                        leftIconColor={
                            isDerivedKeys
                            ? colors.palette.success200
                            : iconColor as string
                        }
                        leftIconInverse={true}
                        RightComponent={
                            isDerivedKeys ? (
                                <View style={$rightContainer}>
                                    <Switch
                                        value={true}
                                        disabled={true}
                                    />
                                </View>
                            ) : (
                                <Button
                                    style={{maxHeight: 10, marginTop: spacing.medium}}
                                    preset="secondary"
                                    tx="privacyScreen_upgradeKeys"
                                    onPress={upgradeToNostrDerivedKeys}
                                />
                            )
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
          {isLoading && <Loading statusMessage={statusMessage} />}
        </Animated.ScrollView>
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
