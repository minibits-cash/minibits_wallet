import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Switch, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation'
import {
  Icon,
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
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import { KeyChain, MinibitsClient, } from '../services'
import { log } from '../services/logService'
import { OwnKeysScreen } from './OwnKeysScreen'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { CommonActions, StackActions } from '@react-navigation/native'

enum TorStatus {
    NOTINIT = 'NOTINIT',
    STARTING = 'STARTING',
    DONE = 'DONE',
}

export const PrivacyScreen: FC<SettingsStackScreenProps<'Privacy'>> = observer(function PrivacyScreen(_props) {
    const {navigation} = _props
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {
            const routes = navigation.getState()?.routes
            let prevRouteName: string = ''

            if(routes.length >= 2) {
                prevRouteName = routes[routes.length - 2].name
            }

            if(prevRouteName === 'Settings') {
                navigation.navigate('Settings')
            } else {
                navigation.dispatch(
                    StackActions.replace('Settings')                    
                )
                navigation.navigate('WalletNavigator', {screen: 'Wallet'})
            }  
        }
    })

    const {userSettingsStore, walletProfileStore} = useStores()
    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isTorDaemonOn, setIsTorDaemonOn] = useState<boolean>(
        userSettingsStore.isTorDaemonOn,
    )
    const [isLoggerOn, setIsLoggerOn] = useState<boolean>(
        userSettingsStore.isLoggerOn,
    )
    const [torStatus, setTorStatus] = useState<TorStatus>(TorStatus.NOTINIT)   
    const [error, setError] = useState<AppError | undefined>()    
    const [isTorModalVisible, setIsTorModalVisible] = useState<boolean>(false)    
    const [torResultMessage, setTorResultMessage] = useState<string>()


    useEffect(() => {
        const getTorStatus = async () => {
            if(!userSettingsStore.isTorDaemonOn) {
                return
            }

            //const status = await TorDaemon.getStatus()            

            //log.trace('torStatus', status, 'getTorStatus')
            //setTorStatus(status.toUpperCase())
        }
        
        getTorStatus()
        
        return () => {}
    }, [])


    /* const toggleTorDaemonSwitch = async () => {
        try {
            setIsLoading(true)

            const result = userSettingsStore.setIsTorDaemonOn(
                !isTorDaemonOn,
            )
            
            const statusBefore = await TorDaemon.getStatus() 
            setTorStatus(statusBefore.toUpperCase())

            if(result) {
                await TorDaemon.start()                
            } else {
                await TorDaemon.stop()
            }

            
            const statusAfter = await TorDaemon.getStatus() 
            setTorStatus(statusAfter.toUpperCase())
            setIsTorDaemonOn(result)
            
            setIsLoading(false)

            if (result === true) {
                setTorResultMessage(
                    'Tor daemon has been activated. You can now connect with mints using .onion addresses.',
                )
                toggleTorModal()
                return
            }

            setTorResultMessage('Tor daemon has been disabled.')
            toggleTorModal()
        } catch (e: any) {
            handleError(e)
            await TorDaemon.stop()
        }
    }

    const startTor = async () => {
        try {
            if(!userSettingsStore.isTorDaemonOn) {
                return
            }

            setIsLoading(true)
            await TorDaemon.start()
            
            const statusAfter = await TorDaemon.getStatus()
            setTorStatus(statusAfter.toUpperCase())
            setIsLoading(false)
            
        } catch (e: any) {
            handleError(e)
            await TorDaemon.stop()
        }
    }


    const stopTor = async () => {
        try {
            setIsLoading(true)
            await TorDaemon.stop()
            
            const statusAfter = await TorDaemon.getStatus()
            setTorStatus(statusAfter.toUpperCase())
            setIsLoading(false)
            
        } catch (e: any) {
            handleError(e)            
        }
    }

    const toggleTorModal = () =>
        setIsTorModalVisible(previousState => !previousState) */
    

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
        navigation.navigate('ContactsNavigator', {screen: 'OwnKeys'})
    }

    const resetProfile = async function() {
        setIsLoading(true)        

        try {
            // overwrite with new keys
            const keyPair = KeyChain.generateNostrKeyPair()
            await KeyChain.saveNostrKeyPair(keyPair)

            // set name to default walletId
            const name = userSettingsStore.walletId as string

            // get random image
            const pictures = await MinibitsClient.getRandomPictures() // TODO PERF

            // update wallet profile
            await walletProfileStore.updateNip05(
                keyPair.publicKey,                
                name,
                name + MINIBITS_NIP05_DOMAIN, // nip05
                name + MINIBITS_NIP05_DOMAIN, // lud16
                pictures[0],
                false // isOwnProfile
            )


            navigation.navigate('ContactsNavigator', {screen: 'Profile'})
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

    return (
      <Screen style={$screen} preset='auto'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Privacy" style={{color: 'white'}} />
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
                        text="Use own Nostr profile"
                        subText={walletProfileStore.isOwnProfile ? walletProfileStore.nip05 : "Import your own Nostr address and keys. Your wallet will stop communicating with minibits.cash Nostr and LNURL address servers, disabling Lightning address features for receiving zaps and payments. Only for hardcore ecash-ers!"}
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
                                    text="Reset"
                                    onPress={resetProfile}
                                />
                            ) : (
                                <Button
                                    style={{maxHeight: 10, marginTop: spacing.medium}}
                                    preset="secondary"
                                    text="Import"
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
