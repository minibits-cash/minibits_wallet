import { getParams, LNURLPayParams, LNURLResponse, LNURLWithdrawParams } from 'js-lnurl'
import AppError, { Err } from "../utils/AppError"
import { LnurlUtils } from './lnurl/lnurlUtils'
import { MinibitsClient } from './minibitsService'

export type LnurlParamsResult = {
    lnurlParams: LNURLWithdrawParams | LNURLPayParams
    encodedInvoice?: string
}


export type LnurlWithdrawResult = {
    status: 'ERROR' | 'OK'
    reason?: string
}


const getLnurlParams = async (encodedLnurl: string) => {

    const lnurlParams = await getParams(encodedLnurl) as any

    if((lnurlParams as LNURLResponse).status === 'ERROR') {
        throw new AppError(Err.CONNECTION_ERROR, lnurlParams.reason, {domain: lnurlParams.domain, caller: 'getLnurlParams'})
    }

    if(lnurlParams.tag === 'withdrawRequest') {
        // tag: string
        // k1: string
        // callback: string
        // domain: string
        // minWithdrawable: number
        // maxWithdrawable: number
        // defaultDescription: string
        return {
            lnurlParams
        } as LnurlParamsResult
    }

    if(lnurlParams.tag === 'payRequest') {
        // tag: string
        // callback: string
        // domain: string
        // minSendable: number
        // maxSendable: number
        // metadata: string
        // decodedMetadata: string[][]
        // commentAllowed?: number  

        const encodedInvoice = await getInvoice(lnurlParams)       

        if(encodedInvoice) {
            return {
                lnurlParams,
                encodedInvoice
            } as LnurlParamsResult
        }

        throw new AppError(Err.CONNECTION_ERROR, 'Could not get lightning invoice from the LNURL provider', {domain: lnurlParams.domain, caller: 'getLnurlParams'})

    }

    if(lnurlParams.tag === 'login') {
        // tag: string
        // k1: string
        // callback: string
        // domain: string
        throw new AppError(Err.NOTFOUND_ERROR, 'Login with LNURL is not yet implemented', {caller: 'getLnurlParams'})
    }

    if(lnurlParams.tag === 'channelRequest') {
        throw new AppError(Err.NOTFOUND_ERROR, 'You do not need to manage lightning channels with Minibits.', {caller: 'getLnurlParams'})
    }

    throw new AppError(Err.NOTFOUND_ERROR, 'Unknown LNURL tag', {tag: lnurlParams.tag})
}


// TODO .onion addresses support
const getLnurlAddressParams = async (lnurlAddress: string) => {
    
    const domain = LnurlUtils.getDomainFromLnurlAddress(lnurlAddress)
    const name = LnurlUtils.getNameFromLnurlAddress(lnurlAddress)

    if(!domain || !name) {
        throw new AppError(Err.NOTFOUND_ERROR, 'Could not get lightning address name or domain', {caller: 'getLnurlAddressParams'})
    }

    const url = `https://${domain}/.well-known/lnurlp/${name}`
    const method = 'GET'        
    const headers = MinibitsClient.getPublicHeaders()
    
    const lnurlParams = await MinibitsClient.fetchApi(url, {
        method,
        headers,            
    })

    if(lnurlParams.status && lnurlParams.status === 'ERROR') {
        throw new AppError(Err.CONNECTION_ERROR, lnurlParams.reason, {domain, caller: 'getLnurlAddressParams'})
    }

    lnurlParams.domain = domain
    try {
        lnurlParams.decodedMetadata = JSON.parse(lnurlParams.metadata)      
    } catch (err) {
        lnurlParams.decodedMetadata = []
    }

    const encodedInvoice = await getInvoice(lnurlParams)       

    if(encodedInvoice) {
        return {
            lnurlParams,
            encodedInvoice
        } as LnurlParamsResult
    }

    throw new AppError(Err.CONNECTION_ERROR, 'Could not get lightning invoice from the LNURL provider', {domain: lnurlParams.domain, caller: 'getLnurlAddressParams'})
}



const getInvoice = async(lnurlParams: LNURLPayParams) => {
    
    let amountMsat = lnurlParams.minSendable // msat

    if(!amountMsat || amountMsat === 0) {
        amountMsat = lnurlParams.maxSendable
    }

    const url = lnurlParams.callback.includes('?') ? `${lnurlParams.callback}&amount=${amountMsat}` : `${lnurlParams.callback}?amount=${amountMsat}`
    const method = 'GET'        
    const headers = MinibitsClient.getPublicHeaders()

    // to make it aligned with other send payment flows, we prefetch the invoice for minSendable amount
    // and later pass it to the TransferScreen to pay
    const invoiceResult: any = await MinibitsClient.fetchApi(url, {
        method,
        headers,            
    })

    if(invoiceResult.status && invoiceResult.status === 'ERROR') {
        throw new AppError(Err.CONNECTION_ERROR, invoiceResult.reason, {domain: lnurlParams.domain, caller: 'getLnurlParams'})
    }

    if(invoiceResult.pr) {
        return invoiceResult.pr as string
    }
    
    throw new AppError(Err.CONNECTION_ERROR, 'Could not get lightning invoice from the LNURL provider', {domain: lnurlParams.domain, caller: 'getLnurlParams'})    
}


const withdraw = async(lnurlParams: LNURLWithdrawParams, encodedInvoice: string) => {
    const url = lnurlParams.callback.includes('?') ? `${lnurlParams.callback}&k1=${lnurlParams.k1}&pr=${encodedInvoice}` : `${lnurlParams.callback}?k1=${lnurlParams.k1}&pr=${encodedInvoice}`
    const method = 'GET'        
    const headers = MinibitsClient.getPublicHeaders()

    const withdrawResult: LnurlWithdrawResult = await MinibitsClient.fetchApi(url, {
        method,
        headers,            
    })

    return withdrawResult
}


export const LnurlClient = {
    getLnurlParams,
    getLnurlAddressParams,
    withdraw,
}