import React, { useState } from 'react'
import FlashMessage from "react-native-flash-message"
import {  
  SafeAreaProvider,
} from 'react-native-safe-area-context'
import {
    setSizeMattersBaseHeight, 
    setSizeMattersBaseWidth
} from '@gocodingnow/rn-size-matters'
import RNExitApp from 'react-native-exit-app'
import {AppNavigator} from './navigation'
import {useInitialRootStore, useStores} from './models'
import {KeyChain, WalletKeys} from './services'
import {ErrorBoundary} from './screens/ErrorScreen/ErrorBoundary'
import Config from './config'
import {log} from './services'
import AppError, { Err } from './utils/AppError'
import { Image, TextStyle, View, Platform, UIManager } from 'react-native'
import { spacing, typography } from './theme'
import { displayName } from '../app.json'
import { Text } from './components/Text'
import useIsInternetReachable from './utils/useIsInternetReachable'
import * as Sentry from '@sentry/react-native'
import { ANDROID_VERSION_NAME, APP_ENV, JS_BUNDLE_VERSION, SENTRY_DSN } from '@env'

/* Set default size ratio for styling */
setSizeMattersBaseWidth(375)
setSizeMattersBaseHeight(812)

function App() {
    
    const {userSettingsStore, relaysStore, authStore, walletStore, walletProfileStore} = useStores()
    const [isUserAuthenticated, setIsUserAuthenticated] = useState(false)
    const [isDeviceAuthenticated, setIsDeviceAuthenticated] = useState(false)
    const isInternetReachable = useIsInternetReachable()   

    const {rehydrated} = useInitialRootStore(async() => {
        log.trace('[useInitialRootStore]', 'Root store rehydrated')
        // This runs after the root store has been initialized and rehydrated from storage.

        // Force auth if set in userSettings
        log.trace('[useInitialRootStore]', {isAuthOn: userSettingsStore.isAuthOn})
        if(userSettingsStore.isAuthOn) {
            try {
                const authToken = await KeyChain.getOrCreateAuthToken(userSettingsStore.isAuthOn)
                setIsUserAuthenticated(true)
                log.trace('[useInitialRootStore]', {authToken})
            } catch (e: any) {
                log.warn('[useInitialRootStore]', 'Authentication failed', {message: e.message})

                if (e && typeof e === 'object') {
                    const errString = JSON.stringify(e)                   
            
                    const isBackPressed = errString.includes('code: 10')
                    const isCancellPressed = errString.includes('code: 13')
                    const isIOSCancel = 'code' in e && String(e.code) === '-128'

                    if(isCancellPressed || isBackPressed || isIOSCancel) {                        
                        RNExitApp.exitApp()
                    }
                }  
            }
        } else {
            setIsUserAuthenticated(true)
        }

        // re-enroll device for JWT authentication if refresh token expired        
        if(authStore.isRefreshTokenExpired && isInternetReachable && userSettingsStore.isOnboarded) {
            log.trace('[useInitialRootStore]', 'Re-enrolling device for JWT authentication')
            try {
                const walletKeys: WalletKeys = await walletStore.getCachedWalletKeys()
                const deviceId = walletProfileStore.device

                await authStore.clearTokens()
                await authStore.enrollDevice(walletKeys.NOSTR, deviceId)
                setIsDeviceAuthenticated(true)

            } catch (e: any) {
                if(e.name === Err.NOTFOUND_ERROR) {
                    // new installation, no keys found
                    
                    userSettingsStore.setIsOnboarded(false) // force onboarding just in case
                    log.trace('[useInitialRootStore]', 'No device keys found, skipping re-enrollment')  
                } else {
                    log.error('[useInitialRootStore]', 'Failed to re-enroll device', {message: e.message})
                }            
            }
        } else {
            setIsDeviceAuthenticated(true)
        }

        if(userSettingsStore.theme !== userSettingsStore.nextTheme) {
            userSettingsStore.setTheme(userSettingsStore.nextTheme)
        }

        // Set initial websocket to close as it might have remained open on last app close
        relaysStore.resetStatuses()
        log.trace('[useInitialRootStore]', 'App is ready to render')
    })

    

    if (!rehydrated || !isUserAuthenticated || !isDeviceAuthenticated) {    
        return (
            <ErrorBoundary catchErrors={Config.catchErrors}>
                <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                    <Text text={displayName} style={$title} />
                    <Image source={require('../android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png')} />
                </View>
            </ErrorBoundary>
        )
    } 

    return (
        <SafeAreaProvider>
        <ErrorBoundary catchErrors={Config.catchErrors}>
            <AppNavigator />
            <FlashMessage position='bottom' />
        </ErrorBoundary>
        </SafeAreaProvider>
    )
}

const $title: TextStyle = {
    textAlign: "center",
    fontFamily: typography.logo.normal,
    fontSize: spacing.large,
    color: 'white'
}

export default App