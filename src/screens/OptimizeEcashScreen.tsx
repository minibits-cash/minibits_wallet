import React, {useState, useEffect} from 'react'
import {
  TextStyle,
  ViewStyle,
  View,
  Platform,
  ScrollView,
} from 'react-native'
import notifee from '@notifee/react-native'
import {useThemeColor, spacing, colors} from '../theme'
import {
  Button,
  Screen,
  Text,
  Card,
  ListItem,
  ErrorModal,
  Loading,
  BottomModal,
  Header,
} from '../components'
import AppError from '../utils/AppError'
import {useStores} from '../models'
import EventEmitter from '../utils/eventEmitter'
import {NotificationService, SWAP_DENOMINATION_TASK, WalletTask, WalletTaskResult} from '../services'
import {TransactionStatus} from '../models/Transaction'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import {StaticScreenProps, useNavigation} from '@react-navigation/native'

const OPTIMIZE_DENOMINATION_THRESHOLD = 1

type Props = StaticScreenProps<undefined>

export const OptimizeEcashScreen = function OptimizeEcash(_props: Props) {
  const navigation = useNavigation()
  const {proofsStore} = useStores()

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<AppError | undefined>()
  const [denominationCounts, setDenominationCounts] = useState<{denomination: number; count: number}[]>([])
  const [activeDenomination, setActiveDenomination] = useState<number | null>(null)
  const [isResultModalVisible, setIsResultModalVisible] = useState(false)
  const [isNotificationModalVisible, setIsNotificationModalVisible] = useState(false)
  const [resultModalInfo, setResultModalInfo] = useState<
    {status: TransactionStatus; title?: string; message: string} | undefined
  >()

  useEffect(() => {
    const counts = buildDenominationCounts()
    setDenominationCounts(counts)
  }, [])

  useEffect(() => {
    const handleResult = async (result: WalletTaskResult) => {
      if (activeDenomination === null) {
        return
      }

      setIsLoading(false)
      setResultModalInfo({
        status: result.errors.length > 0 ? TransactionStatus.ERROR : TransactionStatus.COMPLETED,
        message: result.message,
      })
      setIsResultModalVisible(true)

      // Refresh denomination counts after optimization
      const counts = buildDenominationCounts()
      setDenominationCounts(counts)
      setActiveDenomination(null)
    }

    if (activeDenomination !== null) {
      EventEmitter.on(`ev_${SWAP_DENOMINATION_TASK}_result`, handleResult)
    }

    return () => {
      EventEmitter.off(`ev_${SWAP_DENOMINATION_TASK}_result`, handleResult)
    }
  }, [activeDenomination])

  const buildDenominationCounts = () => {
    const allProofs = Array.from(proofsStore.proofs.values()).filter(
      p => !p.isSpent && !p.isPending,
    )
    const countMap: Record<number, number> = {}
    for (const proof of allProofs) {
      countMap[proof.amount] = (countMap[proof.amount] ?? 0) + 1
    }
    return Object.entries(countMap)
      .map(([denomination, count]) => ({denomination: Number(denomination), count}))
      .sort((a, b) => a.denomination - b.denomination)
  }

  const optimizeDenomination = async (denomination: number) => {
    const enabled = await NotificationService.areNotificationsEnabled()

    if (!enabled) {
      setIsNotificationModalVisible(true)
      return
    }

    try {
      setIsLoading(true)
      setActiveDenomination(denomination)

      if (Platform.OS === 'android') {
        await NotificationService.createTaskNotification(
          `Optimizing denomination ${denomination}...`,
          {task: SWAP_DENOMINATION_TASK, data: denomination},
        )
      } else {
        WalletTask.swapByDenominationQueue(denomination)
      }
    } catch (e: any) {
      handleError(e)
    }
  }

  const toggleResultModal = async () => {
    setIsResultModalVisible(prev => !prev)
  }

  const openNotificationSettings = async () => {
    await notifee.openNotificationSettings()
  }

  const handleError = (e: AppError) => {
    setIsLoading(false)
    setActiveDenomination(null)
    setError(e)
  }

  const headerBg = useThemeColor('header')
  const headerTitle = useThemeColor('headerTitle')
  const hint = useThemeColor('textDim')

  return (
    <Screen contentContainerStyle={$screen} preset="fixed">
      <Header leftIcon="faArrowLeft" onLeftPress={() => navigation.goBack()} />
      <View style={[$headerContainer, {backgroundColor: headerBg}]}>
        <Text preset="heading" text="Optimize ecash" style={{color: headerTitle}} />
      </View>
      <ScrollView style={$contentContainer}>
        <Card
          ContentComponent={
            <>
              {denominationCounts.length === 0 ? (
                <ListItem text="No ecash proofs found." />
              ) : (
                denominationCounts.map(({denomination, count}) => (
                  <ListItem
                    key={denomination}
                    text={`${denomination} sat`}
                    subText={`Count: ${count}`}
                    RightComponent={
                      count > OPTIMIZE_DENOMINATION_THRESHOLD ? (
                        <View style={$rightContainer}>
                          <Button
                            preset="secondary"
                            text="Optimize"
                            onPress={() => optimizeDenomination(denomination)}
                            textStyle={{lineHeight: verticalScale(16), fontSize: verticalScale(14)}}
                            style={{minHeight: verticalScale(40), paddingVertical: verticalScale(spacing.tiny)}}
                          />
                        </View>
                      ) : undefined
                    }
                  />
                ))
              )}
            </>
          }
          style={$card}
        />
        <View style={$hintContainer}>
          <Text
            style={{color: hint}}
            size="xs"
            preset="formHelper"
            text={`Denominations with more than ${OPTIMIZE_DENOMINATION_THRESHOLD} proofs can be optimized individually.`}
          />
        </View>
      </ScrollView>
      {isLoading && <Loading />}
      {error && <ErrorModal error={error} />}
      <BottomModal
        isVisible={isResultModalVisible}
        ContentComponent={
          <>
            {resultModalInfo?.status === TransactionStatus.COMPLETED && (
              <>
                <ResultModalInfo
                  icon="faCheckCircle"
                  iconColor={colors.palette.success200}
                  title="Success"
                  message={resultModalInfo.message}
                />
                <View style={$buttonContainer}>
                  <Button preset="secondary" text="Close" onPress={toggleResultModal} />
                </View>
              </>
            )}
            {(resultModalInfo?.status === TransactionStatus.ERROR ||
              resultModalInfo?.status === TransactionStatus.BLOCKED) && (
              <>
                <ResultModalInfo
                  icon="faTriangleExclamation"
                  iconColor={colors.palette.focus300}
                  title={resultModalInfo.title ?? 'Optimization failed'}
                  message={resultModalInfo.message}
                />
                <View style={$buttonContainer}>
                  <Button preset="secondary" text="Close" onPress={toggleResultModal} />
                </View>
              </>
            )}
          </>
        }
        onBackButtonPress={toggleResultModal}
        onBackdropPress={toggleResultModal}
      />
      <BottomModal
        isVisible={isNotificationModalVisible}
        ContentComponent={
          <>
            <ResultModalInfo
              icon="faTriangleExclamation"
              iconColor={colors.palette.accent300}
              title="Permission needed"
              message="Minibits needs a permission to display notification while this task will be running."
            />
            <View style={$buttonContainer}>
              <Button preset="secondary" text="Open settings" onPress={openNotificationSettings} />
            </View>
          </>
        }
        onBackButtonPress={() => setIsNotificationModalVisible(false)}
        onBackdropPress={() => setIsNotificationModalVisible(false)}
      />
    </Screen>
  )
}

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
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  marginLeft: spacing.tiny,
  marginRight: -10,
  flexDirection: 'row',
}

const $hintContainer: ViewStyle = {
  marginHorizontal: spacing.medium,
  marginBottom: spacing.small,
}
