import AppError, { Err } from "../utils/AppError"
import { log } from "./logService"
import {
    MINIBITS_SERVER_API_KEY,
    MINIBITS_SERVER_API_HOST,
    JS_BUNDLE_VERSION,    
} from '@env'
import { WalletProfile, WalletProfileRecord } from "../models/WalletProfileStore"


type MinibitsRequestArgs = {
	method: 'POST' | 'PUT' | 'DELETE' | 'GET'
	body?: Record<string, unknown>
	headers?: Record<string, string>
}

type MinibitsRequestOptions = MinibitsRequestArgs & Omit<RequestInit, 'body' | 'headers' | 'method'>

const getRandomPictures = async function () {
    const url = MINIBITS_SERVER_API_HOST + '/profile'  
    const method = 'GET'    
    
    const avatars: string[] = await fetchApi(url + `/avatars`, {
        method,        
    })

    log.trace('[getRandomPictures]', `Got pictures`)

    return avatars
}


const createWalletProfile = async function (pubkey: string, walletId: string, seedHash: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'POST'    
    
    const body = {
        pubkey,
        walletId,
        seedHash
    }
    
    log.trace('[createWalletProfile]', `Create new profile`, {url})
    
    const walletProfile: WalletProfileRecord = await fetchApi(url, {
        method,        
        body,
    })

    log.info('[createWalletProfile]', `Created new profile`, {walletProfile})

    return walletProfile
}

// what is passed in {update} gets updated
const updateWalletProfile = async function (pubkey: string, update: {name?: string, lud16?: string, avatar?: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'    
    const { name, lud16, avatar } = update
    
    const body = {       
        name,
        lud16,
        avatar,        
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/${pubkey}`, {
        method,        
        body,
    })

    log.trace('[updateWalletProfile]', `Updated wallet profile`, {update})

    return walletProfile
}


const updateWalletProfileNip05 = async function (pubkey: string, update: {newPubkey: string, name: string, nip05: string, lud16: string, avatar: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'    
    const { newPubkey, name, nip05, lud16, avatar } = update
    
    const body = {            
        newPubkey,
        nip05,
        lud16,        
        name,
        avatar
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/nip05/${pubkey}`, {
        method,        
        body,
    })

    log.info('[updateWalletProfileNip05]', `Updated wallet profile nip05`, walletProfile.nip05)

    return walletProfile
}



const updateDeviceToken = async function (pubkey: string, update: {deviceToken: string} ) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile' 
    const method = 'PUT'    
    const { deviceToken } = update
    
    const body = {            
        deviceToken
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/deviceToken/${pubkey}`, {
        method,        
        body,
    })

    log.info('[updateDeviceToken]', `Updated wallet deviceToken`, walletProfile.device)

    return walletProfile
}


const recoverProfile = async function (seedHash: string, update: {newPubkey: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'    
    const { newPubkey } = update
    
    const body = {            
        newPubkey,        
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/recover/seedHash/${seedHash}`, {
        method,        
        body,
    })

    log.info('[recoverProfile]', `Recovered wallet profile with seedHash`, seedHash)

    return walletProfile
}

// Serves for migration from pre-seed wallet version
const migrateSeedHash = async function (pubkey: string, update: {seedHash: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'    
    const { seedHash } = update
    
    const body = {            
        seedHash,        
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/migrate/pubkey/${pubkey}`, {
        method,        
        body,
    })

    log.info('[migrateSeedHash]', `Migrated seedHash`, seedHash)

    return walletProfile
}


const getWalletProfile = async function (pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile' 
    const method = 'GET'    

    const walletProfile: WalletProfileRecord = await fetchApi(url + `/${pubkey}`, {
        method,        
    })

    log.trace('[getWalletProfile]', `Got response`, walletProfile?.pubkey || null)

    return walletProfile
}


const getWalletProfileByWalletId = async function (walletId: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'GET'    

    const walletProfile: WalletProfileRecord = await fetchApi(url + `/walletId/${walletId}`, {
        method,                   
    })

    log.trace('[getWalletProfileByWalletId]', `Got response`, walletProfile?.walletId || null)

    return walletProfile
}


const getWalletProfileByNip05 = async function (nip05: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'GET'    

    const walletProfile: WalletProfileRecord = await fetchApi(url + `/nip05/${nip05}`, {
        method,            
    })

    log.trace('[getWalletProfileByNip05]', `Got response`, walletProfile?.walletId || null)

    return walletProfile
}


const getWalletProfileBySeedHash = async function (seedHash: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'GET'    

    const walletProfile: WalletProfileRecord = await fetchApi(url + `/seedHash/${seedHash}`, {
        method,            
    })

    log.trace('[getWalletProfileBySeedHash]', `Got response`, walletProfile?.walletId || null)

    return walletProfile
}


const createDonation = async function (amount: number, memo: string, pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/donation' 
    const method = 'POST'    
    
    const body = {
        amount,
        memo,
        pubkey
    }        

    const invoice: {
        payment_hash: string, 
        payment_request: string
    } = await fetchApi(url, {
        method,        
        body
    })

    log.info(`[createDonation] Created new donation invoice`, {invoice})

    return invoice
}


const checkDonationPaid = async function (paymentHash: string, pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/donation'      
    const method = 'GET'    

    const donationPaid: {paid: boolean} = await fetchApi(url + `/${paymentHash}/${pubkey}`, {
        method,            
    })

    log.info(`[checkDonationPaid] Got response`, donationPaid)

    return donationPaid
}


const createClaim = async function (walletId: string, seedHash: string, pubkey: string,) {    
    const url = MINIBITS_SERVER_API_HOST + '/claim' 
    const method = 'POST'    
    
    const body = {
        walletId,
        seedHash,
        pubkey
    }        

    const claimedInvoices: Array<{token: string, }> = await fetchApi(url, {
        method,        
        body
    })

    log.info(`[createClaim] Created new claim and got invoices`, {claimedInvoices})

    return claimedInvoices
}


const fetchApi = async (url: string, options: MinibitsRequestOptions, timeout = 10000) => { //ms
    log.trace('[fetchApi]', {url})
    
    const controller = new AbortController()
    const body = options.body ? JSON.stringify(options.body) : undefined
    const headers = getHeaders()    

    const promise = fetch(url, {...options, body, headers})
    const kill = new Promise((resolve) => setTimeout(resolve, timeout))
    const response: Response = await Promise.race([promise, kill]) as Response        

    if (!response) {
        controller.abort()
        throw new AppError(Err.NETWORK_ERROR, 'API takes too long to respond', {caller: 'fetchApi', url})
    }    

    const responseJson = await response.json()        

    if(responseJson && responseJson.error) {            
        const {error} = responseJson
        log.trace('[fetchApi] error responseJson', responseJson)

        if(error === Object(error)) {            
            throw new AppError(error.name || Err.NETWORK_ERROR, error.message || '', {caller: 'fetchApi', message: error.params?.message || '', status: response.status})
        } else {
            throw new AppError(Err.NETWORK_ERROR, String(error), {caller: 'fetchApi', status: response.status})
        }        
    }

    return responseJson    
}


const getHeaders = () => {   
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',  
        'Authorization': `Bearer ${MINIBITS_SERVER_API_KEY}`,
        'User-Agent': `Minibits/${JS_BUNDLE_VERSION}`
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
    updateDeviceToken,
    recoverProfile,
    migrateSeedHash,
    getRandomPictures,
    getWalletProfileByWalletId,
    getWalletProfileByNip05,
    getWalletProfileBySeedHash,
    createDonation,
    checkDonationPaid,
    createClaim,
    getPublicHeaders,
    fetchApi,
}