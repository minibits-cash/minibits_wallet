import notifee, { AndroidImportance } from '@notifee/react-native'
import { colors } from '../theme';
import { log } from '../utils/logger';


const createLocalNotification = async function (title: string, body: string, largeIcon?: string) {
    log.trace('Start', {title, body, largeIcon}, 'createLocalNotification')
    // Request permissions (required for iOS)
    await notifee.requestPermission()

    // Create a channel (required for Android)
    const channelId = await notifee.createChannel({
      id: 'important',
      name: 'Minibits payment notifications',
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
              largeIcon
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
            },
        })
        
        return notificationId
    }    
}


const updateLocalNotification = async function (id: string, update: { title: string, body: string}) {
    // Request permissions (required for iOS)
    // await notifee.requestPermission()

    // Create a channel (required for Android)
    const channelId = await notifee.createChannel({
      id: 'default',
      name: 'Default Channel',
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
        // smallIcon: 'name-of-a-small-icon', // optional, defaults to 'ic_launcher'.
        // pressAction is needed if you want the notification to open the app when pressed
        /* pressAction: {
          id: 'default',
        },*/
      },
    });
}


const cancelNotification = async function (id: string) {
    await notifee.cancelNotification(id)
}

export const NotificationService = {
    createLocalNotification,
    updateLocalNotification,
    cancelNotification,
}