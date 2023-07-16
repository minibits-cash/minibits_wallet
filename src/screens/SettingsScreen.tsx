import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {TextStyle, View, ViewStyle} from 'react-native'
import {
    APP_ENV,      
    CODEPUSH_STAGING_DEPLOYMENT_KEY,
    CODEPUSH_PRODUCTION_DEPLOYMENT_KEY, 
} from '@env'
import codePush, { RemotePackage } from "react-native-code-push"
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
import {Icon, ListItem, Screen, Text, Card} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {translate} from '../i18n'
import { Env, log } from '../utils/logger'
import { BackupScreen } from './BackupScreen'

interface SettingsScreenProps extends SettingsStackScreenProps<'Settings'> {}

const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY

export const SettingsScreen: FC<SettingsScreenProps> = observer(
  function SettingsScreen(_props) {
    const {navigation} = _props
    useHeader({}) // default header component
    const {mintsStore} = useStores()

    const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false)
    const [updateDescription, setUpdateDescription] = useState<string>('')
    const [isNativeUpdateAvailable, setIsNativeUpdateAvailable] = useState<boolean>(false)

    useEffect(() => {
        const checkForUpdate = async () => {
            try {
                const update = await codePush.checkForUpdate(deploymentKey, handleBinaryVersionMismatchCallback)
                if (update && update.failedInstall !== true) {  // do not announce update that failed to install before
                    setUpdateDescription(update.description)                  
                    setIsUpdateAvailable(true)
                }
                log.info('update', update, 'checkForUpdate')
            } catch (e: any) {
                log.info(e.name, e.message)
                return false // silent
            }
        } 
        checkForUpdate()
      }, [])

    const handleBinaryVersionMismatchCallback = function(update: RemotePackage) {    
        log.info('handleBinaryVersionMismatchCallback', [true, update], 'handleBinaryVersionMismatchCallback')    
        setIsNativeUpdateAvailable(true)
    }

    const gotoMints = function() {
      navigation.navigate('Mints', {})
    }

    const gotoSecurity = function() {
      navigation.navigate('Security')
    }

    const gotoDevOptions = function() {
      navigation.navigate('Developer')
    }

    const gotoBackupRestore = function() {
      navigation.navigate('Backup')
    }

    const gotoUpdate = function() {
        navigation.navigate('Update', {
            isNativeUpdateAvailable, 
            isUpdateAvailable, 
            updateDescription
        })
    }

    const $itemRight = {color: useThemeColor('textDim')}
    const headerBg = useThemeColor('header')
    
    return (
      <Screen style={$screen} preset="auto">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="heading"
            tx="settingsScreen.title"
            style={{color: 'white'}}
          />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
              <>
                <ListItem
                  tx="settingsScreen.manageMints"
                  LeftComponent={
                    <Icon
                      icon="faCoins"
                      size={spacing.medium}
                      color={colors.palette.iconBlue300}
                      inverse={true}
                    />
                  }
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
                  tx="settingsScreen.backupRecovery"
                  LeftComponent={
                    <Icon
                      icon="faCloudArrowUp"
                      size={spacing.medium}
                      color={colors.palette.success300}
                      inverse={true}
                    />
                  }
                  style={$item}
                  bottomSeparator={true}
                  onPress={gotoBackupRestore}
                />
                <ListItem
                  tx="settingsScreen.security"
                  LeftComponent={
                    <Icon
                      icon="faShieldHalved"
                      size={spacing.medium}
                      color={colors.palette.iconGreyBlue400}
                      inverse={true}
                    />
                  }
                  style={$item}
                  bottomSeparator={true}
                  onPress={gotoSecurity}
                />
                <ListItem
                  tx="settingsScreen.update"                  
                  LeftComponent={
                    <Icon
                      icon="faWandMagicSparkles"
                      size={spacing.medium}
                      color={(isUpdateAvailable || isNativeUpdateAvailable) ? colors.palette.iconMagenta200 : colors.palette.neutral400}
                      inverse={true}
                    />
                  }
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
                  tx="settingsScreen.devOptions"
                  LeftComponent={
                    <Icon
                      icon="faCode"
                      size={spacing.medium}
                      color={colors.palette.accent300}
                      inverse={true}
                    />
                  }
                  style={$item}
                  // bottomSeparator={true}
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
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.1,
}

const $contentContainer: TextStyle = {
  // flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $card: ViewStyle = {
  // marginVertical: 0,
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

