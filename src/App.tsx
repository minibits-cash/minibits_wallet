import React, { useCallback, useEffect, useRef, useState } from 'react'
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
import { Image, Pressable, Text as RNText, TextStyle, View } from 'react-native'
import { colors, spacing, typography } from './theme'
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
  const [isAuthLocked, setIsAuthLocked] = useState(false)
  const isAuthInProgressRef = useRef(false)

  const isInternetReachable = useIsInternetReachable() // boolean | null
  const [isNetworkChecked, setIsNetworkChecked] = useState(false)

  // Track when network check completes
  useEffect(() => {
    if (isInternetReachable !== null) {
      setIsNetworkChecked(true)
    }
  }, [isInternetReachable])

  const attemptAuth = useCallback(async () => {
    if (isAuthInProgressRef.current) {
      log.trace('[App] attemptAuth skipped, auth already in progress')
      return
    }

    isAuthInProgressRef.current = true

    try {
      const isAuthEnabled = userSettingsStore.isAuthOn
      log.trace('[App] attemptAuth called')

      const result = await KeyChain.authenticateOnAppStart(isAuthEnabled)
      log.trace('[App] attemptAuth result:', { success: result.success, shouldExitApp: result.shouldExitApp })

      if (result.success) {
        setIsUserAuthenticated(true)
        setIsAuthLocked(false)
        return
      }

      if (result.shouldExitApp) {
        RNExitApp.exitApp()
        return
      }

      log.trace('[App] attemptAuth failed, locking app')
      setIsAuthLocked(true)
    } catch (e: any) {
      log.error('[App] attemptAuth caught error', { message: e.message })
      setIsAuthLocked(true)
    } finally {
      isAuthInProgressRef.current = false
    }
  }, [userSettingsStore])

  // === Only safe, always-run startup logic inside useInitialRootStore ===
  const { rehydrated } = useInitialRootStore(() => {
    log.trace('[App]', 'Root store rehydrated')

    // User authentication (biometrics / PIN)
    if (userSettingsStore.isAuthOn) {
      // Keep UI in locked mode until authentication succeeds.
      setIsAuthLocked(true)
      attemptAuth()
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

      if(userSettingsStore.isOnboarded === false) {
        log.trace('[App] User not onboarded → new install, skipping device re-enrollment')
        setIsDeviceAuthenticated(true)
        return
      }

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
            log.error('[App] Device re-enrollment failed', { message: e.message })
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

  // Splash / Locked screen
  if (
    !rehydrated ||
    !isUserAuthenticated ||
    !isDeviceAuthenticated ||
    isAuthLocked
  ) {
    return (
      <View style={{flex: 1}}>
        <ErrorBoundary catchErrors={Config.catchErrors}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text text={displayName} style={$title} />
            <Image source={require('../android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png')} />
          </View>
        </ErrorBoundary>
        {isAuthLocked && (
          <View style={{alignItems: 'center', paddingHorizontal: spacing.large, paddingBottom: 60}}>
            <RNText style={{color: colors.palette.neutral400, fontSize: 14, textAlign: 'center', marginBottom: spacing.large}}>
              Minibits is locked. Authentication is required to continue.
            </RNText>
            <Pressable
              style={{backgroundColor: colors.palette.accent400, paddingVertical: spacing.small, paddingHorizontal: spacing.extraLarge, borderRadius: spacing.small, marginBottom: spacing.medium, minWidth: 200, alignItems: 'center'}}
              onPress={attemptAuth}
            >
              <RNText style={{color: 'white', fontSize: 16, fontWeight: '600'}}>Authenticate</RNText>
            </Pressable>
            <Pressable
              style={{paddingVertical: spacing.small, paddingHorizontal: spacing.extraLarge, minWidth: 200, alignItems: 'center'}}
              onPress={() => RNExitApp.exitApp()}
            >
              <RNText style={{color: colors.palette.neutral400, fontSize: 16}}>Close app</RNText>
            </Pressable>
          </View>
        )}
      </View>
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