import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useCallback, useRef} from 'react'
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
  FlatList,
  Pressable,
  Linking
} from 'react-native'
import codePush, { RemotePackage } from 'react-native-code-push'
import {moderateVerticalScale, verticalScale} from '@gocodingnow/rn-size-matters'
import { SvgXml } from 'react-native-svg'
import PagerView, { PagerViewOnPageScrollEventData } from 'react-native-pager-view'
import { ScalingDot } from 'react-native-animated-pagination-dots'
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
  ScanIcon
} from '../components'
import {useStores} from '../models'
import EventEmitter from '../utils/eventEmitter'
import {WalletStackScreenProps} from '../navigation'
import {Mint, MintBalance, MintStatus} from '../models/Mint'
import {MintsByHostname} from '../models/MintsStore'
import {Database, KeyChain, log, NostrClient} from '../services'
import {Env} from '../utils/envtypes'
import {Transaction, TransactionStatus} from '../models/Transaction'
import {TransactionListItem} from './Transactions/TransactionListItem'
import {WalletTask} from '../services'
import {translate} from '../i18n'
import AppError, { Err } from '../utils/AppError'
import {
    APP_ENV,      
    CODEPUSH_STAGING_DEPLOYMENT_KEY,
    CODEPUSH_PRODUCTION_DEPLOYMENT_KEY,
    MINIBITS_MINT_URL,
    NATIVE_VERSION_ANDROID
} from '@env'
import { round } from '../utils/number'
import { NotificationService } from '../services/notificationService'
import { PaymentRequest } from '../models/PaymentRequest'
import Clipboard from '@react-native-clipboard/clipboard'
import { IncomingParser } from '../services/incomingParser'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { CurrencyCode, CurrencySign } from './Wallet/CurrencySign'

// refresh

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView)
const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY

interface WalletScreenProps extends WalletStackScreenProps<'Wallet'> {}

type RelayStatus = {
    relay: string, 
    status: number, 
    error?: string
}

export const WalletScreen: FC<WalletScreenProps> = observer(
  function WalletScreen({route, navigation}) {    
    const {
        mintsStore, 
        proofsStore, 
        transactionsStore, 
        paymentRequestsStore, 
        userSettingsStore, 
        walletProfileStore
    } = useStores()
    
    const appState = useRef(AppState.currentState)
    const isInternetReachable = useIsInternetReachable()
    const returnWithNavigationReset = route.params?.returnWithNavigationReset
   
    const [info, setInfo] = useState<string>('')
    const [defaultMintUrl, setDefaultMintUrl] = useState<string>(MINIBITS_MINT_URL)
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState<boolean>(false)
    
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
                    // toggleUpdateModal()
                    log.info('OTA Update available', update, 'checkForUpdate')
                }             
            } catch (e: any) {                
                return false // silent
            }           

        } 
        
        setTimeout(() => {
            if(!isInternetReachable) {
                return
            }
            checkForUpdate()
        }, 100)
        
    }, [])


    
    const handleBinaryVersionMismatchCallback = function(update: RemotePackage) {
        log.info('[handleBinaryVersionMismatchCallback] triggered', NATIVE_VERSION_ANDROID, update)
        // setIsNativeUpdateAvailable(true)
        // toggleUpdateModal()
    }

    
    useEffect(() => {
        // get deeplink if any
        const getInitialData  = async () => {
            const url = await Linking.getInitialURL()
            
            // log.trace('returnWithNavigationReset', returnWithNavigationReset)
                      
            if (url && !returnWithNavigationReset) {                            
                handleDeeplink({url})                
                return // deeplinks have priority over clipboard
            }
            
            if(!isInternetReachable) { return }

            // Auto-recover inflight proofs - do only on startup and before checkPendingReceived to prevent conflicts
            // TODO add manual option to recovery settings
            WalletTask.handleInFlight().catch(e => false)
            // Create websocket subscriptions to receive tokens or payment requests by NOSTR DMs                    
            WalletTask.receiveEventsFromRelays().catch(e => false)
            // log.trace('[getInitialData]', 'walletProfile', walletProfileStore)            
        }
        
        Linking.addEventListener('url', handleDeeplink)
        getInitialData()

        return () => {}
    }, [])


    const handleDeeplink = async function ({url}: {url: string}) {
        try {

            const incomingData = IncomingParser.findAndExtract(url)
            await IncomingParser.navigateWithIncomingData(incomingData, navigation)

        } catch (e: any) {
            handleError(e)
        }
    }


    const handleClipboard = function (clipboard: string) {
        log.trace('clipboard', clipboard, 'handleClipboard')
    }
    

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
            if(!isInternetReachable) {
                return
            }                
            WalletTask.handleSpentFromPending().catch(e => false)               
            WalletTask.handlePendingTopups().catch(e => false)            
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

                    if(!isInternetReachable) {
                        return
                    } 

                    WalletTask.handleSpentFromPending().catch(e => false) 
                    WalletTask.handlePendingTopups().catch(e => false)
                    // calls checkPendingReceived if re-connects
                    NostrClient.reconnectToRelays().catch(e => false)           
            }
    
            appState.current = nextAppState         
        })        
    
        return () => {
          subscription.remove()          
        }
    }, [])


    const toggleUpdateModal = () => {
        setIsUpdateModalVisible(previousState => !previousState)
    }


    const addMint = async function ({scannedMintUrl = ''} = {}) {
        // necessary
        navigation.setParams({scannedMintUrl: undefined})       

        const newMintUrl = scannedMintUrl || defaultMintUrl
        
        log.trace('newMintUrl', newMintUrl)

        if(newMintUrl.includes('.onion')) {
            if(!userSettingsStore.isTorDaemonOn) {
                setInfo('Please enable Tor daemon in Privacy settings before connecting to the mint using .onion address.')
                return
            }
        }
        
        if (mintsStore.alreadyExists(newMintUrl)) {
            const msg = translate('mintsScreen.mintExists')
            log.info(msg)
            setInfo(msg)
            return
        }

        try {
            setIsLoading(true)
            await mintsStore.addMint(newMintUrl)
        } catch (e: any) {
            handleError(e)
        } finally {
            setIsLoading(false)
        }
    }

    const gotoReceiveOptions = function () {
        navigation.navigate('ReceiveOptions')
    }

    const gotoSendOptions = function () {
        navigation.navigate('SendOptions')
    }

    const gotoScan = function () {
        navigation.navigate('Scan')
    }

    const gotoMintInfo = function (mintUrl: string) {
        navigation.navigate('SettingsNavigator', {screen: 'MintInfo', params: {mintUrl}})
    }

    const gotoTranHistory = function () {
        navigation.navigate('TranHistory')
    }

    const gotoTranDetail = function (id: number) {
      navigation.navigate('TranDetail', {id} as any)
    }

    const gotoPaymentRequests = function () {
        navigation.navigate('PaymentRequests')
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
      <Screen contentContainerStyle={$screen}>
            <Header 
                leftIcon='faListUl'
                leftIconColor={colors.palette.primary100}
                onLeftPress={gotoTranHistory}
                TitleActionComponent={
                    <CurrencySign 
                        currencyCode={CurrencyCode.SATS}
                        // containerStyle={{}}
                        textStyle={{color: 'white'}}              
                    />
                }
                RightActionComponent={
                <>
                    {paymentRequestsStore.countNotExpired > 0 && (
                        <Pressable 
                            style={{flexDirection: 'row', alignItems:'center', marginRight: spacing.medium}}
                            onPress={() => gotoPaymentRequests()}
                        >
                            <Icon icon='faPaperPlane' color={'white'}/>
                            <Text text={`${paymentRequestsStore.countNotExpired}`} style={{color: 'white'}} />
                        </Pressable>
                    )}
                </>
                }                
            />        
            <TotalBalanceBlock
                totalBalance={balances.totalBalance}
                pendingBalance={balances.totalPendingBalance}
                isMoreThenOneMint={groupedMints.length > 1 ? true : false}
            />
            <View style={[$contentContainer, (groupedMints.length > 1) ? {marginTop: -spacing.extraLarge * 2.4} : {marginTop: -spacing.extraLarge * 1.8}]}>
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
                                containerStyle={{bottom: undefined, position: undefined, marginTop: -spacing.tiny, paddingBottom: spacing.medium}}
                                //@ts-ignore
                                scrollX={scrollX}
                                dotSize={30}
                            />
                        )}
                        <AnimatedPagerView
                            testID="pager-view"
                            initialPage={0}
                            ref={pagerRef}
                            style={{flexGrow: 1}}                                             
                            onPageScroll={onPageScroll}
                        >
                            {groupedMints.map((mints) => (
                                <View key={mints.hostname}>
                                    <MintsByHostnameListItem                                    
                                        mintsByHostname={mints}
                                        mintBalances={balances.mintBalances.filter(balance => balance.mint.includes(mints.hostname))}
                                        gotoMintInfo={gotoMintInfo}                                     
                                    />
                                    {transactionsStore.recentByHostname(mints.hostname).length > 0 && (
                                        <Card                                    
                                            ContentComponent={                                            
                                                <FlatList
                                                    data={transactionsStore.recentByHostname(mints.hostname) as Transaction[]}
                                                    renderItem={({item, index}) => {
                                                        return (<TransactionListItem
                                                            key={item.id}
                                                            transaction={item}
                                                            isFirst={index === 0}
                                                            isTimeAgoVisible={true}
                                                            gotoTranDetail={gotoTranDetail}
                                                        />)
                                                        }
                                                    }
                                                    // keyExtractor={(item, index) => item.id}
                                                    // contentContainerStyle={{paddingRight: spacing.small}}
                                                    style={{ maxHeight: 300 - (mints.mints.length > 1 ? mints.mints.length * 38 : 0)}}
                                                />                                            
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
              onPress={gotoReceiveOptions}
              style={[$buttonReceive, {borderRightColor: screenBg}]}
            />
            <Button
              RightAccessory={() => (
                <SvgXml 
                    width={spacing.medium} 
                    height={spacing.medium} 
                    xml={ScanIcon}
                    fill='white'
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
              onPress={gotoSendOptions}
              style={[$buttonSend, {borderLeftColor: screenBg}]}
            />
          </View>
        </View>
        <BottomModal
          isVisible={isUpdateModalVisible ? true : false}
          style={{alignItems: 'stretch'}}
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
        {info && <InfoModal message={info} />}
        {error && <ErrorModal error={error} />}
      </Screen>
    )
  },
)

const TotalBalanceBlock = observer(function (props: {
    totalBalance: number
    pendingBalance: number
    isMoreThenOneMint: boolean
}) {
    const headerBg = useThemeColor('header')
    const balanceColor = 'white'
    const currencyColor = colors.palette.primary200

    return (
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            <Text
                testID='total-balance'
                preset='heading'              
                style={[$totalBalance, props.isMoreThenOneMint ? {color: balanceColor} : {color: balanceColor, paddingTop: spacing.tiny}]}            
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
            style={[$card, {marginTop: spacing.small}]}
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
    gotoMintInfo: any
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
                //bottomSeparator={true}                
            />
            }
            ContentComponent={
            <>
                {props.mintsByHostname.mints.map((mint: Mint) => (
                <ListItem
                    key={mint.mintUrl}
                    text={mint.shortname}
                    textStyle={[$mintText, {color}]}
                    leftIcon={mint.status === MintStatus.OFFLINE ? 'faTriangleExclamation' : 'faCoins'}
                    leftIconColor={mint.color}                    
                    leftIconInverse={true}
                    RightComponent={
                    <View style={$balanceContainer}>
                        <Text style={[$balance, {color: balanceColor}]}>
                        {(props.mintBalances.find(b => b.mint === mint.mintUrl)
                            ?.balance || 0).toLocaleString()}
                        </Text>
                    </View>
                    }
                    //topSeparator={true}
                    style={$item}
                    onPress={() => props.gotoMintInfo(mint.mintUrl)}
                />
                ))}
            </>
            }
            contentStyle={{color}}            
            style={$card}
        />
    )
})



const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.tiny,  
    height: spacing.screenHeight * 0.18,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.medium,
}

const $contentContainer: TextStyle = {
    // padding: spacing.extraSmall,    
    flex: 0.85,
    // paddingTop: spacing.extraSmall - 3,
    // borderWidth: 1,
    // borderColor: 'green',
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  paddingTop: 0,
  marginHorizontal: spacing.extraSmall,
  // alignSelf: 'stretch'
}

const $cardHeading: TextStyle = {
  fontFamily: typography.primary?.medium,
  fontSize: moderateVerticalScale(18),
}

const $totalBalance: TextStyle = {
    fontSize: moderateVerticalScale(48),
    lineHeight: moderateVerticalScale(48)
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
