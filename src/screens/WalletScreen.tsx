import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useCallback, useRef} from 'react'
import {useFocusEffect} from '@react-navigation/native'
import {
  TextStyle,
  ViewStyle,
  View,
  Text as RNText,
  AppState,
} from 'react-native'
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import {useThemeColor, spacing, colors, typography} from '../theme'
import {
  Button,
  Icon,
  Screen,
  Text,
  Card,
  ListItem,
  InfoModal,
  Loading,
  BottomModal,
  ErrorModal,
} from '../components'
import {useStores} from '../models'
import {WalletStackScreenProps} from '../navigation'
// import useIsInternetReachable from '../utils/useIsInternetReachable'
import {useHeader} from '../utils/useHeader'
import {Mint, MintBalance} from '../models/Mint'
import {MintsByHostname} from '../models/MintsStore'
import {log} from '../utils/logger'
import {Transaction} from '../models/Transaction'
import {TransactionListItem} from './Transactions/TransactionListItem'
import {MintClient, MintKeys, MintKeySets, Wallet} from '../services'
import {translate} from '../i18n'
import AppError from '../utils/AppError'

interface WalletScreenProps extends WalletStackScreenProps<'Wallet'> {}


export const WalletScreen: FC<WalletScreenProps> = observer(
  function WalletScreen({route, navigation}) {    
    const {mintsStore, proofsStore, transactionsStore, invoicesStore} = useStores()
    
    const appState = useRef(AppState.currentState);

    useHeader({
      rightIcon: 'faBolt',
      rightIconColor: colors.palette.primary100,
      onRightPress: () => toggleLightningModal(),
      leftIcon: 'faListUl',
      leftIconColor: colors.palette.primary100,
      onLeftPress: () => gotoTranHistory(),
    })

    const scrollY = useSharedValue(0)

    const handleScroll = useAnimatedScrollHandler(event => {
      scrollY.value = event.contentOffset.y
    })

    const stylez = useAnimatedStyle(() => {
      return {
        transform: [
          {
            translateY: scrollY.value,
          },
        ],
      }
    })

    const [balances, setBalances] = useState(() => proofsStore.getBalances())    
    const [info, setInfo] = useState<string>('')
    const [defaultMintUrl, setDefaultMintUrl] = useState<string>('https://mint.minibits.cash/Bitcoin')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [isLightningModalVisible, setIsLightningModalVisible] = useState<boolean>(false)

    useFocusEffect(
        useCallback(() => {
            const updatedBalances = proofsStore.getBalances()
            setBalances(updatedBalances)
            // Fixes #3
            Wallet.checkPendingSpent()
            Wallet.checkPendingTopups()
        }, [])
    )

    useFocusEffect(
        useCallback(() => {
            if (!route.params?.scannedMintUrl) {
                log.trace('nothing scanned')
                return
            }

            const scannedMintUrl = route.params?.scannedMintUrl             
            log.trace('route.params', route.params)
            addMint({scannedMintUrl})

        }, [route.params?.scannedMintUrl])
    )

    useEffect(() => {
        const subscription = AppState.addEventListener('change', nextAppState => {
            if (
                appState.current.match(/inactive|background/) &&
                nextAppState === 'active'
            ) {
                // Fixes #3
                Wallet.checkPendingSpent()
                Wallet.checkPendingTopups()

                const updatedBalances = proofsStore.getBalances()
                setBalances(updatedBalances)
            }
    
            appState.current = nextAppState         
        })
    
        return () => {
          subscription.remove();
        }
    }, [])


    const toggleLightningModal = () => {
      setIsLightningModalVisible(previousState => !previousState)
    }


    const addMint = async function ({scannedMintUrl = ''} = {}) {
        // necessary
        navigation.setParams({scannedMintUrl: undefined})       

        const newMintUrl = scannedMintUrl || defaultMintUrl
        
        log.trace('newMintUrl', newMintUrl)
        
        if (mintsStore.alreadyExists(newMintUrl)) {
            const msg = translate('mintsScreen.mintExists')
            log.info(msg)
            setInfo(msg)
            return
        }

        try {
            setIsLoading(true)

            const mintKeys: {
                keys: MintKeys
                keyset: string
            } = await MintClient.getMintKeys(newMintUrl)

            const newMint: Mint = {
                mintUrl: newMintUrl,
                keys: mintKeys.keys,
                keysets: [mintKeys.keyset],
            }

            mintsStore.addMint(newMint)
        } catch (e: any) {
            handleError(e)
        } finally {
            setIsLoading(false)
        }
    }

    const gotoReceive = function () {
        navigation.navigate('Receive', {})
    }

    const gotoScan = function () {
        navigation.navigate('Scan')
    }

    const gotoSend = function () {
        navigation.navigate('Send')
    }

    const gotoTranHistory = function () {
        navigation.navigate('TranHistory')
    }

    const gotoTranDetail = function (id: number) {
      navigation.navigate('TranDetail', {id} as any)
    }

    const gotoWithdraw = function () {
      toggleLightningModal() // close
      navigation.navigate('Transfer', {})
    }

    const gotoTopup = function () {
      toggleLightningModal() // close
      navigation.navigate('Topup')
    }

    const handleError = function (e: AppError) {
      setIsLoading(false)
      setError(e)
    }

    //const balances = proofsStore.getBalances()
    const screenBg = useThemeColor('background')

    return (
      <Screen preset='auto' contentContainerStyle={$screen}>
        <Animated.ScrollView
          style={[$screen, {backgroundColor: screenBg}]}
          scrollEventThrottle={16}
          onScroll={handleScroll}>
          <TotalBalanceBlock
            totalBalance={balances.totalBalance}
            pendingBalance={balances.totalPendingBalance}
            // gotoTranHistory={gotoTranHistory}
          />
          <View style={$contentContainer}>
            {mintsStore.mintCount === 0 && <PromoBlock addMint={addMint} />}
            {mintsStore.groupedByHostname.map(
              (mintsByHostname: MintsByHostname) => (
                <MintsByHostnameListItem
                  key={mintsByHostname.hostname}
                  mintsByHostname={mintsByHostname}
                  mintBalances={balances.mintBalances}
                />
              ),
            )}
            {transactionsStore.count > 0 && (
              <Card
                ContentComponent={
                  <>
                    {transactionsStore.recent.map(
                      (tx: Transaction, index: number) => (
                        <TransactionListItem
                          key={tx.id}
                          tx={tx}
                          isFirst={index === 0}
                          gotoTranDetail={gotoTranDetail}
                        />
                      ),
                    )}
                  </>
                }
                style={$card}
              />
            )}
            {isLoading && <Loading />}
          </View>
        </Animated.ScrollView>
        <Animated.View style={[$bottomContainer, stylez]}>
          <View style={$buttonContainer}>
            <Button
              tx={'walletScreen.receive'}
              LeftAccessory={() => (
                <Icon
                  icon='faArrowDown'
                  color='white'
                  size={spacing.medium}                  
                />
              )}
              onPress={gotoReceive}
              style={[$buttonReceive, {borderRightColor: screenBg}]}
            />
            <Button
              RightAccessory={() => (
                <Icon
                  icon='faExpand'
                  color='white'
                  size={spacing.medium}                  
                />
              )}
              onPress={gotoScan}
              style={$buttonScan}
            />
            <Button
              tx={'walletScreen.send'}
              RightAccessory={() => (
                <Icon
                  icon='faArrowUp'
                  color='white'
                  size={spacing.medium}                  
                />
              )}
              onPress={gotoSend}
              style={[$buttonSend, {borderLeftColor: screenBg}]}
            />
          </View>
        </Animated.View>
        <BottomModal
          isVisible={isLightningModalVisible ? true : false}
          top={spacing.screenHeight * 0.6}
          ContentComponent={
            <LightningActionsBlock
              gotoWithdraw={gotoWithdraw}
              gotoTopup={gotoTopup}
            />
          }
          onBackButtonPress={toggleLightningModal}
          onBackdropPress={toggleLightningModal}
        />
        {info && <InfoModal message={info} />}
        {error && <ErrorModal error={error} />}
      </Screen>
    )
  },
)

const TotalBalanceBlock = observer(function (props: {
    totalBalance: number
    pendingBalance: number
}) {
    const headerBg = useThemeColor('header')
    const balanceColor = 'white'
    const pendingBalanceColor = colors.palette.primary200

    return (
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            <Text
                testID='total-balance'
                preset='heading'
                style={{color: balanceColor}}            
                text={props.totalBalance.toLocaleString()}
            />
            {props.pendingBalance > 0 && (
                <Text
                    testID='pending-balance'
                    preset='default'
                    style={{color: pendingBalanceColor}}
                    text={`Pending: ${props.pendingBalance.toLocaleString()}`}
                />
            )}
        </View>
    )
})

const PromoBlock = function (props: {addMint: any}) {
    return (
        <Card
            HeadingComponent={
            <View style={$promoIconContainer}>
                <Icon icon='faBurst' size={50} color={colors.palette.accent400} />
            </View>
            }
            ContentComponent={
            <View style={{flexDirection: 'row'}}>
                <RNText style={$promoText}>
                Add{' '}
                <Text
                    text='Minibits'
                    style={{fontFamily: 'Gluten-Regular', fontSize: 18}}
                />{' '}
                as your first mint to start!
                </RNText>
            </View>
            }
            style={$card}
            FooterComponent={
            <View style={{alignItems: 'center'}}>
                <Button
                preset='default'
                onPress={props.addMint}
                text='Add your first mint'
                />
            </View>
            }
        />
    )
}

const MintsByHostnameListItem = observer(function (props: {
    mintsByHostname: MintsByHostname
    mintBalances: MintBalance[]
}) {
    const color = useThemeColor('textDim')
    const balanceColor = useThemeColor('amount')

    return (
        <Card
            verticalAlignment='force-footer-bottom'
            HeadingComponent={
            <ListItem
                text={props.mintsByHostname.hostname}
                textStyle={$cardHeading}
                style={{marginHorizontal: spacing.micro}}
            />
            }
            ContentComponent={
            <>
                {props.mintsByHostname.mints.map((mint: Mint) => (
                <ListItem
                    key={mint.mintUrl}
                    text={mint.shortname}
                    textStyle={[$mintText, {color}]}
                    leftIcon={'faCoins'}
                    leftIconColor={mint.color}
                    leftIconInverse={true}
                    RightComponent={
                    <View style={$balanceContainer}>
                        <Text style={[$balance, {color: balanceColor}]}>
                        {props.mintBalances.find(b => b.mint === mint.mintUrl)
                            ?.balance || 0}
                        </Text>
                    </View>
                    }
                    topSeparator={true}
                    style={$item}
                />
                ))}
            </>
            }
            contentStyle={{color}}
            // footer={'Some text'}
            style={$card}
        />
    )
})

const LightningActionsBlock = function (props: {
  gotoWithdraw: any
  gotoTopup: any
}) {
  return (
    <>
        <ListItem
            tx='walletScreen.topUpWallet'
            subTx='walletScreen.topUpWalletSubText'
            leftIcon='faArrowRightToBracket'
            leftIconTransform='rotate-90'
            onPress={props.gotoTopup}
            bottomSeparator={true}
            style={{paddingHorizontal: spacing.medium}}
        />
        <ListItem
            tx='walletScreen.transferFromWallet'
            subTx='walletScreen.transferFromWalletSubText'
            leftIcon='faArrowUpFromBracket'
            onPress={props.gotoWithdraw}
            style={{paddingHorizontal: spacing.medium}}
        />
    </>
  )
}

const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  paddingTop: spacing.extraSmall,
  height: spacing.screenHeight * 0.18,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
  marginTop: spacing.medium,
}

const $contentContainer: TextStyle = {
  marginTop: -spacing.extraLarge * 2,
  flex: 1,
  padding: spacing.extraSmall,
  alignItems: 'center',
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  paddingTop: 0,
}

const $cardHeading: TextStyle = {
  fontFamily: typography.primary?.medium,
  fontSize: 20,
}

const $promoIconContainer: ViewStyle = {
  marginTop: -spacing.large,
  alignItems: 'center',
}

const $promoText: TextStyle = {
  padding: spacing.small,
  textAlign: 'center',
  fontSize: 18,
}

const $item: ViewStyle = {
  marginHorizontal: spacing.micro,
}

const $mintText: TextStyle = {
  overflow: 'hidden',
  fontSize: 14,
}

const $balanceContainer: ViewStyle = {
  justifyContent: 'center',
  alignSelf: 'center',
  marginRight: spacing.extraSmall,
}

const $balance: TextStyle = {
  fontSize: 20,
  fontFamily: typography.primary?.medium,
}

const $bottomContainer: ViewStyle = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  flex: 1,
  justifyContent: 'flex-end',
  marginBottom: spacing.medium,
  alignSelf: 'stretch',
  // opacity: 0,
}

const $buttonReceive: ViewStyle = {
  borderTopLeftRadius: 30,
  borderBottomLeftRadius: 30,
  borderTopRightRadius: 0,
  borderBottomRightRadius: 0,
  minWidth: verticalScale(130),
  borderRightWidth: 1,  
}

const $buttonScan: ViewStyle = {
  borderRadius: 0,
  minWidth: verticalScale(60),
}

const $buttonSend: ViewStyle = {
  borderTopLeftRadius: 0,
  borderBottomLeftRadius: 0,
  borderTopRightRadius: 30,
  borderBottomRightRadius: 30,
  minWidth: verticalScale(130),
  borderLeftWidth: 1,  
}
