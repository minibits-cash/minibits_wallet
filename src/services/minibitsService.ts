import AppError, { Err } from "../utils/AppError"
import { log } from "./logService"
import {
    MINIBITS_SERVER_API_KEY,
    MINIBITS_SERVER_API_HOST,
    JS_BUNDLE_VERSION,    
} from '@env'
import { WalletProfileRecord } from "../models/WalletProfileStore"
import { CurrencyCode } from "./wallet/currency"
import { AuthService } from "./authService"
 // refresh // refresh // refresh

type MinibitsRequestArgs = {
	method: 'POST' | 'PUT' | 'DELETE' | 'GET'
	body?: Record<string, unknown>
	headers?: Record<string, string>
	jwtAuthRequired?: boolean
}

type MinibitsRequestOptions = MinibitsRequestArgs & Omit<RequestInit, 'body' | 'headers' | 'method'>

const getRandomPictures = async function () {
    const url = MINIBITS_SERVER_API_HOST + '/profile'  
    const method = 'GET'    
    
    const avatars = await fetchApi(url + `/avatars`, {
        method,
        jwtAuthRequired: true,        
    }) as string[]

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
    
    const walletProfile = await fetchApi(url, {
        method,        
        body,
        jwtAuthRequired: true
    }) as WalletProfileRecord

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

    const walletProfile = await fetchApi(url + `/${pubkey}`, {
        method,        
        body,
        jwtAuthRequired: true
    }) as WalletProfileRecord

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

    const walletProfile = await fetchApi(url + `/nip05/${pubkey}`, {
        method,        
        body,
        jwtAuthRequired: true
    }) as WalletProfileRecord

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

    const walletProfile = await fetchApi(url + `/deviceToken/${pubkey}`, {
        method,        
        body,
        jwtAuthRequired: true
    }) as WalletProfileRecord

    log.info('[updateDeviceToken]', `Updated wallet deviceToken`, walletProfile.device)

    return walletProfile
}


const recoverProfile = async function (pubkey: string, walletId: string, seedHash: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'    
    
    const body = {            
        pubkey,
        walletId,
        seedHash        
    }        

    const walletProfile = await fetchApi(url + `/recover`, {
        method,        
        body,
        jwtAuthRequired: true
    }) as WalletProfileRecord

    log.info('[recoverProfile]', `Recovered wallet address`, {seedHash, pubkey, walletId})

    return walletProfile
}


const getWalletProfile = async function (pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile' 
    const method = 'GET'    

    const walletProfile = await fetchApi(url + `/${pubkey}`, {
        method,
        jwtAuthRequired: true    
    }) as WalletProfileRecord

    log.trace('[getWalletProfile]', `Got response`, walletProfile?.pubkey || null)

    return walletProfile
}


const getWalletProfileByNip05 = async function (nip05: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'GET'    

    const walletProfile = await fetchApi(url + `/nip05/${nip05}`, {
        method,
        jwtAuthRequired: true       
    }) as WalletProfileRecord

    log.trace('[getWalletProfileByNip05]', `Got response`, walletProfile?.walletId || null)

    return walletProfile
}


const getWalletProfileBySeedHash = async function (seedHash: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'GET'    

    const walletProfile = await fetchApi(url + `/seedHash/${seedHash}`, {
        method,
        jwtAuthRequired: true          
    }) as WalletProfileRecord

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

    const invoice = await fetchApi(url, {
        method,        
        body,
        jwtAuthRequired: true
    }) as {
        payment_hash: string, 
        payment_request: string
    }

    log.info(`[createDonation] Created new donation invoice`, {invoice})

    return invoice
}


const checkDonationPaid = async function (paymentHash: string, pubkey: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/donation'      
    const method = 'GET'    

    const donationPaid = await fetchApi(url + `/${paymentHash}/${pubkey}`, {
        method,
        jwtAuthRequired: true         
    }) as {paid: boolean}

    log.info(`[checkDonationPaid] Got response`, donationPaid)

    return donationPaid
}


const createClaim = async function (walletId: string, seedHash: string, pubkey: string, batchFrom?: number) {    
    const url = MINIBITS_SERVER_API_HOST + '/claim' 
    const method = 'POST'    
    
    const body = {
        walletId,
        seedHash,
        pubkey,
        batchFrom
    }
    
    // log.trace('[createClaim]', body)

    const claimedTokens = await fetchApi(url, {
        method,        
        body,
        jwtAuthRequired: true
    }) as Array<{
        token: string, 
        zapSenderProfile?: string, 
        zapRequest?: string
    }>

    log.debug(`[minibitsClient.createClaim] Got claim response`)

    return claimedTokens
}


const getExchangeRate = async function (currency: CurrencyCode) {    
    const url = MINIBITS_SERVER_API_HOST + '/rate'      
    const method = 'GET'    

    const rate = await fetchApi(url + `/${currency}`, {
        method,
        jwtAuthRequired: true            
    }) as {currency: CurrencyCode, rate: number}

    log.info(`[getExchangeRate] Got response`, rate)

    return rate
}


const fetchApi = async (url: string, options: MinibitsRequestOptions, timeout = 15000) => { //ms
    log.trace('[fetchApi] start', url)
    
    const controller = new AbortController()
    const body = options.body ? JSON.stringify(options.body) : undefined
    const jwtAuthRequired = options.jwtAuthRequired || false
    
    let headers: Record<string, string>
    
    if (jwtAuthRequired) {
        headers = await AuthService.getAuthenticatedHeaders()
    } else {
        headers = getPublicHeaders()
    }

    const makeRequest = async (): Promise<Response> => {
        const promise = fetch(url, {...options, body, headers})
        const kill = new Promise((resolve) => setTimeout(resolve, timeout))
        const response = await Promise.race([promise, kill]) as Response        

        if (!response) {
            controller.abort()
            throw new AppError(Err.NETWORK_TIMEOUT, 'Timeout: API takes too long to respond.', {caller: 'fetchApi', url})
        }

        return response
    }

    let response = await makeRequest()

    // Handle 401 responses by attempting token refresh once
    if (response.status === 401 && jwtAuthRequired) {
        try {
            log.trace('[fetchApi] Got 401, attempting token refresh')
            await AuthService.refreshTokens()
            
            // Update headers with new token and retry
            headers = await AuthService.getAuthenticatedHeaders()
            response = await makeRequest()
            
            log.trace('[fetchApi] Request retried successfully after token refresh')
        } catch (refreshError: any) {
            log.error('[fetchApi] Token refresh failed, logging out', refreshError)
            
            // If refresh fails, logout and throw the original 401 error
            try {
                await AuthService.logout()
            } catch (logoutError: any) {
                log.error('[fetchApi] Logout failed', logoutError)
            }
            
            throw new AppError(Err.AUTH_ERROR, 'Authentication failed. Please log in again.', {caller: 'fetchApi', status: 401, url})
        }
    }
    
    const responseJson = await response.json() as any       

    if(responseJson && responseJson.error) {            
        const {error} = responseJson
        log.trace('[fetchApi] error responseJson', responseJson)

        if(error === Object(error)) {            
            throw new AppError(error.name || Err.NETWORK_ERROR, error.message || '', {caller: error.params?.caller || 'fetchApi', message: error.params?.message || undefined, status: response.status, url})
        } else {
            throw new AppError(Err.NETWORK_ERROR, String(error), {caller: 'fetchApi', status: response.status, url})
        }        
    }

    return responseJson    
}

// legacy headers
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
        'User-Agent': `Minibits/${JS_BUNDLE_VERSION}`        
    }
}


export const MinibitsClient = {
    getWalletProfile,
    createWalletProfile,
    updateWalletProfile,
    updateWalletProfileNip05,
    updateDeviceToken,
    recoverProfile,    
    getRandomPictures,  
    getWalletProfileByNip05,
    getWalletProfileBySeedHash,
    createDonation,
    checkDonationPaid,
    createClaim,    
    getExchangeRate,
    getPublicHeaders,
    fetchApi,
}
