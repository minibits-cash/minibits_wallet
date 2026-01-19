import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useCallback, useRef, ReactElement} from 'react'
import {StaticScreenProps, useFocusEffect, useNavigation} from '@react-navigation/native'
import {
  TextStyle,
  ViewStyle,
  View,
  AppState,
  FlatList,
  Pressable,
  Linking,
  LayoutAnimation,
  Platform,
} from 'react-native'
import {moderateScale, verticalScale} from '@gocodingnow/rn-size-matters'
import { SvgXml } from 'react-native-svg'
import { NavigationState, Route, TabBar, TabView } from 'react-native-tab-view'
import {useThemeColor, spacing, colors} from '../theme'
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
  ScanIcon,
  MintIcon
} from '../components'
import EventEmitter from '../utils/eventEmitter'
import {useStores} from '../models'
import {Mint, UnitBalance} from '../models/Mint'
import {MintsByUnit} from '../models/MintsStore'
import {Database, HANDLE_CLAIM_TASK, HANDLE_RECEIVED_EVENT_TASK, log, NostrClient, NotificationService, SyncQueue, WalletTaskResult} from '../services'
import {Transaction, TransactionStatus} from '../models/Transaction'
import {TransactionListItem} from './Transactions/TransactionListItem'
import {WalletTask} from '../services'
import {translate} from '../i18n'
import AppError, { Err } from '../utils/AppError'
import {    
    HOT_UPDATER_API_KEY,
    HOT_UPDATER_URL,
    MINIBITS_MINT_URL,    
} from '@env'
import { IncomingParser } from '../services/incomingParser'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { CurrencySign } from './Wallet/CurrencySign'
import { CurrencyCode, MintUnit, MintUnitCurrencyPairs, convertToFromSats, getCurrency } from "../services/wallet/currency"
import { CurrencyAmount } from './Wallet/CurrencyAmount'
import { LeftProfileHeader } from './ContactsScreen'
import { getUnixTime } from 'date-fns/getUnixTime'
import FastImage from 'react-native-fast-image'
import { HotUpdater, getUpdateSource } from '@hot-updater/react-native'

const MINT_CHECK_INTERVAL = 60

type Props = StaticScreenProps<{
    scannedMintUrl?: string
}>

export const WalletScreen = observer(function WalletScreen({ route }: Props) {
    const navigation = useNavigation() 
    const {        
        mintsStore, 
        proofsStore, 
        transactionsStore,          
        userSettingsStore, 
        nwcStore,
        walletProfileStore,
        walletStore
    } = useStores()        
    
    const appState = useRef(AppState.currentState)
    const lastMintCheckRef = useRef<number>(0)
    const lastBackgroundTimestampRef = useRef<number>(0)
    const isOnlineRef = useRef<boolean>(false)
    const isInternetReachable = useIsInternetReachable()
    const groupedMints: MintsByUnit[] = mintsStore.groupedByUnit

    // Tab view by unit
    const [routes] = useState(
        groupedMints.map((mintUnit) => ({
            key: mintUnit.unit,
            title: getCurrency(mintUnit.unit).code            
        }))
    )
    const [tabIndex, setTabIndex] = useState(0)
    const [currentUnit, setCurrentUnit] = useState<MintUnit>(groupedMints.length > 0 ? groupedMints[0].unit : 'sat')

    const [info, setInfo] = useState<string>('')
    const [defaultMintUrl, setDefaultMintUrl] = useState<string>(MINIBITS_MINT_URL)
    const [pendingCount, setPendingCount] = useState<number>(0)
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [isMintsModalVisible, setIsMintsModalVisible] = useState<boolean>(false)
    const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false)
    const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false)
    const [isSendModalVisible, setIsSendModalVisible] = useState<boolean>(false)
    const [isReceiveModalVisible, setIsReceiveModalVisible] = useState<boolean>(false)
    const [headerTitle, setHeaderTitle] = useState<string>('')
    const [headerStyle, setHeaderStyle] = useState<'success' | 'warning' | 'error'>('success')
    const [updateDescription, setUpdateDescription] = useState<string>('')
    const [updateSize, setUpdateSize] = useState<string>('')
    const [isNativeUpdateAvailable, setIsNativeUpdateAvailable] = useState<boolean>(false)
    const [isOnline, setIsOnline] = useState(false)
    
    useEffect(() => {
      if (isInternetReachable !== null) {
        // Update ref immediately (for use in handlers/async)
        isOnlineRef.current = isInternetReachable
    
        // Only update state if it's a real change → triggers re-render
        if (isInternetReachable !== isOnline) {
          log.trace('[Online] status change', {isInternetReachable})
          setIsOnline(isInternetReachable)
        }
      }
    }, [isInternetReachable])

    // On app start
    useEffect(() => {
        const checkForUpdate = async () => {
            try {
                const updateInfo = await HotUpdater.checkForUpdate({
                    source: getUpdateSource(HOT_UPDATER_URL, {
                        updateStrategy: "appVersion",
                    }),
                    requestHeaders: {
                        Authorization: `Bearer ${HOT_UPDATER_API_KEY}`,
                    },
                })

                log.trace('[checkForUpdate]', {updateInfo})

                if (!updateInfo) {
                    return
                }

                if(!__DEV__) {
                    setIsUpdateAvailable(true)
                    setUpdateDescription(updateInfo.message || '')
                    toggleUpdateModal()

                    if (updateInfo.shouldForceUpdate) {
                        // apply emergency update immediately
                        const isDownloaded = await updateInfo.updateBundle()
                        if(isDownloaded) {
                            await HotUpdater.reload()
                        }
                    }
                }
                
            } catch (e: any) {
                log.error(e)
                return false
            }
        } 
        
        setTimeout(() => {
            if(!isOnlineRef.current) {
                return
            }
            checkForUpdate()
        }, 500)
        
    }, []) 

    // On app start
    useEffect(() => {        
        const getInitialData  = async () => {
            // get deeplink data if any
            const url = await Linking.getInitialURL()
                                             
            if (url) {                            
                handleDeeplink({url})                
                return // skip further processing so that it does not slow down or clash deep link
            }

            if (nwcStore.all.length > 0) {
                nwcStore.resetDailyLimits()
            }
            
            if(!isOnlineRef.current) { 
                log.trace('[isOnline] Offline → skipping getInitialData')
                return 
            }
            
            if(groupedMints.length === 0) {
                await addMint()
            }

            // Only once on startup - Create websocket subscriptions to receive tokens or payment requests by NOSTR DMs                    
            WalletTask.receiveEventsFromRelaysQueue()           

            // Set wallet tab to preferred unit
            const preferredUnit: MintUnit = userSettingsStore.preferredUnit
            const preferredTabIndex = routes.findIndex(route => route.key === preferredUnit)    
            if(tabIndex !== preferredTabIndex) {
                onTabChange(preferredTabIndex)
            }

            // Create websocket subscriptions to receive NWC requests from remote wallets (if any)
            // go through websockets only if remote notifications not working as push data messages are
            // delivered even if notifications are disabled on device                        
            if(!walletProfileStore.device) {nwcStore.listenForNwcEvents()}
            // if(__DEV__) NotificationService.createNwcListenerNotification()
        }

        const handleReceivedEventTaskResult  = async (result: WalletTaskResult) => {
            log.trace('[handleReceivedEventTaskResult]')
            if(result.error && isOnlineRef.current) {
                handleError(result.error)
            }        
        }

        const handleClaimTaskResult  = async (result: WalletTaskResult) => {
            log.trace('[handleClaimTaskResult]')
            //isPerfromCheckRunningRef.current = false // allow performChecks to run again
            if(result.error && isOnlineRef.current) {
                handleError(result.error)
            }
        }
        
        Linking.addEventListener('url', handleDeeplink)
        EventEmitter.on(`ev_${HANDLE_RECEIVED_EVENT_TASK}_result`, handleReceivedEventTaskResult)
        EventEmitter.on(`ev_${HANDLE_CLAIM_TASK}_result`, handleClaimTaskResult)
        

        getInitialData()

        // Unsubscribe from the task result event on component unmount
        return () => {
            EventEmitter.off(`ev_${HANDLE_RECEIVED_EVENT_TASK}_result`, handleReceivedEventTaskResult)
            EventEmitter.off(`ev_${HANDLE_CLAIM_TASK}_result`, handleClaimTaskResult)        
        }
        
    }, [])


    const onTabChange = (tabIndex: number) => {
        if(groupedMints.length === 0) {
            return
        }

        const currentUnit = routes[tabIndex].key 
        log.trace('[onTabChange] currentUnit', currentUnit)

        setCurrentUnit(currentUnit)
        setTabIndex(tabIndex)

        const preferredUnit = userSettingsStore.preferredUnit
        if(currentUnit !== preferredUnit) { // prevents db write on first load
            userSettingsStore.setPreferredUnit(currentUnit)
        }        
    }


    const handleDeeplink = async function ({url}: {url: string}) {
        try {

            const incomingData = IncomingParser.findAndExtract(url)
            await IncomingParser.navigateWithIncomingData(
                incomingData, 
                navigation,                 
                currentUnit
            )

        } catch (e: any) {
            handleError(e)
        }
    }


    /* const handleClipboard = function (clipboard: string) {
        log.trace('clipboard', clipboard, 'handleClipboard')
    }*/
    

    const gotoUpdate = function() {
        setIsUpdateModalVisible(false)
        //@ts-ignore
        navigation.navigate('SettingsNavigator', {
            screen: 'Update',
            params: {
                isNativeUpdateAvailable, 
                isUpdateAvailable, 
                updateDescription,
                updateSize,
                prevScreen: 'Wallet'
            }            
        })
    }
    
    //const isPerfromCheckRunningRef = useRef(false)

    
    const performChecks = useCallback(async () => {
        // Prevent overlapping runs when onFocus and AppState change happen together
        //if (isPerfromCheckRunningRef.current) return
        //isPerfromCheckRunningRef.current = true

        if(!isOnlineRef.current) { 
            log.trace('[isOnline] Offline → skipping performChecks')
            return 
        }

        const nowInSec = getUnixTime(new Date());
        log.trace('[performChecks] Start', { secsFromLastMintCheck: nowInSec - lastMintCheckRef.current})

        if (nowInSec - lastMintCheckRef.current > MINT_CHECK_INTERVAL) {
            lastMintCheckRef.current = nowInSec

            WalletTask.handleInFlightQueue()
            WalletTask.handlePendingQueue()
            await WalletTask.syncStateWithAllMintsQueueAwaitable({isPending: true})
            
            // Avoid rate and claim calls to race refreshing tokens
            WalletTask.handleClaimQueue().then(() => {
                if(userSettingsStore.exchangeCurrency) {
                    walletStore.refreshExchangeRate(userSettingsStore.exchangeCurrency!) 
                }
            }).catch(e => {
                if(isOnlineRef.current) handleError(e)
            })
            
            // TODO rethink
            const countByStatus = Database.getTransactionsCount()
            if(countByStatus[TransactionStatus.PENDING] && countByStatus[TransactionStatus.PENDING] > 0) {
                setPendingCount(countByStatus[TransactionStatus.PENDING] || 0)
            }
        } else {
            log.trace('[performChecks] Skipping mint server checks...')
        }
     

    }, [isOnlineRef.current, userSettingsStore.exchangeCurrency])
    
    
    useFocusEffect(() => {
        log.trace('[useFocusEffect] WalletScreen')
        performChecks()
    })

    

    useEffect(() => {

        const subscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'background') {
                lastBackgroundTimestampRef.current = Date.now()
                return
            }

            if (nextState === 'active') {
                const timeInBackground = Date.now() - lastBackgroundTimestampRef.current
                if (timeInBackground < 1000) {  // (usually <1s for NFC)
                    log.trace('[handleAppStateChange] Ignored too short background event (could be NFC tap)', { timeInBackground })
                    return  // Ignore – this was an NFC flicker
                }

                // Real foreground – run your normal logic (e.g., unlock check, etc.)
                log.trace('[handleAppStateChange] WalletScreen active again')
                performChecks()
                NostrClient.reconnectToRelays().catch(e => false)
            }
        })
    
        return () => subscription.remove()

    }, [performChecks])

  
    useFocusEffect(
        useCallback(() => {
            if (!route.params?.scannedMintUrl) {                
                return
            }

            const scannedMintUrl = route.params?.scannedMintUrl         
            addMint({scannedMintUrl})

        }, [route.params?.scannedMintUrl])
    )

    const toggleMintsModal = () => {
        setIsMintsModalVisible(previousState => !previousState)
    }


    const toggleUpdateModal = () => {
        setIsUpdateModalVisible(previousState => !previousState)
    }


    const toggleSendModal = () => {
        log.trace('toggleSendModal')
        setIsSendModalVisible(previousState => !previousState)
    }


    const toggleReceiveModal = () => {
        setIsReceiveModalVisible(previousState => !previousState)
    }

    const addMint = async function ({scannedMintUrl = ''} = {}) {
        // necessary
        // @ts-ignore
        navigation.setParams({scannedMintUrl: undefined})       

        const newMintUrl = scannedMintUrl || defaultMintUrl
        
        log.trace('newMintUrl', newMintUrl)
        
        if (mintsStore.alreadyExists(newMintUrl)) {
            const msg = translate('walletScreen_mintExists')
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

    const gotoScan = function () {
        // @ts-ignore
        navigation.navigate('Scan', {unit: currentUnit})
    }

    const gotoTokenReceive = async function () {
        toggleReceiveModal()
        // @ts-ignore
        navigation.navigate('TokenReceive', {unit: currentUnit})
    }

    const gotoPendingTransactions = function () {
        // @ts-ignore
        navigation.navigate('TransactionsNavigator', {
            screen: 'TranHistory',
            params: {
                showPending: true
            }
        }) 
    }

    const gotoProfile = function () {
        // @ts-ignore
        navigation.navigate('ContactsNavigator', {
            screen: 'Profile',
            params: {
                prevScreen: 'Wallet'
            }
        })        
    }

    const gotoMintInfo = function (mintUrl: string) {
        setIsMintsModalVisible(false)
        //@ts-ignore       
        navigation.navigate('SettingsNavigator', {
            screen: 'MintInfo',
            params: {mintUrl}            
        })
    }

    const gotoTopup = function (mintUrl?: string) {
        if(mintUrl) {
            setIsMintsModalVisible(false)
            // @ts-ignore
            navigation.navigate('Topup', {                        
                mintUrl,
                unit: currentUnit
            })
        } else {
            setIsReceiveModalVisible(false)
            // @ts-ignore
            navigation.navigate('Topup', {                                        
                unit: currentUnit
            })
        }
    }


    const gotoNfcPay = function () {
        setIsSendModalVisible(false)
        // @ts-ignore
        navigation.navigate('NfcPay', {                                        
            unit: currentUnit
        })       
    }


    const gotoLightningPay = function (mintUrl?: string) {
        log.trace({mintUrl})
        if(mintUrl) {
            setIsMintsModalVisible(false)
            // @ts-ignore
            navigation.navigate('LightningPay', {
                mintUrl,
                unit: currentUnit
            })
        } else {
            setIsSendModalVisible(false)
            // @ts-ignore
            navigation.navigate('LightningPay', {                                        
                unit: currentUnit
            })
        }        
    }


    const gotoSend = function () {
        // log.trace('[gotoSend]', {currentUnit})
        setIsSendModalVisible(false)
        // @ts-ignore
        navigation.navigate('Send', {                                        
            unit: currentUnit
        })
    }

    const handleError = function (e: AppError) {
      setIsLoading(false)
      setError(e)
    }


    const renderUnitTabs = function ({ route }: { route: { key: string } }) {
        const unitMints = groupedMints.find((mintUnit) => mintUnit.unit === route.key)
                
        // log.trace('[renderUnitTabs]', {unitMints, balance: balances.unitBalances.find((balance) => balance.unit === unitMints?.unit)})
        // log.warn({balances})
        
        if (unitMints?.mints && unitMints?.mints.length > 0) {
            
            const unitBalance = balances.unitBalances.find((balance) => balance.unit === unitMints.unit)
            log.trace('[renderUnitTabs]', {unitBalance})

            if(unitBalance) {
                return (
                    <>
                        <View style={[
                            $headerContainer, {
                                backgroundColor: headerBg, 
                                //paddingTop: spacing.tiny,
                                //borderWidth: 1
                            }
                        ]}>
                            <UnitBalanceBlock                            
                                unitBalance={unitBalance}
                            />
                            <Pressable                         
                                onPress={toggleMintsModal}
                            >                        
                                <MintsByUnitSummary 
                                    mintsByUnit={unitMints}
                                    navigation={navigation}
                                />
                            </Pressable>
                        </View>
                        <View style={$tabContainer}>                           
                            {transactionsStore.getRecentByUnit(unitMints.unit).length > 0 ? (
                                <Card                                    
                                    ContentComponent={                                            
                                        <FlatList
                                            data={transactionsStore.getRecentByUnit(unitMints.unit) as Transaction[]}
                                            renderItem={({item, index}) => {
                                                return (
                                                    <TransactionListItem
                                                        key={item.id}
                                                        transaction={item}
                                                        isFirst={index === 0}
                                                        isTimeAgoVisible={true}                                                
                                                    />
                                                )}
                                            }                                        
                                        />                                            
                                    }
                                    style={[$card, {paddingVertical: spacing.extraSmall}]}
                                />
                            ) : (
                                <Card                                
                                    ContentComponent={
                                        <ListItem 
                                            leftIcon='faArrowTurnDown'
                                            leftIconColor={colors.palette.green400}
                                            tx='walletScreen_startByFunding'
                                            textStyle={{fontSize: moderateScale(14)}}
                                            RightComponent={
                                                <View style={$rightContainer}>
                                                    <Button 
                                                        preset='secondary'
                                                        text={`Topup`}
                                                        onPress={() => gotoTopup()}
                                                    />
                                                </View>
                                            }
                                        />
                                    }                                
                                    style={[$card, {paddingTop: spacing.extraSmall, minHeight: 80}]}
                                />
                            )}
                        </View>                
                    </>            
                )
            }
        }
        return null
    }

    const tabWidth = moderateScale(75)
    
    const getActiveTabColor = (state: NavigationState<Route>) => {
        return useThemeColor('headerTitle')
    }

    const renderTabBar = (props: any) => {
        return(
            <View style={{
                backgroundColor: headerBg, 
                marginTop: -spacing.small, 
                //borderWidth: 1,
            }}>
                <View style={{width: routes.length * tabWidth, alignSelf: 'center', backgroundColor: headerBg}}>
                    <TabBar                        
                        {...props}                 
                        tabStyle={{width: tabWidth}}
                        renderTabBarItem={({ route }) => (
                            <CurrencySign
                                mintUnit={route.key as MintUnit}
                                textStyle={{color: 'white'}}
                                containerStyle={{padding: spacing.small, width: tabWidth}}
                            />
                        )}                       
                        indicatorStyle={{backgroundColor: getActiveTabColor(props.navigationState)}}                    
                        style={{backgroundColor: headerBg, shadowColor: 'transparent'}}
                    />
                </View>
            </View>
        )
    }


    const HeaderTitle = function (props: any) {
        if (!isOnline) {
            return (
                <Text
                    tx="commonOffline"
                    style={$warning}
                    size="xxs"
                />
            )
        }
    
        if (headerTitle.length > 0) {
            const styleMap: Record<string, any> = {
                error: $error,
                success: $success,
                warning: $warning,
            }
    
            const style = styleMap[headerStyle] || undefined
    
            return (
                <Text
                    text={headerTitle}
                    style={[style, $headerTitle]}
                    size="xxs"
                />
            )
        }
    
        return undefined
    }
    
    const headerBg = useThemeColor('header')    
    const balances = proofsStore.balances
    const screenBg = useThemeColor('background')
    const mainButtonIcon = useThemeColor('mainButtonIcon')
    const mainButtonColor = useThemeColor('card')
    const label = useThemeColor('textDim')
    const headerTitleColor = useThemeColor('headerTitle')

    const isNwcVisible = nwcStore.all.some(c => c.remainingDailyLimit !== c.dailyLimit)
    const nwcCardsData = nwcStore.all.filter(c => c.remainingDailyLimit !== c.dailyLimit)

    return (        
      <Screen contentContainerStyle={$screen} preset='fixed'>
            <Header 
                LeftActionComponent={<LeftProfileHeader 
                    gotoProfile={gotoProfile}
                    isAvatarVisible={false}
                />}                
                TitleActionComponent={<HeaderTitle />}               
                RightActionComponent={
                <View style={{justifyContent: 'flex-end', flexDirection: 'row'}}>
                    {pendingCount > 0 && (
                        <Pressable 
                            style={{flexDirection: 'row', alignItems:'center', marginRight: spacing.small}}
                            onPress={gotoPendingTransactions}
                        >
                            <Icon icon='faClock' color={headerTitleColor}/>
                            <Text text={`${pendingCount}`} style={{color: headerTitleColor}} />
                        </Pressable>
                    )}
                    <Pressable 
                            style={{marginRight: spacing.medium}}
                            onPress={gotoNfcPay}
                    >
                        <Icon icon='faNfcSymbol' color={headerTitleColor}/>
                    </Pressable>
                </View>
                }                
            />
            {groupedMints.length > 0 && (                              
                <TabView
                    renderTabBar={renderTabBar}
                    navigationState={{ index: tabIndex, routes }}
                    renderScene={renderUnitTabs}
                    onIndexChange={onTabChange}
                    initialLayout={{ width: spacing.screenWidth }}
                    // style={{borderWidth: 1, borderColor: 'red'}}                                       
                />
            )}
            {isNwcVisible && (
                <View style={$nwcContainer}>
                    <FlatList
                        data={nwcCardsData}
                        horizontal={true}
                        renderItem={({item, index}) => {
                            return (
                                <Card
                                    HeadingComponent={<Text text={item.name} size='xs'/>}                                        
                                    ContentComponent={
                                        <>
                                        <Text tx='walletScreen_spentToday' size='xxs' preset='formHelper' style={{color: label, overflow: 'hidden'}}/>
                                        <CurrencyAmount 
                                            amount={item.dailyLimit - item.remainingDailyLimit}
                                            currencyCode={CurrencyCode.SAT}
                                            containerStyle={{marginLeft: -spacing.tiny, marginTop: spacing.small}}
                                            size='medium'
                                        />
                                        </>
                                    }
                                    style={{
                                        width: spacing.screenWidth * 0.28,
                                        marginRight: spacing.small,
                                        marginBottom: spacing.extraSmall                                                                                                                                 
                                    }}                                        
                                />
                            )}
                        }
                        style={{
                            

                        }}                                        
                    />
                </View>
            )} 
            <View style={[$bottomContainer]}>                               
                <View style={$buttonContainer}>
                    <Button
                        LeftAccessory={() => (
                            <Icon
                                icon='faArrowUp'
                                size={spacing.medium}
                                color={mainButtonIcon}                                
                            />
                        )}
                        onPress={toggleSendModal}                        
                        style={[{backgroundColor: mainButtonColor, borderWidth: 1, borderColor: screenBg}, $buttonSend]}
                        textStyle={{marginRight: spacing.tiny}}
                        preset='secondary'
                        tx='payCommon_send'
                    />             
                    <Button
                        RightAccessory={() => (
                            <SvgXml 
                                width={spacing.large} 
                                height={spacing.large} 
                                xml={ScanIcon}
                                fill={mainButtonIcon}
                                //style={{marginLeft: -spacing.tiny}}
                            />
                        )}
                        onPress={gotoScan}
                        style={[{backgroundColor: mainButtonColor, borderWidth: 1, borderColor: screenBg}, $buttonScan]}
                        preset='secondary'
                    />
                    <Button
                        RightAccessory={() => (
                            <Icon
                                icon='faArrowDown'
                                size={spacing.medium}
                                color={mainButtonIcon}
                                containerStyle={{paddingLeft: spacing.tiny}}                               
                            />
                        )}
                        onPress={toggleReceiveModal}
                        tx='payCommon_receive'
                        style={[{backgroundColor: mainButtonColor, borderWidth: 1, borderColor: screenBg}, $buttonReceive]}
                        textStyle={{marginLeft: spacing.tiny}}
                        preset='secondary'
                    /> 
                </View>
            </View>
            {info && <InfoModal message={info} />}
            {error && <ErrorModal error={error} />}
            {isLoading && <Loading />}

        <BottomModal
            isVisible={isUpdateModalVisible ? true : false}
            // style={{alignItems: 'stretch'}}
            ContentComponent={        
            <ListItem
                LeftComponent={
                    <View style={{marginRight: spacing.medium}}>                        
                        <FastImage 
                            source={{uri: 'https://www.minibits.cash/img/minibits_icon-192.png'}}
                            style={{width: 40, height: 40}}
                        />
                    </View>
                }
                tx="updateModal_title"
                subTx="updateModal_desc"
                onPress={gotoUpdate}
            />
            }
            onBackButtonPress={toggleUpdateModal}
            onBackdropPress={toggleUpdateModal}
        />
        <BottomModal
            isVisible={isMintsModalVisible ? true : false}
            // style={{alignItems: 'stretch'}}
            ContentComponent={        
                <MintsByUnitList                                    
                    mintsByUnit={groupedMints}
                    currentUnit={currentUnit}
                    onTopup={gotoTopup}
                    onLightningPay={gotoLightningPay}                    
                    onMintInfo={gotoMintInfo}
                />
            }
            onBackButtonPress={toggleMintsModal}
            onBackdropPress={toggleMintsModal}
        />
        <BottomModal
          isVisible={isSendModalVisible ? true : false}
          //style={{alignItems: 'stretch'}}
          ContentComponent={  
            <>
            <ListItem   
                leftIcon='faMoneyBill1'                          
                tx="walletScreen_sendEcash"
                subTx="walletScreen_sendEcashDesc"
                onPress={gotoSend}
                bottomSeparator={true}
            />
            <ListItem   
                leftIcon='faBolt'             
                tx="walletScreen_payWithLightning"
                subTx="walletScreen_payWithLightningDesc"
                onPress={() => gotoLightningPay()}
                //bottomSeparator={true}
            />
            {/*<ListItem   
                leftIcon='faNfcSymbol'             
                text="Pay with NFC"
                subText="Tap NFC-enabled wallet or POS to pay"
                onPress={() => gotoNfcPay()}
            />*/}
            </>      
          }
          onBackButtonPress={toggleSendModal}
          onBackdropPress={toggleSendModal}
        /> 
        <BottomModal
          isVisible={isReceiveModalVisible ? true : false}
          // style={{alignItems: 'stretch'}}
          ContentComponent={  
            <>
            <ListItem   
                leftIcon='faMoneyBill1'             
                tx="walletScreen_receiveEcash"
                subTx="walletScreen_receiveEcashDesc"
                onPress={gotoTokenReceive}
                bottomSeparator={true}
            />
            <ListItem      
                leftIcon='faBolt'          
                tx='walletScreen_topupWithLightning'
                subTx="walletScreen_topupWithLightningDesc"
                onPress={() => gotoTopup()}
            />
            </>      
          }
          onBackButtonPress={toggleReceiveModal}
          onBackdropPress={toggleReceiveModal}
        />       

      </Screen>
    )
  },
)


const UnitBalanceBlock = observer(function (props: {
    unitBalance: UnitBalance
}) {    
    const {walletStore, userSettingsStore} = useStores()    
    const convertedBalanceColor = useThemeColor('headerSubTitle')    
    const {unitBalance} = props
    const headerTitle = useThemeColor('headerTitle')
    const balanceColor = headerTitle
    
    const getConvertedBalance = function () {
        return convertToFromSats(
            unitBalance.unitBalance, 
            MintUnitCurrencyPairs[unitBalance.unit], 
            walletStore.exchangeRate!
        )
    }

    return (
        <>
            <CurrencyAmount
                amount={unitBalance.unitBalance || 0}                
                mintUnit={unitBalance.unit}
                symbolStyle={{display: 'none'}}
                amountStyle={[$unitBalance, {color: balanceColor}]}
                containerStyle={{marginTop: spacing.small}}
            />
            <View style={{height: verticalScale(40)}}>            
            {walletStore.exchangeRate 
            && (userSettingsStore.exchangeCurrency === getCurrency(unitBalance.unit).code || unitBalance.unit === 'sat')            
            && ( 
                <CurrencyAmount
                    amount={getConvertedBalance() ?? 0}
                    currencyCode={unitBalance.unit === 'sat' ? userSettingsStore.exchangeCurrency : CurrencyCode.SAT}
                    symbolStyle={{color: convertedBalanceColor, marginTop: spacing.tiny, fontSize: verticalScale(10)}}
                    amountStyle={{color: convertedBalanceColor}}                        
                    size='small'             
                />
            )}
            </View>
        </>
    )
})


const MintsByUnitSummary = observer(function (props: {
    mintsByUnit: MintsByUnit    
    navigation: any
}) {
    const {
        mintsStore, 
        proofsStore, 
    } = useStores()    
      
    const [selectedMint, setSelectedMint] = useState<Mint | undefined>(undefined)

    useEffect(() => {        
        const setSelected  = async () => {            
            const balance = proofsStore.getMintBalanceWithMaxBalance(props.mintsByUnit.unit)
            if(!balance) return

            const mint = mintsStore.findByUrl(balance?.mintUrl)            
            setSelectedMint(mint)
        }       
        
        setSelected()
        return () => {}
    }, [])
    
    const {mintsByUnit} = props
    const mintsCountText = translate('walletScreen_andOtherMints', {count: mintsByUnit.mints.length - 1})

    return (
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <View
                style={{
                    marginEnd: spacing.small,                    
                    flex: 0,
                    borderRadius: spacing.small,
                    padding: spacing.extraSmall,
                    backgroundColor: getMintColor(mintsByUnit.unit)
                }}
            >
                <SvgXml 
                    width={spacing.medium} 
                    height={spacing.medium} 
                    xml={MintIcon}
                    fill='white'
                />
            </View>
            <Text size='xs' style={{color: 'white'}} text={`${selectedMint?.shortname} ${mintsByUnit.mints.length > 1 ? mintsCountText : ''}`}/>
        </View>
    )
})


const MintsByUnitList = observer(function (props: {
    mintsByUnit: MintsByUnit[]
    currentUnit: MintUnit    
    onTopup: Function
    onLightningPay: Function    
    onMintInfo: Function    
}) {
    
    const [selectedMintUrl, setSelectedMintUrl] = useState<string | undefined>(undefined)

    const onSelectedMint = function (mintUrl: string) {
        if (selectedMintUrl && selectedMintUrl === mintUrl) {            
            if(Platform.OS === 'android') {
                LayoutAnimation.easeInEaseOut()
            }
            setSelectedMintUrl(undefined)
            return
        }

        if(Platform.OS === 'android') {
            LayoutAnimation.easeInEaseOut()
        }
        setSelectedMintUrl(mintUrl)        
    }
        
    const color = useThemeColor('textDim')
    const balanceColor = useThemeColor('amount')
    const {mintsByUnit} = props
    const mintsByUnitCurrent = mintsByUnit.find((mintUnit) => mintUnit.unit === props.currentUnit)

    return (
        <>
            {mintsByUnitCurrent!.mints.map((mint: Mint, index: number) => (
                <View key={mint.mintUrl}>
                <ListItem                        
                    text={mint.shortname}
                    subText={mint.hostname}                    
                    LeftComponent={
                        <View
                            style={{
                                marginEnd: spacing.small,
                                flex: 0,
                                borderRadius: spacing.small,
                                padding: spacing.extraSmall,
                                backgroundColor: getMintColor(mintsByUnitCurrent!.unit)
                            }}
                        >
                            <SvgXml 
                                width={spacing.medium} 
                                height={spacing.medium} 
                                xml={MintIcon}
                                fill='white'
                            />
                        </View>
                    }
                    RightComponent={
                        <CurrencyAmount 
                            amount={mint.balances?.balances[mintsByUnitCurrent!.unit] || 0}
                            mintUnit={mintsByUnitCurrent!.unit}
                            size='medium'
                        />                    
                    }
                    //topSeparator={true}
                    style={$item}
                    onPress={() => onSelectedMint(mint.mintUrl)}
                    topSeparator={index > 0 ? true : false}
                />
                {selectedMintUrl === mint.mintUrl &&  (
                    <View style={{flexDirection: 'row', marginBottom: spacing.small, justifyContent: 'flex-start'}}>
                        <Button
                            tx="walletScreen_topup"
                            LeftAccessory={() => (
                                <Icon
                                icon='faPlus'
                                color={color}
                                size={spacing.small}                  
                                />
                            )}
                            preset='secondary'
                            textStyle={{fontSize: 14, color}}
                            onPress={() => props.onTopup(mint.mintUrl)}
                            style={{
                                minHeight: verticalScale(40), 
                                paddingVertical: verticalScale(spacing.tiny),
                                marginRight: spacing.small
                            }}                    
                        />
                        <Button
                            tx="walletScreen_pay"
                            LeftAccessory={() => (
                                <Icon
                                icon='faBolt'
                                color={color}
                                size={spacing.small}                  
                                />
                            )}
                            textStyle={{fontSize: 14, color}}
                            preset='secondary'
                            onPress={() => props.onLightningPay(mint.mintUrl)}
                            style={{
                                minHeight: verticalScale(40), 
                                paddingVertical: verticalScale(spacing.tiny),
                                marginRight: spacing.small
                            }}                    
                        />
                        <Button
                            tx="wallerScreen_mintButton"
                            LeftAccessory={() => (
                                <View style={{marginHorizontal: spacing.extraSmall}}>
                                    <SvgXml 
                                        width={spacing.small} 
                                        height={spacing.small} 
                                        xml={MintIcon}
                                        fill={color}
                                    />
                                </View>
                            )}
                            textStyle={{fontSize: 14, color}}
                            preset='secondary'
                            onPress={() => props.onMintInfo(mint.mintUrl)}
                            style={{
                                minHeight: verticalScale(40), 
                                paddingVertical: verticalScale(spacing.tiny),
                                marginRight: spacing.small
                            }}                    
                        />
                    </View>
                )}
                </View>
            ))}
        </>
    )
})


export const getMintColor = function (unit: MintUnit) {
    if (unit === 'sat' || unit === 'msat' || unit === 'btc') {
        return colors.palette.orange600
    }

    if (unit === 'eur') {
        return colors.palette.blue600
    }

    if (unit === 'usd') {
        return colors.palette.green400
    }
}


const $screen: ViewStyle = {
   
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    // padding: spacing.tiny,  
    height: spacing.screenHeight * 0.25,
}

const $tabContainer: TextStyle = {
    marginTop: -spacing.extraLarge * 1.5,
    // alignSelf: 'stretch',
    // padding: spacing.extraSmall,    
    // flex: 1,
    // paddingTop: spacing.extraSmall - 3,
    // borderWidth: 1,
    // borderColor: 'green',
}


const $rightContainer: ViewStyle = {
    padding: spacing.extraSmall,
    alignSelf: 'center',
    marginLeft: spacing.small,
}

const $card: ViewStyle = {    
    marginBottom: spacing.small,
    marginHorizontal: spacing.extraSmall,    
}


const $unitBalance: TextStyle = {
    fontSize: verticalScale(48),
    lineHeight: verticalScale(48)
}


const $item: ViewStyle = {
  marginHorizontal: spacing.micro,
}


const $nwcContainer: ViewStyle = {
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.extraSmall,
}

const $bottomContainer: ViewStyle = {
  justifyContent: 'flex-end',
  paddingHorizontal: spacing.extraSmall,
  // marginTop: spacing.small,
  marginBottom: 0
}

const $buttonContainer: ViewStyle = {    
    flexDirection: 'row',    
    justifyContent: 'center',
    alignItems: 'center',    
}

const $buttonSend: ViewStyle = {
  borderTopLeftRadius: verticalScale(60 / 2),
  borderBottomLeftRadius: verticalScale(60 / 2),
  borderTopRightRadius: 0,
  borderBottomRightRadius: 0,  
  width: verticalScale(130),
  height: verticalScale(55),
  marginRight: verticalScale(-25),  
}

const $buttonScan: ViewStyle = {
  borderRadius: verticalScale(70 / 2),
  width: verticalScale(70),
  height: verticalScale(70),
  zIndex: 99,  
}

const $buttonReceive: ViewStyle = {
  borderTopLeftRadius: 0,
  borderBottomLeftRadius: 0,
  borderTopRightRadius: verticalScale(30),
  borderBottomRightRadius: verticalScale(30),
  width: verticalScale(130),
  height: verticalScale(55),
  marginLeft: verticalScale(-15), 
}

const $bottomModal: ViewStyle = {    
    alignItems: 'center',  
    paddingVertical: spacing.large,
    paddingHorizontal: spacing.small,  
}


const $headerTitle: TextStyle = {
    paddingHorizontal: spacing.small,
    borderRadius: spacing.tiny,
    alignSelf: 'center',
    marginVertical: spacing.small,
    lineHeight: spacing.medium,
    color: 'white'
}

const $warning: TextStyle = {
    backgroundColor: colors.palette.orange400,
    borderRadius: spacing.extraSmall,
    paddingHorizontal: spacing.tiny,
}

const $error: TextStyle = {
    backgroundColor: colors.palette.angry300,
}

const $success: TextStyle = {
    backgroundColor: colors.palette.success200,
}
