import React from 'react'
import * as Sentry from '@sentry/react-native'
import {
    SENTRY_DSN,
} from '@env'
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context'
import {AppNavigator} from './navigation'
import {useInitialRootStore} from './models'
import {Database} from './services'
import {ErrorBoundary} from './screens/ErrorScreen/ErrorBoundary'
import Config from './config'
import {Env, log} from './utils/logger'
import AppError from './utils/AppError'

Sentry.init({
  dsn: SENTRY_DSN,
  beforeSend: function (event, hint) {
    const exception = hint.originalException
    if (exception instanceof AppError) {
      event.fingerprint = [exception.name.toString()]
    }
    return event
  }
})

interface AppProps {
  appName: string
}

function App(props: AppProps) {
  
  log.info(`${props.appName} app started...`)

  const {rehydrated} = useInitialRootStore(() => {
    // This runs after the root store has been initialized and rehydrated from storage.
    log.trace('Root store rehydrated', [], 'useInitialRootStore')

    // This creates and opens a sqlite database that stores transactions history.
    // It triggers db migrations if database version has changed.
    // As it runs inside a callback, it should not block UI.
    const dbVersion = Database.getDatabaseVersion()
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

export default App
