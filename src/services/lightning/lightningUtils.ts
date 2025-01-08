import { decode } from "@gandlaf21/bolt11-decode"
import AppError, { Err } from '../../utils/AppError'
import { addSeconds } from 'date-fns'
import { log } from '../logService'
import { roundUp, toNumber } from "../../utils/number"

// TODO refactor all this into own module

export type DecodedLightningInvoice = {
  paymentRequest: string
  sections: any[]
  readonly expiry: any
  readonly route_hints: any[]
}

export type LightningInvoiceData = {
    amount: number; 
    payment_hash: string, 
    timestamp: number,
    expiry: number, 
    description?: string; 
    description_hash?: string,     
}

export function isLightningInvoice(address: string) {
  const regex = /^(ln)(bc|bt|bs|crt)\d+\w+/
  return regex.test(address.toLowerCase())
}


const findEncodedLightningInvoice = function (content: string) {
    const words = content.split(/\s+|\n+/)
    const maybeInvoice = words.find(word => word.toLowerCase().includes("lnbc"))
    return maybeInvoice || null
}


const extractEncodedLightningInvoice = function (maybeInvoice: string) {    
    // Attempt to decode the scanned content as a lightning invoice
    let invoice: DecodedLightningInvoice 
    let encodedInvoice: string = ''

    if (maybeInvoice && maybeInvoice.startsWith('lightning:')) {       

        // URI token formats
        const uriPrefixes = [
            'lightning://',
            'lightning:',            
        ]

        for (const prefix of uriPrefixes) {
            if (maybeInvoice && maybeInvoice.startsWith(prefix)) {            
                encodedInvoice = maybeInvoice.slice(prefix.length)
                break // necessary
            }
        }
        
        invoice = decodeInvoice(encodedInvoice) // throws
        return encodedInvoice        
    }

    if (maybeInvoice && maybeInvoice.startsWith('bitcoin:')) {        
        const url = new URL(maybeInvoice)
        // Use URLSearchParams to get the value of the "lightning" parameter
        encodedInvoice = url.searchParams.get("lightning") as string
        invoice = decodeInvoice(encodedInvoice) // throws
        return encodedInvoice  
    }

    invoice = decodeInvoice(maybeInvoice) // throws
    return maybeInvoice
}


const decodeInvoice = function (encoded: string): DecodedLightningInvoice {
  try {
    const decoded: DecodedLightningInvoice = decode(encoded)
    return decoded
  } catch (e: any) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      `Provided invoice is invalid: ${e.message}`,
      {encoded, caller: 'decodeInvoice'},
    )
  }
}


const getInvoiceExpiresAt = function (timestamp: number, expiry: number): Date {
    const expiresAt = addSeconds(new Date(timestamp as number * 1000), expiry as number)
    return expiresAt   
}


const getInvoiceData = function (decoded: DecodedLightningInvoice) {
    const result: LightningInvoiceData = {
        amount: 0,
        payment_hash: '',
        expiry: 0,
        timestamp: 0
    }

    // log.trace('decoded invoice', decoded)

    for (const item of decoded.sections) {
        switch (item.name) {
            case 'amount':
                result.amount = roundUp(toNumber(item.value) / 1000, 0) // round to whole sats
                break
            case 'description':
                result.description = (item.value as string) || ''
                break
            case 'payment_hash':
                result.payment_hash = (Buffer.from(item.value).toString('hex') as string)
                break
            case 'description_hash':
                result.description_hash = (Buffer.from(item.value).toString('hex') as string) || ''
                break                
            case 'timestamp':
                result.timestamp = (item.value as number) || Math.floor(Date.now() / 1000) 
                break
        }
    }

    result.expiry = decoded.expiry

    log.trace('[getInvoiceData]', result)
    
    return result
}

export const LightningUtils = {
    findEncodedLightningInvoice,
    extractEncodedLightningInvoice,
    decodeInvoice,
    getInvoiceExpiresAt,
    getInvoiceData
}
