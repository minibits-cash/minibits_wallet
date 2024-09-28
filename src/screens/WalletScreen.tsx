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
  Animated,
  FlatList,
  Pressable,
  Linking,
  LayoutAnimation,  
} from 'react-native'
import codePush, { RemotePackage } from 'react-native-code-push'
import {moderateScale, verticalScale} from '@gocodingnow/rn-size-matters'
import { SvgXml } from 'react-native-svg'
import { debounce } from "lodash"
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
  ScanIcon,
  MintIcon
} from '../components'
import {useStores} from '../models'
import {WalletStackScreenProps} from '../navigation'
import {Mint, UnitBalance} from '../models/Mint'
import {MintsByUnit} from '../models/MintsStore'
import {log, NostrClient} from '../services'
import {Env} from '../utils/envtypes'
import {Transaction} from '../models/Transaction'
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
import { IncomingParser } from '../services/incomingParser'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { CurrencySign } from './Wallet/CurrencySign'
import { CurrencyCode, MintUnit, MintUnitCurrencyPairs, convertToFromSats, getCurrency } from "../services/wallet/currency"
import { CurrencyAmount } from './Wallet/CurrencyAmount'
import { LeftProfileHeader } from './ContactsScreen'
import { NavigationState, Route, TabBar, TabView } from 'react-native-tab-view'

const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY

interface WalletScreenProps extends WalletStackScreenProps<'Wallet'> {}

export const WalletScreen: FC<WalletScreenProps> = observer(
  function WalletScreen({route, navigation}) {    
    const {
        mintsStore, 
        proofsStore, 
        transactionsStore, 
        paymentRequestsStore, 
        userSettingsStore, 
        nwcStore,
        walletProfileStore,
        walletStore
    } = useStores()        
    
    const appState = useRef(AppState.currentState)
    const isInternetReachable = useIsInternetReachable()
    const groupedMints: MintsByUnit[] = mintsStore.groupedByUnit

    // Tab view by unit
    const [routes] = useState(
        groupedMints.map((mintUnit) => ({
            key: mintUnit.unit,
            title: getCurrency(mintUnit.unit).code,
        }))
    )
    const [tabIndex, setTabIndex] = useState(0)
    const [currentUnit, setCurrentUnit] = useState<MintUnit>(groupedMints.length > 0 ? groupedMints[0].unit : 'sat')

    const [info, setInfo] = useState<string>('')
    const [defaultMintUrl, setDefaultMintUrl] = useState<string>(MINIBITS_MINT_URL)
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState<boolean>(false)
    
    const [isMintsModalVisible, setIsMintsModalVisible] = useState<boolean>(false)
    const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false)
    const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false)
    const [isSendModalVisible, setIsSendModalVisible] = useState<boolean>(false)
    const [isReceiveModalVisible, setIsReceiveModalVisible] = useState<boolean>(false)
    const [updateDescription, setUpdateDescription] = useState<string>('')
    const [updateSize, setUpdateSize] = useState<string>('')
    const [isNativeUpdateAvailable, setIsNativeUpdateAvailable] = useState<boolean>(false)

    // On app start
    useEffect(() => {
        const checkForUpdate = async () => {            
            try {
                const update = await codePush.checkForUpdate(deploymentKey, handleBinaryVersionMismatchCallback)                
                
                if (update && update.failedInstall !== true) {  // do not announce update that failed to install before
                    setUpdateDescription(update.description)
                    setUpdateSize(`${round(update.packageSize *  0.000001, 2)}MB`)
                    setIsUpdateAvailable(true)
                    toggleUpdateModal()
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

    // On app start
    useEffect(() => {
        // get deeplink if any
        const getInitialData  = async () => {
            // get deeplink data if any
            const url = await Linking.getInitialURL()
                                             
            if (url) {                            
                handleDeeplink({url})                
                return // skip further processing so that it does not slow down or clash deep link
            }
            
            if(!isInternetReachable) { return }
            
            if(groupedMints.length === 0) {
                await addMint()
            }

            // check lnaddress claims on app start and set timestamp to trigger focus updates
            WalletTask.handleClaim().catch(e => setInfo(e.message))
            // Auto-recover inflight proofs - do only on startup and before checkPendingReceived to prevent conflicts            
            WalletTask.handleInFlight().catch(e => false)
            // Create websocket subscriptions to receive tokens or payment requests by NOSTR DMs                    
            WalletTask.receiveEventsFromRelays().catch(e => false)
            // Get exchange rate
            if(userSettingsStore.exchangeCurrency) {
                walletStore.refreshExchangeRate(userSettingsStore.exchangeCurrency!)
            }
            // Set wallet tab to preferred unit
            const preferredUnit: MintUnit = userSettingsStore.preferredUnit
            const preferredTabIndex = routes.findIndex(route => route.key === preferredUnit)    
            if(tabIndex !== preferredTabIndex) {
                onTabChange(preferredTabIndex)
            }

            // Create websocket subscriptions to receive NWC requests from remote wallets (if any)
            // go through websockets only if remote notifications not working as push data messages are
            // delivered even if notifications are disabled on device            
            const isRemoteDataPushEnabled = walletProfileStore.device ? true : false
            if(!isRemoteDataPushEnabled) {nwcStore.receiveNwcEvents()} 
        }
        
        Linking.addEventListener('url', handleDeeplink)
        getInitialData()

        return () => {}
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
        navigation.navigate('SettingsNavigator', {screen: 'Update', params: {
            isNativeUpdateAvailable, 
            isUpdateAvailable, 
            updateDescription,
            updateSize
        }, initial: false})
    }   
    
    
    useFocusEffect(        
        useCallback(() => {
            if(!isInternetReachable) {
                return
            }

            WalletTask.syncPendingStateWithMints().catch(e => false)               
            WalletTask.handlePendingTopups().catch(e => false)
            
            debounce(() => WalletTask.handleClaim(), 60000) 

            if(userSettingsStore.exchangeCurrency) {                
                debounce(() => walletStore.refreshExchangeRate(
                    userSettingsStore.exchangeCurrency!
                ), 60000)
            }  
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

                    WalletTask.syncPendingStateWithMints().catch(e => false) 
                    WalletTask.handlePendingTopups().catch(e => false)

                    debounce(() => WalletTask.handleClaim(), 60000) 

                    if(userSettingsStore.exchangeCurrency) {                
                        debounce(() => walletStore.refreshExchangeRate(
                            userSettingsStore.exchangeCurrency!
                        ), 60000)
                    }

                    // calls checkPendingReceived if re-connects
                    NostrClient.reconnectToRelays().catch(e => false)           
            }
    
            appState.current = nextAppState         
        })        
    
        return () => {
          subscription.remove()          
        }
    }, [])


    const toggleMintsModal = () => {
        setIsMintsModalVisible(previousState => !previousState)
    }


    const toggleUpdateModal = () => {
        setIsUpdateModalVisible(previousState => !previousState)
    }


    const toggleSendModal = () => {
        setIsSendModalVisible(previousState => !previousState)
    }


    const toggleReceiveModal = () => {
        setIsReceiveModalVisible(previousState => !previousState)
    }

    const addMint = async function ({scannedMintUrl = ''} = {}) {
        // necessary
        navigation.setParams({scannedMintUrl: undefined})       

        const newMintUrl = scannedMintUrl || defaultMintUrl
        
        log.trace('newMintUrl', newMintUrl)
        
        if (mintsStore.alreadyExists(newMintUrl)) {
            const msg = translate('walletScreen.mintExists')
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
        navigation.navigate('Scan')
    }

    const gotoTokenReceive = async function () {
        toggleReceiveModal()
        navigation.navigate('TokenReceive', {unit: currentUnit})
    }

    const gotoTranDetail = function (id: number) {
        // navigation.navigate('TranDetail', {id})
        navigation.navigate('TransactionsNavigator', {screen: 'TranDetail', params: {id}, initial: false})
    }

    const gotoPaymentRequests = function () {
        navigation.navigate('PaymentRequests')
    }

    const gotoProfile = function () {
        navigation.navigate('ContactsNavigator', {screen: 'Profile', params: {}, initial: false})
    }

    const gotoMintInfo = function (mintUrl: string) {
        setIsMintsModalVisible(false)
        navigation.navigate('SettingsNavigator', {
            screen: 'MintInfo', 
            params: {mintUrl}, 
            initial: false
        })
    }

    const gotoTopup = function (mintUrl?: string) {
        if(mintUrl) {
            setIsMintsModalVisible(false)
            navigation.navigate('Topup', {                        
                mintUrl,
                unit: currentUnit
            })
        } else {
            setIsReceiveModalVisible(false)
            navigation.navigate('Topup', {                                        
                unit: currentUnit
            })
        }
    }


    const gotoLightningPay = function (mintUrl?: string, ) {
        if(mintUrl) {
            setIsMintsModalVisible(false)
            navigation.navigate('LightningPay', {
                mintUrl,
                unit: currentUnit
            })
        } else {
            setIsSendModalVisible(false)
            navigation.navigate('LightningPay', {                                        
                unit: currentUnit
            })
        }        
    }


    const gotoSend = function () {
        // log.trace('[gotoSend]', {currentUnit})
        setIsSendModalVisible(false)
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
        
        if (unitMints) {            
            return (
            <>
                <View style={[
                    $headerContainer, {
                        backgroundColor: headerBg, 
                        paddingTop: spacing.small,
                    }
                ]}>
                    <UnitBalanceBlock                            
                        unitBalance={balances.unitBalances.find(balance => balance.unit === unitMints.unit)!}
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
                    {transactionsStore.recentByUnit(unitMints.unit).length > 0 ? (
                        <Card                                    
                            ContentComponent={                                            
                                <FlatList
                                    data={transactionsStore.recentByUnit(unitMints.unit) as Transaction[]}
                                    renderItem={({item, index}) => {
                                        return (
                                            <TransactionListItem
                                                key={item.id}
                                                transaction={item}
                                                isFirst={index === 0}
                                                isTimeAgoVisible={true}
                                                gotoTranDetail={() => gotoTranDetail(item.id!)}
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
                                    text='Start by funding your wallet'
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
        return null;
    }

    const tabWidth = moderateScale(80)

    const getActiveTabColor = (state: NavigationState<Route>) => {
        if(state && state.routes.length > 0) {
            switch (state.routes[tabIndex].key) {
                case 'usd':
                    return useThemeColor('usd')              
                case 'eur':
                    return useThemeColor('eur')                 
                default:
                    return useThemeColor('btc') 
            }
        }

        return useThemeColor('btc')
    }

    const renderTabBar = (props: any) => {
        return(
            <View style={{backgroundColor: headerBg, marginTop: -spacing.medium}}>
                <View style={{width: routes.length * tabWidth, alignSelf: 'center', backgroundColor: headerBg}}>
                    <TabBar                        
                        {...props}                        
                        tabStyle={{width: tabWidth}}
                        renderLabel={({ route, focused, color }) => (
                            <CurrencySign
                                mintUnit={route.key as MintUnit}
                                textStyle={{color: 'white'}}
                                containerStyle={focused ? {} : {opacity: 0.5}}
                            />
                        )}
                        indicatorStyle={{ backgroundColor: getActiveTabColor(props.navigationState) }}                    
                        style={{backgroundColor: headerBg, shadowColor: 'transparent'}}
                    />
                </View>
            </View>
        )
    }
    
    const headerBg = useThemeColor('header')    
    const balances = proofsStore.getBalances()
    const screenBg = useThemeColor('background')
    const mainButtonIcon = useThemeColor('mainButtonIcon')
    const mainButtonColor = useThemeColor('card')
    const label = useThemeColor('textDim')
    const headerTitle = useThemeColor('headerTitle')

    const isNwcVisible = nwcStore.all.some(c => c.remainingDailyLimit !== c.dailyLimit)
    const nwcCardsData = nwcStore.all.filter(c => c.remainingDailyLimit !== c.dailyLimit)

    return (        
      <Screen contentContainerStyle={$screen}>
            <Header 
                LeftActionComponent={<LeftProfileHeader 
                    gotoProfile={gotoProfile}
                    isAvatarVisible={false}
                />}                
                TitleActionComponent={!isInternetReachable ? (
                        <Text   
                            tx={'common.offline'}
                            style={$offline}
                            size='xxs'                          
                        />
                    ) : ( undefined  )
                }               
                RightActionComponent={
                <>
                    {paymentRequestsStore.countNotExpired > 0 && (
                        <Pressable 
                            style={{flexDirection: 'row', alignItems:'center', marginRight: spacing.medium}}
                            onPress={() => gotoPaymentRequests()}
                        >
                            <Icon icon='faPaperPlane' color={headerTitle}/>
                            <Text text={`${paymentRequestsStore.countNotExpired}`} style={{color: headerTitle}} />
                        </Pressable>
                    )}
                </>
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
                                        <Text text='Spent today' size='xxs' preset='formHelper' style={{color: label, overflow: 'hidden'}}/>
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
                        tx='payCommon.send'
                    />             
                    <Button
                        RightAccessory={() => (
                            <SvgXml 
                                width={spacing.large} 
                                height={spacing.large} 
                                xml={ScanIcon}
                                fill={mainButtonIcon}
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
                        tx='payCommon.receive'
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
            isVisible={isMintsModalVisible ? true : false}
            style={{alignItems: 'stretch', padding: spacing.medium}}
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
                tx="updateModal.title"
                subTx="updateModal.desc"
                onPress={gotoUpdate}
            />
            }
            onBackButtonPress={toggleUpdateModal}
            onBackdropPress={toggleUpdateModal}
        />
        <BottomModal
          isVisible={isSendModalVisible ? true : false}
          style={{alignItems: 'stretch'}}
          ContentComponent={  
            <>
            <ListItem   
                leftIcon='faMoneyBill1'                          
                tx="walletScreen.sendEcash"
                subTx="walletScreen.sendEcashDesc"
                onPress={gotoSend}
                bottomSeparator={true}
            />
            <ListItem   
                leftIcon='faBolt'             
                tx="walletScreen.payWithLightning"
                subTx="walletScreen.payWithLightningDesc"
                onPress={() => gotoLightningPay()}
            />
            </>      
          }
          onBackButtonPress={toggleSendModal}
          onBackdropPress={toggleSendModal}
        /> 
        <BottomModal
          isVisible={isReceiveModalVisible ? true : false}
          style={{alignItems: 'stretch'}}
          ContentComponent={  
            <>
            <ListItem   
                leftIcon='faMoneyBill1'             
                tx="walletScreen.receiveEcash"
                subTx="walletScreen.receiveEcashDesc"
                onPress={gotoTokenReceive}
                bottomSeparator={true}
            />
            <ListItem      
                leftIcon='faBolt'          
                tx='walletScreen.topupWithLightning'
                subTx="walletScreen.topupWithLightningDesc"
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
                containerStyle={{marginTop: spacing.medium}}
            />
            <View style={{height: verticalScale(40)}}>            
            {walletStore.exchangeRate && userSettingsStore.exchangeCurrency && ( 
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


const ZeroBalanceBlock = function () {
    const headerBg = useThemeColor('header')
    const balanceColor = 'white'
    const currencyColor = colors.palette.primary200
    

    return (
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            <Text                
                preset='heading'              
                style={[$unitBalance, {color: balanceColor}]}            
                text={'0'}
            />
        </View>
    )
}



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
    const mintsCountText = `and ${mintsByUnit.mints.length - 1} other${mintsByUnit.mints.length - 1 > 1 ? 's' : ''}`

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
            LayoutAnimation.easeInEaseOut()
            setSelectedMintUrl(undefined)
            return
        }

        LayoutAnimation.easeInEaseOut()
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
                    topSeparator={index !== 0 ?? true}
                />
                {selectedMintUrl === mint.mintUrl &&  (
                    <View style={{flexDirection: 'row', marginBottom: spacing.small, justifyContent: 'flex-start'}}>
                        <Button
                            tx="walletScreen.topup"
                            LeftAccessory={() => (
                                <Icon
                                icon='faPlus'
                                color={color}
                                size={spacing.small}                  
                                />
                            )}
                            preset='secondary'
                            textStyle={{fontSize: 14, color}}
                            onPress={() => props.onTopup(mintsByUnitCurrent!.unit, mint.mintUrl)}
                            style={{
                                minHeight: verticalScale(40), 
                                paddingVertical: verticalScale(spacing.tiny),
                                marginRight: spacing.small
                            }}                    
                        />
                        <Button
                            tx="walletScreen.pay"
                            LeftAccessory={() => (
                                <Icon
                                icon='faBolt'
                                color={color}
                                size={spacing.small}                  
                                />
                            )}
                            textStyle={{fontSize: 14, color}}
                            preset='secondary'
                            onPress={() => props.onLightningPay(mintsByUnitCurrent!.unit, mint.mintUrl)}
                            style={{
                                minHeight: verticalScale(40), 
                                paddingVertical: verticalScale(spacing.tiny),
                                marginRight: spacing.small
                            }}                    
                        />
                        <Button
                            tx="wallerScreen.mintButton"
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
    flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    // padding: spacing.tiny,  
    height: spacing.screenHeight * 0.28,
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

const $promoContainer: TextStyle = {
    marginTop: -spacing.extraLarge * 1.5,
}

const $rightContainer: ViewStyle = {
    padding: spacing.extraSmall,
    alignSelf: 'center',
    marginLeft: spacing.small,
}

const $card: ViewStyle = {    
    marginBottom: spacing.small,
    //paddingTop: 0,
    marginHorizontal: spacing.extraSmall,    
}

const $cardHeading: TextStyle = {
  fontFamily: typography.primary?.medium,
  fontSize: verticalScale(18),
}

const $unitBalance: TextStyle = {
    fontSize: verticalScale(48),
    lineHeight: verticalScale(48)
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


const $nwcContainer: ViewStyle = {
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.extraSmall,
}

const $bottomContainer: ViewStyle = {
  justifyContent: 'flex-end',
  paddingHorizontal: spacing.extraSmall,
  marginTop: spacing.large,
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


const $offline: TextStyle = {
    paddingHorizontal: spacing.small,
    borderRadius: spacing.tiny,
    alignSelf: 'center',
    marginVertical: spacing.small,
    lineHeight: spacing.medium,    
    backgroundColor: colors.palette.orange400,
    color: 'white'
}
