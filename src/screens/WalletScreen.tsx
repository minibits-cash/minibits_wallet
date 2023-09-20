import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useCallback, useRef, useMemo, createRef, RefObject} from 'react'
import {useFocusEffect} from '@react-navigation/native'
import {
  TextStyle,
  ViewStyle,
  View,
  Text as RNText,
  AppState,
  Image,
  InteractionManager,
  Animated,
  findNodeHandle,
  FlatList,
  Pressable
} from 'react-native'
/* import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated' */
import codePush, { RemotePackage } from 'react-native-code-push'
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
  Header,
} from '../components'
import {useStores} from '../models'
import EventEmitter from '../utils/eventEmitter'
import {WalletStackScreenProps} from '../navigation'
// import useIsInternetReachable from '../utils/useIsInternetReachable'
import {useHeader} from '../utils/useHeader'
import {Mint, MintBalance} from '../models/Mint'
import {MintsByHostname} from '../models/MintsStore'
import {Env, log} from '../utils/logger'
import {Transaction, TransactionStatus} from '../models/Transaction'
import {TransactionListItem} from './Transactions/TransactionListItem'
import {MintClient, MintKeys, ReceivedEventResult, Wallet} from '../services'
import {translate} from '../i18n'
import AppError, { Err } from '../utils/AppError'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import {
    APP_ENV,      
    CODEPUSH_STAGING_DEPLOYMENT_KEY,
    CODEPUSH_PRODUCTION_DEPLOYMENT_KEY, 
} from '@env'
import { round } from '../utils/number'
import { NotificationService } from '../services/notificationService'
import PagerView, { PagerViewOnPageScrollEventData } from 'react-native-pager-view'
import { ExpandingDot, ScalingDot, SlidingBorder, SlidingDot } from 'react-native-animated-pagination-dots'
import { PaymentRequest, PaymentRequestStatus } from '../models/PaymentRequest'
import { Invoice } from '../models/Invoice'

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView)
const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY

interface WalletScreenProps extends WalletStackScreenProps<'Wallet'> {}


export const WalletScreen: FC<WalletScreenProps> = observer(
  function WalletScreen({route, navigation}) {    
    const {mintsStore, proofsStore, transactionsStore, paymentRequestsStore} = useStores()
    
    const appState = useRef(AppState.currentState);

   
    const [info, setInfo] = useState<string>('')
    const [defaultMintUrl, setDefaultMintUrl] = useState<string>('https://mint.minibits.cash/Bitcoin')
    const [error, setError] = useState<AppError | undefined>()
    // const [receivedModalInfo, setReceivedModalInfo] = useState<ReceivedEventResult | undefined>(undefined)
    const [isLoading, setIsLoading] = useState<boolean>(false)
    // const [isLightningModalVisible, setIsLightningModalVisible] = useState<boolean>(false)
    // const [isReceivedModalVisible, setIsReceivedModalVisible] = useState<boolean>(false)

    const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false)
    const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false)
    const [updateDescription, setUpdateDescription] = useState<string>('')
    const [updateSize, setUpdateSize] = useState<string>('')
    const [isNativeUpdateAvailable, setIsNativeUpdateAvailable] = useState<boolean>(false)

    useEffect(() => {
        const checkForUpdate = async () => {            
            try {
                const update = await codePush.checkForUpdate(deploymentKey, handleBinaryVersionMismatchCallback)
                if (update && update.failedInstall !== true) {  // do not announce update that failed to install before
                    setUpdateDescription(update.description)
                    setUpdateSize(`${round(update.packageSize *  0.000001, 2)}MB`)                  
                    setIsUpdateAvailable(true)
                    toggleUpdateModal()
                }
                log.trace('update', update, 'checkForUpdate')
            } catch (e: any) {                
                return false // silent
            }            
        } 
        InteractionManager.runAfterInteractions(async () => {
            checkForUpdate()
        })
    }, [])

    
    const handleBinaryVersionMismatchCallback = function(update: RemotePackage) {
        setIsNativeUpdateAvailable(true)
        toggleUpdateModal()
    }

    
    useEffect(() => {
        InteractionManager.runAfterInteractions(async () => {
            // subscribe once to receive tokens or payment requests by NOSTR DMs
            Wallet.checkPendingReceived()
        })

        EventEmitter.on('receiveTokenCompleted', onReceiveTokenCompleted)
        EventEmitter.on('receivePaymentRequest', onReceivePaymentRequest)
        EventEmitter.on('topupCompleted', onReceiveTopupCompleted)

        return () => {            
            EventEmitter.off('receiveTokenCompleted', onReceiveTokenCompleted)
            EventEmitter.off('receivePaymentRequest', onReceivePaymentRequest) 
            EventEmitter.off('topupCompleted', onReceiveTopupCompleted)          
        }
    }, [])
    

    const gotoUpdate = function() {
        navigation.navigate('SettingsNavigator', {screen: 'Update', params: {
            isNativeUpdateAvailable, 
            isUpdateAvailable, 
            updateDescription,
            updateSize
        }})
    }   
    

    useFocusEffect(        
        useCallback(() => {
            InteractionManager.runAfterInteractions(async () => {                
                Wallet.checkPendingSpent()
                Wallet.checkPendingTopups()                
            })
        }, [])
    )

  
    useFocusEffect(
        useCallback(() => {
            if (!route.params?.scannedMintUrl) {                
                return
            }

            const scannedMintUrl = route.params?.scannedMintUrl         
            addMint({scannedMintUrl})

        }, [route.params?.scannedMintUrl])
    )


    useEffect(() => {        
        const subscription = AppState.addEventListener('change', nextAppState => {
            if (
                appState.current.match(/inactive|background/) &&
                nextAppState === 'active') {
                
                InteractionManager.runAfterInteractions(async () => {         
                    Wallet.checkPendingSpent()
                    Wallet.checkPendingTopups()                    
                })              
            }
    
            appState.current = nextAppState         
        })        
    
        return () => {
          subscription.remove()          
        }
    }, [])

    
    const onReceiveTokenCompleted = async (result: ReceivedEventResult) => {
        log.trace('onReceiveTokenCompleted event handler trigerred', result)

        if (result.status !== TransactionStatus.COMPLETED) {
          return
        }

        await NotificationService.createLocalNotification(
            result.title,
            result.message,
            result.picture,
        )     
    }


    const onReceiveTopupCompleted = async (invoice: Invoice) => { // TODO make it ReceivedEventResult
        log.trace('onReceiveTopupCompleted event handler trigerred', invoice)

        await NotificationService.createLocalNotification(
            `⚡ ${invoice.amount} sats received!`,
            `Your invoice has been paid and your wallet balance credited with ${invoice.amount} sats.`,            
        )     
    }
    
    
    const onReceivePaymentRequest = async (result: ReceivedEventResult) => {
        log.trace('onReceivePaymentRequest event handler trigerred', result)

        await NotificationService.createLocalNotification(
            result.title,
            result.message,
            result.picture,
        )       
    } 


    /* const toggleLightningModal = () => {
      setIsLightningModalVisible(previousState => !previousState)
    } */

    const toggleUpdateModal = () => {
        setIsUpdateModalVisible(previousState => !previousState)
    }

    /* const toggleReceivedModal = () => {
        setIsReceivedModalVisible(previousState => !previousState)
    } */


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
        navigation.navigate('Send', {})
    }

    const gotoTranHistory = function () {
        navigation.navigate('TranHistory')
    }

    const gotoTranDetail = function (id: number) {
      navigation.navigate('TranDetail', {id} as any)
    }

    const gotoTransfer = function (availableMintBalances: MintBalance[] | undefined) {        
        // setIsLightningModalVisible(false)
        navigation.navigate('Transfer', {availableMintBalances})
    }

    const gotoPaymentRequests = function () {
        navigation.navigate('PaymentRequests')
    }

    const gotoTopup = function (availableMintBalances: MintBalance[] | undefined) {        
        // setIsLightningModalVisible(false)
        navigation.navigate('Topup', {availableMintBalances})
    }

    /* Mints pager */

    const groupedMints = mintsStore.groupedByHostname
    const width = spacing.screenWidth
    const pagerRef = useRef<PagerView>(null)
    const scrollOffsetAnimatedValue = React.useRef(new Animated.Value(0)).current
    const positionAnimatedValue = React.useRef(new Animated.Value(0)).current
    const inputRange = [0, groupedMints.length]
    const scrollX = Animated.add(
        scrollOffsetAnimatedValue,
        positionAnimatedValue
    ).interpolate({
        inputRange,
        outputRange: [0, groupedMints.length * width],
    })

    const onPageScroll = React.useMemo(
        () =>
          Animated.event<PagerViewOnPageScrollEventData>(
            [
              {
                nativeEvent: {
                  offset: scrollOffsetAnimatedValue,
                  position: positionAnimatedValue,
                },
              },
            ],
            {
              useNativeDriver: false,
            }
          ),
          
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    )



    const handleError = function (e: AppError) {
      setIsLoading(false)
      setError(e)
    }

    const balances = proofsStore.getBalances()
    const screenBg = useThemeColor('background')
    const iconInfo = useThemeColor('textDim')

    return (
      <Screen preset='fixed' contentContainerStyle={$screen}>
            <Header 
                leftIcon='faListUl'
                leftIconColor={colors.palette.primary100}
                onLeftPress={gotoTranHistory}
                RightActionComponent={
                <>
                    {paymentRequestsStore.countNotExpired > 0 && (
                        <Pressable 
                            style={{flexDirection: 'row', alignItems:'center', marginRight: spacing.medium}}
                            onPress={() => gotoPaymentRequests()}
                        >
                            <Icon icon='faPaperPlane'/>
                            <Text text={`${paymentRequestsStore.countNotExpired}`}/>
                        </Pressable>
                    )}
                </>
                }                
            />        
            <TotalBalanceBlock
                totalBalance={balances.totalBalance}
                pendingBalance={balances.totalPendingBalance}
                // gotoTranHistory={gotoTranHistory}
            />
            <View style={$contentContainer}>
                {mintsStore.mintCount === 0 ? (
                    <PromoBlock addMint={addMint} />
                ) : (
                    <>
                        {groupedMints.length > 1 && (
                            <ScalingDot
                                testID={'sliding-border'}                        
                                data={groupedMints}
                                inActiveDotColor={colors.palette.primary300}
                                activeDotColor={colors.palette.primary100}
                                activeDotScale={1.2}
                                containerStyle={{bottom: undefined, position: undefined, marginTop: -spacing.small, paddingBottom: spacing.medium}}
                                //@ts-ignore
                                scrollX={scrollX}
                                dotSize={30}
                            />
                        )}
                        <AnimatedPagerView
                            testID="pager-view"
                            initialPage={0}
                            ref={pagerRef}
                            style={{ flexGrow: 1}}                                             
                            onPageScroll={onPageScroll}
                        >
                            {groupedMints.map((mints) => (
                                <View key={mints.hostname} style={{marginHorizontal: spacing.extraSmall, flexGrow: 1}}>
                                    <MintsByHostnameListItem                                    
                                        mintsByHostname={mints}
                                        mintBalances={balances.mintBalances.filter(balance => balance.mint.includes(mints.hostname))}
                                        gotoTopup={gotoTopup}
                                        gotoTransfer={gotoTransfer}
                                    />
                                    {transactionsStore.recentByHostname(mints.hostname).length > 0 && (
                                        <Card                                    
                                            ContentComponent={
                                            <>
                                                <FlatList
                                                    data={transactionsStore.recentByHostname(mints.hostname) as Transaction[]}
                                                    renderItem={({item, index}) => {
                                                        return (<TransactionListItem
                                                            key={item.id}
                                                            tx={item}
                                                            isFirst={index === 0}
                                                            gotoTranDetail={gotoTranDetail}
                                                        />)
                                                        }
                                                    }
                                                    // keyExtractor={(item, index) => item.id}
                                                    // contentContainerStyle={{paddingRight: spacing.small}}
                                                    style={{ maxHeight: 300 - (mints.mints.length > 1 ? mints.mints.length * 38 : 0)}}
                                                />
                                            </>
                                            }
                                            style={[$card, {paddingTop: spacing.extraSmall}]}
                                        />
                                    )}                               
                                
                                </View>
                            ))}
                        </AnimatedPagerView>
                    </>
                )}          

                {isLoading && <Loading />}
          </View>
        
        <View style={[$bottomContainer]}>
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
        </View>
        {/*<BottomModal
          isVisible={isLightningModalVisible ? true : false}
          top={spacing.screenHeight * 0.6}
          ContentComponent={
            <LightningActionsBlock
              gotoWithdraw={gotoTransfer}
              gotoTopup={gotoTopup}
            />
          }
          onBackButtonPress={toggleLightningModal}
          onBackdropPress={toggleLightningModal}
        />*/}
        <BottomModal
          isVisible={isUpdateModalVisible ? true : false}
          top={spacing.screenHeight * 0.75}
          style={{padding: spacing.small}}
          ContentComponent={        
            <ListItem
                LeftComponent={
                    <View style={{marginRight: spacing.medium}}>                        
                        <Image 
                            source={{uri: 'https://www.minibits.cash/img/minibits_icon-192.png'}}
                            style={{width: 40, height: 40}}
                        />
                    </View>
                }
                text='New Minibits version is available'
                subText='Updates provide new functionalities and important bug fixes. View details in the Update manager.'
                onPress={gotoUpdate}
            />
          }
          onBackButtonPress={toggleUpdateModal}
          onBackdropPress={toggleUpdateModal}
        />        
        {/* <BottomModal
          isVisible={isReceivedModalVisible ? true : false}
          top={spacing.screenHeight * 0.5}
          ContentComponent={
            <>
              {receivedModalInfo && receivedModalInfo.paymentRequest && (
                  <>
                    <View style={$bottomModal}>                
                        {receivedModalInfo.picture ? (
                        <Image 
                            style={{
                                width: 90, 
                                height: 90, 
                                borderRadius: 45,                        
                            }} 
                            source={{uri: receivedModalInfo.picture}} 
                        />
                    ) : (
                        <Icon
                            icon='faCircleUser'                                
                            size={80}                    
                            color={'white'}                
                        />
                    )}
                    <Text preset='bold' text={receivedModalInfo.title} style={{color: 'white', marginBottom: spacing.small}} />
                    <Text style={{marginTop: spacing.small}} text={receivedModalInfo.message} />
                    <Text 
                        style={{textAlign: 'center', marginTop: spacing.small}} 
                        text={receivedModalInfo.memo} 
                    />
                    <View style={$buttonContainer}>
                        <Button                                
                            text={`Pay invoice`}
                            onPress={() => gotoTransferWithPaymentRequest(receivedModalInfo.paymentRequest as PaymentRequest)}
                        />
                    </View>            
                    </View>

                  </>
                )}              
            </>
          }
          onBackButtonPress={toggleReceivedModal}
          onBackdropPress={toggleReceivedModal}
        /> */}
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
                text='Satoshi'
                size='xxs' 
                style={{color: pendingBalanceColor}}
            />
            <Text
                testID='total-balance'
                preset='heading'              
                style={{color: balanceColor}}            
                text={props.totalBalance.toLocaleString()}
            />
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
            style={[$card, {marginHorizontal: spacing.extraSmall}]}
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
    gotoTopup: any
    gotoTransfer: any
}) {
    const color = useThemeColor('textDim')
    const balanceColor = useThemeColor('amount')
    const buttonBg = useThemeColor('background')   

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
            FooterComponent={
                <View style={[$buttonContainer, {backgroundColor: buttonBg, borderRadius: spacing.small, alignItems: 'center', alignSelf: 'flex-start'}]}>
                    <Button
                        preset='tertiary'
                        onPress={() => props.gotoTopup(props.mintBalances)}
                        style={{minHeight: verticalScale(30)}}
                        text='Topup'
                        textStyle={{lineHeight: verticalScale(16), fontSize: 14}}                                                
                    />
                    <Icon icon='faBolt' size={14} color={color}/>
                    <Button
                        preset='tertiary'
                        onPress={() => props.gotoTransfer(props.mintBalances)}
                        style={{minHeight: verticalScale(30)}}
                        text='Transfer'
                        textStyle={{lineHeight: verticalScale(16), fontSize: 14}}                                                    
                    />
                </View>
            }
            contentStyle={{color}}
            // footer={'Some text'}
            style={$card}
        />
    )
})

/* const LightningActionsBlock = function (props: {
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
} */

const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  paddingTop: 0,
  height: spacing.screenHeight * 0.18,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
  marginTop: spacing.medium,
}

const $contentContainer: TextStyle = {
  marginTop: -spacing.extraLarge * 2,
  flex: 0.9,
  paddingTop: spacing.extraSmall,  
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  paddingTop: 0,
}

const $cardHeading: TextStyle = {
  fontFamily: typography.primary?.normal,
  fontSize: verticalScale(18),
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
  fontSize: verticalScale(20),
  fontFamily: typography.primary?.medium,
}

const $bottomContainer: ViewStyle = {  
  flex: 0.1,
  justifyContent: 'flex-start',
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

const $bottomModal: ViewStyle = {    
    alignItems: 'center',  
    paddingVertical: spacing.large,
    paddingHorizontal: spacing.small,  
  }
