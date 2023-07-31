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
import { KeyChain } from '../services'
import { BIOMETRY_TYPE } from 'react-native-keychain'
import { log } from '../utils/logger'

export const SecurityScreen: FC<SettingsStackScreenProps<'Security'>> = observer(function SecurityScreen(_props) {
    const {navigation} = _props
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const {userSettingsStore} = useStores()
    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isStorageEncrypted, setIsStorageEncrypted] = useState<boolean>(
        userSettingsStore.isStorageEncrypted,
    )
    const [biometryType, setBiometryType] = useState<BIOMETRY_TYPE | null>(null)
    const [error, setError] = useState<AppError | undefined>()
    const [isEncryptionModalVisible, setIsEncryptionModalVisible] = useState<boolean>(false)
    const [encryptionResultMessage, setEncryptionResultMessage] = useState<string>()

    useEffect(() => {
        const getBiometry = async () => {
            const biometry: BIOMETRY_TYPE | null = await KeyChain.getSupportedBiometryType()
            log.info('supportedBiometryType', biometry, 'getBiometry')
            setBiometryType(biometry)
        }
        
        getBiometry()
        
        return () => {          
        }
    }, [])


    const toggleEncryptedSwitch = async () => {
        try {
            setIsLoading(true)
            // check device has biometric support - disabled for testing
             if(!isStorageEncrypted) {
                const biometryType = await KeyChain.getSupportedBiometryType()

                if(!biometryType) {
                    setInfo('Your device does not support any biometric authentication to protect the encryption key.')
                }
            } 

            const result = await userSettingsStore.setIsStorageEncrypted(
                !isStorageEncrypted,
            )
            
            setIsStorageEncrypted(result)
            setIsLoading(false)

            if (result === true) {
                setEncryptionResultMessage(
                    'Storage has been AES encrypted with the key stored in the device secure keys storage.',
                )
                toggleEncryptionModal()
                return
            }

            setEncryptionResultMessage('Storage encryption has been disabled.')
            toggleEncryptionModal()
        } catch (e: any) {
            handleError(e)
        }
    }

    const toggleEncryptionModal = () =>
        setIsEncryptionModalVisible(previousState => !previousState)

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')

    return (
      <Screen style={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Security" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
              <>
              <ListItem
                tx="securityScreen.encryptStorage"
                subTx="securityScreen.encryptStorageDescription"
                leftIcon={isStorageEncrypted ? 'faLock' : 'faLockOpen'}
                leftIconColor={
                    isStorageEncrypted
                      ? colors.palette.success200
                      : colors.palette.neutral400
                }
                leftIconInverse={true}
                RightComponent={
                  <View style={$rightContainer}>
                    <Switch
                      onValueChange={toggleEncryptedSwitch}
                      value={isStorageEncrypted}
                    />
                  </View>
                }
                style={$item}
              />
              <ListItem
                tx="securityScreen.biometry"
                subTx={biometryType ? 'securityScreen.biometryAvailable' : 'securityScreen.biometryNone'}
                leftIcon='faFingerprint'
                leftIconColor={
                    biometryType
                      ? colors.palette.success200
                      : colors.palette.neutral400
                }
                leftIconInverse={true}
                RightComponent={!!biometryType ? (
                    <View style={[$rightContainer, {marginLeft: spacing.small}]}>
                    <Icon
                        icon='faCheckCircle'
                        size={spacing.large}
                        color={
                        (isStorageEncrypted)
                            ? colors.palette.success200
                            : colors.palette.neutral400
                        }
                        inverse={false}
                    />
                    </View>
                ) : (<></>)}
                style={$item}
              />
              </>
            }
          />
          {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isEncryptionModalVisible ? true : false}
          top={spacing.screenHeight * 0.5}
          // style={{marginHorizontal: spacing.extraSmall}}
          ContentComponent={
            <ResultModalInfo
              icon={isStorageEncrypted ? 'faLock' : 'faLockOpen'}
              iconColor={
                isStorageEncrypted
                  ? colors.palette.success200
                  : colors.palette.neutral400
              }
              title={
                isStorageEncrypted ? 'Encryption is on' : 'Encryption is off'
              }
              message={encryptionResultMessage as string}
            />
          }
          onBackButtonPress={toggleEncryptionModal}
          onBackdropPress={toggleEncryptionModal}
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
