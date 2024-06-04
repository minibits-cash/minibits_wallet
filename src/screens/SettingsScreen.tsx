import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useRef, useState} from 'react'
import {Alert, AppState, FlatList, Switch, TextStyle, View, ViewStyle} from 'react-native'
import notifee from '@notifee/react-native'
import messaging from '@react-native-firebase/messaging'
import {
    APP_ENV,      
    CODEPUSH_STAGING_DEPLOYMENT_KEY,
    CODEPUSH_PRODUCTION_DEPLOYMENT_KEY,
} from '@env'
import codePush, { RemotePackage } from 'react-native-code-push'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
import {Icon, ListItem, Screen, Text, Card} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {translate} from '../i18n'
import { log } from '../services'
import {Env} from '../utils/envtypes'
import { round } from '../utils/number'
import { getCurrency } from '../services/wallet/currency'
import { getMintColor } from './WalletScreen'
import { NotificationService } from '../services/notificationService'


interface SettingsScreenProps extends SettingsStackScreenProps<'Settings'> {}

const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY

export const SettingsScreen: FC<SettingsScreenProps> = observer(
  function SettingsScreen(_props) {
    const {navigation} = _props
    useHeader({}) // default header component
    const appState = useRef(AppState.currentState)
    const {mintsStore, relaysStore, userSettingsStore, walletProfileStore} = useStores()

    const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false)
    const [updateDescription, setUpdateDescription] = useState<string>('')    
    const [updateSize, setUpdateSize] = useState<string>('')
    const [isNativeUpdateAvailable, setIsNativeUpdateAvailable] = useState<boolean>(false)
    const [areNotificationsEnabled, setAreNotificationsEnabled] = useState<boolean>(false)

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

    const gotoBackupRestore = function() {
      navigation.navigate('Backup')
    }

    const gotoUpdate = function() {
        navigation.navigate('Update', {
            isNativeUpdateAvailable, 
            isUpdateAvailable, 
            updateDescription,
            updateSize
        })
    }

    const openNotificationSettings = async function() {
        await notifee.openNotificationSettings()        
    }

    const gotoPreferredUnit = function() {
      Alert.alert('Preferred unit is set based on your Wallet screen.') 
    }

    const $itemRight = {color: useThemeColor('textDim')}
    const headerBg = useThemeColor('header')
    
    return (
      <Screen contentContainerStyle={$screen} preset='auto'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset='heading'
            tx='settingsScreen.title'
            style={{color: 'white'}}
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
                    tx='settingsScreen.preferredUnit'
                    leftIcon='faMoneyBill1'
                    leftIconColor={getMintColor(userSettingsStore.preferredUnit)}
                    leftIconInverse={true}
                    style={$item}
                    RightComponent={
                      <View style={$rightContainer}>
                      <Text 
                          style={$itemRight}
                          text={getCurrency(userSettingsStore.preferredUnit).code}
                      />
                      </View>
                    }
                    bottomSeparator={false}
                    onPress={gotoPreferredUnit}
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
                    leftIconColor={colors.palette.green400}
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
                    tx='settingsScreen.backupRecovery'
                    leftIcon='faCloudArrowUp'
                    leftIconColor={colors.palette.angry300}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoBackupRestore}
                />
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

