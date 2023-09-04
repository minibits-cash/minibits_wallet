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