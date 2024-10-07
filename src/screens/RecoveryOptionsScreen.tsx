import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback, useEffect} from 'react'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import {spacing, useThemeColor, colors} from '../theme'
import {AppStackScreenProps, SettingsStackScreenProps, WalletStackScreenProps} from '../navigation'
import {
  Button,
  Icon,
  Card,
  Screen,
  ListItem,
  Text,
} from '../components'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import AppError from '../utils/AppError'

export enum RecoveryOption {
    SEND_TOKEN = 'SEND_TOKEN',
    PASTE_OR_SCAN_INVOICE = 'PASTE_OR_SCAN_INVOICE',
    SHOW_TOKEN = 'SHOW_TOKEN',
    PAY_PAYMENT_REQUEST = 'PAY_PAYMENT_REQUEST',
    LNURL_PAY = 'LNURL_PAY',
    LNURL_ADDRESS = 'LNURL_ADDRESS',
    DONATION = 'DONATION',
}

export const RecoveryOptionsScreen: FC<AppStackScreenProps<'RecoveryOptions'>> = observer(
  function RecoveryOptionsScreen({route, navigation}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })
 
    const [error, setError] = useState<AppError | undefined>()

    const gotoRemoteRecovery = function () {
        navigation.navigate('RemoteRecovery', {isAddressRecovery: false})
    }


    const gotoLocalRecovery = function () {
        navigation.navigate('LocalRecovery')
    }




    const handleError = function (e: AppError): void {
      log.error(e.name, e.message)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    const subtitleColor = useThemeColor('textDim')

    return (
      <Screen preset="auto" contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            <Text
              preset="heading"
              tx="recoveryOptions.title"
              style={{color: 'white'}}
            />
        </View>
        <View style={$contentContainer}>                  
            <Card
                style={$ecashCard}
                ContentComponent={
                    <>
                    <ListItem
                        tx="recoveryOptions.local"
                        subTx="recoveryOptions.localDescription"
                        leftIcon='faDownload'
                        leftIconColor={colors.palette.focus300}
                        leftIconInverse={true}
                        style={$item}
                        bottomSeparator={true}
                        onPress={gotoLocalRecovery}
                    />                 
                    <ListItem
                        tx="recoveryOptions.remote"
                        subTx="recoveryOptions.remoteDescription"
                        leftIcon='faUpRightFromSquare'
                        leftIconColor={colors.palette.blue200}
                        leftIconInverse={true}                        
                        style={$item}
                        onPress={gotoRemoteRecovery}
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
  height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
  // flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $ecashCard: ViewStyle = {
  marginTop: -spacing.extraLarge * 2,
  marginBottom: spacing.small,
  // paddingTop: 0,
}

const $lightningCard: ViewStyle = {
    marginVertical: spacing.small,    
    // paddingTop: 0,
  }

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}
