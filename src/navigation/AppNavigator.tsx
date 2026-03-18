import {
  createStaticNavigation,
  DarkTheme,
  DefaultTheme,
  StaticParamList,
} from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { observer } from "mobx-react-lite"
import React from "react"
import Config from "../config"
import {
  WelcomeScreen,
  SeedRecoveryScreen,
  MintsScreen,
  SeedRecoveryOptionsScreen,
  ImportBackupScreen,
  RecoverWalletAddressScreen,
  POSScreen,
  NfcPayScreen
} from "../screens"
import { rootStoreInstance } from "../models"
import {  TabsNavigator  } from "./TabsNavigator"
import { navigationRef, useBackButtonHandler } from "./navigationUtilities"
import { ThemeCode, useThemeColor } from "../theme"
import useColorScheme from "../theme/useThemeColor"
import { MMKVStorage } from "../services"
import { SystemBars } from "react-native-edge-to-edge"


/**
j * This is a list of all the route names that will exit the app if the back button
 * is pressed while in that screen. Only affects Android.
 */
const exitRoutes = Config.exitRoutes

const { userSettingsStore } = rootStoreInstance

const RootStack = createNativeStackNavigator({
  initialRouteName: userSettingsStore.isOnboarded ? 'Tabs' : 'Welcome',
  screenOptions: {
    headerShown: false,
    //contentStyle: {backgroundColor: bgColor} 
  },
  screens: {
    Welcome: WelcomeScreen,    
    
    SeedRecovery: SeedRecoveryScreen,
    ImportBackup: ImportBackupScreen,
    RecoverWalletAddress: RecoverWalletAddressScreen,   
    Mints: MintsScreen,
    POS: POSScreen,
    NfcPay: NfcPayScreen,
    Tabs: TabsNavigator,
  }
})

type RootStackParamList = StaticParamList<typeof RootStack>
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

const Navigation = createStaticNavigation(RootStack)

export const AppNavigator = observer(function AppNavigator() {  

    useBackButtonHandler((routeName) => exitRoutes.includes(routeName))  
    
    const colorScheme = useColorScheme()
    const dark = colorScheme === 'dark'
    const theme = MMKVStorage.loadTheme()
    const isLightTheme = theme === ThemeCode.LIGHT ||
      (theme === ThemeCode.DEFAULT && colorScheme === 'light')

    const background = useThemeColor('background') as string
    const primary = useThemeColor('tabActiveIcon') as string
    const card = useThemeColor('background') as string
    const text = useThemeColor('text') as string
    const border = 'transparent'
    const notification = useThemeColor('warn') as string
    const systemTheme = dark ? DarkTheme : DefaultTheme
    

    const NavigationTheme = {        
        dark,
        colors: {
          ...systemTheme.colors,
          background, 
          primary,
          card,
          text,
          border,
          notification
        },
        fonts: DefaultTheme.fonts
    }

    return (
        <>
            <SystemBars style={isLightTheme ? "dark" : "light"} />
            <Navigation
                // @ts-ignore
                ref={navigationRef}
                theme={NavigationTheme}
            />
        </>
    )
})
