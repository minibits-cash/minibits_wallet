import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Alert, Platform, ScrollView, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {
    APP_ENV,        
    JS_BUNDLE_VERSION,
    COMMIT,
    IOS_BUILD,
    ANDROID_VERSION_CODE,
} from '@env'
import packageJson from '../../package.json'
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
import {rootStoreInstance, useStores} from '../models'
import {translate} from '../i18n'
import AppError from '../utils/AppError'
import {Database, KeyChain} from '../services'
import {MMKVStorage} from '../services'
import { LogLevel } from '../services/log/logTypes'
import { getSnapshot } from 'mobx-state-tree'
import { delay } from '../utils/delay'
import RNExitApp from 'react-native-exit-app'
import { TransactionStatus } from '../models/Transaction'
import { maxTransactionsInHistory } from '../models/TransactionsStore'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'
// refresh // refresh

type Props = StaticScreenProps<undefined>

export const DeveloperScreen = observer(function DeveloperScreen({ route }: Props) {
    const navigation = useNavigation()
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {transactionsStore, userSettingsStore, proofsStore, walletProfileStore, authStore} = useStores()
    const rootStore = useStores()

    const [isLoading, setIsLoading] = useState(false)
    const [rnVersion, setRnVersion] = useState<string>('')
    const [walletStateSize, setWalletStateSize] = useState<number>(0)
    const [dbVersion, setDbVersion] = useState<number>(0)
    const [isLogLevelSelectorVisible, setIsLogLevelSelectorVisible] = useState<boolean>(false)
    const [selectedLogLevel, setSelectedLogLevel] = useState<LogLevel>(userSettingsStore.logLevel)
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')

    useEffect(() => {
        const init = async () => {            
            const rn = packageJson.dependencies['react-native']
            const snapshot = getSnapshot(rootStoreInstance)
            // log.info('[SNAPSHOT]', {snapshot})
            const stateSize = Buffer.byteLength(JSON.stringify(snapshot), 'utf8')

            const db = Database.getInstance()
            const {version} = Database.getDatabaseVersion(db)

            setDbVersion(version)
            setWalletStateSize(stateSize)
            setRnVersion(rn)
        }
        init()
    }, [])

    // Reset of transaction model state and reload from DB
    const syncTransactionsFromDb = async function () {
      setIsLoading(true)
      try {
        const dbTransactions = await Database.getTransactionsAsync(
          maxTransactionsInHistory,
          0,
        )

        if (dbTransactions && dbTransactions.length > 0) {
            // remove all from the transactionsStore model
            transactionsStore.removeAllTransactions()

            // Add last 10 to history
            await transactionsStore.addToHistory(maxTransactionsInHistory, 0, false)
            // Add recent by unit
            await transactionsStore.addRecentByUnit()

            setIsLoading(false)
            setInfo(translate('resetCompletedDetail', { transCount: dbTransactions.length }))
            return true
        }

        setInfo(translate("resetAborted"))
        setIsLoading(false)
        return false
      } catch (e: any) {
        handleError(e)
      }
    }


    const deletePending = async function () {
      Alert.alert(
        translate("commonConfirmAlertTitle"),
        "This action can not be undone. Use only in development or testing.",
        [
          {
            text: translate('commonCancel'),
            style: 'cancel',
            onPress: () => { /* Action canceled */ },
          },
          {
            text: translate('commonConfirm'),
            onPress: async () => {
              try {
                setIsLoading(true)
                transactionsStore.deleteByStatus(TransactionStatus.PENDING)
        
                const pending = proofsStore.allPendingProofs
                const pendingCount = proofsStore.pendingProofsCount.valueOf()

                if(pendingCount > 0) {
                  // move pending to spent
                  proofsStore.moveToSpent(pending) 
                }

                syncTransactionsFromDb()                

                setIsLoading(false)
                setInfo(`Removed pending transactions from the database and ${pendingCount} proofs from the wallet state`)
                
              } catch (e: any) {
                handleError(e)
              }
            },
          },
        ],
      )      
    }


    const movePendingToSpendable = async function () {
      Alert.alert(
        translate("commonConfirmAlertTitle"),
        "This action may cause transactions failure. Use only as a recovery path agreed with support.",
        [
          {
            text: translate('commonCancel'),
            style: 'cancel',
            onPress: () => { /* Action canceled */ },
          },
          {
            text: translate('commonConfirm'),
            onPress: async () => {
              try {
                setIsLoading(true)
                transactionsStore.deleteByStatus(TransactionStatus.PENDING)
        
                const pending = proofsStore.allPendingProofs
                const pendingCount = proofsStore.pendingProofsCount.valueOf()                

                if(pendingCount > 0) {
                  // force move pending proofs to spendable wallet                  
                  proofsStore.revertToSpendable(pending)
                }                     

                setIsLoading(false)
                setInfo(`${pendingCount} pending proofs were moved to spendable balance.`)
                
              } catch (e: any) {
                handleError(e)
              }
            },
          },
        ],
      )      
    }

    const deleteJwtTokens = async function () {
      Alert.alert(
        translate("commonConfirmAlertTitle"),
        translate("developerScreen_clearJwtTokensDescription"),
        [
          {
            text: translate('commonCancel'),
            style: 'cancel',
            onPress: () => { /* Action canceled */ },
          },
          {
            text: translate('commonConfirm'),
            onPress: async () => {
              try {
                setIsLoading(true)                
                await authStore.logout()
                setIsLoading(false)
                setInfo(translate("developerScreen_jwtTokensCleared"))
              } catch (e: any) {
                handleError(e)
              }
            },
          },
        ],
      )
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
        translate("commonConfirmAlertTitle"),
        translate("factoryResetUserConfirmDesc"),
        [
          {
            text: translate('commonCancel'),
            style: 'cancel',
            onPress: () => { /* Action canceled */ },
          },
          {
            text: translate('commonConfirm'),
            onPress: async () => {
                setIsLoading(true)
                try {
                  // Delete database
                  Database.cleanAll()
                  // Clean mobx storage
                  MMKVStorage.clearAll()
                  rootStore.reset()
                  // recreate db schema
                  Database.getInstance()             
                  // Delete wallet keys
                  await KeyChain.removeWalletKeys()
                  // Delete biometric auth token
                  await KeyChain.removeAuthToken()
                  // Delete jwt tokens
                  await KeyChain.removeJwtTokens()
                  // Reset server's jwt tokens and logout
                  await authStore.logout()

                  setIsLoading(false)
                  setInfo(translate("factoryResetSuccess"))
                  await delay(2000)
                  RNExitApp.exitApp()
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
    const headerTitle = useThemeColor('headerTitle')

    return (
      <Screen style={$screen} preset='fixed'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="heading"
            tx="developerScreen_title"
            style={{color: headerTitle}}
          />
        </View>
        <ScrollView style={$contentContainer}>          
          <Card
            style={[$card]}
            HeadingComponent={
                <ListItem
                  tx="developerScreen_info"
                  subText={`Environment: ${APP_ENV}
JS Bundle version: ${JS_BUNDLE_VERSION}
${Platform.OS === 'android' ? 'Android version code: ' + ANDROID_VERSION_CODE : 'iOS build: ' + IOS_BUILD}
Commit: ${COMMIT}
DB version: ${dbVersion}
State size: ${walletStateSize.toLocaleString()} bytes
React Native: ${rnVersion}ß
Sentry id: ${walletProfileStore.walletId}
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
              <>
                <ListItem
                  tx="developerScreen_logLevel"
                  subText={userSettingsStore.logLevel.toUpperCase()}
                  leftIcon='faListUl'
                  leftIconColor={colors.palette.iconMagenta200}
                  leftIconInverse={true}                  
                  style={$item}
                  bottomSeparator={true}
                  onPress={toggleLogLevelSelector}
                />
                <ListItem
                  tx="showOnboarding"
                  subTx="showOnboardingDesc"
                  leftIcon='faInfoCircle'
                  leftIconColor={colors.light.tint}
                  leftIconInverse={true}                  
                  style={$item}     
                  bottomSeparator={true}             
                  onPress={() => userSettingsStore.setIsOnboarded(false)}
                /> 
                <ListItem
                  tx="developerScreen_resyncTransactions"
                  subTx="developerScreen_resyncTransactionsDescription"
                  leftIcon='faRotate'
                  leftIconColor={colors.palette.blue200}
                  leftIconInverse={true}                  
                  style={$item}                  
                  onPress={syncTransactionsFromDb}
                /> 
              </>
            }
          />
          <Card
            label='Danger zone'
            labelStyle={{marginTop: spacing.medium}}
            style={[$card, {marginBottom: spacing.large}]}
            HeadingComponent={
              <>
                <ListItem
                  tx="developerScreen_forceMovePending"
                  subTx="developerScreen_forceMovePendingDescription"
                  leftIcon='faArrowUp'
                  leftIconColor={colors.palette.accent200}
                  leftIconInverse={true}
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}                  
                  onPress={movePendingToSpendable}
                />
                <ListItem
                  tx="developerScreen_forceDeletePending"
                  subTx="developerScreen_forceDeletePendingDescription"
                  leftIcon='faClock'
                  leftIconColor={colors.palette.accent400}
                  leftIconInverse={true}
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}                  
                  onPress={deletePending}
                  topSeparator
                />
                <ListItem
                  tx="developerScreen_clearJwtTokens"
                  subTx="developerScreen_clearJwtTokensDescription"
                  leftIcon='faKey'
                  leftIconColor={colors.palette.focus300}
                  leftIconInverse={true}
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}                  
                  onPress={deleteJwtTokens}
                  topSeparator
                />
                <ListItem
                  tx="developerScreen_reset"
                  subTx="developerScreen_resetDescription"
                  leftIcon='faXmark'
                  leftIconColor={colors.palette.angry500}
                  leftIconInverse={true}
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}                  
                  onPress={factoryReset}
                  topSeparator
                />  
              </>
            }
            />
        </ScrollView>
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
                        tx='commonClose'
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
