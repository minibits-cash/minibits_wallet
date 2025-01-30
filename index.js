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
import {
  WalletTask, 
  NotificationService, 
  SWAP_ALL_TASK, 
  TEST_TASK, 
  SYNC_STATE_WITH_ALL_MINTS_TASK,
  HANDLE_NWC_REQUEST_TASK
} from './src/services'
import { log } from './src/services/logService'
import App from './src/App'
import {name as appName} from './app.json'

function BootstrapApp() {  
  return <App appName={appName} />
}

// long running tasks
notifee.registerForegroundService(async (notification) => {
  return new Promise(async (resolve) => {
    log.trace('[registerForegroundService] Foreground service starting for task:', notification.data.task)

    try {      

      if(notification.data.task === HANDLE_NWC_REQUEST_TASK) {
        log.info(`[registerForegroundService] Submitting task ${HANDLE_NWC_REQUEST_TASK} to the queue.`)
        
        const {nwcStore} = rootStoreInstance
        // if an app is in killed state, state is not loaded
        if(nwcStore.all.length === 0) {        
            await setupRootStore(rootStoreInstance)        
        }
        
        WalletTask.handleNwcRequestQueue({requestEvent: notification.data.data})        
      }
      
      if(notification.data.task === SYNC_STATE_WITH_ALL_MINTS_TASK) {
        log.debug(`[registerForegroundService] Submitting task ${SYNC_STATE_WITH_ALL_MINTS_TASK} to the queue.`)

        WalletTask.syncStateWithAllMintsQueue({isPending: false})
      }


      if(notification.data.task === SWAP_ALL_TASK) {
        log.debug(`[registerForegroundService] Submitting task ${SWAP_ALL_TASK} to the queue.`)

        WalletTask.swapAllQueue()
      }


      if(notification.data.task === TEST_TASK) {
        log.debug(`[registerForegroundService] Submitting task ${TEST_TASK} to the queue.`)

        WalletTask.testQueue()
      }

    } catch(e) {
      log.error('[registerForegroundService]', e.message)
    }
  })
})


notifee.onBackgroundEvent(async ({ type, detail }) => {
  return true
})

messaging().onMessage(NotificationService.onForegroundNotification)
messaging().setBackgroundMessageHandler(NotificationService.onBackgroundNotification)
NotificationService.initNotifications()

AppRegistry.registerComponent(appName, () => BootstrapApp)
