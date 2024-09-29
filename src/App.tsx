import React, { useEffect } from 'react'
import * as Sentry from '@sentry/react-native'
import {
    APP_ENV,
    SENTRY_DSN,
    JS_BUNDLE_VERSION,
    NATIVE_VERSION_ANDROID,
    CODEPUSH_STAGING_DEPLOYMENT_KEY,
    CODEPUSH_PRODUCTION_DEPLOYMENT_KEY,    
} from '@env'
import codePush from 'react-native-code-push'
import messaging, { isAutoInitEnabled } from '@react-native-firebase/messaging'
import FlashMessage from "react-native-flash-message"
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context'
import {
    setSizeMattersBaseHeight, 
    setSizeMattersBaseWidth
} from '@gocodingnow/rn-size-matters'
import {AppNavigator} from './navigation'
import {useInitialRootStore, useStores} from './models'
import {Database, KeyChain} from './services'
import {ErrorBoundary} from './screens/ErrorScreen/ErrorBoundary'
import Config from './config'
import {log} from './services'
import {Env} from './utils/envtypes'
import AppError from './utils/AppError'

// RN 0.73 screen rendering issue
//import { enableFreeze, enableScreens  } from 'react-native-screens';
// enableScreens(false)

setSizeMattersBaseWidth(375)
setSizeMattersBaseHeight(812)

if (!__DEV__) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: APP_ENV,
        release: `minibits_wallet_android@${JS_BUNDLE_VERSION}`,
        dist: NATIVE_VERSION_ANDROID,
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

interface AppProps {
  appName: string
}

function App(props: AppProps) {    
    const {userSettingsStore, relaysStore, walletProfileStore} = useStores()    

    const {rehydrated} = useInitialRootStore(async() => {
        log.trace('[useInitialRootStore]', 'Root store rehydrated')
        // This runs after the root store has been initialized and rehydrated from storage.

        // Creates and opens a sqlite database that stores transactions history and user settings.
        // It triggers db migrations if database version has changed.        
        Database.getDatabaseVersion()
        
        // Syncs userSettings store with the database (needed?)
        userSettingsStore.loadUserSettings()

        // Force auth if set in userSettings
        log.trace('[useInitialRootStore]', {isAuthOn: userSettingsStore.isAuthOn})
        if(userSettingsStore.isAuthOn) {
            const authToken = await KeyChain.getOrCreateAuthToken(userSettingsStore.isAuthOn)
            log.trace('[useInitialRootStore]', {authToken})
        }

        // FCM push notifications - set or refresh device token on app start                
        await messaging().registerDeviceForRemoteMessages()        
        const deviceToken = await messaging().getToken()

        log.debug('[useInitialRootStore]', {deviceToken})
        
        // Make sure profile has already been created (i.e. this is not first run)
        if(walletProfileStore.pubkey && deviceToken) {
            // if device token changed, update the server
            if(deviceToken !== walletProfileStore.device) {
                await walletProfileStore.setDevice(deviceToken)
            }
        }

        // Set initial websocket to close as it might have remained open on last app close
        relaysStore.resetStatuses()
        log.trace('[useInitialRootStore]', 'App is ready to render')
    })

    

    if (!rehydrated) {    
        return null
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

const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY
const codePushOptions = { deploymentKey, checkFrequency: codePush.CheckFrequency.MANUAL }
export default codePush(codePushOptions)(App)
