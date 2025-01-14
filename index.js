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

      const {nwcStore, userSettingsStore, walletStore} = rootStoreInstance

      if(notification.android.channelId === NWC_CHANNEL_ID) {        
        if(nwcStore.all.length === 0) {        
            await setupRootStore(rootStoreInstance)        
        }      
        
        nwcStore.handleNwcRequestFromNotification(notification.data).catch((e) => {
          log.error('[registerForegroundService]', e.message)
        })
      }

      if(notification.android.channelId === TASK_QUEUE_CHANNEL_ID) {

        const tasksArray = notification.data.tasksToRun.split('|')
        
        if(tasksArray.includes('handleClaim')) {
          WalletTask.handleClaim()
        }
        
        if(tasksArray.includes('syncPendingStateWithMints')) {
          WalletTask.syncPendingStateWithMints()
        }

        if(tasksArray.includes('handlePendingTopups')) {
          WalletTask.handlePendingTopups()
        }
        
        if(tasksArray.includes('handleInFlight')) {
          WalletTask.handleInFlight()
        }

        if(tasksArray.includes('syncSpendableStateWithMints')) {
          WalletTask.syncSpendableStateWithMints()   
        }

        if(tasksArray.includes('sendAll')) {
          WalletTask.sendAll()   
        }

        if(tasksArray.includes('refreshExchangeRate') && userSettingsStore.exchangeCurrency) {        
            walletStore.refreshExchangeRate(userSettingsStore.exchangeCurrency)
        }
      }

    } catch(e) {
      log.error('[registerForegroundService]', e.message)
    }
  })
})

// Setup notification listeners and handlers
messaging().onMessage(NotificationService.onForegroundNotification)
messaging().setBackgroundMessageHandler(NotificationService.onBackgroundNotification)

AppRegistry.registerComponent(appName, () => BootstrapApp)
