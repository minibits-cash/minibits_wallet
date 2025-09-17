import notifee, { AndroidImportance, AuthorizationStatus, DisplayedNotification } from '@notifee/react-native'
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
import { LISTEN_FOR_NWC_EVENTS, NwcRequest, nwcPngUrl } from '../models/NwcStore';
import { HANDLE_NWC_REQUEST_TASK, WalletTask, WalletTaskResult } from './walletService'
import { SyncQueue } from './syncQueueService'
import { delay } from '../utils/delay'
import TaskQueue, { Task, TaskId, TaskStatus } from 'taskon'
import { minibitsPngIcon } from '../components/MinibitsIcon'

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

let _nwcQueue: any = undefined

const getNwcQueue = function () {
    if(!_nwcQueue) {
        _nwcQueue = new TaskQueue({
            concurrency: 1, // strictly synchronous processing
            returnError: true,
            stopOnError: false,            
            taskPrioritizationMode: "head",            
          })
        return _nwcQueue as TaskQueue
    }

    return _nwcQueue as TaskQueue
}


const addNwcQueueTask = function (taskId: TaskId, task: Promise<any> | any) {
    const queue = getNwcQueue()

    log.info(`Adding new nwcQueue task ${taskId} to the queue`)

    queue
    .addTask(
        task,
        taskId, _handleNwcQueueTaskStatusChange)
    .then((result: any) => {
        log.info(`nwcQueue task ${taskId} completed.`)
    })
    
}

const _handleNwcQueueTaskStatusChange = (status: TaskStatus) => {
    log.trace(
        `[_handleNwcQueueTaskStatusChange] The status of task changed to ${status}`,
    )
}


const DEFAULT_CHANNEL_ID = 'default'
const DEFAULT_CHANNEL_NAME = 'Minibits notifications'

const NWC_CHANNEL_ID = 'nwcDefault';
const NWC_CHANNEL_NAME = 'Minibits NWC payment'
export const NWC_LISTENER_NAME = 'Minibits NWC listener'

export const TASK_QUEUE_CHANNEL_ID = 'internalDefault'
export const TASK_QUEUE_CHANNEL_NAME = 'Minibits tasks'

export const TEST_CHANNEL_ID = 'testDefault'
export const TEST_CHANNEL_NAME = 'Minibits test tasks'

const initNotifications = async () => {
    let enabled = await areNotificationsEnabled()
    log.debug(`[initNotifications] Push notifications are ${enabled ? 'enabled' : 'disabled'}.`)

    if(!enabled) return    

    await messaging().registerDeviceForRemoteMessages()
    const deviceToken = await messaging().getToken()
    log.trace(`[initNotifications] Device token: ${deviceToken}`)
    if(Platform.OS === 'ios') {
        const apnsToken = await messaging().getAPNSToken()
        log.trace(`[initNotifications] APNS token: ${apnsToken}`)        
    }
    
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

    if(Platform.OS === 'android') {
    
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
                name: TEST_CHANNEL_NAME,
                sound: 'default',
                })
            }
        })  
    } else {
        await notifee.setNotificationCategories([
            {
                id: DEFAULT_CHANNEL_ID,              
            },
            {
                id: NWC_CHANNEL_ID,              
            },
            {
                id: TASK_QUEUE_CHANNEL_ID,              
            },
        ]);
    }

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

        // Process NWC request notified by FCM message by dedicated queue to avoid race condition
        // when starting foreground service
        if(remoteData.type === 'NotifyNwcRequestData') {
            const now = new Date().getTime()

            addNwcQueueTask(
                `_nwcRequestHandler-${now}`,
                async () => await _nwcRequestHandler(remoteData)
            )

            return
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

        // Process NWC request notified by FCM message by dedicated queue to avoid race condition
        // when starting foreground service
        if(remoteData.type === 'NotifyNwcRequestData') {
            const now = new Date().getTime()
            
            addNwcQueueTask(
                `_nwcRequestHandler-${now}`,
                async () => await _nwcRequestHandler(remoteData)
            )           
            
            return
        }

        throw new AppError(Err.VALIDATION_ERROR, 'Unknown remoteData.type', {remoteData})       
        
    } catch (e: any) {
        log.error(e.name, e.message)
    }  
}


const _receiveToLnurlHandler = async function(remoteData: NotifyReceiveToLnurlData) {   
    const {amount, unit, comment, zapSenderProfile} = remoteData.data
    const currencyCode = getCurrency(unit as MintUnit).code

    await createLocalNotification(
        Platform.OS === 'android' ? `<b>⚡${formatCurrency(amount, currencyCode)} ${currencyCode}</b> incoming!` : `⚡${formatCurrency(amount, currencyCode)} ${currencyCode} incoming!`,
        Platform.OS === 'android' ? `${zapSenderProfile ? 'Zap' : 'Payment'} from <b>${zapSenderProfile?.nip05 || 'unknown payer'}</b> is ready to be received.${comment ? ' Message from sender: ' + comment : ''}` : `${zapSenderProfile ? 'Zap' : 'Payment'} from ${zapSenderProfile?.nip05 || 'unknown payer'} is ready to be received.${comment ? ' Message from sender: ' + comment : ''}`,
        zapSenderProfile?.picture       
    )
}


const _nwcRequestHandler = async function(remoteData: NotifyNwcRequestData) {    
    log.trace('[_nwcRequestHandler] start')    

    const {requestEvent} = remoteData.data
    const {nwcStore} = rootStoreInstance
    
    if(nwcStore.all.length === 0) {        
        await setupRootStore(rootStoreInstance)        
    }

    // start new foreground service only if none is running    
    const queue: TaskQueue = SyncQueue.getSyncQueue()
    const isNwcRequestTaskRunning = queue.getAllTasksDetails(['idle', 'running'])
        .some(task => String(task.taskId).includes('handleNwcRequestTask'))   

    if(!isNwcRequestTaskRunning) {
        
        if(Platform.OS === 'android') {
            const isChannelCreated = await notifee.isChannelCreated(NWC_CHANNEL_ID)
            if (!isChannelCreated) {
                await notifee.createChannel({
                    id: NWC_CHANNEL_ID,
                    name: NWC_CHANNEL_NAME,
                    sound: 'default',
                })
            }
        }

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
                actions: [
                    {
                      title: 'Stop',
                      pressAction: {
                        id: 'stop',
                      },
                    },
                ],
            },
            ios: {
                categoryId: NWC_CHANNEL_ID,
            },
            data: {task: HANDLE_NWC_REQUEST_TASK,  data: requestEvent}, // Pass the task data to the foreground service
        })

        if(Platform.OS === 'ios') {
            WalletTask.handleNwcRequestQueue({requestEvent})
        }
            

    } else {
        // if fg service is already running, add new nwc command to the queue
        WalletTask.handleNwcRequestQueue({requestEvent})
        
        if(Platform.OS === 'ios') {

            await notifee.displayNotification({
                title: NWC_CHANNEL_NAME,
                body: 'Processing remote NWC command...',
                ios: {
                    categoryId: NWC_CHANNEL_ID,
                }
            })
        }
        
    }

    // make some room for foreground service to start and pass nwcRequest to the queue
    // to avoid new one being attempted
    await delay(500)
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


// Foreground service creation for Android long running tasks
const createTaskNotification = async function (body: string, data: {task: string, data?: any}) {
    log.trace('Start', {body, data}, 'createTaskNotification')
    
    const isChannelCreated = await notifee.isChannelCreated(TASK_QUEUE_CHANNEL_ID)
    if (!isChannelCreated) {
        await notifee.createChannel({
            id: TASK_QUEUE_CHANNEL_ID,
            name: TASK_QUEUE_CHANNEL_NAME,
            sound: 'default',
        })
    }    
        
    return notifee.displayNotification({
        title: TASK_QUEUE_CHANNEL_NAME,
        body,
        android: {
            channelId: TASK_QUEUE_CHANNEL_ID,
            asForegroundService: true,
            largeIcon: minibitsPngIcon,
            importance: AndroidImportance.HIGH,
            progress: {
                indeterminate: true,
            },
            actions: [
                {
                  title: 'Stop',
                  pressAction: {
                    id: 'stop',
                  },
                },
            ],
        },
        ios: {
            categoryId: TASK_QUEUE_CHANNEL_ID,
        },
        data
    })
}


const createNwcListenerNotification = async function () {

    if(Platform.OS !== 'android') {
        return
    }

    log.trace('Start', 'createNwcListenerNotification')

    const isChannelCreated = await notifee.isChannelCreated(NWC_CHANNEL_ID)
    if (!isChannelCreated) {
        await notifee.createChannel({
            id: NWC_CHANNEL_ID,
            name: NWC_CHANNEL_NAME,
            sound: 'default',
        })
    }    
        
    return notifee.displayNotification({
        title: NWC_LISTENER_NAME,
        body: 'Listening for NWC commands...',
        android: {
            channelId: NWC_CHANNEL_ID,
            asForegroundService: true,
            largeIcon: minibitsPngIcon,
            importance: AndroidImportance.HIGH,
            /*progress: {
                indeterminate: true,
            },*/
            actions: [
                {
                  title: 'Stop',
                  pressAction: {
                    id: 'stop',
                  },
                },
            ],
        },
        data: {task: LISTEN_FOR_NWC_EVENTS}
    })
}


// Local notification creation
const createLocalNotification = async function (title: string, body: string, largeIcon?: string) {
    log.trace('Start', {title, body, largeIcon}, 'createLocalNotification')
    // Request permissions (required for iOS)
    if(Platform.OS === 'ios') {
      await notifee.requestPermission()
    }
    
    const isChannelCreated = await notifee.isChannelCreated(DEFAULT_CHANNEL_ID)
    if (!isChannelCreated) {
        await notifee.createChannel({
            id: DEFAULT_CHANNEL_ID,
            name: DEFAULT_CHANNEL_NAME,
            sound: 'default',
        })
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
            ios: {
                categoryId: DEFAULT_CHANNEL_ID,
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
            ios: {
                categoryId: DEFAULT_CHANNEL_ID,
            },
        })
        
        return notificationId
    }    
}


const getDisplayedNotifications = async function (): Promise<DisplayedNotification[]> {
    const notifications = await notifee.getDisplayedNotifications()
    return notifications
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
    createTaskNotification,
    createNwcListenerNotification,
    createLocalNotification,
    onBackgroundNotification,
    onForegroundNotification,    
    areNotificationsEnabled,
    getDisplayedNotifications,
    stopForegroundService
}