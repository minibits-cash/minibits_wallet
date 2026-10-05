import {observer} from 'mobx-react-lite'
import React, {useState} from 'react'
import {ScrollView, Switch, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {
  ListItem,
  Screen,
  Text,
  Card,
  ErrorModal,
  Header,
} from '../components'
import AppError from '../utils/AppError'
import { useNavigation } from '@react-navigation/native'
import { useStores } from '../models'
import { translate } from '../i18n'
import { CollapsibleText } from '../components/CollapsibleText'

export const OptimizeOptionsScreen = observer(function () {
    const navigation = useNavigation()
    const {userSettingsStore} = useStores()

    const [error, setError] = useState<AppError | undefined>()

    const gotoOptimizeEcash = function () {
      //@ts-ignore
      navigation.navigate('OptimizeEcash')
    }

    const toggleBatchClaimSwitch = () => {
      try {
        userSettingsStore.setIsBatchClaimOn(!userSettingsStore.isBatchClaimOn)
      } catch (e: any) {
        setError(e)
      }
    }

    const headerBg = useThemeColor('header')
    const headerTitle = useThemeColor('headerTitle')
    const $subText = {color: useThemeColor('textDim'), fontSize: 14}

    return (
      <Screen preset='fixed' contentContainerStyle={$screen}>
        <Header
            leftIcon='faArrowLeft'
            onLeftPress={() => navigation.goBack()}
        />
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" tx="settingsScreen_optimizeEcash" style={{color: headerTitle}} />
        </View>
        <ScrollView style={$contentContainer}>
            <Card
                style={$card}
                HeadingComponent={
                  <ListItem
                    tx="optimizeOptions_ecash"
                    subTx="optimizeOptions_ecashDesc"
                    leftIcon='faWandMagicSparkles'
                    leftIconColor={colors.palette.gold200}
                    leftIconInverse={true}
                    style={$item}
                    onPress={gotoOptimizeEcash}
                  />
                }
            />
            <Card
                style={$card}
                HeadingComponent={
                  <ListItem
                    tx='profileScreen_batchReceive'
                    leftIcon='faCubes'
                    leftIconColor={colors.palette.iconGreyBlue400}
                    leftIconInverse={true}
                    style={$item}
                    RightComponent={
                      <View style={$rightContainer}>
                        <Switch
                          onValueChange={toggleBatchClaimSwitch}
                          value={userSettingsStore.isBatchClaimOn}
                        />
                      </View>
                    }
                    BottomComponent={
                      <CollapsibleText
                        collapsed={true}
                        text={translate('profileScreen_batchReceiveDesc')}
                        textProps={{style: $subText}}
                      />
                    }
                  />
                }
            />
        </ScrollView>
        {error && <ErrorModal error={error} />}
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  flex: 1
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.15,
}

const $contentContainer: TextStyle = {
  marginTop: -spacing.extraLarge * 1.5,
  padding: spacing.extraSmall,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginLeft: spacing.small,
}
