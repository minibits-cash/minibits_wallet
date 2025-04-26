import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {ScrollView, Switch, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
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
import { KeyChain } from '../services'
import { BIOMETRY_TYPE } from 'react-native-keychain'
import { log } from '../services/logService'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'

type Props = StaticScreenProps<undefined>

export const SecurityScreen = observer(function SecurityScreen({ route }: Props) {
    const navigation = useNavigation()
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const {userSettingsStore} = useStores()
    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isBiometricAuthOn, setIsBiometricAuthOn] = useState<boolean>(
        userSettingsStore.isAuthOn,
    )
    const [biometryType, setBiometryType] = useState<BIOMETRY_TYPE | null>(null)
    const [error, setError] = useState<AppError | undefined>()
    const [isAuthModalVisible, setIsAuthModalVisible] = useState<boolean>(false)
    const [resultMessage, setResultMessage] = useState<string>()

    useEffect(() => {
        const getBiometry = async () => {
            const biometry: BIOMETRY_TYPE | null = await KeyChain.getSupportedBiometryType()
            log.trace('[getBiometry]', {biometry, isAuthOn: userSettingsStore.isAuthOn})
            setBiometryType(biometry)
        }
        
        getBiometry()        
        return () => {}
    }, [])


    const toggleBiometricAuthSwitch = async () => {
        try {
            setIsLoading(true)
            // check device has biometric support - disabled for testing
             if(!isBiometricAuthOn) {
                const biometryType = await KeyChain.getSupportedBiometryType()

                if(!biometryType) {
                    setInfo('Your device does not support any biometric authentication method.')
                }
            } 

            const result = await userSettingsStore.setIsAuthOn(
                !isBiometricAuthOn,
            )
            
            setIsBiometricAuthOn(result)
            setIsLoading(false)

            if (result === true) {
                setResultMessage(
                    'Biometric authentication to access the wallet has been turned on.',
                )
                toggleAuthModal()
                return
            }

            setResultMessage('Biometric authentication has been disabled.')
            toggleAuthModal()
        } catch (e: any) {
            handleError(e)
        }
    }

    const toggleAuthModal = () =>
        setIsAuthModalVisible(previousState => !previousState)

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const headerTitle = useThemeColor('headerTitle')

    return (
      <Screen preset='fixed' contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Security" style={{color: headerTitle}} />
        </View>
        <ScrollView style={$contentContainer}>
            <Card
                style={$card}
                ContentComponent={
                <>
                    <ListItem
                        tx="securityScreen.biometricAuth"
                        subTx="securityScreen.biometricAuthDescription"
                        leftIcon={isBiometricAuthOn ? 'faLock' : 'faLockOpen'}
                        leftIconColor={
                            isBiometricAuthOn
                            ? colors.palette.success200
                            : colors.palette.neutral400
                        }
                        leftIconInverse={true}
                        RightComponent={
                        <View style={$rightContainer}>
                            <Switch
                            onValueChange={toggleBiometricAuthSwitch}
                            value={isBiometricAuthOn}
                            />
                        </View>
                        }
                        style={$item}
                    />
                    {/*isBiometricAuthOn && (
                        <ListItem
                            tx="securityScreen.biometry"
                            subTx={biometryType ? 'securityScreen.biometryAvailable' : 'securityScreen.biometryNone'}
                            leftIcon='faFingerprint'
                            leftIconColor={colors.palette.iconGreyBlue400}
                            leftIconInverse={true}
                            style={$item}
                            topSeparator={true}
                        /> 
                    )*/} 
                </>
                }
            />            
          {isLoading && <Loading />}
        </ScrollView>
        <BottomModal
            isVisible={isAuthModalVisible ? true : false}            
            ContentComponent={
                <ResultModalInfo
                    icon={isBiometricAuthOn ? 'faLock' : 'faLockOpen'}
                    iconColor={
                        isBiometricAuthOn
                        ? colors.palette.success200
                        : colors.palette.neutral400
                    }
                    title={
                        isBiometricAuthOn ? 'Authentication is on' : 'Authentication is off'
                    }
                    message={resultMessage as string}
                />
            }
            onBackButtonPress={toggleAuthModal}
            onBackdropPress={toggleAuthModal}
        />        
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
