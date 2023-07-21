import React from 'react'
import * as Sentry from '@sentry/react-native'
import {
    APP_ENV,
    SENTRY_DSN,
    JS_BUNDLE_VERSION,
    NATIVE_VERSION_ANDROID,
    CODEPUSH_STAGING_DEPLOYMENT_KEY,
    CODEPUSH_PRODUCTION_DEPLOYMENT_KEY,
    SENTRY_ACTIVE, 
} from '@env'
import codePush from 'react-native-code-push'
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
import {Database} from './services'
import {ErrorBoundary} from './screens/ErrorScreen/ErrorBoundary'
import Config from './config'
import {Env, log, SentryActive} from './utils/logger'
import AppError from './utils/AppError'

setSizeMattersBaseWidth(375)
setSizeMattersBaseHeight(812)

if (!__DEV__ && SENTRY_ACTIVE === SentryActive.TRUE) {
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
    const {userSettingsStore} = useStores()
    const {rehydrated} = useInitialRootStore(() => {
        // This runs after the root store has been initialized and rehydrated from storage.
        log.trace('Root store rehydrated', [], 'useInitialRootStore')

        // This creates and opens a sqlite database that stores transactions history.
        // It triggers db migrations if database version has changed.
        // As it runs inside a callback, it should not block UI.
        Database.getDatabaseVersion()
        userSettingsStore.loadUserSettings()        
    })

    if (!rehydrated) {    
        return null
    }  

    return (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ErrorBoundary catchErrors={Config.catchErrors}>
            <AppNavigator />
        </ErrorBoundary>
        </SafeAreaProvider>
    )
}

const deploymentKey = APP_ENV === Env.PROD ? CODEPUSH_PRODUCTION_DEPLOYMENT_KEY : CODEPUSH_STAGING_DEPLOYMENT_KEY
const codePushOptions = { deploymentKey, checkFrequency: codePush.CheckFrequency.MANUAL }
export default codePush(codePushOptions)(App)
