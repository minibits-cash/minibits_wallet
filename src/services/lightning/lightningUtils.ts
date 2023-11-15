import {
  getDecodedLnInvoice,
} from '@cashu/cashu-ts'
import AppError, {Err} from '../../utils/AppError'
import addSeconds from 'date-fns/addSeconds'
import { log } from '../logService'

// TODO refactor all this into own module

export type DecodedLightningInvoice = {
  paymentRequest: string
  sections: any[]
  readonly expiry: any
  readonly route_hints: any[]
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

    if (maybeInvoice.startsWith('lightning:')) {       

        // URI token formats
        const uriPrefixes = [
            'lightning://',
            'lightning:',            
        ]

        for (const prefix of uriPrefixes) {
            if (maybeInvoice.startsWith(prefix)) {            
                encodedInvoice = maybeInvoice.slice(prefix.length)
                break // necessary
            }
        }
        
        invoice = decodeInvoice(encodedInvoice) // throws
        return encodedInvoice        
    }

    if (maybeInvoice.startsWith('bitcoin:')) {        
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
    const decoded = getDecodedLnInvoice(encoded)
    return decoded as DecodedLightningInvoice
  } catch (e: any) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      `Provided invoice is invalid: ${encoded}`,
      e.message,
    )
  }
}


const getInvoiceExpiresAt = function (timestamp: number, expiry: number): Date {
    const expiresAt = addSeconds(new Date(timestamp as number * 1000), expiry as number)
    return expiresAt   
}


const getInvoiceData = function (decoded: DecodedLightningInvoice) {
    let result: {amount?: number; description?: string; expiry?: number, payment_hash?: string, description_hash?: string, timestamp?: number} = {}

    // log.trace('decoded invoice', decoded)

    for (const item of decoded.sections) {
        switch (item.name) {
            case 'amount':
                result.amount = parseInt(item.value) / 1000 //sats
                break
            case 'description':
                result.description = (item.value as string) || ''
                break
            case 'payment_hash':
                result.payment_hash = (Buffer.from(item.value).toString('hex') as string) || ''
                break
            case 'description_hash':
                result.description_hash = (Buffer.from(item.value).toString('hex') as string) || ''
                break                
            case 'timestamp':
                result.timestamp = (item.value as number) || Math.floor(Date.now() / 1000) 
                break
        }
    }

    result.expiry = decoded.expiry || 600

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
