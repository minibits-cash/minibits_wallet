import React, { useState } from 'react'
import * as Sentry from '@sentry/react-native'
import {
    APP_ENV,
    SENTRY_DSN,
    JS_BUNDLE_VERSION,    
    ANDROID_VERSION_NAME,    
} from '@env'
// import codePush from 'react-native-code-push'
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
import {KeyChain} from './services'
import {ErrorBoundary} from './screens/ErrorScreen/ErrorBoundary'
import Config from './config'
import {log} from './services'
import {Env} from './utils/envtypes'
import AppError from './utils/AppError'
import { Image, TextStyle, View, Platform, UIManager } from 'react-native'
import { spacing, typography } from './theme'
import { displayName } from '../app.json'
import { Text } from './components/Text'

/* Set default size ratio for styling */
setSizeMattersBaseWidth(375)
setSizeMattersBaseHeight(812)

if (!__DEV__) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: APP_ENV,
        release: `minibits_wallet_android@${JS_BUNDLE_VERSION}`,
        dist: ANDROID_VERSION_NAME,
        beforeSend: function (event, hint) {
            const exception = hint.originalException
            if (exception instanceof AppError) {
            event.fingerprint = [exception.name.toString()]
            }
            return event
        },
        enableTracing: false
    })
}

if (Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true)
}

function App() {
    
    const {userSettingsStore, relaysStore} = useStores()
    const [isAuthenticated, setIsAuthenticated] = useState(false)    

    const {rehydrated} = useInitialRootStore(async() => {
        log.trace('[useInitialRootStore]', 'Root store rehydrated')
        // This runs after the root store has been initialized and rehydrated from storage.

        // Force auth if set in userSettings
        log.trace('[useInitialRootStore]', {isAuthOn: userSettingsStore.isAuthOn})
        if(userSettingsStore.isAuthOn) {
            try {
                const authToken = await KeyChain.getOrCreateAuthToken(userSettingsStore.isAuthOn)
                setIsAuthenticated(true)
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
            setIsAuthenticated(true)
        }

        if(userSettingsStore.theme !== userSettingsStore.nextTheme) {
            userSettingsStore.setTheme(userSettingsStore.nextTheme)
        }

        // Set initial websocket to close as it might have remained open on last app close
        relaysStore.resetStatuses()
        log.trace('[useInitialRootStore]', 'App is ready to render')
    })

    

    if (!rehydrated || !isAuthenticated) {    
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

/*const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY
const codePushOptions = { deploymentKey, checkFrequency: codePush.CheckFrequency.MANUAL }
export default codePush(codePushOptions)(App)*/
export default App
