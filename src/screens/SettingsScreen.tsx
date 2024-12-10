import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {AppState, TextStyle, View, ViewStyle, useColorScheme} from 'react-native'
import notifee from '@notifee/react-native'
import messaging from '@react-native-firebase/messaging'
import {
    APP_ENV,      
    CODEPUSH_STAGING_DEPLOYMENT_KEY,
    CODEPUSH_PRODUCTION_DEPLOYMENT_KEY,
} from '@env'
import codePush, { RemotePackage } from 'react-native-code-push'
import {ThemeCode, Themes, colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
import {ListItem, Screen, Text, Card, NwcIcon, Button, BottomModal, InfoModal, Icon} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {translate} from '../i18n'
import { Database, log } from '../services'
import {Env} from '../utils/envtypes'
import { round } from '../utils/number'
import { Currencies, CurrencyCode, getCurrency } from '../services/wallet/currency'
import { getMintColor } from './WalletScreen'
import { NotificationService } from '../services/notificationService'
import { SvgXml } from 'react-native-svg'
import { CurrencySign } from './Wallet/CurrencySign'
import { CommonActions } from '@react-navigation/native'


interface SettingsScreenProps extends SettingsStackScreenProps<'Settings'> {}

const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY

export const SettingsScreen: FC<SettingsScreenProps> = observer(
  function SettingsScreen(_props) {
    const {navigation} = _props
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
    const [info, setInfo] = useState('')

    useEffect(() => {
        const checkForUpdate = async () => {
            try {
                const update = await codePush.checkForUpdate(deploymentKey, handleBinaryVersionMismatchCallback)
                if (update && update.failedInstall !== true) {  // do not announce update that failed to install before
                    setUpdateDescription(update.description)
                    setUpdateSize(`${round(update.packageSize *  0.000001, 2)}MB`)                  
                    setIsUpdateAvailable(true)
                }
                
            } catch (e: any) {
                log.info(e.name, e.message)
                return false // silent
            }
        } 
        checkForUpdate()
    }, [])


    useEffect(() => {
      const getNotificationPermission = async () => {
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
      getNotificationPermission()
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
                
                // Make sure profile has already been created (i.e. this is not first run)
                if(walletProfileStore.pubkey && deviceToken) {
                    // if device token changed, update the server
                    if(deviceToken !== walletProfileStore.device) {
                        await walletProfileStore.setDevice(deviceToken)
                    }
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

  const handleBinaryVersionMismatchCallback = function(update: RemotePackage) {            
    // silent
    // setIsNativeUpdateAvailable(true)
  }

  const gotoMints = function() {
    navigation.navigate('Mints', {})
  }

  const gotoSecurity = function() {
    navigation.navigate('Security')
  }    
    
  const gotoPrivacy = function() {
      navigation.navigate('Privacy')
  }

  const gotoDevOptions = function() {
    navigation.navigate('Developer')
  }

  const gotoRelays = function() {
      navigation.navigate('Relays')
    }

  const gotoBackupOptions = function() {
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
      navigation.navigate('Update', {
          isNativeUpdateAvailable, 
          isUpdateAvailable, 
          updateDescription,
          updateSize
      })
  }

  const gotoNwc = function() {
    navigation.navigate('Nwc')
  } 

  const openNotificationSettings = async function() {
      await notifee.openNotificationSettings()        
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
        // state update causes crash because of hooks
        Database.updateUserSettings({...userSettingsStore, theme})
        setCurrentTheme(theme)
        setInfo('Restart the wallet to apply new theme.')
      } catch (e: any) {
        log.warn('[onSelectTheme]', e.message)
      }
    }
    toggleThemeModal()  
  }

  const $itemRight = {color: useThemeColor('textDim')}
  const headerBg = useThemeColor('header')
  const headerTitle = useThemeColor('headerTitle')  
  const colorScheme = useColorScheme()
  const defaultThemeColor = colorScheme === 'dark' ? Themes[ThemeCode.DARK]?.color : Themes[ThemeCode.LIGHT]?.color
    
    return (
      <Screen contentContainerStyle={$screen} preset='auto'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset='heading'
            tx='settingsScreen.title'
            style={{color: headerTitle}}
          />
        </View>
        <View style={$contentContainer}>
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
                            text={translate('settingsScreen.mintsCount', {count: mintsStore.mintCount})}
                        />
                        </View>
                    }
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoMints}
                />
                <ListItem
                    tx='settingsScreen.exchangeCurrency'
                    leftIcon='faMoneyBill1'
                    leftIconColor={getRateColor() as string}
                    leftIconInverse={true}
                    style={$item}
                    RightComponent={
                      <View style={$rightContainer}>
                      <Text                          
                          text={userSettingsStore.exchangeCurrency ?? 'None'}
                          style={$itemRight}
                      />
                      </View>
                    }        
                    bottomSeparator={true}            
                    onPress={toggleCurrencyModal}
                />
                <ListItem
                    tx='settingsScreen.theme'
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
                          tx={areNotificationsEnabled ? 'common.enabled' : 'common.disabled'}
                      />
                      </View>
                   }
                    bottomSeparator={true}
                    onPress={openNotificationSettings}
                />
                <ListItem
                    text='Nostr Wallet Connect'
                    subText={`${nwcStore.all.length} allowed app${nwcStore.all.length > 1 ? 's' : ''}`}                 
                    LeftComponent={
                    <View style={{
                      borderRadius: spacing.small,
                      padding: spacing.tiny, 
                      backgroundColor: 'white',
                      marginRight: spacing.medium
                    }}
                    >
                      <SvgXml 
                        width={spacing.large} 
                        height={spacing.large} 
                        xml={NwcIcon}   
                        style={{}}                     
                      />
                    </View>
                    }   
                    leftIconInverse={true}
                    style={$item}

                    bottomSeparator={true}
                    onPress={gotoNwc}
                />
                <ListItem
                    tx="nostr.relaysTitle"
                    subText={translate("common.connectedParam", { param: relaysStore.connectedCount })}
                    leftIcon='faCircleNodes'
                    leftIconColor={colors.palette.iconViolet200}
                    leftIconInverse={true}
                    RightComponent={
                        <View style={$rightContainer}>
                        <Text
                            style={$itemRight}                         
                            text={`${relaysStore.allRelays.length} relays`}
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
                    text='Backup'
                    leftIcon='faCloudArrowUp'
                    leftIconColor={colors.palette.success300}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoBackupOptions}
                />
                <ListItem
                    text='Recovery'
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
            style={[$card, {marginTop: spacing.large}]}
            ContentComponent={
              <>
                <ListItem
                    tx='settingsScreen.security'
                    leftIcon='faShieldHalved'
                    leftIconColor={colors.palette.iconGreyBlue400}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoSecurity}
                />
                <ListItem
                    tx='settingsScreen.privacy'
                    leftIcon='faEyeSlash'
                    leftIconColor={colors.palette.blue200}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoPrivacy}
                />
                <ListItem
                    tx='settingsScreen.update'     
                    leftIcon='faWandMagicSparkles'
                    leftIconColor={(isUpdateAvailable || isNativeUpdateAvailable) ? colors.palette.iconMagenta200 : colors.palette.neutral400}
                    leftIconInverse={true}
                    RightComponent={
                        <View style={$rightContainer}>
                        <Text
                            style={$itemRight}                         
                            text={(isUpdateAvailable || isNativeUpdateAvailable) ? '1 update' : ''}
                        />
                        </View>
                    }
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoUpdate}
                />
                <ListItem
                    tx='settingsScreen.devOptions'
                    leftIcon='faCode'
                    leftIconColor={colors.palette.neutral600}
                    leftIconInverse={true}
                    style={$item}                  
                    onPress={gotoDevOptions}
                />
              </>
            }
          />
          
        </View>
        <BottomModal
          isVisible={isCurrencyModalVisible ? true : false}
          style={{alignItems: 'stretch'}}
          ContentComponent={  
            <>
            {[CurrencyCode.USD, CurrencyCode.EUR].map(code => 
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
                  text={'Do not load exchange rates'}
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
  // flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
  // flex: 1,
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,
  // alignItems: 'center',
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

