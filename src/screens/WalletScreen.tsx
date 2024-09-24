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
import {moderateScale, moderateVerticalScale, verticalScale} from '@gocodingnow/rn-size-matters'
import { SvgXml } from 'react-native-svg'
import {getUnixTime} from 'date-fns'
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
import { MintUnit, getCurrency } from "../services/wallet/currency"
import { CurrencyAmount } from './Wallet/CurrencyAmount'
import { LeftProfileHeader } from './ContactsScreen'
import { maxTransactionsByUnit } from '../models/TransactionsStore'
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
        walletProfileStore
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
    const [lastClaimCheck, setLastClaimCheck] = useState<number>(getUnixTime(new Date()))
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
            const url = await Linking.getInitialURL()
                                             
            if (url) {                            
                handleDeeplink({url})                
                return // skip further processing so that it does not slow down or clash deep link
            }
            
            if(!isInternetReachable) { return }            

            // check lnaddress claims on app start and set timestamp to trigger focus updates
            WalletTask.handleClaim().catch(e => setInfo(e.message))
            // Auto-recover inflight proofs - do only on startup and before checkPendingReceived to prevent conflicts            
            WalletTask.handleInFlight().catch(e => false)
            // Create websocket subscriptions to receive tokens or payment requests by NOSTR DMs                    
            WalletTask.receiveEventsFromRelays().catch(e => false)            
            
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


    const handleClipboard = function (clipboard: string) {
        log.trace('clipboard', clipboard, 'handleClipboard')
    }
    

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
            
            // check lnaddress claims max once per minute to decrease server load      
            const nowInSec = getUnixTime(new Date())

            log.trace('[useFocusEffect]', {nowInSec, lastClaimCheck, delay: lastClaimCheck ? nowInSec - lastClaimCheck : undefined})

            if(lastClaimCheck && nowInSec - lastClaimCheck > 60) {                
                WalletTask.handleClaim().catch(e => false)
                setLastClaimCheck(nowInSec)            
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

                    // check lnaddress claims max once per minute to decrease server load            
                    const nowInSec = getUnixTime(new Date())

                    // log.trace('[appState change]', {nowInSec, lastClaimCheck, delay: lastClaimCheck ? nowInSec - lastClaimCheck : undefined})

                    if(lastClaimCheck && nowInSec - lastClaimCheck > 60) {                        
                        WalletTask.handleClaim().catch(e => false)
                        setLastClaimCheck(nowInSec)            
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
                        paddingTop: spacing.medium
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
                <View style={$contentContainer}>                           
                    {transactionsStore.recentByUnit(unitMints.unit).length > 0 ? (
                        <Card                                    
                            ContentComponent={                                            
                                <FlatList
                                    data={transactionsStore.recentByUnit(unitMints.unit, maxTransactionsByUnit) as Transaction[]}
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
                            style={[$card, {paddingTop: spacing.extraSmall}]}
                        />
                    ) : (
                        <Card                                
                            ContentComponent={
                                <ListItem 
                                    leftIcon='faArrowTurnDown'
                                    text='Make your first transaction'
                                    textStyle={{fontSize: moderateScale(14)}} 
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
        switch (state.routes[tabIndex].key) {
            case 'usd':
                return useThemeColor('usd')              
            case 'eur':
                return useThemeColor('eur')                 
            default:
                return useThemeColor('btc') 
          }
          
    }

    const renderTabBar = (props: any) => {
        return(
            <View style={{backgroundColor: headerBg, marginTop: -spacing.extraSmall}}>
                <View style={{width: routes.length * tabWidth, alignSelf: 'center', backgroundColor: headerBg}}>
                    <TabBar                        
                        {...props}                        
                        tabStyle={{width: tabWidth}}
                        renderLabel={({ route, focused, color }) => (
                            <CurrencySign
                                mintUnit={route.key as MintUnit}
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
    const mainButtonIcon = useThemeColor('button')
    const mainButtonColor = useThemeColor('card')

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
                            <Icon icon='faPaperPlane' color={'white'}/>
                            <Text text={`${paymentRequestsStore.countNotExpired}`} style={{color: 'white'}} />
                        </Pressable>
                    )}
                </>
                }                
            />
            {groupedMints.length === 0 ? (
                <>
                    <ZeroBalanceBlock/>
                    <View style={$contentContainer}>
                        <PromoBlock addMint={addMint} />
                    </View>
                </>
            ) : (                
                <TabView
                    renderTabBar={renderTabBar}
                    navigationState={{ index: tabIndex, routes }}
                    renderScene={renderUnitTabs}
                    onIndexChange={onTabChange}
                    initialLayout={{ width: spacing.screenWidth }}                    
                />
            )}
            <View style={$bottomContainer}>
                <View style={$buttonContainer}>
                    <Button
                        LeftAccessory={() => (
                            <Icon
                                icon='faArrowUp'
                                size={spacing.medium}
                                color={mainButtonIcon}
                                //style={{paddingLeft: spacing.medium}}
                            />
                        )}
                        onPress={toggleSendModal}                        
                        style={[{backgroundColor: mainButtonColor, borderWidth: 1, borderColor: screenBg}, $buttonTopup]}
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
                            />
                        )}
                        onPress={toggleReceiveModal}
                        tx='payCommon.receive'
                        style={[{backgroundColor: mainButtonColor, borderWidth: 1, borderColor: screenBg}, $buttonPay]}
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
    const balanceColor = 'white'
    const convertedBalanceColor = colors.palette.primary200
    const currencyColor = colors.palette.primary200    
    const {unitBalance} = props

    return (
        <>
            <CurrencyAmount
                amount={unitBalance.unitBalance || 0}
                // amount={2487}
                mintUnit={unitBalance.unit}
                symbolStyle={{display: 'none'}}
                amountStyle={[$unitBalance, {color: balanceColor}]}
                containerStyle={{marginTop: spacing.medium}}
            />
            <CurrencyAmount
                amount={283}
                mintUnit={'usd'}
                symbolStyle={{color: currencyColor, marginTop: spacing.tiny}}
                amountStyle={{color: convertedBalanceColor}}
                // containerStyle={{marginLeft: -spacing.medium}}  
                size='small'             
            />

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

const PromoBlock = function (props: {addMint: any}) {
    return (
        <Card
            HeadingComponent={
            <View style={$promoIconContainer}>
                <View
                    style={{
                        flex: 0,
                        borderRadius: spacing.small,
                        padding: spacing.extraSmall,
                        backgroundColor: colors.palette.orange600
                    }}
                >
                    <SvgXml 
                        width={spacing.extraLarge} 
                        height={spacing.extraLarge} 
                        xml={MintIcon}
                        fill='white'
                    />
                </View>
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
                    tx="walletScreen.addFirstMint"
                />
            </View>
            }            
        />
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
        <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
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
                                minHeight: moderateVerticalScale(40), 
                                paddingVertical: moderateVerticalScale(spacing.tiny),
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
                                minHeight: moderateVerticalScale(40), 
                                paddingVertical: moderateVerticalScale(spacing.tiny),
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
                                minHeight: moderateVerticalScale(40), 
                                paddingVertical: moderateVerticalScale(spacing.tiny),
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
    height: spacing.screenHeight * 0.30,
}

const $contentContainer: TextStyle = {
    marginTop: -spacing.extraLarge * 1.5,
    // alignSelf: 'stretch',
    // padding: spacing.extraSmall,    
    // flex: 1,
    // paddingTop: spacing.extraSmall - 3,
    // borderWidth: 3,
    // borderColor: 'green',
}

const $card: ViewStyle = {    
    marginBottom: spacing.small,
    //paddingTop: 0,
    marginHorizontal: spacing.extraSmall,    
}

const $cardHeading: TextStyle = {
  fontFamily: typography.primary?.medium,
  fontSize: moderateVerticalScale(18),
}

const $unitBalance: TextStyle = {
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
  // flex: 0.18,
  // justifyContent: 'flex-end',
  // marginBottom: spacing.extraSmall,
  // alignItems: 'center',
  // opacity: 0,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',    
    marginBottom: spacing.tiny,
    justifyContent: 'center',
    alignItems: 'center',    
}

const $buttonTopup: ViewStyle = {
  borderTopLeftRadius: moderateVerticalScale(60 / 2),
  borderBottomLeftRadius: moderateVerticalScale(60 / 2),
  borderTopRightRadius: 0,
  borderBottomRightRadius: 0,  
  width: moderateVerticalScale(150),
  height: moderateVerticalScale(60),
  marginRight: -25,  
}

const $buttonScan: ViewStyle = {
  borderRadius: moderateVerticalScale(70 / 2),
  width: moderateVerticalScale(70),
  height: moderateVerticalScale(70),
  zIndex: 99,  
}

const $buttonPay: ViewStyle = {
  borderTopLeftRadius: 0,
  borderBottomLeftRadius: 0,
  borderTopRightRadius: moderateVerticalScale(30),
  borderBottomRightRadius: moderateVerticalScale(30),
  width: moderateVerticalScale(150),
  height: moderateVerticalScale(60),
  marginLeft: -25, 
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
    color: 'white',
}
