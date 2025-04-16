import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Linking, Platform, ScrollView, Switch, TextStyle, View, ViewStyle} from 'react-native'
import {
    APP_ENV,      
    CODEPUSH_STAGING_DEPLOYMENT_KEY,
    CODEPUSH_PRODUCTION_DEPLOYMENT_KEY, 
} from '@env'
// import codePush from "react-native-code-push"
import {colors, spacing, useThemeColor} from '../theme'
import {
  Icon,
  ListItem,
  Screen,
  Text,
  Card,
  Loading,
  ErrorModal,
  InfoModal,  
  Button,
} from '../components'
import {useHeader} from '../utils/useHeader'
import AppError from '../utils/AppError'
import { log } from '../services'
import {Env} from '../utils/envtypes'
import { CommonActions, StaticScreenProps, useNavigation } from '@react-navigation/native'
import { translate } from '../i18n'


const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY

type Props = StaticScreenProps<{
    isNativeUpdateAvailable: boolean, 
    isUpdateAvailable: boolean, 
    updateDescription: string,
    updateSize: string
    prevScreen: 'Settings' | 'Wallet'
}>

export const UpdateScreen = observer(function UpdateScreen({ route }: Props) {
    const navigation = useNavigation()
    const {
        isUpdateAvailable, 
        isNativeUpdateAvailable,
        updateDescription,
        updateSize,
        prevScreen
    } = route.params   

    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {
            navigation.setParams({isUpdateAvailable: undefined})
            navigation.setParams({isNativeUpdateAvailable: undefined})
            navigation.setParams({updateDescription: undefined})
            navigation.setParams({updateSize: undefined})

            if(prevScreen === 'Settings') {
                navigation.goBack()
            } else {
                navigation.dispatch(                
                    CommonActions.reset({
                        index: 1,
                        routes: [{
                            name: 'WalletNavigator'
                        }]
                    })
                )
            } 
        },
    })

    // const {userSettingsStore} = useStores()

    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()


    const handleUpdate = function (): void {
        /*try {
            codePush.sync({
                deploymentKey,
                rollbackRetryOptions: {
                    delayInHours: 1,
                    maxRetryAttempts: 3
                },
                installMode: codePush.InstallMode.IMMEDIATE,
                
            },
            (status) => {
                switch (status) {
                    case codePush.SyncStatus.DOWNLOADING_PACKAGE:
                        log.trace('Downloading update...')
                        setInfo(translate("updateScreen.downloading"))
                        break
                    case codePush.SyncStatus.INSTALLING_UPDATE:
                        log.trace('Installing update...')
                        setInfo(translate("updateScreen.installing"))
                        break
                }
            })
        } catch (e: any) {
            handleError(e)
        }*/
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

    const gotoGithub = () => {       
        Linking.openURL('https://github.com/minibits-cash/minibits_wallet/releases')
    }


    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const headerTitle = useThemeColor('headerTitle')

    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" tx="updateScreen.updateManagerTitle" style={{color: headerTitle}} />
        </View>
        <ScrollView style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
            <>
                {isUpdateAvailable && (
                    <>
                    <ListItem
                        tx='updateScreen.updateAvailable'
                        subTx='updateScreen.updateAvailableDesc'
                        leftIcon='faWandMagicSparkles'
                        leftIconColor={colors.palette.iconMagenta200}
                        leftIconInverse={true}                  
                        style={$item}
                    />                    
                    <ListItem
                        tx='updateScreen.updateNew'
                        subText={updateDescription || translate("updateScreen.defaultUpdateDesc")}
                        leftIcon='faInfoCircle'
                        leftIconColor={colors.palette.neutral500}
                        topSeparator={true}                   
                        style={$item}
                    />                    
                    <ListItem
                        tx='updateScreen.updateSize'
                        subText={updateSize || '1.0MB'}
                        leftIcon='faDownload'
                        leftIconColor={colors.palette.neutral500}                         
                        topSeparator={true}                   
                        style={$item}
                    />
                    </>
                )}
                {isNativeUpdateAvailable && (
                <ListItem
                    tx='updateScreen.updateAvailable'
                    subTx={'updateScreen.nativeUpdateAvailableDesc'}
                    leftIcon='faWandMagicSparkles'
                    leftIconColor={colors.palette.iconMagenta200}
                    leftIconInverse={true}                    
                    style={$item}
                />)}
                {(!isUpdateAvailable && !isNativeUpdateAvailable) && (
                    <ListItem
                        tx='updateScreen.updateNotAvailable'
                        subTx={'updateScreen.updateNotAvailableDesc'}                                       
                        leftIcon='faInfoCircle'
                        leftIconColor={colors.palette.neutral500}
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
                    <View style={$buttonContainer}>
                    <Button
                        onPress={gotoPlayStore}
                        tx='updateScreen.gotoPlayStore'
                        style={{marginTop: spacing.medium, marginRight: spacing.small}}
                    />
                    <Button
                        onPress={gotoGithub}
                        tx="updateScreen.apkOnGithub"
                        preset='secondary'
                        style={{marginTop: spacing.medium}}
                    />
                    </View>
                )}
             </>   
            }
          />
          {isLoading && <Loading />}
        </ScrollView>        
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}      
      </Screen>
    )
  })

const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.20,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.medium,
}

const $contentContainer: TextStyle = {  
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,  
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
