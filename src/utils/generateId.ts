import QuickCrypto from 'react-native-quick-crypto'
import { log } from '../services/logService'

/**
 * Random hex id of `lengthInBytes` bytes.
 *
 * Lives in its own module rather than in `utils.ts`, whose other exports are UI
 * helpers — a toast built on react-native-flash-message and the theme barrel (and
 * so, transitively, the service layer). The MODEL layer needs only this function,
 * and importing it from that grab-bag made Mint and ProofsStore depend on the whole
 * UI stack to generate an id.
 */
export const generateId = function (lengthInBytes: number) {
    const random = QuickCrypto.randomBytes(lengthInBytes)
    const uint8Array = new Uint8Array(random)

    const id: string = Buffer.from(uint8Array).toString('hex')
    log.trace('[generateId]', {id})
    return id
}
