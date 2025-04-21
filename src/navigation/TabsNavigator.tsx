import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { StaticParamList } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { PlatformPressable } from '@react-navigation/elements'
import React from "react"
import { TextStyle, ViewStyle } from "react-native"
import { Icon } from "../components"
import { translate } from "../i18n"
import { 
  WalletScreen, 
  ReceiveScreen,
  SendScreen, 
  ScanScreen,
  LightningPayScreen,
  ContactsScreen,
  PictureScreen,
  ContactDetailScreen, 
  ProfileScreen,
  WalletNameScreen, 
  SettingsScreen, 
  MintsScreen,
  MintInfoScreen, 
  DeveloperScreen,
  SecurityScreen,
  PrivacyScreen,
  UpdateScreen,
  MnemonicScreen,
  BackupOptionsScreen,  
  ExportBackupScreen,
  RelaysScreen,
  TranDetailScreen, 
  TranHistoryScreen,
  PaymentRequestsScreen,
  TransferScreen,
  TopupScreen,
  OwnKeysScreen,
  TokenReceiveScreen,
  NwcScreen,
} from "../screens"
import { colors, spacing, typography } from "../theme"

const $tabBar: ViewStyle = {  
  borderTopColor: 'transparent',
  borderTopWidth: 0,
  elevation: 0
}

const $tabBarItem = {
  paddingVertical: spacing.small,
}

const $tabBarLabel: TextStyle = {
  fontSize: 12,
  fontFamily: typography.primary?.light,
  lineHeight: 16,
  flex: 1,
}


const WalletStack = createNativeStackNavigator({  
  screenOptions: {
    headerShown: false,    
  },
  screens: {
    Wallet: WalletScreen,
    TokenReceive: TokenReceiveScreen,
    Receive: ReceiveScreen,
    Send: SendScreen,
    Scan: ScanScreen,
    LightningPay: LightningPayScreen,
    PaymentRequests: PaymentRequestsScreen,
    Transfer: TransferScreen,
    Topup: TopupScreen,    
  }
})

type WalletStackParamList = StaticParamList<typeof WalletStack>
declare global {
  namespace ReactNavigation {
    interface RootParamList extends WalletStackParamList {}
  }
}


const TransactionsStack = createNativeStackNavigator({  
  screenOptions: {
    headerShown: false,    
  },
  screens: {
    TranHistory: TranHistoryScreen,
    TranDetail: TranDetailScreen,
    
  }
})

type TransactionsStackParamList = StaticParamList<typeof TransactionsStack>
declare global {
  namespace ReactNavigation {
    interface RootParamList extends TransactionsStackParamList {}
  }
}

const ContactsStack = createNativeStackNavigator({  
  screenOptions: {
    headerShown: false,    
  },
  screens: {
    Contacts: ContactsScreen,
    Profile: ProfileScreen,
    Picture: PictureScreen,
    ContactDetail: ContactDetailScreen,
    OwnKeys: OwnKeysScreen,
    WalletName: WalletNameScreen,    
  }
})

type ContactsStackParamList = StaticParamList<typeof ContactsStack>
declare global {
  namespace ReactNavigation {
    interface RootParamList extends ContactsStackParamList {}
  }
} 

const SettingsStack = createNativeStackNavigator({  
  screenOptions: {
    headerShown: false,    
  },
  screens: {
    Settings: SettingsScreen,
    Mints: MintsScreen,
    MintInfo: MintInfoScreen,
    Security: SecurityScreen,
    Privacy: PrivacyScreen,
    Update: UpdateScreen,
    BackupOptions: BackupOptionsScreen,
    Mnemonic: MnemonicScreen,
    ExportBackup: ExportBackupScreen,
    Developer: DeveloperScreen,
    Relays: RelaysScreen,
    Nwc: NwcScreen,    
  }
})

type SettingsStackParamList = StaticParamList<typeof SettingsStack>
declare global {
  namespace ReactNavigation {
    interface RootParamList extends SettingsStackParamList {}
  }
}

export const TabsNavigator = createBottomTabNavigator({
  initialRouteName: "WalletNavigator",
  backBehavior: 'firstRoute',
  screenOptions: {
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarShowLabel: false,
    tabBarStyle: [$tabBar, { 
      marginBottom: spacing.medium
    }],
    tabBarItemStyle: [$tabBarItem, {}],
    tabBarLabelStyle: $tabBarLabel,    
    animation: 'shift',
    tabBarButton: (props) => (
      <PlatformPressable
        {...props}
        android_ripple={{color: 'transparent'}}       
      />
    ),   
  },
  screens: {
    WalletNavigator: {
      screen: WalletStack,
      options: {
        tabBarLabel: translate("tabNavigator.walletLabel"),
        tabBarIcon: ({ focused, color }) => <Icon icon="faWallet" color={color} size={spacing.large} />,                       
      }
    },
    TransactionsNavigator: {
      screen: TransactionsStack,
      options: {
        tabBarLabel: translate("tabNavigator.transactionsLabel"),
        tabBarIcon: ({ focused, color }) => <Icon icon="faListUl" color={color} size={spacing.large} />,        
      }
    },
    ContactsNavigator: {
      screen: ContactsStack,
      options: {
        tabBarLabel: translate("tabNavigator.contactsLabel"),
        tabBarIcon: ({ focused, color }) => <Icon icon="faAddressBook" color={color} size={spacing.large} />,        
      }
    },
    SettingsNavigator: {
      screen: SettingsStack,
      options: {
        tabBarLabel: translate("tabNavigator.settingsLabel"),
        tabBarIcon: ({ focused, color }) => <Icon icon="faGears" color={color} size={spacing.large} />,        
      }
    },
  }

})
