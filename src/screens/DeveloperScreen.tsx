import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation'
import {
    APP_ENV,    
    NATIVE_VERSION_ANDROID,
    JS_BUNDLE_VERSION,
    COMMIT,
    MINIBITS_MINT_URL,
    MINIBITS_RELAY_URL,
    MINIBITS_NIP05_DOMAIN,
    MINIBITS_SERVER_API_HOST 
} from '@env'
import packageJson from '../../package.json'
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
import {translate} from '../i18n'
import AppError from '../utils/AppError'
import {Database, KeyChain, NostrClient} from '../services'
import {MMKVStorage} from '../services'
import {maxTransactionsInModel} from '../models/TransactionsStore'
import { LogLevel } from '../services/log/logTypes'

// refresh

export const DeveloperScreen: FC<SettingsStackScreenProps<'Developer'>> = observer(function DeveloperScreen(_props) {
    const {navigation} = _props
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {transactionsStore, userSettingsStore} = useStores()

    const [isLoading, setIsLoading] = useState(false)
    const [rnVersion, setRnVersion] = useState<string>('')
    const [isLogLevelSelectorVisible, setIsLogLevelSelectorVisible] = useState<boolean>(false)
    const [selectedLogLevel, setSelectedLogLevel] = useState<LogLevel>(userSettingsStore.logLevel)
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')

    useEffect(() => {
        const getRnVersion = async () => {            
            const rn = packageJson.dependencies['react-native']
            setRnVersion(rn)            
        }
        getRnVersion()
    }, [])

    // Reset of whole model state and reload from DB
    const syncTransactionsFromDb = async function () {
      setIsLoading(true)
      try {
        const result = await Database.getTransactionsAsync(
          maxTransactionsInModel,
          0,
        )

        if (result && result.length > 0) {
            // remove all from the transactionsStore model
            transactionsStore.removeAllTransactions()

            // Add last 10 from database
            transactionsStore.addTransactionsToModel(result._array)

            setIsLoading(false)
            setInfo(translate('resetCompletedDetail', { transCount: result.length }))
            return true
        }

        setInfo(translate("resetAborted"))
        setIsLoading(false)
        return false
      } catch (e: any) {
        handleError(e)
      }
    }


    const toggleLogLevelSelector = () =>
        setIsLogLevelSelectorVisible(previousState => !previousState)


    const onLogLevelSelect = function (logLevel: LogLevel) {
        try {
            const result = userSettingsStore.setLogLevel(logLevel)
            setSelectedLogLevel(result)
        } catch (e: any) {
            handleError(e)
        }
    }
    

    const factoryReset = async function () {
      Alert.alert(
        translate("common.confirmAlertTitle"),
        translate("factoryResetUserConfirmDesc"),
        [
          {
            text: translate('common.cancel'),
            style: 'cancel',
            onPress: () => { /* Action canceled */ },
          },
          {
            text: translate('common.confirm'),
            onPress: async () => {
                setIsLoading(true)
                try {
                  // Delete database
                  Database.cleanAll()                
                  // Delete Nostr keys
                  await KeyChain.removeNostrKeypair()
                  // Delete Encryption key
                  await KeyChain.removeMmkvEncryptionKey()
                  // Delete mnemonic
                  await KeyChain.removeMnemonic()
                  // Delete seed
                  await KeyChain.removeSeed()
                  // Clean mobx storage
                  MMKVStorage.clearAll()
                  // recreate db schema
                  Database.getInstance()
                  setIsLoading(false)
                  setInfo(translate("factoryResetSuccess"))
                } catch (e: any) {
                  handleError(e)
                }
            },
          },
        ],
      )
    }

    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const iconSelectedColor = useThemeColor('button')
    const iconColor = useThemeColor('textDim')

    return (
      <Screen style={$screen} preset='auto'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="heading"
            tx="developerScreen.title"
            style={{color: 'white'}}
          />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$card}
            HeadingComponent={
              <>
                <ListItem
                  tx="developerScreen.logLevel"
                  subText={userSettingsStore.logLevel.toUpperCase()}
                  leftIcon='faListUl'
                  leftIconColor={colors.palette.iconMagenta200}
                  leftIconInverse={true}
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}
                  bottomSeparator={true}
                  onPress={toggleLogLevelSelector}
                />
                <ListItem
                  tx="developerScreen.transactions"
                  subText={translate(
                    'developerScreen.transactionsDescription',
                    {count: transactionsStore.count},
                  )}
                  leftIcon='faDownload'
                  leftIconColor={colors.palette.iconYellow300}
                  leftIconInverse={true}
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}
                  bottomSeparator={true}
                  onPress={syncTransactionsFromDb}
                />
                <ListItem
                  tx="showOnboarding"
                  subTx="showOnboardingDesc"
                  leftIcon='faRotate'
                  leftIconColor={colors.light.tint}
                  leftIconInverse={true}
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}                  
                  onPress={() => userSettingsStore.setIsOnboarded(false)}
                /> 
              
              </>
            }
          />
          <Card
            style={[$card, {marginTop: spacing.medium}]}
            HeadingComponent={
                <ListItem
                  tx="developerScreen.info"
                  subText={`Environment: ${APP_ENV}
Native version: ${NATIVE_VERSION_ANDROID}
JS Bundle version: ${JS_BUNDLE_VERSION}
React Native: ${rnVersion}
Commit: ${COMMIT}
Sentry id: ${userSettingsStore.userSettings.walletId}
                  `}
                  leftIcon='faInfoCircle'
                  leftIconColor={colors.palette.iconGreen300}
                  leftIconInverse={true}                  
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}
                /> 
            }
            />
          <Card
            style={[$card, {marginTop: spacing.medium}]}
            HeadingComponent={
                <ListItem
                  tx="developerScreen.reset"
                  subTx="developerScreen.resetDescription"
                  leftIcon='faXmark'
                  leftIconColor={colors.palette.angry500}
                  leftIconInverse={true}
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}                  
                  onPress={factoryReset}
                />  
            }
            />
        </View>
        <BottomModal
          isVisible={isLogLevelSelectorVisible ? true : false}
          style={{alignItems: 'stretch'}}          
          ContentComponent={
            <>
                <ListItem                    
                    text={LogLevel.ERROR.toUpperCase()}
                    subTx="loglevelErrorDesc"
                    leftIcon={selectedLogLevel === LogLevel.ERROR ? 'faCheckCircle' : 'faCircle'}          
                    leftIconColor={selectedLogLevel === LogLevel.ERROR ? iconSelectedColor as string : iconColor as string}                    
                    onPress={() => onLogLevelSelect(LogLevel.ERROR)}
                    style={{paddingHorizontal: spacing.small}}                    
                    bottomSeparator={true}
                />
                <ListItem                    
                    text={LogLevel.INFO.toUpperCase()}
                    subTx="loglevelInfoDesc"
                    leftIcon={selectedLogLevel === LogLevel.INFO ? 'faCheckCircle' : 'faCircle'}          
                    leftIconColor={selectedLogLevel === LogLevel.INFO ? iconSelectedColor as string : iconColor as string}                    
                    onPress={() => onLogLevelSelect(LogLevel.INFO)}
                    style={{paddingHorizontal: spacing.small}}                    
                    bottomSeparator={true}
                />
                <ListItem                    
                    text={LogLevel.DEBUG.toUpperCase()}
                    subTx="loglevelDebugDesc"
                    leftIcon={selectedLogLevel === LogLevel.DEBUG ? 'faCheckCircle' : 'faCircle'}          
                    leftIconColor={selectedLogLevel === LogLevel.DEBUG ? iconSelectedColor as string : iconColor as string}                    
                    onPress={() => onLogLevelSelect(LogLevel.DEBUG)}
                    style={{paddingHorizontal: spacing.small}}                    
                    bottomSeparator={true}
                />
                <View style={$buttonContainer}>
                    <Button
                        preset="secondary"
                        tx='common.close'
                        onPress={toggleLogLevelSelector}
                    />
                </View>

            </>
          }
          onBackButtonPress={toggleLogLevelSelector}
          onBackdropPress={toggleLogLevelSelector}
        />
        {isLoading && <Loading />}
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  })

const $screen: ViewStyle = {
  flex: 1,
}

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

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginLeft: spacing.small,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    marginTop: spacing.large,
}
