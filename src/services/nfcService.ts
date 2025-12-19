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
/* const withFreshNfcConnection = async <T>(action: () => Promise<T>): Promise<T> => {
    // Cancel any previous session
    await NfcManager.cancelTechnologyRequest().catch(() => {})
    log.trace('[withFreshNfcConnection] Pre-cancel completed')

    if (Platform.OS === 'android') {
        await new Promise(r => setTimeout(r, NFC_STALE_DELAY_MS))
    }

    try {
        return await action()
    } finally {
        await NfcManager.cancelTechnologyRequest().catch(() => {})
        log.trace('[withFreshNfcConnection] Post-cancel completed')
    }
}*/


const readNdefTag = async () => {
    log.trace('[readNdefTag] start')
    try {
        await NfcManager.requestTechnology(NfcTech.Ndef) // needs to run only once per read/write session
        log.trace('[readNdefTag] requestTechnology completed')
        const tag = await NfcManager.getTag()
        log.trace('[readNdefTag] tag read') // do not close session
        
        return tag
    } catch(e: any) {
        throw new AppError(Err.NFC_ERROR, e.message, {caller: 'readNdefTag', error: String(e)})
    }
}


const writeNdefMessage = async (text: string) => {
    try {
        log.trace('[writeNdefMessage] start') // no more requestTechnology, it requires second tap then
        const bytes = Ndef.encodeMessage([Ndef.textRecord('en', text)])
        await NfcManager.ndefHandler.writeNdefMessage(bytes)
        log.trace('[writeNdefMessage] write completed')
        await NfcManager.cancelTechnologyRequest().catch(() => {}) // close session
    } catch(e: any) {
        throw new AppError(Err.NFC_ERROR, e.message, {caller: 'writeNdefMessage', error: String(e)})
    }
}


/**
 * Checks if a string is safe to broadcast via Android NFC HCE (Type 4 Tag emulation)
 * Safe limit: 32,000 bytes (conservative, accounts for NDEF overhead)
 * 
 * @param str The string to check (e.g., token, invoice, URL)
 * @returns true if the string's byte size is safely under the limit, false otherwise
 */
const isStringSafeForNFC = function (str: string): boolean {
    const SAFE_NFC_BYTE_LIMIT = 32000 // Conservative limit (leaves room for NDEF wrapper)
  
    try {
      // Encode string to UTF-8 bytes
      const encoder = new TextEncoder()
      const bytes = encoder.encode(str)
      
      return bytes.length <= SAFE_NFC_BYTE_LIMIT
    } catch (error) {
      console.warn('Error measuring string byte size:', error)
      return false
    }
  }

export const NfcService = {
    init,
    isEnabled,
    isStringSafeForNFC,
    goToNfcSetting,
    readNdefTag,
    writeNdefMessage,
}