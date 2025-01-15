import 'react-native-reanimated' // needed for qrcode reader
import { install } from 'react-native-quick-crypto' // needed for secp256k1, conf in babel.config
install()
import 'react-native-url-polyfill/auto' // URL.host etc
import 'text-encoding-polyfill' // cashu-ts
import 'message-port-polyfill' // nostr-tools
import notifee from '@notifee/react-native'
import messaging from '@react-native-firebase/messaging'
import {AppRegistry} from 'react-native'
import { rootStoreInstance, setupRootStore } from './src/models'
import {WalletTask, NotificationService, NWC_CHANNEL_ID, TASK_QUEUE_CHANNEL_ID} from './src/services'
import { log } from './src/services/logService'
import App from './src/App'
import {name as appName} from './app.json'

function BootstrapApp() {  
  return <App appName={appName} />
}

// Process nwc commands as long running headless tasks
notifee.registerForegroundService(async (notification) => {
  return new Promise(async (resolve) => {
    log.trace('[registerForegroundService] Foreground service running for task:', notification)

    try {      

      if(notification.data.task === 'handleNwcRequestFromNotification') {
        const {nwcStore} = rootStoreInstance

        if(nwcStore.all.length === 0) {        
            await setupRootStore(rootStoreInstance)        
        }      
        
        nwcStore.handleNwcRequestFromNotification(notification.data.data).catch((e) => {
          log.error('[registerForegroundService]', e.message)
        })
      }
      
      if(notification.data.task === 'syncSpendableStateWithMints') {
        WalletTask.syncSpendableStateWithMints()
      }

      if(notification.data.task === 'sendAll') {
        WalletTask.sendAll() 
      }

      /*if(notification.android.channelId === TASK_QUEUE_CHANNEL_ID) {

          const tasksArray = notification.data.tasksToRun.split('|')
        
      }*/

    } catch(e) {
      log.error('[registerForegroundService]', e.message)
    }
  })
})


notifee.onBackgroundEvent(async ({ type, detail }) => {
  return true
})

// Setup notification listeners and handlers
messaging().onMessage(NotificationService.onForegroundNotification)
messaging().setBackgroundMessageHandler(NotificationService.onBackgroundNotification)

AppRegistry.registerComponent(appName, () => BootstrapApp)
