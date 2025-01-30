import notifee, { AndroidImportance, AuthorizationStatus } from '@notifee/react-native'
import { colors } from '../theme'
import { log } from './logService'
import {
    MINIBIT_SERVER_NOSTR_PUBKEY,    
} from '@env'
import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging'
import { MintUnit, formatCurrency, getCurrency } from './wallet/currency'
import { NostrClient, NostrEvent, NostrProfile } from './nostrService'
import AppError, { Err } from '../utils/AppError'
import { Platform } from 'react-native'
import { rootStoreInstance, setupRootStore } from '../models'
import { NwcRequest, nwcPngUrl } from '../models/NwcStore';
import { HANDLE_NWC_REQUEST_TASK, WalletTask, WalletTaskResult } from './walletService'
import { SyncQueue } from './syncQueueService'
import { delay } from '../utils/delay'
import TaskQueue from 'taskon'

export type NotifyReceiveToLnurlData = {
    type: 'NotifyReceiveToLnurlData',
    data: {
        amount: number,
        unit: 'sat',
        comment?: string | null,
        zapSenderProfile?: NostrProfile
    }    
}

export type NotifyNwcRequestData = {
  type: 'NotifyNwcRequestData',
  data: {
    requestEvent: NostrEvent,
  }
}

const DEFAULT_CHANNEL_ID = 'default'
const DEFAULT_CHANNEL_NAME = 'Minibits notifications'

const NWC_CHANNEL_ID = 'nwcDefault';
const NWC_CHANNEL_NAME = 'Minibits NWC payment'

export const TASK_QUEUE_CHANNEL_ID = 'internalDefault'
export const TASK_QUEUE_CHANNEL_NAME = 'Minibits tasks'

export const TEST_CHANNEL_ID = 'testDefault'
export const TEST_CHANNEL_NAME = 'Minibits test tasks'

const initNotifications = async () => {
    messaging().onMessage(onForegroundNotification)
    messaging().setBackgroundMessageHandler(onBackgroundNotification)

    let enabled = await areNotificationsEnabled()
    log.trace(`[initNotifications] Push notifications are ${enabled ? 'enabled' : 'disabled'}.`)

    if(!enabled) return    

    await messaging().registerDeviceForRemoteMessages()
    const deviceToken = await messaging().getToken()
    log.trace(`[initNotifications] Device token: ${deviceToken}`)
    
    const {walletProfileStore} = rootStoreInstance
    if(deviceToken && deviceToken !== walletProfileStore.device) {
        // if device token changed, update the server        
        await walletProfileStore.setDevice(deviceToken)        
    }

    messaging().onTokenRefresh(token => {
        if(token !== walletProfileStore.device) {
            walletProfileStore.setDevice(token)
        }
    })

    notifee.isChannelCreated(DEFAULT_CHANNEL_ID).then(isCreated => {
        if (!isCreated) {
            notifee.createChannel({
            id: DEFAULT_CHANNEL_ID,
            name: DEFAULT_CHANNEL_NAME,
            vibration: true,
            importance: AndroidImportance.HIGH,
            })
        }
    })      
    
    notifee.isChannelCreated(NWC_CHANNEL_ID).then(isCreated => {
        if (!isCreated) {
            notifee.createChannel({
            id: NWC_CHANNEL_ID,
            name: NWC_CHANNEL_NAME,
            sound: 'default',
            })
        }
    })

    notifee.isChannelCreated(TASK_QUEUE_CHANNEL_ID).then(isCreated => {
        if (!isCreated) {
            notifee.createChannel({
            id: TASK_QUEUE_CHANNEL_ID,
            name: TASK_QUEUE_CHANNEL_NAME,
            sound: 'default',
            })
        }
    })

    notifee.isChannelCreated(TEST_CHANNEL_ID).then(isCreated => {
        if (!isCreated) {
            notifee.createChannel({
            id: TEST_CHANNEL_ID,
            name: TASK_QUEUE_CHANNEL_NAME,
            sound: 'default',
            })
        }
    })


}

// Remote notification receive handler
const onForegroundNotification = async function(remoteMessage: FirebaseMessagingTypes.RemoteMessage) {
    log.trace('[onForegroundNotification]', {remoteMessage})
    try {

        const remoteData = await _getRemoteData(remoteMessage)

        // Process notification about incoming lightning address / zap payment
        if(remoteData.type === 'NotifyReceiveToLnurlData') {
            return _receiveToLnurlHandler(remoteData)    
        }

        // Process NWC request notified by FCM message
        if(remoteData.type === 'NotifyNwcRequestData') {            
            // log.trace('[onForegroundNotification] App is in foreground, skipping NWC requestHandler')
            return _nwcRequestHandler(remoteData)  
        }

        throw new AppError(Err.VALIDATION_ERROR, 'Unknown remoteData.type', {remoteData})       
        
    } catch (e: any) {
        log.error(e.name, e.message)
    }
  
}

const onBackgroundNotification = async function(remoteMessage: FirebaseMessagingTypes.RemoteMessage) {
    log.trace('[onBackgroundNotification]', {remoteMessage})
    try {

        const remoteData = await _getRemoteData(remoteMessage)

        // Process notification about incoming lightning address / zap payment
        if(remoteData.type === 'NotifyReceiveToLnurlData') {
            return _receiveToLnurlHandler(remoteData)          
        }

        // Process NWC request notified by FCM message
        if(remoteData.type === 'NotifyNwcRequestData') {
            if(isNwcRequestHandlerRunning) {
                await delay(1000)
                return _nwcRequestHandler(remoteData)
                  
            } else {
                return _nwcRequestHandler(remoteData)      
            }                     
        }

        throw new AppError(Err.VALIDATION_ERROR, 'Unknown remoteData.type', {remoteData})       
        
    } catch (e: any) {
        log.error(e.name, e.message)
    }  
}

const isNotificationDisplayed = async function (options: { foregroundServiceOnly?: boolean }): Promise<boolean> {
    const { foregroundServiceOnly } = options
    const notifications = await notifee.getDisplayedNotifications()
    let isDisplayed: boolean = false

    log.trace('[isNotificationDisplayed] Displayed notifications', {notifications, foregroundServiceOnly})

    for (const notification of notifications) {
        if (foregroundServiceOnly) {
            // Assuming `foreground` is a property that indicates if the notification is in the foreground
            if (notification.notification.android?.asForegroundService === true) {
                log.trace('[isNotificationDisplayed] foregroundServiceOnly true')
                isDisplayed = true
            }
        } else {
            // If foregroundOnly is false, return true as soon as we find any notification            
            isDisplayed = true
        }
    }

    // If no matching notification is found, return false
    log.trace('[isNotificationDisplayed]', isDisplayed)
    return isDisplayed
}


const _receiveToLnurlHandler = async function(remoteData: NotifyReceiveToLnurlData) {   
    const {amount, unit, comment, zapSenderProfile} = remoteData.data
    const currencyCode = getCurrency(unit as MintUnit).code

    await createLocalNotification(
        `<b>⚡${formatCurrency(amount, currencyCode)} ${currencyCode}</b> incoming!`,
        `${zapSenderProfile ? 'Zap' : 'Payment'} from <b>${zapSenderProfile?.nip05 || 'unknown payer'}</b> is ready to be received.${comment ? ' Message from sender: ' + comment : ''}`,
        zapSenderProfile?.picture       
    )
}

let isNwcRequestHandlerRunning = false

const _nwcRequestHandler = async function(remoteData: NotifyNwcRequestData) {
    log.trace('[_nwcRequestHandler] start')
    isNwcRequestHandlerRunning = true

    const {requestEvent} = remoteData.data
    const {nwcStore} = rootStoreInstance
    
    if(nwcStore.all.length === 0) {        
        await setupRootStore(rootStoreInstance)        
    }

    // start new foreground service only if none is running
    // const isForegroundServiceRunning = await isNotificationDisplayed({foregroundServiceOnly: true})
    const queue: TaskQueue = SyncQueue.getSyncQueue()
    const isNwcRequestTaskRunning = queue.getAllTasksDetails(['idle', 'running'])
        .some(task => String(task.taskId).includes('handleNwcRequestTask'))   

    if(!isNwcRequestTaskRunning) {

        await notifee.displayNotification({
            title: NWC_CHANNEL_NAME,
            body: 'Processing remote NWC command...',
            android: {
                channelId: NWC_CHANNEL_ID,
                asForegroundService: true,
                largeIcon: nwcPngUrl,
                importance: AndroidImportance.HIGH,
                progress: {
                    indeterminate: true,
                },
            },
            data: {task: HANDLE_NWC_REQUEST_TASK,  data: requestEvent}, // Pass the task data to the foreground service
        })

    } else {
        // if fg already running, add new nwc command to the queue
        WalletTask.handleNwcRequestQueue({requestEvent})        
    }

    isNwcRequestHandlerRunning = false
    log.trace('[_nwcRequestHandler] done')
}

const _getRemoteData = async function(remoteMessage: FirebaseMessagingTypes.RemoteMessage) {
   
    const {encrypted} = remoteMessage.data!

    if (!encrypted) {
        throw new AppError(Err.VALIDATION_ERROR, 'Unknown remote message data received', {data: remoteMessage.data})            
    }

    const serverPubkey = MINIBIT_SERVER_NOSTR_PUBKEY
    const decrypted = await NostrClient.decryptNip04(serverPubkey, encrypted as string)

    if (!decrypted) {
        throw new AppError(Err.VALIDATION_ERROR, 'Unknown remote message data received', {data: remoteMessage.data})
    }
    
    return JSON.parse(decrypted)
}


// Local notification creation
const createLocalNotification = async function (title: string, body: string, largeIcon?: string) {
    log.trace('Start', {title, body, largeIcon}, 'createLocalNotification')
    // Request permissions (required for iOS)
    if(Platform.OS === 'ios') {
      await notifee.requestPermission()
    }    

    // Display a notification
    if(largeIcon) {
        const notificationId = await notifee.displayNotification({
            title,
            body,
            android: {
              channelId: DEFAULT_CHANNEL_ID,
              color: colors.palette.success200,
              largeIcon,
              pressAction: {
                id: 'default',
              },
            },
        })
        
        return notificationId
    } else {
        const notificationId = await notifee.displayNotification({
            title,
            body,
            android: {
              channelId: DEFAULT_CHANNEL_ID,
              color: colors.palette.success200,
              pressAction: {
                id: 'default',
              },         
            },
        })
        
        return notificationId
    }    
}


const areNotificationsEnabled = async function (): Promise<boolean> {
  const settings = await notifee.getNotificationSettings()

  if (settings.authorizationStatus == AuthorizationStatus.AUTHORIZED) {
    return true
  } 
  
  return false
}


const stopForegroundService = async function (): Promise<void> {    
    await notifee.stopForegroundService()
    log.trace('[stopForegroundService] completed')
}

export const NotificationService = {
    initNotifications,
    createLocalNotification,
    onBackgroundNotification,
    onForegroundNotification,    
    areNotificationsEnabled,
    isNotificationDisplayed,
    stopForegroundService
}