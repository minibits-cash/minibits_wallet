import { useEffect, useState } from 'react'
import NetInfo, { NetInfoState } from '@react-native-community/netinfo'
import {log} from './logger'


export default function useIsInternetReachable() {
    // useState hook for setting netInfo
    const [netInfo, setNetInfo] = useState({} as NetInfoState)
    
    useEffect(() => {
        // Whenever connection status changes below event fires
        const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
            log.trace(state)            
            setNetInfo(state)
        })
        // Event cleanup function
        return () => {
            unsubscribe()
        }
    }, [])

    // Returns current network connection status
    return netInfo.isInternetReachable
}
