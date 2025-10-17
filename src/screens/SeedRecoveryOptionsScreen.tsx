import React from 'react'
import {observer} from 'mobx-react-lite'
import {ScrollView, View, ViewStyle} from 'react-native'
import {StaticScreenProps, useNavigation} from '@react-navigation/native'
import {Screen, Card, ListItem, Text} from '../components'
import {spacing, useThemeColor, colors} from '../theme'
import {useHeader} from '../utils/useHeader'
import {translate} from '../i18n'

type Props = StaticScreenProps<undefined>

export const SeedRecoveryOptionsScreen = observer(function SeedRecoveryOptionsScreen(_: Props) {
  const navigation = useNavigation<any>()

  useHeader({
    leftIcon: 'faArrowLeft',
    onLeftPress: () => navigation.goBack(),
  })

  // const headerTitle = translate('seedRecoveryOptions')
  const headerBackground = useThemeColor('header')
  const headerTitleColor = useThemeColor('headerTitle')

  const gotoImportBackup = () => {
    navigation.navigate('ImportBackup')
  }

  const gotoSeedRecovery = () => {
    navigation.navigate('SeedRecovery')
  }

  const gotoAddressRecovery = () => {
    navigation.navigate('RecoverWalletAddress')
  }

  return (
    <Screen preset="fixed" contentContainerStyle={$screen}>
      <View style={[$headerContainer, {backgroundColor: headerBackground}]}>
          <Text
            preset="heading"
            tx="seedRecoveryOptions"
            style={{color: 'white'}}
          />
      </View>
      <ScrollView style={$contentContainer}>
        <Card
          style={$card}
          ContentComponent={
            <>
              <ListItem
                tx="recoveryOptionsFromBackup"
                subTx="recoveryOptionsFromBackupDescription"
                leftIcon="faDownload"
                leftIconColor={colors.palette.focus300}
                leftIconInverse
                bottomSeparator
                style={$item}
                onPress={gotoImportBackup}
              />
              <ListItem
                tx="recoveryOptionsFromSeed"
                subTx="recoveryOptionsFromSeedDescription"
                leftIcon="faSeedling"
                leftIconColor={colors.palette.orange400}
                leftIconInverse
                style={$item}
                onPress={gotoSeedRecovery}
              />
              <ListItem
                tx="walletAddressRecovery"
                subTx="walletAddressRecoveryDesc"
                leftIcon="faCircleUser"
                leftIconColor={colors.palette.iconViolet300}
                leftIconInverse
                topSeparator
                style={$item}
                onPress={gotoAddressRecovery}
              />
            </>
          }
        />
      </ScrollView>
    </Screen>
  )
})

const $screen: ViewStyle = {}

const $headerContainer: ViewStyle = {
  alignItems: 'center',  
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.15,
}

const $contentContainer: ViewStyle = {
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}
