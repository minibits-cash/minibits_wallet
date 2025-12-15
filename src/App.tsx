import React, { useEffect, useState } from 'react'
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
import { Image, TextStyle, View } from 'react-native'
import { spacing, typography } from './theme'
import { displayName } from '../app.json'
import { Text } from './components/Text'
import useIsInternetReachable from './utils/useIsInternetReachable'

setSizeMattersBaseWidth(375)
setSizeMattersBaseHeight(812)

function App() {
  const {
    userSettingsStore,
    relaysStore,
    authStore,
    walletStore,
    walletProfileStore
  } = useStores()

  const [isUserAuthenticated, setIsUserAuthenticated] = useState(false)
  const [isDeviceAuthenticated, setIsDeviceAuthenticated] = useState(false)

  const isInternetReachable = useIsInternetReachable() // boolean | null
  const [isNetworkChecked, setIsNetworkChecked] = useState(false)

  // Track when network check completes
  useEffect(() => {
    if (isInternetReachable !== null) {
      setIsNetworkChecked(true)
    }
  }, [isInternetReachable])

  // === Only safe, always-run startup logic inside useInitialRootStore ===
  const { rehydrated } = useInitialRootStore(() => {
    log.trace('[App]', 'Root store rehydrated')

    // User authentication (biometrics / PIN)
    if (userSettingsStore.isAuthOn) {
      KeyChain.getOrCreateAuthToken(userSettingsStore.isAuthOn)
        .then((authToken) => {
          setIsUserAuthenticated(true)
          log.trace('[App]', { authToken })
        })
        .catch((e: any) => {
          log.warn('[App]', 'User authentication failed', { message: e.message })

          if (e && typeof e === 'object') {
            const errString = JSON.stringify(e)
            const isBackPressed = errString.includes('code: 10')
            const isCancellPressed = errString.includes('code: 13')
            const isIOSCancel = 'code' in e && String(e.code) === '-128'

            if (isCancellPressed || isBackPressed || isIOSCancel) {
              RNExitApp.exitApp()
            }
          }
        })
    } else {
      setIsUserAuthenticated(true)
    }

    // Theme sync
    if (userSettingsStore.theme !== userSettingsStore.nextTheme) {
      userSettingsStore.setTheme(userSettingsStore.nextTheme)
    }

    // Reset relay statuses
    relaysStore.resetStatuses()
  })


  useEffect(() => {
    if (
      isInternetReachable === null ||
      isDeviceAuthenticated || 
      !rehydrated
    ) {
      log.trace('[App] Not yet ready for device auth check')
      return
    }

    if (isInternetReachable === true) {

      if(authStore.isRefreshTokenExpired) {
        log.trace('[App] Network is online and refresh token expired → attempting device re-enrollment')

        ;(async () => {
          try {
            const walletKeys: WalletKeys = await walletStore.getCachedWalletKeys()
            const deviceId = walletProfileStore.device
  
            await authStore.clearTokens()
            await authStore.enrollDevice(walletKeys.NOSTR, deviceId)
  
            log.trace('[App] Device re-enrollment successful')
          } catch (e: any) {
            if (e.name !== Err.NOTFOUND_ERROR) {
              log.error('[App] Device re-enrollment failed', { message: e.message })
            } else {
              // Expected on fresh install
              userSettingsStore.setIsOnboarded(false)
            }
          } finally {
            // Always unblock the app
            setIsDeviceAuthenticated(true)
          }
        })()
      } else {
        log.trace('[App] Network is online and refresh token valid → device authenticated')
        setIsDeviceAuthenticated(true)
      }
      
    } else {
      // Confirmed offline → skip re-enrollment, proceed safely
      log.trace('[App] Network confirmed offline → skipping refresh token check, device authenticated')
      setIsDeviceAuthenticated(true)
    }
  }, [
    isInternetReachable,
    rehydrated
  ])

  // Show splash screen until fully ready
  if (
    !rehydrated ||
    !isUserAuthenticated ||
    !isDeviceAuthenticated
  ) {
    return (
      <ErrorBoundary catchErrors={Config.catchErrors}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
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
        <FlashMessage position="bottom" />
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