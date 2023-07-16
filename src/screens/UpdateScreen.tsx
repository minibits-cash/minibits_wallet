import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Linking, Platform, Switch, TextStyle, View, ViewStyle} from 'react-native'
import {
    APP_ENV,      
    CODEPUSH_STAGING_DEPLOYMENT_KEY,
    CODEPUSH_PRODUCTION_DEPLOYMENT_KEY, 
} from '@env'
import codePush from "react-native-code-push"
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
import {
  Icon,
  ListItem,
  Screen,
  Text,
  Card,
  Loading,
  ErrorModal,
  InfoModal,
  BottomModal,
  Button,
} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import { Env, log } from '../utils/logger'

const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY


export const UpdateScreen: FC<SettingsStackScreenProps<'Update'>> = observer(function UpdateScreen(_props) {
    const {navigation, route} = _props
    const {
        isUpdateAvailable, 
        isNativeUpdateAvailable
    } = route.params


    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    // const {userSettingsStore} = useStores()

    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()


    const handleUpdate = function (): void {
        try {
        codePush.sync({
            deploymentKey,
            updateDialog: {
                appendReleaseDescription: true,
                descriptionPrefix: "\n\nChange log:\n"
            },
            installMode: codePush.InstallMode.IMMEDIATE
         })
        } catch (e: any) {
            handleError(e)
        }
    }


    const gotoPlayStore = () => {
        const packageName = 'com.minibits_wallet'; // Replace with your app's package name
      
        // Determine the URL based on the user's platform (Android or iOS)
        let url = ''
        if (Platform.OS === 'android') {
          url = `market://details?id=${packageName}`
        } else if (Platform.OS === 'ios') {
          url = `itms-apps://itunes.apple.com/app/${packageName}`
        }
      
        // Open the URL in the device's default app for handling URLs (e.g., Play Store)
        Linking.openURL(url)
    }


    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')

    return (
      <Screen style={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Update manager" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
            <>
                {isUpdateAvailable && (
                <ListItem
                    tx='updateScreen.updateAvailable'
                    subTx={'updateScreen.updateAvailableDesc'}
                    LeftComponent={
                    <Icon
                        icon={'faWandMagicSparkles'}
                        size={spacing.medium}
                        color={
                            colors.palette.iconMagenta200
                        }
                        inverse={true}
                    />
                    }                    
                    style={$item}
                />)}
                {isNativeUpdateAvailable && (
                <ListItem
                    tx='updateScreen.updateAvailable'
                    subTx={'updateScreen.nativeUpdateAvailableDesc'}
                    LeftComponent={
                    <Icon
                        icon={'faWandMagicSparkles'}
                        size={spacing.medium}
                        color={
                            colors.palette.iconMagenta200
                        }
                        inverse={true}
                    />
                    }                    
                    style={$item}
                />)}
                {(!isUpdateAvailable && !isNativeUpdateAvailable) && (
                    <ListItem
                        tx='updateScreen.updateNotAvailable'
                        subTx={'updateScreen.updateNotAvailableDesc'}                                       
                        style={$item}
                    />                                    
                )}
            </>
            }
            FooterComponent={
             <>
                {isUpdateAvailable && (
                    <Button
                    onPress={handleUpdate}                        
                    tx='updateScreen.updateNow'
                    style={{alignSelf: 'center', marginTop: spacing.medium}}
                />
                )}
                {isNativeUpdateAvailable && (
                    <Button
                        onPress={gotoPlayStore}
                        tx='updateScreen.gotoPlayStore'
                        style={{alignSelf: 'center', marginTop: spacing.medium}}
                    />
                )}
             </>   
            }
          />
          {isLoading && <Loading />}
        </View>        
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}      
      </Screen>
    )
  })

const $screen: ViewStyle = {}

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
  marginBottom: 0,
}

const $bottomModal: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.large,
  paddingHorizontal: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  // padding: spacing.extraSmall,
  alignSelf: 'center',
  //marginLeft: spacing.small,
}
