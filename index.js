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
import {
  LISTEN_FOR_NWC_EVENTS
} from './src/models/NwcStore'
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

      // NWC command received by push notification
      if(notification.data.task === HANDLE_NWC_REQUEST_TASK) {
        log.info(`[registerForegroundService] Submitting task ${HANDLE_NWC_REQUEST_TASK} to the queue.`)
        
        const {nwcStore} = rootStoreInstance
        // if an app is in killed state, state is not loaded
        if(nwcStore.all.length === 0) {        
            await setupRootStore(rootStoreInstance)        
        }
        
        WalletTask.handleNwcRequestQueue({requestEvent: notification.data.data})        
      }

      // Listen for NWC commands from minibits relay over ws if push notifications are not enabled
      if(notification.data.task === LISTEN_FOR_NWC_EVENTS) {
        const {nwcStore} = rootStoreInstance
        nwcStore.listenForNwcEvents() 
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


notifee.onForegroundEvent(async ({ type, detail }) => {
  log.trace('[onForegroundEvent]', {type, detail})
  
  if (detail.pressAction.id === 'stop') {
    log.trace('[onForegroundEvent] Stopping foreground service')
    await notifee.stopForegroundService()
  }
})

notifee.onBackgroundEvent(async ({ type, detail }) => {
  return true
})

messaging().onMessage(NotificationService.onForegroundNotification)
messaging().setBackgroundMessageHandler(NotificationService.onBackgroundNotification)
NotificationService.initNotifications()

AppRegistry.registerComponent(appName, () => BootstrapApp)
