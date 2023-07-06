import {observer} from 'mobx-react-lite'
import React, {FC} from 'react'
import {TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
import {Icon, ListItem, Screen, Text, Card} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {translate} from '../i18n'

interface SettingsScreenProps extends SettingsStackScreenProps<'Settings'> {}

export const SettingsScreen: FC<SettingsScreenProps> = observer(
  function SettingsScreen(_props) {
    const {navigation} = _props
    useHeader({}) // default header component
    const {mintsStore} = useStores()

    function gotoMints() {
      navigation.navigate('Mints')
    }

    function gotoSecurity() {
      navigation.navigate('Security')
    }

    function gotoDevOptions() {
      navigation.navigate('Developer')
    }

    function gotoBackupRestore() {
      navigation.navigate('Backup')
    }

    const $itemRight = {color: useThemeColor('textDim')}
    const headerBg = useThemeColor('header')

    return (
      <Screen style={$screen}>
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
