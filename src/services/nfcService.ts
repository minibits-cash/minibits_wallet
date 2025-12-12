import { Platform } from 'react-native'
import NfcManager, { NfcTech, Ndef, NfcEvents, TagEvent } from 'react-native-nfc-manager'
import { log } from './logService'
import AppError, { Err } from '../utils/AppError'

const NFC_STALE_DELAY_MS = 120

const init = async function () {
    const supported = await NfcManager.isSupported()
    if (supported) {
      await NfcManager.start()
      
    }
    return supported
  }

const isEnabled = function () {
    return NfcManager.isEnabled()
}

const goToNfcSetting = function () {
    return NfcManager.goToNfcSetting()
}

/**
 * Ensures a fresh NFC connection by cancelling any previous session
 * and adding a tiny delay on Android
 */
const withFreshNfcConnection = async <T>(action: () => Promise<T>): Promise<T> => {
    // Cancel any previous session
    await NfcManager.cancelTechnologyRequest().catch(() => {})
    log.trace('[withFreshNfcConnection] Pre-cancel completed')

    if (Platform.OS === 'android') {
        await new Promise(r => setTimeout(r, NFC_STALE_DELAY_MS))
    }

    try {
        return await action()  // Only requestTechnology + getTag / writeNdef
    } finally {
        // This now runs IMMEDIATELY after read/write
        await NfcManager.cancelTechnologyRequest().catch(() => {})
        log.trace('[withFreshNfcConnection] Post-cancel completed')
    }
}


const readNdefTag = async () => {
    return await withFreshNfcConnection(async () => {
        log.trace('[readNdefTag] requesting technology')
        await NfcManager.requestTechnology(NfcTech.Ndef)
        log.trace('[readNdefTag] requestTechnology completed')
        const tag = await NfcManager.getTag()
        
        return tag
    })
}

const writeNdefMessage = async (text: string) => {
    return await withFreshNfcConnection(async () => {
        await NfcManager.requestTechnology(NfcTech.Ndef)
        log.trace('[writeNdefMessage] requestTechnology completed')
        const bytes = Ndef.encodeMessage([Ndef.textRecord('en', text)])
        await NfcManager.ndefHandler.writeNdefMessage(bytes)
    })
}



export const NfcService = {
    init,
    isEnabled,
    goToNfcSetting,
    readNdefTag,
    writeNdefMessage,
}