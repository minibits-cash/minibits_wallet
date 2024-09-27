import notifee, { AndroidImportance, AuthorizationStatus } from '@notifee/react-native'
import { colors } from '../theme';
import { log } from './logService';
import {
    MINIBIT_SERVER_NOSTR_PUBKEY,    
} from '@env'
import { FirebaseMessagingTypes } from '@react-native-firebase/messaging'
import { MintUnit, formatCurrency, getCurrency } from './wallet/currency'
import { NostrClient, NostrEvent, NostrProfile } from './nostrService'
import AppError, { Err } from '../utils/AppError'
import { Platform } from 'react-native'
import { RootStoreModel, rootStoreInstance, setupRootStore } from '../models';
import { ProofsStoreModel } from '../models/ProofsStore';

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

// Remote notification receive handler
const onForegroundNotification = async function(remoteMessage: FirebaseMessagingTypes.RemoteMessage) {
    log.trace('[onForegroundReceiveNotification]', {remoteMessage})
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
    log.trace('[onBackgroundReceiveNotification]', {remoteMessage})
    try {

        const remoteData = await _getRemoteData(remoteMessage)

        // Process notification about incoming lightning address / zap payment
        if(remoteData.type === 'NotifyReceiveToLnurlData') {
            return _receiveToLnurlHandler(remoteData)          
        }

        // Process NWC request notified by FCM message
        if(remoteData.type === 'NotifyNwcRequestData') {
            return _nwcRequestHandler(remoteData)
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
        `<b>⚡${formatCurrency(amount, currencyCode)} ${currencyCode}</b> incoming!`,
        `${zapSenderProfile ? 'Zap' : 'Payment'} from <b>${zapSenderProfile?.nip05 || 'unknown payer'}</b> is ready to be received.${comment ? ' Message from sender: ' + comment : ''}`,
        zapSenderProfile?.picture       
    )
}

const _nwcRequestHandler = async function(remoteData: NotifyNwcRequestData) {   
    const {requestEvent} = remoteData.data
    const {nwcStore, proofsStore} = rootStoreInstance

    // If app is killed, state is not loaded
    if(nwcStore.all.length === 0) {        
        await setupRootStore(rootStoreInstance)        
    }

    log.trace('[_nwcRequestHandler]', {connections: nwcStore.all})
    
    await nwcStore.handleNwcRequestFromNotification(requestEvent)   
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

    // Create a channel (required for Android)
    const channelId = await notifee.createChannel({
        id: 'default',
        name: 'Minibits notifications',
        vibration: true,
        importance: AndroidImportance.HIGH,
    })

    // Display a notification
    if(largeIcon) {
        const notificationId = await notifee.displayNotification({
            title,
            body,
            android: {
              channelId,
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
              channelId,
              color: colors.palette.success200,
              pressAction: {
                id: 'default',
              },         
            },
        })
        
        return notificationId
    }    
}


/*const updateLocalNotification = async function (id: string, update: { title: string, body: string}) {

    // Create a channel (required for Android)
    const channelId = await notifee.createChannel({
      id: 'default',
      name: 'Minibits notifications',      
    })

    const {title, body} = update

    // Display a notification
    await notifee.displayNotification({
      id,
      title,
      body,
      android: {
        channelId,
        color: colors.palette.success200,
        pressAction: {
          id: 'default',
        },
      },
    });
}


const cancelNotification = async function (id: string) {
    await notifee.cancelNotification(id)
}*/


const areNotificationsEnabled = async function (): Promise<boolean> {
  const settings = await notifee.getNotificationSettings()

  if (settings.authorizationStatus == AuthorizationStatus.AUTHORIZED) {
    return true
  } 
  
  return false
}

export const NotificationService = {
    onForegroundNotification,
    onBackgroundNotification,    
    createLocalNotification,
    // updateLocalNotification,
    // cancelNotification,
    areNotificationsEnabled
}