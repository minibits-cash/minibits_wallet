import {useCallback, useRef} from 'react'
import {BackHandler} from 'react-native'
import {useFocusEffect} from '@react-navigation/native'

/**
 * Overrides the Android back button while the calling screen is focused, for
 * screens whose header back does something other than goBack(). Handlers run
 * newest first, so this wins over the app-wide one in navigationUtilities.
 * Pass undefined to keep the default behaviour.
 */
export function useHardwareBack(onBack?: () => void) {
    const onBackRef = useRef(onBack)
    onBackRef.current = onBack
    const isEnabled = !!onBack

    useFocusEffect(
        useCallback(() => {
            if (!isEnabled) return
            const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
                onBackRef.current?.()
                return true
            })
            return () => subscription.remove()
        }, [isEnabled]),
    )
}
