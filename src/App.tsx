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
import messaging from '@react-native-firebase/messaging'
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
import {Database, MinibitsClient} from './services'
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
        // This runs after the root store has been initialized and rehydrated from storage.

        // Creates and opens a sqlite database that stores transactions history and user settings.
        // It triggers db migrations if database version has changed.
        // As it runs inside a callback, it should not block UI.        
        Database.getDatabaseVersion()
        
        // Syncs userSettings store with the database where they are persisted
        userSettingsStore.loadUserSettings()        
        log.trace('[useInitialRootStore]', 'Root store rehydrated')

        // FCM push notifications - set or refresh device token on app start                
        await messaging().registerDeviceForRemoteMessages()        
        const deviceToken = await messaging().getToken()

        log.debug('[useInitialRootStore]', {deviceToken})

        // Save new or refreshed token to local and server profile        
        if (deviceToken.length > 0 && deviceToken !== walletProfileStore.device) {
            walletProfileStore.setDevice(deviceToken)
        }

        // Set initial websocket to close as it might have remained open on last app close
        for (const relay of relaysStore.allRelays) {
            relay.setStatus(WebSocket.CLOSED)
        }
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
