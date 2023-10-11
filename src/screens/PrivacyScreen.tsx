import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Switch, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
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
} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import { TorDaemon } from '../services'
import { log } from '../utils/logger'

enum TorStatus {
    NOTINIT = 'NOTINIT',
    STARTING = 'STARTING',
    DONE = 'DONE',
}

export const PrivacyScreen: FC<SettingsStackScreenProps<'Security'>> = observer(function PrivacyScreen(_props) {
    const {navigation} = _props
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const {userSettingsStore} = useStores()
    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isTorDaemonOn, setIsTorDaemonOn] = useState<boolean>(
        userSettingsStore.isTorDaemonOn,
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

            const tor = TorDaemon.getInstance()
            const status = await tor.getDaemonStatus()

            log.trace('torStatus', status, 'getTorStatus')
            setTorStatus(status.toUpperCase())
        }
        
        getTorStatus()
        
        return () => {}
    }, [])


    const toggleTorDaemonSwitch = async () => {
        try {
            setIsLoading(true)

            const result = userSettingsStore.setIsTorDaemonOn(
                !isTorDaemonOn,
            )

            const tor = TorDaemon.getInstance()
            const statusBefore = await tor.getDaemonStatus()
            setTorStatus(statusBefore.toUpperCase())

            if(result) {
                await tor.startIfNotStarted()                
            } else {
                await tor.stopIfRunning()
            }

            
            const statusAfter = await tor.getDaemonStatus()
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
        }
    }

    const startTor = async () => {
        try {
            if(!userSettingsStore.isTorDaemonOn) {
                return
            }

            setIsLoading(true)

            const tor = TorDaemon.getInstance()            
            await tor.startIfNotStarted()
            
            const statusAfter = await tor.getDaemonStatus()
            setTorStatus(statusAfter.toUpperCase())
            setIsLoading(false)
            
        } catch (e: any) {
            handleError(e)
        }
    }

    const toggleTorModal = () =>
        setIsTorModalVisible(previousState => !previousState)


    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')

    return (
      <Screen style={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Privacy" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
            <Card
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
                            onPress={startTor}
                        /> 
                    )}
                </>
                }
            />
          {isLoading && <Loading />}
        </View>
        <BottomModal
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
        />
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
