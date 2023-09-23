import { showMessage } from "react-native-flash-message"
import { colors, spacing, useThemeColor } from "../theme"

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
    if(img.startsWith('http')) {
        return img
    } else {
        return `data:image/png;base64,${img}`
    }
}


export const infoMessage = function(message: string, description?: string) {
    const backgroundColor = colors.dark.info
    
    return showMessage({
        message,
        description,        
        backgroundColor,
        color: 'white',
        style: {minHeight: spacing.screenHeight * 0.15, borderTopLeftRadius: spacing.medium, borderTopRightRadius: spacing.medium},        
    })
}


