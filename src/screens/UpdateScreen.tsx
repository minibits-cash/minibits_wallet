import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Linking, Platform, ScrollView, Switch, TextStyle, View, ViewStyle} from 'react-native'
import {
    APP_ENV,
    HOT_UPDATER_API_KEY,
    HOT_UPDATER_URL,      
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
  BottomModal,
} from '../components'
import {useHeader} from '../utils/useHeader'
import AppError, { Err } from '../utils/AppError'
import { log } from '../services'
import {Env} from '../utils/envtypes'
import { CommonActions, StaticScreenProps, useNavigation } from '@react-navigation/native'
import { translate } from '../i18n'
import { HotUpdater, useHotUpdaterStore } from '@hot-updater/react-native'
import { ResultModalInfo } from './Wallet/ResultModalInfo'


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

    const { progress, isBundleUpdated } = useHotUpdaterStore()

    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {
            //@ts-ignore
            navigation.setParams({isUpdateAvailable: undefined})
            //@ts-ignore
            navigation.setParams({isNativeUpdateAvailable: undefined})
            //@ts-ignore
            navigation.setParams({updateDescription: undefined})
            //@ts-ignore
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

    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isUpdateModalVisible, setIsUpdateModalVisible] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    const toggleUpdateModal = () => {
        setIsUpdateModalVisible(previousState => !previousState)
    }

    const handleUpdate = async function () {
        try {
            setIsUpdateModalVisible(true)
            const updateInfo = await HotUpdater.checkForUpdate({
                source: HOT_UPDATER_URL,
                requestHeaders: {
                    Authorization: `Bearer ${HOT_UPDATER_API_KEY}`,
                },
            })

            if (!updateInfo) {
                throw new AppError(Err.NETWORK_ERROR, 'Could not retrieve update information')
            }

            await HotUpdater.updateBundle(updateInfo.id, updateInfo.fileUrl)
            HotUpdater.reload()

        } catch(e: any) {
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

    const gotoGithub = () => {       
        Linking.openURL('https://github.com/minibits-cash/minibits_wallet/releases')
    }


    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setIsUpdateModalVisible(false)
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
                    {/*<ListItem
                        tx='updateScreen.updateSize'
                        subText={updateSize || '1.0MB'}
                        leftIcon='faDownload'
                        leftIconColor={colors.palette.neutral500}                         
                        topSeparator={true}                   
                        style={$item}
                    />*/}
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
        <BottomModal
            isVisible={isUpdateModalVisible ? true : false}
            style={{alignItems: 'stretch', padding: spacing.small}}
            ContentComponent={  
                <ResultModalInfo 
                    icon='faDownload'
                    iconColor={colors.palette.accent400}
                    title={`${Math.round(progress * 100)}%`}
                    message='Update is in progress...'
                />     
            }
            onBackButtonPress={toggleUpdateModal}
            onBackdropPress={toggleUpdateModal}
        /> 
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}      
      </Screen>
    )
  })

const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.15,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.medium,
}

const $contentContainer: TextStyle = {  
    flex: 1,
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
