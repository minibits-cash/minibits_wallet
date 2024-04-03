import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useState} from 'react'
import {FlatList, TextStyle, View, ViewStyle} from 'react-native'
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


interface SettingsScreenProps extends SettingsStackScreenProps<'Settings'> {}

const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY

export const SettingsScreen: FC<SettingsScreenProps> = observer(
  function SettingsScreen(_props) {
    const {navigation} = _props
    useHeader({}) // default header component
    const {mintsStore, relaysStore} = useStores()

    const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false)
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
                }
                
            } catch (e: any) {
                log.info(e.name, e.message)
                return false // silent
            }
        } 
        checkForUpdate()
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
                    tx='settingsScreen.manageMints'
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
                    tx='settingsScreen.backupRecovery'
                    leftIcon='faCloudArrowUp'
                    leftIconColor={colors.palette.success300}
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
                    leftIconColor={colors.palette.accent300}
                    leftIconInverse={true}
                    style={$item}                  
                    onPress={gotoDevOptions}
                />
              </>
            }
          />
          <Card
            style={[$card, {marginTop: spacing.large}]}
            ContentComponent={
                <ListItem
                    text={'Nostr relays'}
                    subText={`Connected: ${relaysStore.connectedCount}`}
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
            }
        />
        </View>
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.18,
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

