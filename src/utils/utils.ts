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
    if(img && img.startsWith('http')) {
        return img
    } else {
        return `data:image/png;base64,${img}`
    }
}


export const infoMessage = function(message: string, description?: string) {
    const backgroundColor = colors.palette.success300
    const textColor = 'white'
    
    return showMessage({
        message,
        description,        
        backgroundColor,
        color: textColor,
        style: {
            minHeight: spacing.screenHeight * 0.15, 
            borderTopLeftRadius: spacing.medium, 
            borderTopRightRadius: spacing.medium
        },        
    })
}


export const warningMessage = function(message: string, description?: string) {
    const backgroundColor = colors.palette.accent500
    
    return showMessage({
        message,
        description,
        duration: 3000,     
        backgroundColor,
        color: 'white',
        style: {
            minHeight: spacing.screenHeight * 0.15, 
            borderTopLeftRadius: spacing.medium, 
            borderTopRightRadius: spacing.medium
        },        
    })
}


