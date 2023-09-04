import AppError, { Err } from "../utils/AppError"
import { Env, log } from "../utils/logger"
import {
    MINIBITS_SERVER_API_KEY,
    MINIBITS_SERVER_API_HOST,    
} from '@env'
import { WalletProfile, WalletProfileRecord } from "../models/WalletProfileStore"



const getRandomPictures = async function () {
    const url = MINIBITS_SERVER_API_HOST + '/profile'  
    const method = 'GET'        
    const headers = getHeaders()
    
    const avatars: string[] = await fetchApi(url + `/avatars`, {
        method,
        headers,            
    })

    log.trace(`Got pictures`, 'getRandomPictures')

    return avatars
}


const createWalletProfile = async function (pubkey: string, walletId: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'POST'        
    const headers = getHeaders()
    
    const requestBody = {
        pubkey,
        walletId
    }        

    const walletProfile: WalletProfileRecord = await fetchApi(url, {
        method,
        headers,
        body: JSON.stringify(requestBody)
    })

    log.info(`Created new profile`, walletProfile.pubkey, 'createWalletProfile')

    return walletProfile

}


const updateWalletProfile = async function (pubkey: string, walletId: string, avatar: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
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

    log.trace(`Updated wallet profile`, walletProfile.pubkey, 'updateWalletProfile')

    return walletProfile
}


const getWalletProfile = async function (pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile' 
    const method = 'GET'        
    const headers = getHeaders()

    const walletProfile: WalletProfileRecord = await fetchApi(url + `/${pubkey}`, {
        method,
        headers,            
    })

    log.trace(`Got response`, walletProfile?.pubkey || null, 'getWalletProfile')

    return walletProfile
}


const getWalletProfileByWalletId = async function (walletId: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'GET'        
    const headers = getHeaders()

    const walletProfile: WalletProfileRecord = await fetchApi(url + `/walletId/${walletId}`, {
        method,
        headers,            
    })

    log.trace(`Got response`, walletProfile?.walletId || null, 'getWalletProfile')

    return walletProfile
}


const createDonation = async function (amount: number, memo: string, pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/donation' 
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
}


const checkDonationPaid = async function (paymentHash: string, pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/donation'      
    const method = 'GET'        
    const headers = getHeaders()

    const donationPaid: {paid: boolean} = await fetchApi(url + `/${paymentHash}/${pubkey}`, {
        method,
        headers,            
    })

    log.info(`Got response`, donationPaid, 'checkDonationPaid')

    return donationPaid
}




const fetchApi = async (url: string, options: any, timeout = 15000) => { //ms
    try {
        const controller = new AbortController()

        const promise = fetch(url, options)
        const kill = new Promise((resolve) => setTimeout(resolve, timeout))
        const response: Response = await Promise.race([promise, kill]) as Response        

        if (!response) {
            controller.abort()
            throw new Error('API takes too long to respond')
        }        

        /* if (!response.ok) {
            const res =  await response.text()
            log.trace('fetchApi res.text', res)          
            throw new Error(res)
        }*/

        const responseJson = await response.json()        

        if(responseJson && responseJson.error) {            
            const {error} = responseJson
            throw new AppError(error.name, error.message, error.params)
        }

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
    getWalletProfile,
    createWalletProfile,
    updateWalletProfile,
    getRandomPictures,
    getWalletProfileByWalletId,
    createDonation,
    checkDonationPaid,
    // fetchSvg,
    getPublicHeaders
}