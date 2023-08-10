import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation'
import {
    APP_ENV,
    LOG_LEVEL,
    SENTRY_ACTIVE,
    NATIVE_VERSION_ANDROID,
    JS_BUNDLE_VERSION,
    COMMIT,    
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
} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {translate} from '../i18n'
import AppError from '../utils/AppError'
import {Database} from '../services'
import {MMKVStorage} from '../services'
import {maxTransactionsInModel} from '../models/TransactionsStore'
import { log } from '../utils/logger'

export const DeveloperScreen: FC<SettingsStackScreenProps<'Developer'>> = observer(function DeveloperScreen(_props) {
    const {navigation} = _props
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {transactionsStore, userSettingsStore} = useStores()

    const [isLoading, setIsLoading] = useState(false)
    const [rnVersion, setRnVersion] = useState<string>('')
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
            setInfo(
                `Reset completed. ${result.length} recent transactions were loaded from database.`,
            )
            return true
        }

        setInfo('Reset aborted, there are no transactions in local database.')
        setIsLoading(false)
        return false
      } catch (e: any) {
        handleError(e)
      }
    }

    const factoryReset = async function () {
      Alert.alert(
        'Confirmation',
        'All application data will be deleted. Are you sure you want to perform a factory reset?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => {
              // Action canceled
            },
          },
          {
            text: 'Confirm',
            onPress: async () => {
              setIsLoading(true)
              try {
                Database.cleanAll()
                // recreate db schema
                Database.getInstance()
                MMKVStorage.clearAll()

                setIsLoading(false)
                setInfo('Factory reset completed, please restart Minibits')
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
                  tx="developerScreen.transactions"
                  subText={translate(
                    'developerScreen.transactionsDescription',
                    {count: transactionsStore.count},
                  )}
                  leftIcon='faRotate'
                  leftIconColor={colors.light.tint}
                  leftIconInverse={true}
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}
                  bottomSeparator={true}
                  onPress={syncTransactionsFromDb}
                />
                <ListItem
                  tx="developerScreen.info"
                  subText={`Environment: ${APP_ENV}
Native version: ${NATIVE_VERSION_ANDROID}
JS Bundle version: ${JS_BUNDLE_VERSION}
React Native: ${rnVersion}
Commit: ${COMMIT}
Log level: ${LOG_LEVEL}
Sentry active: ${SENTRY_ACTIVE}
Sentry id: ${userSettingsStore.userSettings.walletId}
                  `}
                  leftIcon='faInfoCircle'
                  leftIconColor={colors.palette.iconGreen300}
                  leftIconInverse={true}
                  bottomSeparator={true}
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}
                />
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
              </>
            }
          />
        </View>
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
