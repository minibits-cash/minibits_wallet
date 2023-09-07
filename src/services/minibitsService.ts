import AppError, { Err } from "../utils/AppError"
import { Env, log } from "../utils/logger"
import {
    MINIBITS_SERVER_API_KEY,
    MINIBITS_SERVER_API_HOST,    
} from '@env'
import { WalletProfile, WalletProfileRecord } from "../models/WalletProfileStore"
import { NostrClient } from "./nostrService"


// refresh
const getRandomPictures = async function () {
    const url = MINIBITS_SERVER_API_HOST + '/profile'  
    const method = 'GET'        
    const headers = getHeaders()
    
    const avatars: string[] = await fetchApi(url + `/avatars`, {
        method,
        headers,            
    })

    log.trace(`Got pictures`, MINIBITS_SERVER_API_HOST, 'getRandomPictures')

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


const updateWalletProfile = async function (pubkey: string, update: {name: string, avatar: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'        
    const headers = getHeaders()
    const { name, avatar } = update
    
    const requestBody = {       
        name,
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


const updateWalletProfileNip05 = async function (pubkey: string, update: {newPubkey: string, nip05: string, name: string, avatar: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile/nip05'
    const method = 'PUT'        
    const headers = getHeaders()
    const { newPubkey, nip05, name, avatar } = update
    
    const requestBody = {            
        newPubkey,
        nip05,        
        name,
        avatar
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/${pubkey}`, {
        method,
        headers,
        body: JSON.stringify(requestBody)
    })

    log.info(`Updated wallet profile nip05`, walletProfile.nip05, 'updateWalletProfileNip05')

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

    log.trace(`Got response`, walletProfile?.walletId || null, 'getWalletProfileByWalletId')

    return walletProfile
}


const getWalletProfileByNip05 = async function (nip05: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'GET'        
    const headers = getHeaders()

    const walletProfile: WalletProfileRecord = await fetchApi(url + `/nip05/${nip05}`, {
        method,
        headers,            
    })

    log.trace(`Got response`, walletProfile?.walletId || null, 'getWalletProfileByNip05')

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
    
    const controller = new AbortController()

    const promise = fetch(url, options)
    const kill = new Promise((resolve) => setTimeout(resolve, timeout))
    const response: Response = await Promise.race([promise, kill]) as Response        

    if (!response) {
        controller.abort()
        throw new Error('API takes too long to respond')
    }    

    const responseJson = await response.json()        

    if(responseJson && responseJson.error) {            
        const {error} = responseJson
        throw new AppError(error.name, error.message, error.params)
    }

    return responseJson    
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
    updateWalletProfileNip05,
    getRandomPictures,
    getWalletProfileByWalletId,
    getWalletProfileByNip05,
    createDonation,
    checkDonationPaid,
    getPublicHeaders,
    fetchApi,
}