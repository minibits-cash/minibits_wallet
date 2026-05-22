import {Platform} from 'react-native'
import {Contact} from '../../models/Contact'
import {NotificationService} from '../notificationService'
import {CurrencyCode, MintUnit, formatCurrency, getCurrency} from './currency'

export const sendTopupNotification = async function (amount: number, unit: MintUnit) {
    const currencyCode = getCurrency(unit).code
    await NotificationService.createLocalNotification(
        `⚡ ${formatCurrency(amount, currencyCode)} ${currencyCode} received!`,
        `Your invoice has been paid and your wallet balance credited with ${formatCurrency(amount, currencyCode)} ${currencyCode}.`,
    )
}

export const sendReceiveNotification = async function (
    receivedAmount: number,
    feePaid: number,
    unit: MintUnit,
    isZap: boolean,
    sentFrom: string,
    sentFromPicture?: string,
): Promise<void> {
    const getNotificationContent = (
        amount: number,
        currency: CurrencyCode,
        zap: boolean,
        sender: string,
    ): {title: string; body: string} => {
        const title = Platform.OS === 'android'
            ? `<b>⚡${formatCurrency(amount, currency)} ${currency}</b> received!`
            : `⚡${formatCurrency(amount, currency)} ${currency} received!`
        const body = Platform.OS === 'android'
            ? `${zap ? 'Zap' : 'Ecash'} from <b>${sender || 'unknown payer'}</b> is now in your wallet.${feePaid > 0 ? ` Fee paid: ${formatCurrency(feePaid, currency)} ${currency}.` : ''}`
            : `${zap ? 'Zap' : 'Ecash'} from ${sender || 'unknown payer'} is now in your wallet.${feePaid > 0 ? ` Fee paid: ${formatCurrency(feePaid, currency)} ${currency}.` : ''}`
        return {title, body}
    }

    const enabled = await NotificationService.areNotificationsEnabled()
    if (!enabled) return

    const currencyCode = getCurrency(unit).code
    if (receivedAmount && receivedAmount > 0) {
        const {title, body} = getNotificationContent(receivedAmount, currencyCode, isZap, sentFrom)
        await NotificationService.createLocalNotification(title, body, sentFromPicture)
    }
}

export const sendErrorReceiveNotification = async function (
    amountToReceive: number,
    unit: MintUnit,
    mint: string,
): Promise<void> {
    const getNotificationContent = (
        amount: number,
        currency: CurrencyCode,
    ): {title: string; body: string} => {
        const title = Platform.OS === 'android'
            ? `<b>Received ${formatCurrency(amount, currency)} ${currency} ecash token from unknonw mint!</b>`
            : `Received ${formatCurrency(amount, currency)} ${currency} ecash token from unknonw mint!`
        const body = Platform.OS === 'android'
            ? `Add <b>${mint}</b> to your wallet first to receive ecash over the Nostr network.`
            : `Add ${mint} to your wallet first to receive ecash over the Nostr network.`
        return {title, body}
    }

    const enabled = await NotificationService.areNotificationsEnabled()
    if (!enabled) return

    const currencyCode = getCurrency(unit).code
    if (amountToReceive && amountToReceive > 0) {
        const {title, body} = getNotificationContent(amountToReceive, currencyCode)
        await NotificationService.createLocalNotification(title, body)
    }
}

export const sendIncomingInvoiceNotification = async function (
    amount: number,
    unit: MintUnit,
    from: Contact,
) {
    await NotificationService.createLocalNotification(
        Platform.OS === 'android'
            ? `⚡ Please pay <b>${formatCurrency(amount, getCurrency(unit).code)} ${getCurrency(unit).code}</b>!`
            : `⚡ Please pay ${formatCurrency(amount, getCurrency(unit).code)} ${getCurrency(unit).code}!`,
        `${from.nip05 || 'Unknown'} has sent you a request to pay.`,
        from.picture,
    )
}
