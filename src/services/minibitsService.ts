import { env } from "process"
import AppError, { Err } from "../utils/AppError"
import { log } from "../utils/logger"
/* import {
    MINIBITS_SERVER_API_KEY,
    MINIBITS_SERVER_URL_DEV,
    MINIBITS_SERVER_URL_PROD
} from '@env'*/

export type WalletProfile = {
    id: number,
    pubkey: string,
    nip05: string,
    avatar: string
}

export const createWalletProfile = async function (pubkey: string, nip05: string) {
    
    // const url = 'https://wallet.minibits.cash/wallet'
    const url = 'http://localhost:3000/profile'

    try {            
        const method = 'POST'        
        const headers = getHeaders()
        
        const requestBody = {
            pubkey,
            nip05
        }        

        const walletProfile: WalletProfile = await fetchApi(url, {
            method,
            headers,
            body: JSON.stringify(requestBody)
        })

        return walletProfile

    } catch (e: any) {
        console.log(e)
        throw new AppError(Err.NETWORK_ERROR, 'Could not get avatar image', e.message)
    }
}    


const fetchApi = async (url: string, options: any, timeout = 5000) => { //ms
    try {
        const controller = new AbortController()

        const promise = fetch(url, options)
        const kill = new Promise((resolve) => setTimeout(resolve, timeout))
        const response: Response = await Promise.race([promise, kill]) as Response

        if (!response) {
            controller.abort()
            throw new Error('API takes too long to response')
        }

        if (!response.ok) {            
            throw new Error(await response.text())
        }

        const responseJson = await response.json()
        return responseJson

    } catch (e) {
        throw e
    }
}


const getHeaders = () => {   
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',  
        'Authorization': `Bearer ${MINIBITS_SERVER_API_KEY}` // TODO ENV
    }
}