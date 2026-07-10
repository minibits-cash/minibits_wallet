import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { StaticParamList } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React from "react"
import { Icon } from "../components"
import { translate } from "../i18n"
import { FloatingTabBar } from "./FloatingTabBar"
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
  OptimizeEcashScreen,
  RelaysScreen,
  TranDetailScreen, 
  TranHistoryScreen,  
  TransferScreen,
  TopupScreen,
  OwnKeysScreen,
  TokenReceiveScreen,
  NwcScreen,
  CashuPaymentRequestScreen,
  RecoveryOptionsScreen,
  SeedRecoveryOptionsScreen,
  //POSScreen
} from "../screens"
// @ts-ignore
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
    Transfer: TransferScreen,
    Topup: TopupScreen,
    CashuPaymentRequest: CashuPaymentRequestScreen,
    //POS: POSScreen,
  }
})

type WalletStackParamList = StaticParamList<typeof WalletStack>
declare global {
  namespace ReactNavigation {
    interface RootParamList extends WalletStackParamList {}
  }
}

// @ts-ignore
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

// @ts-ignore
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

// @ts-ignore
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
    RecoveryOptions: RecoveryOptionsScreen,
    Mnemonic: MnemonicScreen,
    ExportBackup: ExportBackupScreen,
    OptimizeEcash: OptimizeEcashScreen,
    Developer: DeveloperScreen,
    Relays: RelaysScreen,
    Nwc: NwcScreen,
    SeedRecoveryOptions: SeedRecoveryOptionsScreen,  
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
  tabBar: (props) => <FloatingTabBar {...props} />,
  screenOptions: {
    headerShown: false,
    tabBarShowLabel: false,
    animation: 'shift',
  },
  screens: {
    WalletNavigator: {
      screen: WalletStack,
      options: {
        tabBarLabel: translate("tabNavigator_walletLabel"),
        tabBarIcon: ({ color, size }) => <Icon icon="faWallet" color={color} size={size} />,
      }
    },
    TransactionsNavigator: {
      screen: TransactionsStack,
      options: {
        tabBarLabel: translate("tabNavigator_transactionsLabel"),
        tabBarIcon: ({ color, size }) => <Icon icon="faListUl" color={color} size={size} />,
      }
    },
    ContactsNavigator: {
      screen: ContactsStack,
      options: {
        tabBarLabel: translate("tabNavigator_contactsLabel"),
        tabBarIcon: ({ color, size }) => <Icon icon="faAddressBook" color={color} size={size} />,
      }
    },
    SettingsNavigator: {
      screen: SettingsStack,
      options: {
        tabBarLabel: translate("tabNavigator_settingsLabel"),
        tabBarIcon: ({ color, size }) => <Icon icon="faGears" color={color} size={size} />,
      }
    },
  }

})
