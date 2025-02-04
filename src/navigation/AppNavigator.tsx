import {  
  createStaticNavigation,
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
  RecoveryOptionsScreen,  
  ImportBackupScreen,
  RecoverWalletAddressScreen
} from "../screens"
import { rootStoreInstance } from "../models"
import {  TabsNavigator  } from "./TabsNavigator"
import { navigationRef, useBackButtonHandler } from "./navigationUtilities"
import { useThemeColor } from "../theme"


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
    RecoveryOptions: RecoveryOptionsScreen,
    SeedRecovery: SeedRecoveryScreen,
    ImportBackup: ImportBackupScreen,
    RecoverWalletAddress: RecoverWalletAddressScreen,   
    Mints: MintsScreen,
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
    const bgColor = useThemeColor('background')

    return (
        <Navigation 
        ref={navigationRef}
        theme={{
            dark: true,
            colors: {
            ...DefaultTheme.colors,
            background: bgColor as string,          
            },
            fonts: DefaultTheme.fonts        
        }} 
        />
    )
})
