import AppError, { Err } from "../utils/AppError"
import { Env, log } from "../utils/logger"
import {
    MINIBITS_SERVER_API_KEY,
    MINIBITS_SERVER_DEV,
    MINIBITS_SERVER_PROD,    
    APP_ENV
} from '@env'

export type WalletProfile = {
    id: number,
    pubkey: string,
    walletId: string,
    avatar: string    
}

const getOrCreateWalletProfile = async function (pubkey: string, walletId: string) {    
    const url = getProfileApiUrl()
    let profile: WalletProfile | null = null
    
    profile = await getWalletProfile(pubkey)    

    if(!profile) {
        profile = await createWalletProfile(pubkey, walletId)
    }

    // preload svg file
    const avatarSvg = await fetchSvg(profile.avatar, {
        method: 'GET',
        headers: getPublicHeaders(),        
    })

    return { profile, avatarSvg }
}


const createWalletProfile = async function (pubkey: string, walletId: string) {    
    const url = getProfileApiUrl()

    try {            
        const method = 'POST'        
        const headers = getHeaders()
        
        const requestBody = {
            pubkey,
            walletId
        }        

        const walletProfile: WalletProfile = await fetchApi(url, {
            method,
            headers,
            body: JSON.stringify(requestBody)
        })

        log.info(`Got new profile`, walletProfile, 'createWalletProfile')

        return walletProfile

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e.info)
    }
}


const updateWalletProfile = async function (pubkey: string, walletId: string, avatar: string) {    
    const url = getProfileApiUrl()

    try {            
        const method = 'PUT'        
        const headers = getHeaders()
        
        const requestBody = {
            pubkey,
            walletId,
            avatar
        }        

        const walletProfile: WalletProfile = await fetchApi(url, {
            method,
            headers,
            body: JSON.stringify(requestBody)
        })

        log.info(`Updated wallet profile`, walletProfile, 'updateWalletProfile')

        return walletProfile

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e.info)
    }
}

const getWalletProfile = async function (pubkey: string) {    
    const url = getProfileApiUrl()

    try {            
        const method = 'GET'        
        const headers = getHeaders()

        const walletProfile: WalletProfile = await fetchApi(url + `/${pubkey}`, {
            method,
            headers,            
        })

        log.info(`Got response`, walletProfile, 'getWalletProfile')

        return walletProfile

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e.info)
    }
}


const getWalletProfileByWalletId = async function (walletId: string) {    
    const url = getProfileApiUrl()

    try {            
        const method = 'GET'        
        const headers = getHeaders()

        const walletProfile: WalletProfile = await fetchApi(url + `/walletId/${walletId}`, {
            method,
            headers,            
        })

        log.info(`Got response`, walletProfile, 'getWalletProfile')

        return walletProfile

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e.info)
    }
}


const getProfileApiUrl = function() {
    let url: string = ''
    if(APP_ENV === Env.PROD) {
        url = MINIBITS_SERVER_PROD + '/profile'
    } else {
        url = MINIBITS_SERVER_DEV + '/profile'
    }

    return url
}


const fetchApi = async (url: string, options: any, timeout = 5000) => { //ms
    try {
        const controller = new AbortController()

        const promise = fetch(url, options)
        const kill = new Promise((resolve) => setTimeout(resolve, timeout))
        const response: Response = await Promise.race([promise, kill]) as Response

        if (!response) {
            controller.abort()
            throw new Error('API takes too long to respond')
        }

        if (!response.ok) {            
            throw new Error(await response.text())
        }

        const responseJson = await response.json()

        if(responseJson.error) {
            throw new Error(responseJson.error)
        }

        return responseJson

    } catch (e) {
        throw e
    }
}


const fetchSvg = async (url: string, options: any, timeout = 5000) => { //ms
    try {
        const controller = new AbortController()

        const promise = fetch(url, options)
        const kill = new Promise((resolve) => setTimeout(resolve, timeout))
        const response: Response = await Promise.race([promise, kill]) as Response

        if (!response) {
            controller.abort()
            throw new Error('Image takes too long to download')
        }

        if (!response.ok) {            
            throw new Error(await response.text())
        }

        const responseText = await response.text()
        return responseText
    } catch (e) {
        throw e
    }
}


const getHeaders = () => {   
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',  
        'Authorization': `Bearer ${MINIBITS_SERVER_API_KEY}`
    }
}

const getPublicHeaders = () => {   
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',          
    }
}


export const MinibitsClient = {
    getOrCreateWalletProfile,
    updateWalletProfile,
    getWalletProfile,
    getWalletProfileByWalletId,
}