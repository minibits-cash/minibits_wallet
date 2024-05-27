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
  ScrollView
} from 'react-native'
import codePush, { RemotePackage } from 'react-native-code-push'
import {moderateVerticalScale, verticalScale} from '@gocodingnow/rn-size-matters'
import { SvgXml } from 'react-native-svg'
import {getUnixTime} from 'date-fns'
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
import { MintUnit } from "../services/wallet/currency"
import { CurrencyAmount } from './Wallet/CurrencyAmount'
import { LeftProfileHeader } from './ContactsScreen'
import { maxTransactionsByUnit } from '../models/TransactionsStore'

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
    } = useStores()
        
    const pagerRef = useRef<PagerView>(null)
    const appState = useRef(AppState.currentState)
    const isInternetReachable = useIsInternetReachable()
    const groupedMints = mintsStore.groupedByUnit

    const [currentUnit, setCurrentUnit] = useState<MintUnit>(groupedMints.length > 0 ? groupedMints[0].unit : 'sat')
    const [info, setInfo] = useState<string>('')
    const [defaultMintUrl, setDefaultMintUrl] = useState<string>(MINIBITS_MINT_URL)
    const [lastClaimCheck, setLastClaimCheck] = useState<number>(getUnixTime(new Date()))
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState<boolean>(false)
    
    const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false)
    const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false)
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
        setIsNativeUpdateAvailable(true)
        toggleUpdateModal()
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
            WalletTask.handleClaim().catch(e => false)
            // Auto-recover inflight proofs - do only on startup and before checkPendingReceived to prevent conflicts            
            WalletTask.handleInFlight().catch(e => false)
            // Create websocket subscriptions to receive tokens or payment requests by NOSTR DMs                    
            WalletTask.receiveEventsFromRelays().catch(e => false)
            // log.trace('[getInitialData]', 'walletProfile', walletProfileStore) 
            const preferredUnit: MintUnit = userSettingsStore.preferredUnit
            const pageIndex = groupedMints.findIndex(m => m.unit === preferredUnit)
            pagerRef.current && pagerRef.current.setPage(pageIndex)         
        }
        
        Linking.addEventListener('url', handleDeeplink)
        getInitialData()

        return () => {}
    }, [])


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

            WalletTask.handleSpentFromPending().catch(e => false)               
            WalletTask.handlePendingTopups().catch(e => false) 
            
            // check lnaddress claims max once per minute to decrease server load      
            const nowInSec = getUnixTime(new Date())

            log.warn('[useFocusEffect]', {nowInSec, lastClaimCheck, delay: lastClaimCheck ? nowInSec - lastClaimCheck : undefined})

            if(lastClaimCheck && nowInSec - lastClaimCheck > 60) {
                log.warn('[useFocusEffect]', 'Starting claim')                
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

                    WalletTask.handleSpentFromPending().catch(e => false) 
                    WalletTask.handlePendingTopups().catch(e => false)

                    // check lnaddress claims max once per minute to decrease server load            
                    const nowInSec = getUnixTime(new Date())

                    log.warn('[appState change]', {nowInSec, lastClaimCheck, delay: lastClaimCheck ? nowInSec - lastClaimCheck : undefined})

                    if(lastClaimCheck && nowInSec - lastClaimCheck > 60) {
                        log.warn('[useFocusEffect]', 'Starting claim')                   
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

    const gotoTokenReceive = async function () {
        /* const routes = navigation.getState()?.routes
        const state = navigation.getState()
        log.trace('[gotoTokenReceive]', {routes, state}) */
        
        navigation.navigate('TokenReceive', {unit: currentUnit})
    }

    const gotoSend = function () {
        navigation.navigate('Send', {unit: currentUnit})
    }

    const gotoScan = function () {
        navigation.navigate('Scan')
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
    
    /* Mints pager */    
    
    const width = spacing.screenWidth    
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


    const onPageSelected = (e: any) => {
        if(groupedMints.length === 0) {
            return
        }

        const currentUnit = groupedMints[e.nativeEvent.position]?.unit
        log.trace('[onPageSelected] currentUnit', currentUnit)

        setCurrentUnit(currentUnit)

        const preferredUnit = userSettingsStore.preferredUnit

        if(currentUnit !== preferredUnit) { // prevents db write on first load
            userSettingsStore.setPreferredUnit(currentUnit)
        }        
    }

    const handleError = function (e: AppError) {
      setIsLoading(false)
      setError(e)
    }

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
                /*leftIcon='faListUl'
                leftIconColor={colors.palette.primary100}                
                onLeftPress={gotoTranHistory}*/
                TitleActionComponent={!isInternetReachable ? (
                        <Text   
                            tx={'common.offline'}
                            style={$offline}
                            size='xxs'                          
                        />
                    ) : (
                        groupedMints.length > 1 ? (
                            <ScalingDot
                                testID={'sliding-border'}                        
                                data={groupedMints}
                                inActiveDotColor={colors.palette.primary300}
                                activeDotColor={colors.palette.primary100}
                                activeDotScale={1}
                                containerStyle={{marginBottom: -spacing.tiny}}
                                //@ts-ignore
                                scrollX={scrollX}
                                dotSize={25}
                            />
                    ) : undefined
                )}                
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
            {groupedMints.length === 0 && (
                <>
                    <ZeroBalanceBlock/>
                    <View style={$contentContainer}>
                        <PromoBlock addMint={addMint} />
                    </View>
                </>
            )}
            <AnimatedPagerView                            
                initialPage={0}
                ref={pagerRef}    
                style={{flexGrow: 1}}                                                       
                onPageScroll={onPageScroll}
                onPageSelected={onPageSelected}                
            >
                {groupedMints.map((mints) => (
                    <View key={mints.unit}>
                        <UnitBalanceBlock                            
                            unitBalance={balances.unitBalances.find(balance => balance.unit === mints.unit)!}
                        />
                        <View style={$contentContainer}>
                            <MintsByUnitListItem                                    
                                mintsByUnit={mints}                                
                                navigation={navigation}                                     
                            />                            
                            {transactionsStore.recentByUnit(mints.unit).length > 0 &&  mints.mints.length  < 4 && (
                                <Card                                    
                                    ContentComponent={                                            
                                        <FlatList
                                            data={transactionsStore.recentByUnit(mints.unit, maxTransactionsByUnit - mints.mints.length) as Transaction[]}
                                            renderItem={({item, index}) => {
                                                return (<TransactionListItem
                                                    key={item.id}
                                                    transaction={item}
                                                    isFirst={index === 0}
                                                    isTimeAgoVisible={true}
                                                    gotoTranDetail={() => gotoTranDetail(item.id!)}
                                                />)
                                                }
                                            }
                                            // style={{ maxHeight: 300 - (mints.mints.length > 1 ? mints.mints.length * 38 : 0)}}
                                        />                                            
                                    }
                                    style={[$card, {paddingTop: spacing.extraSmall}]}
                                />
                            )}
                        </View>                        
                    </View>     
                ))}                       
            </AnimatedPagerView>   
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
                        onPress={gotoSend}                        
                        style={[{backgroundColor: mainButtonColor, borderWidth: 1, borderColor: screenBg}, $buttonTopup]}
                        preset='tertiary'
                        text='Send'
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
                        preset='tertiary'
                    />
                    <Button
                        RightAccessory={() => (
                            <Icon
                                icon='faArrowDown'
                                size={spacing.medium}
                                color={mainButtonIcon}
                            />
                        )}
                        onPress={gotoTokenReceive}
                        text='Receive'
                        style={[{backgroundColor: mainButtonColor, borderWidth: 1, borderColor: screenBg}, $buttonPay]}
                        preset='tertiary'
                    /> 
                </View>  
            </View>
            {info && <InfoModal message={info} />}
            {error && <ErrorModal error={error} />}
            {isLoading && <Loading />}
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

      </Screen>
    )
  },
)


const UnitBalanceBlock = observer(function (props: {
    unitBalance: UnitBalance
}) {
    const headerBg = useThemeColor('header')
    
    const balanceColor = 'white'
    const currencyColor = colors.palette.primary200
    const {unitBalance} = props
    // const headerBg = getMintColor(unitBalance.unit)
    
    // log.trace('[UnitBalanceBlock]', {unitBalance})

    return (
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            <CurrencySign                
                mintUnit={unitBalance.unit}
                size='small'
                textStyle={{color: balanceColor}}
            />
            <CurrencyAmount
                amount={unitBalance.unitBalance || 0}
                mintUnit={unitBalance.unit}
                symbolStyle={{display: 'none'}}
                amountStyle={[$unitBalance, {color: balanceColor, marginTop: spacing.small}]}
            />
        </View>
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


const MintsByUnitListItem = observer(function (props: {
    mintsByUnit: MintsByUnit    
    navigation: any
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

    const gotoMintInfo = function (mintUrl: string) {
        props.navigation.navigate('SettingsNavigator', {screen: 'MintInfo', params: {mintUrl}, initial: false})
    }


    const gotoTopup = function (unit: MintUnit, mintUrl: string) {
        props.navigation.navigate('Topup', {                        
            mintUrl,
            unit
        })
    }


    const gotoLightningPay = async function (unit: MintUnit, mintUrl: string, ) {
        props.navigation.navigate('LightningPay', {
            mintUrl,
            unit
        })
    }


    const gotoSend = async function (unit: MintUnit, mintUrl: string) {
        props.navigation.navigate('Send', {
            mintUrl,
            unit
        })
    }

    
    const color = useThemeColor('textDim')
    const balanceColor = useThemeColor('amount')
    const {mintsByUnit} = props



    /* const isSingleMint: boolean = mintsByUnit.mints.length === 1 || false
    const singleMint: Mint = mintsByUnit.mints[0] */


    return (
        <Card
            verticalAlignment='force-footer-bottom'            
            ContentComponent={
                <ScrollView>
                    {mintsByUnit.mints.map((mint: Mint) => (
                        <View key={mint.mintUrl}>
                        <ListItem                        
                            text={mint.shortname}
                            subText={mint.hostname}                    
                            // leftIcon={mint.status === MintStatus.OFFLINE ? 'faTriangleExclamation' : 'faMoneyBill1'}              
                            // leftIconInverse={true}
                            // leftIconColor={mint.color}
                            LeftComponent={
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
                            }
                            RightComponent={
                                <CurrencyAmount 
                                    amount={mint.balances?.balances[mintsByUnit.unit as MintUnit] || 0}
                                    mintUnit={mintsByUnit.unit}
                                    size='medium'
                                />                    
                            }
                            //topSeparator={true}
                            style={$item}
                            onPress={() => onSelectedMint(mint.mintUrl)}
                        />
                        {selectedMintUrl === mint.mintUrl &&  (
                            <View style={{flexDirection: 'row', marginBottom: spacing.small, justifyContent: 'flex-start'}}>
                                <Button
                                    text={'Topup'}
                                    LeftAccessory={() => (
                                        <Icon
                                        icon='faPlus'
                                        color={color}
                                        size={spacing.small}                  
                                        />
                                    )}
                                    preset='secondary'
                                    textStyle={{fontSize: 14, color}}
                                    onPress={() => gotoTopup(mintsByUnit.unit, mint.mintUrl)}
                                    style={{
                                        minHeight: moderateVerticalScale(40), 
                                        paddingVertical: moderateVerticalScale(spacing.tiny),
                                        marginRight: spacing.small
                                    }}                    
                                />
                                {/*<Button
                                    text={'Exchange'}
                                    LeftAccessory={() => (
                                        <Icon
                                        icon='faRotate'
                                        color={color}
                                        size={spacing.medium}                  
                                        />
                                    )}
                                    textStyle={{fontSize: 14, color}}
                                    preset='tertiary'
                                    onPress={props.gotoMintInfo}
                                    style={{minHeight: moderateVerticalScale(40), paddingVertical: moderateVerticalScale(spacing.tiny)}}                    
                                />*/}
                                <Button
                                    text={'Pay'}
                                    LeftAccessory={() => (
                                        <Icon
                                        icon='faBolt'
                                        color={color}
                                        size={spacing.small}                  
                                        />
                                    )}
                                    textStyle={{fontSize: 14, color}}
                                    preset='secondary'
                                    onPress={() => gotoLightningPay(mintsByUnit.unit, mint.mintUrl)}
                                    style={{
                                        minHeight: moderateVerticalScale(40), 
                                        paddingVertical: moderateVerticalScale(spacing.tiny),
                                        marginRight: spacing.small
                                    }}                    
                                />
                                {/*<Button
                                    text={'Send'}
                                    LeftAccessory={() => (
                                        <Icon
                                        icon='faMoneyBill1'
                                        color={color}
                                        size={spacing.medium}                  
                                        />
                                    )}
                                    textStyle={{fontSize: 14, color}}
                                    preset='secondary'
                                    onPress={() => gotoSend(mintsByUnit.unit, mint.mintUrl)}
                                    style={{
                                        minHeight: moderateVerticalScale(40), 
                                        paddingVertical: moderateVerticalScale(spacing.tiny),
                                        marginRight: spacing.tiny
                                    }}                    
                                />*/}
                                <Button
                                    text={'Mint'}
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
                                    onPress={() => gotoMintInfo(mint.mintUrl)}
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
                </ScrollView>
            }            
            contentStyle={{color}}            
            style={[$card, {maxHeight: spacing.screenHeight * 0.6}]}
        />
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
    height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
    marginTop: -spacing.extraLarge * 2,
    // padding: spacing.extraSmall,    
    flex: 1,
    // paddingTop: spacing.extraSmall - 3,
    // borderWidth: 1,
    // borderColor: 'green',
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  //paddingTop: 0,
  marginHorizontal: spacing.extraSmall,
  // alignSelf: 'stretch'
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
