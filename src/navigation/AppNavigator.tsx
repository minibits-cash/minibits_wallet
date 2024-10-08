/**
 * The app navigator (formerly "AppNavigator" and "MainNavigator") is used for the primary
 * navigation flows of your app.
 * Generally speaking, it will contain an auth flow (registration, login, forgot password)
 * and a "main" flow which the user will use once logged in.
 */
import {
  DefaultTheme,
  NavigationContainer,
  NavigatorScreenParams,
  useTheme
} from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { StackScreenProps } from "@react-navigation/stack"
import { observer } from "mobx-react-lite"
import React from "react"
import Config from "../config"
import {
  WelcomeScreen,
  RemoteRecoveryScreen,
  MintsScreen,
  RecoveryOptionsScreen,
  ImportBackupScreen
} from "../screens"
import { useStores } from "../models"
import { TabsNavigator, TabsParamList  } from "./TabsNavigator"
import { navigationRef, useBackButtonHandler } from "./navigationUtilities"
import { colors, useThemeColor } from "../theme"

/**
 * This type allows TypeScript to know what routes are defined in this navigator
 * as well as what properties (if any) they might take when navigating to them.
 *
 * If no params are allowed, pass through `undefined`. Generally speaking, we
 * recommend using your MobX-State-Tree store(s) to keep application state
 * rather than passing state through navigation params.
 *
 * For more information, see this documentation:
 *   https://reactnavigation.org/docs/params/
 *   https://reactnavigation.org/docs/typescript#type-checking-the-navigator
 *   https://reactnavigation.org/docs/typescript/#organizing-types
 */
export type AppStackParamList = {
  Welcome: undefined
  RecoveryOptions: undefined
  RemoteRecovery: {isAddressRecovery: boolean}
  ImportBackup: undefined
  Mints: {}
  Tabs: NavigatorScreenParams<TabsParamList>  
}

/**
 * This is a list of all the route names that will exit the app if the back button
 * is pressed while in that screen. Only affects Android.
 */
const exitRoutes = Config.exitRoutes

export type AppStackScreenProps<T extends keyof AppStackParamList> = StackScreenProps<
  AppStackParamList,
  T
>

// Documentation: https://reactnavigation.org/docs/stack-navigator/
const Stack = createNativeStackNavigator<AppStackParamList>()
const AppStack = observer(function AppStack() {

  const bgColor = useThemeColor('background')
  const { userSettingsStore } = useStores()  

  return (
    <Stack.Navigator
      screenOptions={{ 
        headerShown: false, // managed with hook + custom component
        contentStyle: {backgroundColor: bgColor}   
      }}
    >
        {userSettingsStore.isUserOnboarded ? (
            <Stack.Screen name="Tabs" component={TabsNavigator} />
        ) : (
        <>
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="RecoveryOptions" component={RecoveryOptionsScreen} />
            <Stack.Screen name="RemoteRecovery" component={RemoteRecoveryScreen} />
            <Stack.Screen name="ImportBackup" component={ImportBackupScreen} />
            <Stack.Screen name="Mints" component={MintsScreen} />
            <Stack.Screen name="Tabs" component={TabsNavigator}/>
        </>
        )}      
    </Stack.Navigator>
  )
})

interface NavigationProps extends Partial<React.ComponentProps<typeof NavigationContainer>> {}

export const AppNavigator = observer(function AppNavigator(props: NavigationProps) {  

  useBackButtonHandler((routeName) => exitRoutes.includes(routeName))
  const bgColor = useThemeColor('background')
  

  return (
    <NavigationContainer  
      theme={{
        dark: true,
        colors: {
          ...DefaultTheme.colors,
          background: bgColor as string,          
        },
      }}          
      ref={navigationRef}      
      {...props}
    >
      <AppStack />
    </NavigationContainer>
  )
})
