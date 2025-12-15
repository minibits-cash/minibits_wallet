// utils/useIsInternetReachable.ts
import { useEffect, useState } from 'react'
import NetInfo from '@react-native-community/netinfo'
import { log } from '../services/logService'

export default function useIsInternetReachable(): boolean {
  // Start as false (conservative/safe default — assume offline until proven otherwise)
  const [isInternetReachable, setIsInternetReachable] = useState<boolean>(false)

  useEffect(() => {
    // Force an immediate check on mount — this reduces delay significantly
    NetInfo.refresh().then((state) => {
      log.trace('useIsInternetReachable', 'Initial refresh', {
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
      })
      if (state.isInternetReachable !== null) {
        setIsInternetReachable(state.isInternetReachable)
      }
    })

    // Subscribe to future changes
    const unsubscribe = NetInfo.addEventListener((state) => {
      // Only update when we have a definitive boolean (ignore null)
      if (state.isInternetReachable !== null) {
        log.trace('useIsInternetReachable', 'Connection change', {
          isInternetReachable: state.isInternetReachable,
        })
        setIsInternetReachable(state.isInternetReachable)
      }
    })

    return () => unsubscribe()
  }, [])

  return isInternetReachable
}