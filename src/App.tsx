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
import {Database, KeyChain} from './services'
import { initNotifications } from './services/notificationService'
import {ErrorBoundary} from './screens/ErrorScreen/ErrorBoundary'
import Config from './config'
import {log} from './services'
import {Env} from './utils/envtypes'
import AppError from './utils/AppError'
import { Image, View } from 'react-native'

/* Init push notifications */
initNotifications()

/* Set default size ratio for styling */
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
        const db = Database.getInstance()       
        Database.getDatabaseVersion(db)
        
        // Syncs userSettings store with the database (needed?)
        userSettingsStore.loadUserSettings()

        // Force auth if set in userSettings
        log.trace('[useInitialRootStore]', {isAuthOn: userSettingsStore.isAuthOn})
        if(userSettingsStore.isAuthOn) {
            try {
                const authToken = await KeyChain.getOrCreateAuthToken(userSettingsStore.isAuthOn)
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

        }

        // Set initial websocket to close as it might have remained open on last app close
        relaysStore.resetStatuses()
        log.trace('[useInitialRootStore]', 'App is ready to render')
    })

    

    if (!rehydrated) {    
        return (
            <ErrorBoundary catchErrors={Config.catchErrors}>
                <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
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

const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY
const codePushOptions = { deploymentKey, checkFrequency: codePush.CheckFrequency.MANUAL }
export default codePush(codePushOptions)(App)
