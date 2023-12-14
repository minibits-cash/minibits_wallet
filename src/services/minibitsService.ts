import AppError, { Err } from "../utils/AppError"
import { log } from "./logService"
import {
    MINIBITS_SERVER_API_KEY,
    MINIBITS_SERVER_API_HOST,    
} from '@env'
import { WalletProfile, WalletProfileRecord } from "../models/WalletProfileStore"

// refresh

const getRandomPictures = async function () {
    const url = MINIBITS_SERVER_API_HOST + '/profile'  
    const method = 'GET'        
    const headers = getHeaders()
    
    const avatars: string[] = await fetchApi(url + `/avatars`, {
        method,
        headers,            
    })

    log.trace('[getRandomPictures]', `Got pictures`)

    return avatars
}


const createWalletProfile = async function (pubkey: string, walletId: string, seedHash: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'POST'        
    const headers = getHeaders()
    
    const requestBody = {
        pubkey,
        walletId,
        seedHash
    }
    
    log.trace('[createWalletProfile]', `Create new profile`, {url})
    
    const walletProfile: WalletProfileRecord = await fetchApi(url, {
        method,
        headers,
        body: JSON.stringify(requestBody)
    })

    log.info('[createWalletProfile]', `Created new profile`, {walletProfile})

    return walletProfile
}


const updateWalletProfileName = async function (pubkey: string, update: {name: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'        
    const headers = getHeaders()
    const { name } = update
    
    const requestBody = {       
        name        
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/name/${pubkey}`, {
        method,
        headers,
        body: JSON.stringify(requestBody)
    })

    log.trace('[updateWalletProfileName]', `Updated wallet profile name`, {name})

    return walletProfile
}


const updateWalletProfileAvatar = async function (pubkey: string, update: {avatar: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'        
    const headers = getHeaders()
    const { avatar } = update
    
    const requestBody = {       
        avatar        
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/avatar/${pubkey}`, {
        method,
        headers,
        body: JSON.stringify(requestBody)
    })

    log.trace('[updateWalletProfileAvatar]', `Updated wallet profile name`, {avatar})

    return walletProfile
}


const updateWalletProfileNip05 = async function (pubkey: string, update: {newPubkey: string, nip05: string, name: string, avatar: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'        
    const headers = getHeaders()
    const { newPubkey, nip05, name, avatar } = update
    
    const requestBody = {            
        newPubkey,
        nip05,        
        name,
        avatar
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/nip05/${pubkey}`, {
        method,
        headers,
        body: JSON.stringify(requestBody)
    })

    log.info('[updateWalletProfileNip05]', `Updated wallet profile nip05`, walletProfile.nip05)

    return walletProfile
}


const recoverProfile = async function (seedHash: string, update: {newPubkey: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'        
    const headers = getHeaders()
    const { newPubkey } = update
    
    const requestBody = {            
        newPubkey,        
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/recover/seedHash/${seedHash}`, {
        method,
        headers,
        body: JSON.stringify(requestBody)
    })

    log.info('[recoverProfile]', `Recovered wallet profile with seedHash`, seedHash)

    return walletProfile
}


const migrateSeedHash = async function (pubkey: string, update: {seedHash: string}) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'PUT'        
    const headers = getHeaders()
    const { seedHash } = update
    
    const requestBody = {            
        seedHash,        
    }        

    const walletProfile: WalletProfile = await fetchApi(url + `/migrate/pubkey/${pubkey}`, {
        method,
        headers,
        body: JSON.stringify(requestBody)
    })

    log.info('[migrateSeedHash]', `Migrated seedHash`, seedHash)

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

    log.trace('[getWalletProfile]', `Got response`, walletProfile?.pubkey || null)

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

    log.trace('[getWalletProfileByWalletId]', `Got response`, walletProfile?.walletId || null)

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

    log.trace('[getWalletProfileByNip05]', `Got response`, walletProfile?.walletId || null)

    return walletProfile
}


const getWalletProfileBySeedHash = async function (seedHash: string) {    
    const url = MINIBITS_SERVER_API_HOST + '/profile'
    const method = 'GET'        
    const headers = getHeaders()

    const walletProfile: WalletProfileRecord = await fetchApi(url + `/seedHash/${seedHash}`, {
        method,
        headers,            
    })

    log.trace('[getWalletProfileBySeedHash]', `Got response`, walletProfile?.walletId || null)

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
        throw new AppError(Err.NETWORK_ERROR, 'API takes too long to respond', {caller: 'fetchApi'})
    }    

    const responseJson = await response.json()        

    if(responseJson && responseJson.error) {            
        const {error} = responseJson
        throw new AppError(error.name || Err.NETWORK_ERROR, error.message, {caller: 'fetchApi', message: error.params.message})
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
    updateWalletProfileName,
    updateWalletProfileAvatar,
    updateWalletProfileNip05,
    recoverProfile,
    migrateSeedHash,
    getRandomPictures,
    getWalletProfileByWalletId,
    getWalletProfileByNip05,
    getWalletProfileBySeedHash,
    createDonation,
    checkDonationPaid,
    getPublicHeaders,
    fetchApi,
}