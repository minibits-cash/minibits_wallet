import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {AppState, LayoutAnimation, Platform, ScrollView, TextStyle, View, ViewStyle, useColorScheme} from 'react-native'
import notifee, { AuthorizationStatus } from '@notifee/react-native'
import messaging from '@react-native-firebase/messaging'
import {
    APP_ENV,
    HOT_UPDATER_API_KEY,
    HOT_UPDATER_URL,
} from '@env'
import {ThemeCode, Themes, colors, spacing, useThemeColor} from '../theme'
import {ListItem, Screen, Text, Card, NwcIcon, Button, BottomModal, InfoModal, Icon} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {translate} from '../i18n'
import { log } from '../services'
import {Env} from '../utils/envtypes'
import { round } from '../utils/number'
import { Currencies, CurrencyCode } from '../services/wallet/currency'
import { NotificationService } from '../services/notificationService'
import { SvgXml } from 'react-native-svg'
import { CurrencySign } from './Wallet/CurrencySign'
import { CommonActions, StaticScreenProps, useNavigation } from '@react-navigation/native'
import { HotUpdater } from '@hot-updater/react-native'

type Props = StaticScreenProps<undefined>

export const SettingsScreen = observer(function SettingsScreen({ route }: Props) {
    const navigation = useNavigation()
    useHeader({}) // default header component
    const appState = useRef(AppState.currentState)
    const {
      mintsStore, 
      relaysStore, 
      userSettingsStore, 
      walletProfileStore,
      nwcStore,
      walletStore
    } = useStores()

    const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false)
    const [updateDescription, setUpdateDescription] = useState<string>('')
    const [currentTheme, setCurrentTheme] = useState<ThemeCode>(userSettingsStore.theme)    
    
    const [updateSize, setUpdateSize] = useState<string>('')
    const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState<boolean>(false)
    const [isThemeModalVisible, setIsThemeModalVisible] = useState<boolean>(false)
    const [isNativeUpdateAvailable, setIsNativeUpdateAvailable] = useState<boolean>(false)
    const [areNotificationsEnabled, setAreNotificationsEnabled] = useState<boolean>(false)
    const [isHeaderVisible, setIsHeaderVisible] = useState(true)
    const [info, setInfo] = useState('')

    useEffect(() => {
        const checkForUpdate = async () => {
            try {
                const updateInfo = await HotUpdater.checkForUpdate({
                    source: HOT_UPDATER_URL,
                    requestHeaders: {
                        Authorization: `Bearer ${HOT_UPDATER_API_KEY}`,
                    },
                })

                log.debug('[checkForUpdate]', {updateInfo})

                if (!updateInfo) {
                    return
                }

                if(!__DEV__) {
                    setIsUpdateAvailable(true)
                    setUpdateDescription(updateInfo.message)
                    
                    if (updateInfo.shouldForceUpdate) {
                        // apply emergency update immediately
                        await HotUpdater.updateBundle(updateInfo.id, updateInfo.fileUrl)
                        HotUpdater.reload()
                    }
                }
                
            } catch (e: any) {
                log.error(e)
                return false
            }
        }

        checkForUpdate()
    }, [])


    useEffect(() => {
      const getDeviceToken = async () => {
          try {
              const enabled = await NotificationService.areNotificationsEnabled()
              setAreNotificationsEnabled(enabled)

              if(enabled && !walletProfileStore.device) {
                await messaging().registerDeviceForRemoteMessages()        
                const deviceToken = await messaging().getToken()
                if(deviceToken) {
                  await walletProfileStore.setDevice(deviceToken)
                }                
              }             
          } catch (e: any) {
              log.info(e.name, e.message)
              return false // silent
          }
      } 
      getDeviceToken()
  }, [])


  useEffect(() => {        
    const subscription = AppState.addEventListener('change', async(nextAppState) => {
        if (
            appState.current.match(/inactive|background/) &&
            nextAppState === 'active') {
              try {
                const enabled = await NotificationService.areNotificationsEnabled()
                setAreNotificationsEnabled(enabled)                
                
                if(!enabled) {
                  return
                }

                // FCM push notifications - set or refresh device token
                await messaging().registerDeviceForRemoteMessages()        
                const deviceToken = await messaging().getToken()
        
                log.debug('[useInitialRootStore]', {deviceToken})
                
                if(deviceToken && deviceToken !== walletProfileStore.device) {
                  // if device token changed, update the server        
                  await walletProfileStore.setDevice(deviceToken)        
                }
              } catch (e: any) {
                  log.info(e.name, e.message)
                  return false // silent
              }
            }

        appState.current = nextAppState         
    })        

    return () => {
      subscription.remove()          
    }
  }, [])

  const toggleCurrencyModal = () => {
    setIsCurrencyModalVisible(previousState => !previousState)
  }

  const toggleThemeModal = () => {
    setIsThemeModalVisible(previousState => !previousState)
  }

 /* const handleBinaryVersionMismatchCallback = function(update: RemotePackage) {            
    // silent
    setIsNativeUpdateAvailable(true)
  } */

  const gotoMints = function() {
    // @ts-ignore
    navigation.navigate('Mints', {})
  }

  const gotoSecurity = function() {
    // @ts-ignore
    navigation.navigate('Security')
  }    
    
  const gotoPrivacy = function() {
    // @ts-ignore
      navigation.navigate('Privacy')
  }

  const gotoDevOptions = function() {
    // @ts-ignore
    navigation.navigate('Developer')
  }

  const gotoRelays = function() {
    // @ts-ignore
      navigation.navigate('Relays')
  }
  
  const gotoBackupOptions = function() {
    // @ts-ignore
    navigation.navigate('BackupOptions')
  }

  const gotoRecoveryOptions = function() {
    navigation.getParent()!.dispatch(
      CommonActions.navigate({
        name: 'RecoveryOptions',
        params: {fromScreen: 'Settings'},
      }
    ))
  }

  const gotoUpdate = function() {
      // @ts-ignore
      navigation.navigate('Update', {
          isNativeUpdateAvailable, 
          isUpdateAvailable, 
          updateDescription,
          updateSize,
          prevScreen: 'Settings'
      })
  }

  const gotoNwc = function() {
    // @ts-ignore
    navigation.navigate('Nwc')
  } 

  const openNotificationSettings = async function() {
    if(Platform.OS === 'android') {
      await notifee.openNotificationSettings()        
    } else {
      const settings  = await notifee.requestPermission()
      if (settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED) {
        log.trace('iOS Permission settings:', settings)
        await messaging().registerDeviceForRemoteMessages()        
        const deviceToken = await messaging().getToken()
        if(deviceToken) {
          await walletProfileStore.setDevice(deviceToken)
        } 
      } else {
        log.trace('iOS user declined permissions')
      }
    }  
  }

  /* const gotoPreferredUnit = function() {
    Alert.alert('Preferred unit is set based on your Wallet screen.') 
  } */
  

  const getRateColor = function () {
    const currency = userSettingsStore.exchangeCurrency

    if (currency === CurrencyCode.BTC) {
        return colors.palette.orange600
    }

    if (currency === CurrencyCode.EUR) {
        return colors.palette.blue600
    }

    if (currency === CurrencyCode.USD) {
        return colors.palette.green400
    }

    return colors.palette.orange400
  }

  const onSelectCurrency = function(currency: CurrencyCode) {
    const currentCurrency = userSettingsStore.exchangeCurrency
    if(currentCurrency !== currency) {
      userSettingsStore.setExchangeCurrency(currency)
      walletStore.refreshExchangeRate(currency)
    }
    toggleCurrencyModal()  
  }
  
  const onResetCurrency = function() {
    const currentCurrency = userSettingsStore.exchangeCurrency
    if(currentCurrency !== null) {
      userSettingsStore.setExchangeCurrency(null)
      walletStore.resetExchangeRate()
    }
    toggleCurrencyModal()  
  }

  const onSelectTheme = async function(theme: ThemeCode) {    
    if(currentTheme !== theme) {
      try {        
        userSettingsStore.setNextTheme(theme)
        setCurrentTheme(theme)
        setInfo(translate('settingsScreen_restartTheme'))
      } catch (e: any) {
        log.warn('[onSelectTheme]', e.message)
      }
    }
    toggleThemeModal()  
  }

  const collapseHeader = function () {
      LayoutAnimation.easeInEaseOut()        
      setIsHeaderVisible(false)
      
  }

  const expandHeader = function () {
      LayoutAnimation.easeInEaseOut()
      setIsHeaderVisible(true)
  }

  const isCloseToBottom = function ({layoutMeasurement, contentOffset, contentSize}){
    return layoutMeasurement.height + contentOffset.y >= contentSize.height - 20
  }
 
  const isCloseToTop = function({layoutMeasurement, contentOffset, contentSize}){
      return contentOffset.y == 0;
  }

  const $itemRight = {color: useThemeColor('textDim')}
  const headerBg = useThemeColor('header')
  const headerTitle = useThemeColor('headerTitle')  
  const colorScheme = useColorScheme()
  const defaultThemeColor = colorScheme === 'dark' ? Themes[ThemeCode.DARK]?.color : Themes[ThemeCode.LIGHT]?.color
    
    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
          <View style={[isHeaderVisible ? $headerContainer : $headerCollapsed, {backgroundColor: headerBg}]}>
           <Text
            preset='heading'
            tx='settingsScreen_title'
            style={{color: headerTitle}}
          />
        </View>
        <ScrollView 
          style={$contentContainer}
        >
          <Card
            style={$card}
            ContentComponent={
              <>
                <ListItem
                    tx='manageMints'
                    leftIcon='faCoins'
                    leftIconColor={colors.palette.iconBlue300}
                    leftIconInverse={true}
                    RightComponent={
                        <View style={$rightContainer}>
                        <Text 
                            style={$itemRight}
                            text={translate('settingsScreen_mintsCount', {count: mintsStore.mintCount})}
                        />
                        </View>
                    }
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoMints}
                />
                <ListItem
                    tx='settingsScreen_exchangeCurrency'
                    leftIcon='faMoneyBill1'
                    leftIconColor={getRateColor() as string}
                    leftIconInverse={true}
                    style={$item}
                    RightComponent={
                      <View style={$rightContainer}>
                      <Text                          
                          tx={userSettingsStore.exchangeCurrency ? undefined : 'settingsScreen_currencyNone'}
                          text={userSettingsStore.exchangeCurrency ?? undefined}
                          style={$itemRight}
                      />
                      </View>
                    }        
                    bottomSeparator={true}            
                    onPress={toggleCurrencyModal}
                />
                <ListItem
                    tx='settingsScreen_theme'
                    leftIcon='faPaintbrush'
                    leftIconColor={currentTheme === ThemeCode.DEFAULT ? defaultThemeColor as string : Themes[currentTheme as ThemeCode]?.color as string}
                    leftIconInverse={true}
                    style={$item}
                    RightComponent={
                      <View style={$rightContainer}>
                      <Text                          
                          text={Themes[currentTheme]!.title}
                          style={$itemRight}
                      />
                      </View>
                    }
                    bottomSeparator={false}
                    onPress={toggleThemeModal}
                />
              </>
            }
          />
          <Card
            style={[$card, {marginTop: spacing.large}]}
            ContentComponent={
              <>
                <ListItem
                    tx="pushNotifications"
                    subText={`Token: ${walletProfileStore.device?.slice(0, 10)}...`}
                    leftIcon='faPaperPlane'
                    leftIconColor={colors.palette.focus200}
                    leftIconInverse={true}
                    style={$item}
                    RightComponent={
                      <View style={$rightContainer}>
                      <Text 
                          style={$itemRight}
                          tx={areNotificationsEnabled ? 'commonEnabled' : 'commonDisabled'}
                      />
                      </View>
                   }
                    bottomSeparator={true}
                    onPress={openNotificationSettings}
                  />
                  <ListItem
                    tx='settingsScreen_nwcTitle'
                    subText={translate('settingsScreen_nwcSubtext', {count: nwcStore.all.length})}
                    LeftComponent={
                    <View style={{
                      borderRadius: spacing.small,
                      padding: spacing.tiny, 
                      backgroundColor: 'white',
                      marginRight: spacing.small
                    }}
                    >
                      <SvgXml 
                        width={spacing.large} 
                        height={spacing.large} 
                        xml={NwcIcon}   
                        //style={{marginRight: spacing.small}}                     
                      />
                    </View>
                    }   
                    leftIconInverse={true}
                    style={$item}

                    bottomSeparator={true}
                    onPress={gotoNwc}
                />
                <ListItem
                    tx="nostr_relaysTitle"
                    subText={translate("commonConnectedParam", { param: relaysStore.connectedCount })}
                    leftIcon='faCircleNodes'
                    leftIconColor={colors.palette.iconViolet200}
                    leftIconInverse={true}
                    RightComponent={
                        <View style={$rightContainer}>
                        <Text
                            style={$itemRight}                         
                            text={translate('settingsScreen_relaysCount', {count: relaysStore.allRelays.length})}
                        />
                        </View>
                    }
                    style={$item}                  
                    onPress={gotoRelays}
                />
              </>
            }
          />
          <Card
            style={[$card, {marginTop: spacing.large}]}
            ContentComponent={
              <>
                <ListItem
                    tx='settingsScreen_backup'
                    leftIcon='faCloudArrowUp'
                    leftIconColor={colors.palette.success300}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoBackupOptions}
                />
                <ListItem
                    tx='settingsScreen_recovery'
                    leftIcon='faHeartPulse'
                    leftIconColor={colors.palette.angry300}
                    leftIconInverse={true}
                    style={$item}                    
                    onPress={gotoRecoveryOptions}
                />                
              </>
            }
          />
          <Card
            style={[$card, {marginVertical: spacing.large}]}
            ContentComponent={
              <>
                <ListItem
                    tx='settingsScreen_security'
                    leftIcon='faShieldHalved'
                    leftIconColor={colors.palette.iconGreyBlue400}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoSecurity}
                />
                <ListItem
                    tx='settingsScreen_privacy'
                    leftIcon='faEyeSlash'
                    leftIconColor={colors.palette.blue200}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoPrivacy}
                />
                <ListItem
                    tx='settingsScreen_update'     
                    leftIcon='faWandMagicSparkles'
                    leftIconColor={(isUpdateAvailable || isNativeUpdateAvailable) ? colors.palette.iconMagenta200 : colors.palette.neutral400}
                    leftIconInverse={true}
                    RightComponent={
                        <View style={$rightContainer}>
                        <Text
                            style={$itemRight}                         
                            tx={(isUpdateAvailable || isNativeUpdateAvailable) ? 'settingsScreen_updateAvailable' : undefined}
                        />
                        </View>
                    }
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoUpdate}
                />
                <ListItem
                    tx='settingsScreen_devOptions'
                    leftIcon='faCode'
                    leftIconColor={colors.palette.neutral600}
                    leftIconInverse={true}
                    style={$item}                  
                    onPress={gotoDevOptions}
                />
              </>
            }
          />
        </ScrollView>
        <BottomModal
          isVisible={isCurrencyModalVisible ? true : false}
          style={{alignItems: 'stretch'}}
          ContentComponent={  
            <>
            {[CurrencyCode.USD, CurrencyCode.EUR, CurrencyCode.CAD].map(code => 
              <ListItem 
                  key={code}  
                  LeftComponent={
                  <CurrencySign 
                    currencyCode={code}
                    containerStyle={{marginRight: spacing.large}}
                  />
                }            
                  text={Currencies[code]?.title}
                  onPress={() => onSelectCurrency(code)}
                  bottomSeparator={true}
              />
            )}
              <ListItem   
                  leftIcon='faXmark'           
                  tx='settingsScreen_doNotLoadRates'
                  onPress={onResetCurrency}
                  bottomSeparator={true}
              />
            </>      
          }
          onBackButtonPress={toggleCurrencyModal}
          onBackdropPress={toggleCurrencyModal}
        />
        <BottomModal
          isVisible={isThemeModalVisible ? true : false}
          style={{alignItems: 'stretch', padding: spacing.small}}
          ContentComponent={  
            <>
            {[ThemeCode.DEFAULT, ThemeCode.DARK, ThemeCode.LIGHT, ThemeCode.GOLDEN].map(code => 
              <ListItem 
                  key={code}  
                  leftIconColor={code === ThemeCode.DEFAULT ? defaultThemeColor as string : Themes[code as ThemeCode]?.color as string}
                  leftIconInverse={true} 
                  leftIcon='faPaintbrush'
                  text={Themes[code as ThemeCode]!.title}
                  onPress={() => onSelectTheme(code as ThemeCode)}
                  RightComponent={
                    <View style={$rightContainer}>
                      {currentTheme === code && (
                        <Icon icon='faCheckCircle' color={$itemRight.color} />
                      )}
                    </View>
                  }
                  bottomSeparator={true}
              />            
            )}              
            </>      
          }
          onBackButtonPress={toggleThemeModal}
          onBackdropPress={toggleThemeModal}
        />
        {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)

const $screen: ViewStyle = {

}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.15,
}

const $headerCollapsed: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.08,
}

const $contentContainer: TextStyle = {
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,
  
}

const $card: ViewStyle = {
    //paddingVertical: 0,
}

const $item: ViewStyle = {
  // paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginLeft: spacing.small,
}

