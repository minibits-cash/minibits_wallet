import { Platform } from 'react-native'
import NfcManager, { NfcTech, Ndef, NfcEvents, TagEvent } from 'react-native-nfc-manager'
import { log } from './logService'
import AppError, { Err } from '../utils/AppError'


const NFC_STALE_DELAY_MS = 120

// Android NfcAdapter reader-mode flags (react-native-nfc-manager passes these through
// to NfcAdapter.enableReaderMode). HCE peers present as ISO-DEP over NFC-A/NFC-B, so we
// must enable those. Enabling reader mode is what makes our foreground session take
// EXCLUSIVE control of the NFC stack and suppress the OS "Complete action using…" chooser
// + other installed wallets (Zeus/Blixt/WoS) from intercepting the tap.
const FLAG_READER_NFC_A = 0x1
const FLAG_READER_NFC_B = 0x2
const FLAG_READER_NO_PLATFORM_SOUNDS = 0x100
const READER_MODE_FLAGS =
    FLAG_READER_NFC_A | FLAG_READER_NFC_B | FLAG_READER_NO_PLATFORM_SOUNDS

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
        await NfcManager.requestTechnology(NfcTech.Ndef, {
            isReaderModeEnabled: true, // use NfcAdapter.enableReaderMode, not enableForegroundDispatch
            readerModeFlags: READER_MODE_FLAGS,
        }) // needs to run only once per read/write session
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
        const bytes = Ndef.encodeMessage([Ndef.textRecord(text)])
        await NfcManager.ndefHandler.writeNdefMessage(bytes)
        log.trace('[writeNdefMessage] write completed')
        await NfcManager.cancelTechnologyRequest().catch(() => {}) // close session
    } catch(e: any) {
        throw new AppError(Err.NFC_ERROR, e.message, {caller: 'writeNdefMessage', error: String(e)})
    }
}


/**
 * Decodes the text payload of the first NDEF record of a tag, handling both Well-Known
 * Text records (how invoices/tokens are shared over NFC, see writeNdefMessage) and URI
 * records (e.g. lightning: URIs).
 */
const decodeNdefTagText = function (tag: TagEvent | null | undefined): string | undefined {
    const record = tag?.ndefMessage?.[0]
    if (!record?.payload) return undefined

    const bytes = new Uint8Array(record.payload as number[])

    if (Ndef.isType(record, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI)) {
        return Ndef.uri.decodePayload(bytes) || undefined
    }
    return Ndef.text.decodePayload(bytes) || undefined
}


/**
 * Returns the text content of the NDEF tag that COLD-launched the app, if any.
 *
 * When the app is launched from a closed state by an Android NDEF_DISCOVERED intent (e.g.
 * tapping another wallet's HCE share and picking Minibits in the OS chooser), a Well-Known
 * Text record carries no data URI — only an EXTRA_NDEF_MESSAGES extra on the launch intent,
 * which React Native's Linking module misses. getLaunchTagEvent() parses that launch intent.
 *
 * Returns undefined when the app was not launched by an NFC tag (the parsed intent has no
 * EXTRA_TAG), which makes this a reliable "was this an NFC launch?" discriminator.
 *
 * getLaunchTagEvent() reads the activity's launch intent, which persists across React
 * remounts; we therefore consume the launch tag only ONCE per app process so a remount of
 * the caller (e.g. WalletScreen) does not re-process and re-navigate to the same payment.
 *
 * @returns the decoded NDEF text, or undefined if the app was not launched by an NFC tag
 */
let launchNdefConsumed = false
const getLaunchNdefText = async function (): Promise<string | undefined> {
    if (Platform.OS !== 'android') return undefined // getLaunchTagEvent is Android-only
    if (launchNdefConsumed) return undefined
    try {
        const tag = await NfcManager.getLaunchTagEvent()
        const text = decodeNdefTagText(tag)
        if (text) launchNdefConsumed = true // only consume when we actually found NFC data
        return text
    } catch (e: any) {
        log.warn('[getLaunchNdefText] failed to read launch NFC tag', { error: String(e) })
        return undefined
    }
}


/**
 * Registers a listener for NDEF tags that arrive while the app is backgrounded (WARM resume)
 * and brought to the foreground by an NFC dispatch. The library emits DiscoverBackgroundTag
 * from its onNewIntent handler when no foreground reader session is active.
 *
 * @param onData called with the decoded NDEF text of the background tag
 */
const setBackgroundTagListener = function (onData: (text: string) => void) {
    if (Platform.OS !== 'android') return
    NfcManager.setEventListener(NfcEvents.DiscoverBackgroundTag, (tag: TagEvent) => {
        const text = decodeNdefTagText(tag)
        // Clear the stored background tag so it cannot be re-read later (e.g. via
        // getBackgroundTag on a remount); the event already delivered it to us here.
        NfcManager.clearBackgroundTag().catch(() => {})
        if (text) onData(text)
    })
}

const removeBackgroundTagListener = function () {
    if (Platform.OS !== 'android') return
    NfcManager.setEventListener(NfcEvents.DiscoverBackgroundTag, null)
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
    getLaunchNdefText,
    setBackgroundTagListener,
    removeBackgroundTagListener,
}