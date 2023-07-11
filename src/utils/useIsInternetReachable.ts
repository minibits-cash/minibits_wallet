import { useEffect, useState } from 'react'
import NetInfo, { NetInfoState } from '@react-native-community/netinfo'
import {log} from './logger'


export default function useIsInternetReachable() {
    // useState hook for setting netInfo
    // const [netInfo, setNetInfo] = useState({} as NetInfoState)
    const [isInternetReachable, setIsInternetReachable] = useState<boolean>(true)
    
    useEffect(() => {
        // Whenever connection status changes below event fires        
        const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {            
            setIsInternetReachable(state.isInternetReachable as boolean)
        })
        // Event cleanup function
        return () => {
            unsubscribe()
        }
    }, [])
    
    return isInternetReachable
}
