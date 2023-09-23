import {observer} from 'mobx-react-lite'
import React, {FC, useState} from 'react'
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
} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {Database, Wallet} from '../services'

export const BackupScreen: FC<SettingsStackScreenProps<'Backup'>> = observer(function BackupScreen(_props) {
    const {navigation} = _props
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const {userSettingsStore, proofsStore} = useStores()

    const [isLoading, setIsLoading] = useState(false)
    const [isLocalBackupOn, setIsLocalBackupOn] = useState<boolean>(
      userSettingsStore.isLocalBackupOn,
    )
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')
    const [isBackupModalVisible, setIsBackupModalVisible] =
      useState<boolean>(false)
    const [backupResultMessage, setBackupResultMessage] = useState<string>()

    const toggleBackupSwitch = () => {
      try {
        setIsLoading(true)
        const result = userSettingsStore.setIsLocalBackupOn(!isLocalBackupOn)
        setIsLocalBackupOn(result)

        if (result === true) {
          Database.addOrUpdateProofs(proofsStore.allProofs)
          Database.addOrUpdateProofs(proofsStore.allPendingProofs, true)

          setBackupResultMessage(
            'Your minibits tokens were backed up to local database. New tokens will be backed up automatically.',
          )
          toggleBackupModal()
          setIsLoading(false)
          return
        }

        Database.removeAllProofs()
        setIsLoading(false)
        setBackupResultMessage(
          'Your backup of minibits tokens has been deleted. New tokens will not be backed up.',
        )
        toggleBackupModal()
      } catch (e: any) {
        handleError(e)
      }
    }

    const toggleBackupModal = () =>
      setIsBackupModalVisible(previousState => !previousState)

    const gotoLocalRecovery = function () {
      navigation.navigate('LocalRecovery')
    }

    const checkSpent = async function () {
      setIsLoading(true)
      const result = (await Wallet.checkSpent()) as {
        spentCount: number
        spentAmount: number
      } | void
      setIsLoading(false)

      if (result && result.spentAmount > 0) {
        setInfo(
          `${result.spentCount} ecash proofs, ${result.spentAmount} sats in total were removed from the wallet.`,
        )
        return
      }

      setInfo('No spent ecash found in your wallet')
    }

    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }

    const headerBg = useThemeColor('header')

    return (
      <Screen preset='auto' style={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Backup" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$card}
            HeadingComponent={
              <>
                <ListItem
                  tx="backupScreen.localBackup"
                  subTx="backupScreen.localBackupDescription"
                  leftIcon='faDownload'
                  leftIconColor={
                    isLocalBackupOn
                      ? colors.palette.success200
                      : colors.palette.neutral400
                  }
                  leftIconInverse={true}
                  RightComponent={
                    <View style={$rightContainer}>
                      <Switch
                        onValueChange={toggleBackupSwitch}
                        value={isLocalBackupOn}
                      />
                    </View>
                  }
                  style={$item}
                />
                {isLocalBackupOn && (
                  <ListItem
                    tx="backupScreen.recoveryTool"
                    subTx="backupScreen.recoveryToolDescription"
                    leftIcon='faUpload'
                    leftIconColor={colors.palette.focus300}
                    leftIconInverse={true}
                    style={$item}
                    onPress={gotoLocalRecovery}
                  />
                )}
                <ListItem
                  tx="backupScreen.removeSpentCoins"
                  subTx="backupScreen.removeSpentCoinsDescription"
                  leftIcon='faRecycle'
                  leftIconColor={colors.palette.secondary300}
                  leftIconInverse={true}
                  style={$item}
                  onPress={checkSpent}
                />
              </>
            }
          />
          {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isBackupModalVisible ? true : false}
          top={spacing.screenHeight * 0.5}
          style={{paddingHorizontal: spacing.small}}
          ContentComponent={
            <ResultModalInfo
              icon={'faDownload'}
              iconColor={
                isLocalBackupOn
                  ? colors.palette.success200
                  : colors.palette.neutral400
              }
              title={
                isLocalBackupOn ? 'Local backup is on' : 'Local backup is off'
              }
              message={backupResultMessage as string}
            />
          }
          onBackButtonPress={toggleBackupModal}
          onBackdropPress={toggleBackupModal}
        />
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)

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

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  // padding: spacing.extraSmall,
  alignSelf: 'center',
  // marginLeft: spacing.small,
}
