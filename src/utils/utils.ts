import { showMessage } from "react-native-flash-message"
import { colors, spacing, useThemeColor } from "../theme"
import QuickCrypto from 'react-native-quick-crypto'
import { log } from "../services/logService"

/**
 * sleep statement.
 *
 * @param ms The number of milliseconds to wait.
 */
export const delay = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

/**
 * resolve image as either url resource or base64 encoded png.
 *
 * @param img string
 */

export const getImageSource = function(img: string) {
    if(img && img.startsWith('http')) {
        return img
    } else {
        return `data:image/png;base64,${img}`
    }
}


export const infoMessage = function(message: string, description?: string) {
    const backgroundColor = colors.palette.neutral500
    const textColor = 'white'
    
    return showMessage({
        message,
        description,
        duration: 3000,          
        backgroundColor,
        color: textColor,
        style: {
            minHeight: spacing.screenHeight * 0.05, 
            borderRadius: spacing.medium,             
            margin: spacing.large,
            marginBottom: spacing.large * 4,
        },        
    })
}


export const generateId = function (lengthInBytes: number) {        
        const random = QuickCrypto.randomBytes(lengthInBytes)
        const uint8Array = new Uint8Array(random)
        
        const id: string = Buffer.from(uint8Array).toString('hex')
        log.trace('[generateId]', {id})
        return id
}


