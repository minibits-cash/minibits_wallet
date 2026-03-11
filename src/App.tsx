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
import { changeIcon } from 'react-native-change-icon'
import {AppNavigator} from './navigation'
import {useInitialRootStore, useStores} from './models'
import {KeyChain, WalletKeys} from './services'
import {ErrorBoundary} from './screens/ErrorScreen/ErrorBoundary'
import Config from './config'
import {log} from './services'
import { Image, TextStyle, View } from 'react-native'
import { ThemeCode, colors, spacing, typography } from './theme'
import useColorScheme from './theme/useThemeColor'
import { displayName } from '../app.json'
import { Text } from './components/Text'
import useIsInternetReachable from './utils/useIsInternetReachable'
import { MMKVStorage } from './services'
import { Button, Screen } from './components'

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

  const colorScheme = useColorScheme()

  const [isUserAuthenticated, setIsUserAuthenticated] = useState(false)
  const [isDeviceAuthenticated, setIsDeviceAuthenticated] = useState(false)
  const [isAppLocked, setIsAppLocked] = useState(false)
  const isAuthInProgressRef = useRef(false)

  const isInternetReachable = useIsInternetReachable() // boolean | null
  const [isNetworkChecked, setIsNetworkChecked] = useState(false)

  // Track when network check completes
  useEffect(() => {
    if (isInternetReachable !== null) {
      setIsNetworkChecked(true)
    }
  }, [isInternetReachable])

  const attemptUserAuthentication = useCallback(async () => {
    if (isAuthInProgressRef.current) {
      log.trace('[App] attemptUserAuthentication skipped, auth already in progress')
      return
    }

    isAuthInProgressRef.current = true

    try {
      const {isAuthOn} = userSettingsStore
      log.trace('[App] attemptUserAuthentication called', {isAuthOn})

      const result = await KeyChain.authenticateOnAppStart(isAuthOn)
      log.trace('[App] attemptUserAuthentication result:', { success: result.success, shouldExitApp: result.shouldExitApp })

      if (result.success) {
        setIsUserAuthenticated(true)
        setIsAppLocked(false)
        return
      }      

      if (result.shouldExitApp) {
        // Fix: show locked UI before exiting so the user isn't stuck on a
        // blank splash if exitApp() has any delay or fails silently.
        setIsAppLocked(true)
        RNExitApp.exitApp()
        return
      }

      log.trace('[App] attemptUserAuthentication failed, locking app')
      setIsAppLocked(true)
    } catch (e: any) {
      log.error('[App] attemptUserAuthentication caught error', { message: e.message })
      setIsAppLocked(true)
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
      attemptUserAuthentication()
    } else {
      setIsUserAuthenticated(true)
    }

    // Theme sync — apply queued theme on startup and persist to dedicated MMKV key
    const appliedTheme = MMKVStorage.loadTheme()
    if (appliedTheme !== userSettingsStore.nextTheme) {
      MMKVStorage.saveTheme(userSettingsStore.nextTheme)
    }

    // Icon sync — keeps launcher icon in sync with the applied theme.
    // Handles upgrades from versions before icon switching existed.
    const targetIcon = MMKVStorage.loadTheme() === ThemeCode.GOLDEN ? 'Golden' : 'Default'
    changeIcon(targetIcon).catch(() => {})

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
    isAppLocked
  ) {
    const splashTheme = MMKVStorage.loadTheme()
    const isLight = splashTheme === ThemeCode.LIGHT ||
      (splashTheme === ThemeCode.DEFAULT && colorScheme === 'light')
    const isGolden = splashTheme === ThemeCode.GOLDEN
    const splashBg = isLight ? colors.palette.neutral200 : colors.palette.neutral700
    const splashTextColor = isLight ? colors.palette.neutral800 : colors.palette.neutral100

    log.trace('[App] Rendering splash/auth screen', {isAppLocked})

    return (
      <SafeAreaProvider>
      <Screen preset='fixed' backgroundColor={splashBg} safeAreaEdges={['top', 'bottom']}>
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
          <Image source={isGolden
            ? require('../android/app/src/main/res/mipmap-xxhdpi/ic_launcher_golden.png')
            : require('../android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png')} />
        </View>
        <Text text={displayName} style={[$title, {color: splashTextColor}]} />
        <View style={{
          paddingHorizontal: spacing.large,
          marginBottom: spacing.extraLarge,
        }}>
          
          {isAppLocked && (
            <>
              <Text size='md' style={{textAlign: 'center', color: splashTextColor}}>
                Minibits is locked. Authentication is required to continue.
              </Text>
              <Button
                preset='default'
                text='Authenticate'
                onPress={attemptUserAuthentication}
                style={{marginVertical: spacing.large, alignSelf: 'center'}}
              />
              <Button
                preset='tertiary'
                text='Exit'
                onPress={() => RNExitApp.exitApp()}
                style={{alignSelf: 'center'}}
              />
            </>
          )}
        </View>
      </Screen>
      </SafeAreaProvider>
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
}

export default App
