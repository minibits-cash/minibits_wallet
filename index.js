import 'react-native-reanimated' // needed for qrcode reader
import Crypto from 'react-native-quick-crypto' // needed for secp256k1, conf in babel.config
import 'react-native-url-polyfill/auto' // URL.host etc
import 'text-encoding-polyfill' // needed in cashu-ts
import {AppRegistry} from 'react-native'
import messaging from '@react-native-firebase/messaging';
import App from './src/App'
import {name as appName} from './app.json'
import { NotificationService } from './src/services/notificationService';


function BootstrapApp() {
  return <App appName={appName} />
}


// Setup notification listeners and handlers
messaging().onMessage(NotificationService.onForegroundNotification)
messaging().setBackgroundMessageHandler(NotificationService.onBackgroundNotification)

AppRegistry.registerComponent(appName, () => BootstrapApp)
