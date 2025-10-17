import AppError, { Err } from "../utils/AppError"
import { log } from "./logService"
import {
    MINIBITS_SERVER_API_KEY,
    MINIBITS_SERVER_API_HOST,
    JS_BUNDLE_VERSION,    
} from '@env'
import { WalletProfileRecord } from "../models/WalletProfileStore"
import { CurrencyCode } from "./wallet/currency"
import { rootStoreInstance } from "../models"
import { JwtTokens } from "./keyChain"
import { AuthChallengeResponse, VerifyChallengeResponse } from "../models/AuthStore"
 // refresh // refresh // refresh // refresh

type MinibitsRequestArgs = {
	method: 'POST' | 'PUT' | 'DELETE' | 'GET'
	body?: Record<string, unknown>
	headers?: Record<string, string>
	jwtAuthRequired?: boolean
    jwtAccessToken?: string
}

type MinibitsRequestOptions = MinibitsRequestArgs & Omit<RequestInit, 'body' | 'headers' | 'method'>

const { authStore } = rootStoreInstance


const getAuthChallenge = async function (pubkey: string, deviceId?: string | null) {
    const challengeUrl = `${MINIBITS_SERVER_API_HOST}/auth/challenge`
    const challengeBody = { pubkey, deviceId }
    
    const challengeResponse: AuthChallengeResponse = await fetchApi(challengeUrl, {
        method: 'POST',
        body: challengeBody,
        jwtAuthRequired: false
    })

    return challengeResponse
}


const verifyAuthChallenge = async function (pubkey: string, challenge: string, signature: string, deviceId?: string | null) {
    const verifyUrl = `${MINIBITS_SERVER_API_HOST}/auth/verify`
    const verifyBody = {
        pubkey,
        challenge,
        signature,
        deviceId,            
    }

    const verifyChallengeResponse: VerifyChallengeResponse = await fetchApi(verifyUrl, {
        method: 'POST',
        body: verifyBody,
        jwtAuthRequired: false
    })

    return verifyChallengeResponse
}


const refreshTokens = async function (refreshToken: string) {
    const refreshUrl = `${MINIBITS_SERVER_API_HOST}/auth/refresh`
    const refreshBody = {
        refreshToken
    }

    const newTokens: JwtTokens = await fetchApi(refreshUrl, {
        method: 'POST',
        body: refreshBody,
        jwtAuthRequired: false
    })

    return newTokens
}


const logout = async function (refreshToken: string) {
    const logoutUrl = `${MINIBITS_SERVER_API_HOST}/auth/logout`
    const logoutBody = {
        refreshToken
    }

    await MinibitsClient.fetchApi(logoutUrl, {
        method: 'POST',
        body: logoutBody,
        jwtAuthRequired: false
    })

    return
}


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

// TODO remove pubkey params
const createWalletProfile = async function (walletId: string, seedHash: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'POST'    
    
    const body = {
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
// TODO remove pubkey from url and params
const updateWalletProfile = async function (update: {name?: string, lud16?: string, avatar?: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'    
    const { name, lud16, avatar } = update
    
    const body = {       
        name,
        lud16,
        avatar,        
    }        

    const walletProfile = await fetchApi(url, {
        method,        
        body,
        jwtAuthRequired: true
    }) as WalletProfileRecord

    log.trace('[updateWalletProfile]', `Updated wallet profile`, {update})

    return walletProfile
}

// TODO remove pubkey from url and params
const updateWalletProfileNip05 = async function (update: {newPubkey: string, name: string, nip05: string, lud16: string, avatar: string}) {    
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

    const walletProfile = await fetchApi(url + `/nip05`, {
        method,        
        body,
        jwtAuthRequired: true
    }) as WalletProfileRecord

    log.info('[updateWalletProfileNip05]', `Updated wallet profile nip05`, walletProfile.nip05)

    return walletProfile
}


// TODO remove pubkey from url and params
const updateDeviceToken = async function (deviceToken: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile' 
    const method = 'PUT'    
    
    
    const body = {            
        deviceToken
    }        

    const walletProfile = await fetchApi(url + `/deviceToken`, {
        method,        
        body,
        jwtAuthRequired: true
    }) as WalletProfileRecord

    log.info('[updateDeviceToken]', `Updated wallet deviceToken`, walletProfile.device)

    return walletProfile
}

// TODO remove pubkey from params
const recoverProfile = async function (walletId: string, seedHash: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'    
    
    const body = {            
        walletId,
        seedHash        
    }        

    const walletProfile = await fetchApi(url + `/recover`, {
        method,        
        body,
        jwtAuthRequired: true
    }) as WalletProfileRecord

    log.info('[recoverProfile]', `Recovered wallet address`, {walletAddress: walletProfile.nip05})

    return walletProfile
}


const recoverAddress = async function (walletId: string, seedHash: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'    
    
    const body = {
        walletId,
        seedHash        
    }        

    const walletProfile = await fetchApi(url + `/recover`, {
        method,        
        body,
        jwtAuthRequired: true
    }) as WalletProfileRecord

    log.info('[recoverProfile]', `Recovered wallet address`, {seedHash, walletId})

    return walletProfile
}

// TODO remove 
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


const checkDonationPaid = async function (paymentHash: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/donation'      
    const method = 'GET'    

    const donationPaid = await fetchApi(url + `/${paymentHash}`, {
        method,
        jwtAuthRequired: true         
    }) as {paid: boolean}

    log.info(`[checkDonationPaid] Got response`, donationPaid)

    return donationPaid
}


const createClaim = async function (walletId: string, seedHash: string, batchFrom?: number) {    
    const url = MINIBITS_SERVER_API_HOST + '/claim' 
    const method = 'POST'    
    
    const body = {
        walletId,
        seedHash,        
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
    log.info('[fetchApi] start', url)
    
    const controller = new AbortController()
    const body = options.body ? JSON.stringify(options.body) : undefined
    const jwtAuthRequired = options.jwtAuthRequired
    
    let headers: Record<string, string>
    
    if (jwtAuthRequired) {
        const jwtAccessToken = await authStore.getValidAccessToken()
        headers = getAuthenticatedHeaders(jwtAccessToken)
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

const getAuthenticatedHeaders = (accessToken: string): Record<string, string> => {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',  
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': `Minibits/${JS_BUNDLE_VERSION}`
    }
}


export const MinibitsClient = {
    getAuthChallenge,
    verifyAuthChallenge,
    refreshTokens,
    logout,
    getWalletProfile,
    createWalletProfile,
    updateWalletProfile,
    updateWalletProfileNip05,
    updateDeviceToken,
    recoverProfile,
    recoverAddress,   
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
