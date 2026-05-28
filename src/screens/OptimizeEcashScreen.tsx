import React, {useState, useEffect, useLayoutEffect, useMemo} from 'react'
import {
  TextStyle,
  ViewStyle,
  View,
  Platform,
} from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
} from 'react-native-reanimated'
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
  AnimatedHeader,
} from '../components'
import AppError from '../utils/AppError'
import {useStores} from '../models'
import EventEmitter from '../utils/eventEmitter'
import {NotificationService, SWAP_DENOMINATION_TASK, WalletTask, WalletTaskResult} from '../services'
import {TransactionStatus} from '../models/Transaction'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import {StaticScreenProps, useNavigation} from '@react-navigation/native'
import {MintBalanceSelector} from './Mints/MintBalanceSelector'
import {MintBalance} from '../models/Mint'
import {MintUnit} from '../services/wallet/currency'

const OPTIMIZE_DENOMINATION_THRESHOLD = 5

type Props = StaticScreenProps<undefined>

export const OptimizeEcashScreen = function OptimizeEcash(_props: Props) {
  const navigation = useNavigation()
  const {proofsStore} = useStores()
  const scrollY = useSharedValue(0)
  const HEADER_SCROLL_DISTANCE = spacing.screenHeight * 0.15

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      header: () => (
        <Header
          leftIcon="faArrowLeft"
          onLeftPress={() => navigation.goBack()}
          title="Optimize ecash"
          scrollY={scrollY}
          scrollDistance={HEADER_SCROLL_DISTANCE}
        />
      ),
    })
  }, [])

  // For now this screen only deals with the 'sat' unit, as denominations are unit-bound.
  const unit: MintUnit = 'sat'

  const mintBalances = useMemo<MintBalance[]>(
    () => proofsStore.getMintBalancesWithUnit(unit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proofsStore.balances],
  )

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<AppError | undefined>()
  const [selectedMintBalance, setSelectedMintBalance] = useState<MintBalance | undefined>(
    () => proofsStore.getMintBalanceWithMaxBalance(unit) ?? mintBalances[0],
  )
  const [denominationCounts, setDenominationCounts] = useState<{denomination: number; count: number}[]>([])
  const [activeDenomination, setActiveDenomination] = useState<number | null>(null)
  const [isResultModalVisible, setIsResultModalVisible] = useState(false)
  const [isNotificationModalVisible, setIsNotificationModalVisible] = useState(false)
  const [resultModalInfo, setResultModalInfo] = useState<
    {status: TransactionStatus; title?: string; message: string} | undefined
  >()

  useEffect(() => {
    const counts = buildDenominationCounts(selectedMintBalance?.mintUrl)
    setDenominationCounts(counts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMintBalance?.mintUrl])

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

      // Refresh denomination counts after optimization for the selected mint
      const counts = buildDenominationCounts(selectedMintBalance?.mintUrl)
      setDenominationCounts(counts)
      setActiveDenomination(null)
    }

    if (activeDenomination !== null) {
      EventEmitter.on(`ev_${SWAP_DENOMINATION_TASK}_result`, handleResult)
    }

    return () => {
      EventEmitter.off(`ev_${SWAP_DENOMINATION_TASK}_result`, handleResult)
    }
  }, [activeDenomination, selectedMintBalance?.mintUrl])

  const buildDenominationCounts = (mintUrl?: string) => {
    if (!mintUrl) {
      return []
    }
    const mintProofs = proofsStore.getByMint(mintUrl, {state: 'UNSPENT', unit})
    const countMap: Record<number, number> = {}
    for (const proof of mintProofs) {
      countMap[proof.amount] = (countMap[proof.amount] ?? 0) + 1
    }
    return Object.entries(countMap)
      .map(([denomination, count]) => ({denomination: Number(denomination), count}))
      .sort((a, b) => a.denomination - b.denomination)
  }

  const onMintBalanceSelect = (balance: MintBalance) => {
    setSelectedMintBalance(balance)
  }

  const optimizeDenomination = async (denomination: number) => {
    if (!selectedMintBalance) {
      return
    }

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
          {
            task: SWAP_DENOMINATION_TASK,
            data: {denomination, mintUrl: selectedMintBalance.mintUrl},
          },
        )
      } else {
        WalletTask.swapByDenominationQueue(denomination, selectedMintBalance.mintUrl)
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

  const hint = useThemeColor('textDim')

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y
    },
  })

  return (
    <Screen contentContainerStyle={$screen} preset="fixed">
      <Animated.ScrollView
        style={$contentContainer}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        <AnimatedHeader
          title="Optimize ecash"
          scrollY={scrollY}
        />
        <View style={[$selectorContainer, {marginTop: -spacing.extraLarge * 1.5}]}>
          {mintBalances.length > 0 ? (
            <MintBalanceSelector
              mintBalances={mintBalances}
              selectedMintBalance={selectedMintBalance}
              unit={unit}
              title="Select mint to optimize"
              onMintBalanceSelect={onMintBalanceSelect}
            />
          ) : (
            <Card content="No mints with balance to optimize." style={$card} />
          )}
        </View>
        <Text
          text={`Only denominations with more than ${OPTIMIZE_DENOMINATION_THRESHOLD} proofs can be optimized - by swapping them with the mint for lower number of ecash notes with higher amounts.`}
          preset="formHelper"
          style={[$hintText, {color: hint}]}
        />
        <Card
          ContentComponent={
            <>
              {denominationCounts.length === 0 ? (
                <ListItem text="No ecash proofs for the selected mint." />
              ) : (
                denominationCounts.map(({denomination, count}, index) => (
                  <ListItem
                    key={denomination}
                    text={`${denomination}`}
                    leftIcon='faMoneyBill1'
                    RightComponent={
                      <View style={$rightContainer}>
                        <Text preset="formHelper" text={`${count}x`} style={{color: hint, marginRight: spacing.small}} />
                      {count > OPTIMIZE_DENOMINATION_THRESHOLD ? (
                          <Button
                            preset="secondary"
                            text="Optimize"
                            onPress={() => optimizeDenomination(denomination)}
                            textStyle={{lineHeight: verticalScale(16), fontSize: verticalScale(14)}}
                            style={{minHeight: verticalScale(40), paddingVertical: verticalScale(spacing.tiny)}}
                          />
                        
                      ) : undefined}
                      </View>
                    }
                    bottomSeparator={index !== denominationCounts.length - 1 ? true : false}
                  />
                ))
              )}
            </>
          }
          style={$card}
        />
      </Animated.ScrollView>
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
  // flex: 1,
}

const $contentContainer: TextStyle = {
  //flex: 1,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  marginHorizontal: spacing.small,
}

const $selectorContainer: ViewStyle = {
  marginHorizontal: spacing.small,
}

const $hintText: TextStyle = {
  marginHorizontal: spacing.medium,
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
  alignItems: 'center',
}
