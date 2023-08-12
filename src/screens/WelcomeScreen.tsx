// import { observer } from "mobx-react-lite"
import React, {FC} from 'react'
import {
  ImageStyle,
  TextStyle,
  View,
  ViewStyle,
  useColorScheme,
  FlatList,
} from 'react-native'
// import { isRTL } from "../i18n"
import {useStores} from '../models'
import {AppStackScreenProps} from '../navigation'
import {useThemeColor, spacing, typography, colors} from '../theme'
import {useHeader} from '../utils/useHeader'
import {useSafeAreaInsetsStyle} from '../utils/useSafeAreaInsetsStyle'
import {
  Button,
  Icon,
  Screen,
  Text,
  TextField,
  TextFieldAccessoryProps,
} from '../components'
import {TxKeyPath} from '../i18n'

// const welcomeLogo = require("../../assets/images/logo.png")

export const WelcomeScreen: FC<AppStackScreenProps<'Welcome'>> =
  function WelcomeScreen(_props) {
    const {navigation} = _props

    useHeader({
      backgroundColor: useThemeColor('background'),
      StatusBarProps: {barStyle: 'dark-content'},
    })

    const {userSettingsStore} = useStores()

    const gotoWallet = function () {
      userSettingsStore.setIsOnboarded(true)
      navigation.navigate('Tabs', {})
    }

    const $bottomContainerInsets = useSafeAreaInsetsStyle(['bottom'])

    const warnings = [
      {id: '1', tx: 'welcomeScreen.warning1'},
      {id: '2', tx: 'welcomeScreen.warning2'},
      {id: '3', tx: 'welcomeScreen.warning3'},
      {id: '4', tx: 'welcomeScreen.warning4'},
    ]

    const renderWarningItem = ({item}: {item: {id: string; tx: string}}) => (
        <View style={$listItem}>
            <View style={$itemIcon}>
                <Icon
                icon="faCheckCircle"
                size={spacing.large}
                color={colors.palette.primary400}
                />
            </View>
            <Text
                tx={item.tx as TxKeyPath}
                style={{paddingHorizontal: spacing.small}}
                size='xs'
            />
        </View>
    )

    return (
        <Screen style={$container} preset="fixed">
            <View>
                <Text
                tx="welcomeScreen.heading"
                testID="welcome-heading"
                preset="heading"
                style={$welcomeHeading}
                />
                <Text
                tx="welcomeScreen.intro"
                preset="default"
                style={$welcomeIntro}
                />
                <View style={$listContainer}>
                    <FlatList
                        data={warnings}
                        renderItem={renderWarningItem}
                        keyExtractor={item => item.id}
                        contentContainerStyle={{paddingRight: spacing.small}}
                    />
                </View>
                <View style={{backgroundColor: colors.palette.accent500, borderRadius: spacing.extraSmall, padding: spacing.medium}}>
                    <Text size='xs' style={{color: 'white'}} text='Check for updates in Settings > Upload manager. During alpha testing, over-the-air updates fix critical bugs.'/>
                </View>
            </View>
            <View style={[$bottomContainer, $bottomContainerInsets]}>
                <Button
                testID="login-button"
                tx="welcomeScreen.go"
                preset="default"
                onPress={gotoWallet}
                />
            </View>
        </Screen>
    )
  }

const $container: ViewStyle = {
  alignItems: 'center',
  padding: spacing.medium,
}

const $listContainer: ViewStyle = {
    maxHeight: spacing.screenHeight * 0.4,    
}

const $listItem: ViewStyle = {
  flexDirection: 'row',
  paddingBottom: spacing.extraSmall,
  paddingRight: spacing.extraSmall,  
}

const $itemIcon: ViewStyle = {
  flexDirection: 'row',
  marginBottom: spacing.small,
}

const $bottomContainer: ViewStyle = {
  flex: 1,
  justifyContent: 'flex-end',
  marginBottom: spacing.large,
  alignSelf: 'stretch',
}

const $welcomeHeading: TextStyle = {
  marginBottom: spacing.medium,
}

const $welcomeIntro: TextStyle = {
  marginBottom: spacing.large,
}
