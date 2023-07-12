import {observer} from 'mobx-react-lite'
import React, {FC, useState} from 'react'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation'
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

export const DeveloperScreen: FC<SettingsStackScreenProps<'Developer'>> = observer(function DeveloperScreen(_props) {
    const {navigation} = _props
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {transactionsStore} = useStores()

    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')

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
                setInfo('Factory reset completed')
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
    const { version } = packageJson
    const rnVersion = packageJson.dependencies['react-native']

    return (
      <Screen style={$screen}>
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
                  LeftComponent={
                    <Icon
                      icon="faRotate"
                      size={spacing.medium}
                      color={colors.light.tint}
                      inverse={true}
                    />
                  }
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}
                  bottomSeparator={true}
                  onPress={syncTransactionsFromDb}
                />
                <ListItem
                  tx="developerScreen.reset"
                  subTx="developerScreen.resetDescription"
                  LeftComponent={
                    <Icon
                      icon="faXmark"
                      size={spacing.medium}
                      color={colors.palette.angry500}
                      inverse={true}
                    />
                  }
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}
                  bottomSeparator={true}
                  onPress={factoryReset}
                />
                <ListItem
                  tx="developerScreen.info"
                  subText={`Version: ${version}, React Native: ${rnVersion}`}
                  LeftComponent={
                    <Icon
                      icon="faInfoCircle"
                      size={spacing.medium}
                      color={colors.palette.iconGreen300}
                      inverse={true}
                    />
                  }
                  RightComponent={<View style={$rightContainer} />}
                  style={$item}
                  // bottomSeparator={true}
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
