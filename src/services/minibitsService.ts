import AppError, { Err } from "../utils/AppError"
import { Env, log } from "../utils/logger"
import {
    MINIBITS_SERVER_API_KEY,
    MINIBITS_SERVER_API_HOST,    
} from '@env'

export type WalletProfile = {
    id: number,
    pubkey: string,
    walletId: string,
    avatar: string    
}

const getOrCreateWalletProfile = async function (pubkey: string, walletId: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile' 
    let profile: WalletProfile | null = null
    
    profile = await getWalletProfile(pubkey)    

    if(!profile) {
        log.trace('Could not find profile', {pubkey}, 'getOrCreateWalletProfile')
        profile = await createWalletProfile(pubkey, walletId)
    }

    // this should not happen outside dev, update the server silently
    if(profile.walletId !== walletId) {
        log.info('Device walletId mismatch with server record, updating server...')
        await updateWalletProfile(pubkey, walletId, profile.avatar)
    }

    // preload svg file
    const avatarSvg = await fetchSvg(profile.avatar, {
        method: 'GET',
        headers: getPublicHeaders(),        
    })

    return { profile, avatarSvg }
}


const getRandomAvatars = async function () {
    const url = MINIBITS_SERVER_API_HOST + '/profile'  

    try {            
        const method = 'GET'        
        const headers = getHeaders()

        const avatarUrls: string[] = await fetchApi(url + `/avatars`, {
            method,
            headers,            
        })

        // log.trace(`Got response`, avatarUrls, 'getRandomAvatars')

        return avatarUrls

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e.info)
    }
}


const createWalletProfile = async function (pubkey: string, walletId: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile' 

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

        log.info(`Created new profile`, walletProfile, 'createWalletProfile')

        return walletProfile

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e.info)
    }
}


const updateWalletProfile = async function (pubkey: string, walletId?: string, avatar?: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'

    try {            
        const method = 'PUT'        
        const headers = getHeaders()
        
        const requestBody = {            
            walletId,
            avatar
        }        

        const walletProfile: WalletProfile = await fetchApi(url + `/${pubkey}`, {
            method,
            headers,
            body: JSON.stringify(requestBody)
        })

        log.trace(`Updated wallet profile`, walletProfile, 'updateWalletProfile')

        return walletProfile

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e.info)
    }
}

const getWalletProfile = async function (pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile' 

    try {            
        const method = 'GET'        
        const headers = getHeaders()

        const walletProfile: WalletProfile = await fetchApi(url + `/${pubkey}`, {
            method,
            headers,            
        })

        log.trace(`Got response`, walletProfile, 'getWalletProfile')

        return walletProfile

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e.info)
    }
}


const getWalletProfileByWalletId = async function (walletId: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'

    try {            
        const method = 'GET'        
        const headers = getHeaders()

        const walletProfile: WalletProfile = await fetchApi(url + `/walletId/${walletId}`, {
            method,
            headers,            
        })

        log.trace(`Got response`, walletProfile, 'getWalletProfile')

        return walletProfile

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e)
    }
}


const createDonation = async function (amount: number, memo: string, pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/donation' 

    log.trace('createDonation start')

    try {            
        const method = 'POST'        
        const headers = getHeaders()
        
        const requestBody = {
            amount,
            memo,
            pubkey
        }        

        const invoice: {
            payment_hash: string, 
            payment_request: string
        } = await fetchApi(url, {
            method,
            headers,
            body: JSON.stringify(requestBody)
        })

        log.info(`Created new donation invoice`, invoice, 'createDonation')

        return invoice

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e)
    }
}


const checkDonationPaid = async function (paymentHash: string, pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/donation'

    try {            
        const method = 'GET'        
        const headers = getHeaders()

        const donationPaid: {paid: boolean} = await fetchApi(url + `/${paymentHash}/${pubkey}`, {
            method,
            headers,            
        })

        log.info(`Got response`, donationPaid, 'checkDonationPaid')

        return donationPaid

    } catch (e: any) {        
        throw new AppError(Err.SERVER_ERROR, e.message, e)
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
            throw new Error('API takes too long to respond')
        }        

        if (!response.ok) {            
            throw new Error(await response.text())
        }

        const responseJson = await response.json()        

        if(responseJson && responseJson.error) {
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
    getRandomAvatars,
    getWalletProfile,
    getWalletProfileByWalletId,
    createDonation,
    checkDonationPaid,
    fetchSvg,
    getPublicHeaders
}