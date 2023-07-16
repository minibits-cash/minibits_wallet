import { BottomTabScreenProps, createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { CompositeScreenProps, DarkTheme, DefaultTheme,   NavigationContainer, NavigatorScreenParams } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { StackScreenProps } from "@react-navigation/stack"
import React from "react"
import { TextStyle, ViewStyle } from "react-native"
import { RemotePackage } from "react-native-code-push"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Icon } from "../components"
import { translate } from "../i18n"
import { 
  WalletScreen, 
  ReceiveScreen, 
  SendScreen, 
  ScanScreen, 
  ContactsScreen, 
  SettingsScreen, 
  MintsScreen, 
  DeveloperScreen,
  SecurityScreen,
  UpdateScreen,
  BackupScreen,
  LocalRecoveryScreen,
  TranDetailScreen, 
  TranHistoryScreen,
  TransferScreen,
  TopupScreen,
} from "../screens"
import { colors, useThemeColor, spacing, typography } from "../theme"
import { AppStackParamList, AppStackScreenProps } from "./AppNavigator"


export type TabsParamList = {
  WalletNavigator: NavigatorScreenParams<WalletStackParamList>  
  Contacts: undefined
  SettingsNavigator: NavigatorScreenParams<SettingsStackParamList>
}

/**
 * Helper for automatically generating navigation prop types for each route.
 *
 * More info: https://reactnavigation.org/docs/typescript/#organizing-types
 */
export type TabScreenProps<T extends keyof TabsParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabsParamList, T>,
  AppStackScreenProps<keyof AppStackParamList>
>

const Tab = createBottomTabNavigator<TabsParamList>()

export function TabsNavigator() {
  const { bottom } = useSafeAreaInsets()
  const bgColor = useThemeColor('menu')
  const textColor = useThemeColor('text')
  const activeColor = useThemeColor('tint')

  return (
    <Tab.Navigator
      initialRouteName="WalletNavigator"
      screenOptions={{
        headerShown: false, // managed with hook + custom component
        tabBarHideOnKeyboard: true,
        tabBarStyle: [$tabBar, { height: bottom + 70, backgroundColor: bgColor }],
        tabBarActiveTintColor: activeColor as string,
        tabBarInactiveTintColor: textColor as string,
        tabBarLabelStyle: [$tabBarLabel, {color: textColor}],
        tabBarItemStyle: $tabBarItem,        
      }}
    >
      <Tab.Screen        
        name="WalletNavigator"
        component={WalletNavigator}
        options={{
          tabBarLabel: translate("tabNavigator.walletLabel"),
          tabBarIcon: ({ focused }) => <Icon icon="faWallet" color={focused ? activeColor : textColor} size={spacing.large} />,      
        }}
      />

      <Tab.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          tabBarLabel: translate("tabNavigator.contactsLabel"),
          tabBarIcon: ({ focused }) => <Icon icon="faAddressBook" color={focused ? activeColor : textColor} size={spacing.large} />,        
        }}
      />

      <Tab.Screen
        name="SettingsNavigator"
        component={SettingsNavigator}
        options={{
          tabBarLabel: translate("tabNavigator.settingsLabel"),
          tabBarIcon: ({ focused }) => <Icon icon="faSliders" color={focused ? activeColor : textColor} size={spacing.large} />,           
        }}
      />
    </Tab.Navigator>
  )
}


export type WalletStackParamList = {  
  Wallet: {scannedMintUrl? : string}
  Receive: {scannedEncodedToken? : string}
  Send: undefined
  Scan: undefined
  TranDetail: {id: number}
  TranHistory: undefined 
  Transfer: {scannedEncodedInvoice? : string}
  Topup: undefined 
}

export type WalletStackScreenProps<T extends keyof WalletStackParamList> = StackScreenProps<
  WalletStackParamList,
  T
>

const WalletStack = createNativeStackNavigator<WalletStackParamList>()

const WalletNavigator = function WalletNavigator() {  

  return (
    <WalletStack.Navigator    
      screenOptions={{ 
        presentation: 'transparentModal', // prevents white glitch on scren change in dark mode
        headerShown: false,        
      }}
    >        
      <WalletStack.Screen name="Wallet" component={WalletScreen} />
      <WalletStack.Screen name="Receive" component={ReceiveScreen} />
      <WalletStack.Screen name="Send" component={SendScreen} />
      <WalletStack.Screen name="Scan" component={ScanScreen} />
      <WalletStack.Screen name="TranDetail" component={TranDetailScreen} />
      <WalletStack.Screen name="TranHistory" component={TranHistoryScreen} />
      <WalletStack.Screen name="Transfer" component={TransferScreen} />
      <WalletStack.Screen name="Topup" component={TopupScreen} />
    </WalletStack.Navigator>
  )
}


export type SettingsStackParamList = {  
  Settings: undefined
  Mints: {scannedMintUrl? : string}
  Security: undefined
  Update: {
    isUpdateAvailable : boolean, 
    isNativeUpdateAvailable: boolean, 
    updateDescription: string,
    updateSize: string,
  }
  Backup: undefined
  LocalRecovery: undefined
  Developer: undefined
}

export type SettingsStackScreenProps<T extends keyof SettingsStackParamList> = StackScreenProps<
  SettingsStackParamList,
  T
>

const SettingsStack = createNativeStackNavigator<SettingsStackParamList>()

const SettingsNavigator = function SettingsNavigator() {  

  return (
    <SettingsStack.Navigator    
      screenOptions={{ 
        presentation: 'transparentModal', // prevents white glitch on scren change in dark mode
        headerShown: false,        
      }}
    >        
      <SettingsStack.Screen name="Settings" component={SettingsScreen} />
      <SettingsStack.Screen name="Mints" component={MintsScreen} />
      <SettingsStack.Screen name="Security" component={SecurityScreen} />
      <SettingsStack.Screen name="Update" component={UpdateScreen} />
      <SettingsStack.Screen name="Backup" component={BackupScreen} />
      <SettingsStack.Screen name="LocalRecovery" component={LocalRecoveryScreen} />
      <SettingsStack.Screen name="Developer" component={DeveloperScreen} />
    </SettingsStack.Navigator>
  )
}

const $tabBar: ViewStyle = {  
  borderTopColor: 'transparent',
  borderTopWidth: 0,
  elevation: 0
}

const $tabBarItem: ViewStyle = {
  paddingTop: spacing.medium,
}

const $tabBarLabel: TextStyle = {
  fontSize: 12,
  fontFamily: typography.primary?.medium,
  lineHeight: 16,
  flex: 1,
}
