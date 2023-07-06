import 'react-native-reanimated' // needed for qrcode reader
import Crypto from 'react-native-quick-crypto' // needed for secp256k1, conf in babel.config
import 'react-native-url-polyfill/auto' // URL.host etc
import 'text-encoding-polyfill' // needed in cashu-ts
import {AppRegistry} from 'react-native'
import App from './src/App'
import {name as appName} from './app.json'


function BootstrapApp() {
  return <App appName={appName} />
}

AppRegistry.registerComponent(appName, () => BootstrapApp)
