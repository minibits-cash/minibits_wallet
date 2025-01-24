
import {decodelnurl} from 'js-lnurl/lib/helpers/decodelnurl'
import AppError, {Err} from '../../utils/AppError'
import { log } from '../logService'
import { LightningUtils, isLightningInvoice } from '../lightning/lightningUtils'

const LNURL_URI_PREFIXES = [
    'lightning://',
    'lightning:',
    'lnurlw://',
    'lnurlw:',
    'lnurlp://',
    'lnurlp:',
  ]

const findEncodedLnurl = function (content: string) {
    const words = content.split(/\s+|\n+/)
    const maybeLnurl = words.find(word => word.toLowerCase().includes("lnurl1"))
    return maybeLnurl || null
}

const findEncodedLnurlAddress = function (content: string) {
    const words = content.split(/\s+|\n+/)
    const maybeAddress = words.find(word => word.toLowerCase().includes("@"))
    return maybeAddress || null
}



function isLnurlAddress(address: string) {
  // Regular expression for a basic email validation    
  const regex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  return regex.test(address)
}

const extractEncodedLnurl = function (maybeLnurl: string) {    

    let encodedLnurl: string | null = null    

    if (maybeLnurl.toLowerCase().startsWith('lnurl1')) {
        const decoded = decodelnurl(maybeLnurl) // throws
        log.trace('[extractEncodedLnurl] Extracted lnurl', maybeLnurl)
        return maybeLnurl
    }

    if (maybeLnurl && maybeLnurl.toLowerCase().startsWith('http')) { // e.g. lnbits withdraw extension links
        const parsed = new URL(maybeLnurl.toLowerCase())
        encodedLnurl = parsed.searchParams.get('lightning')

        if(encodedLnurl) {
            const decoded = decodelnurl(encodedLnurl) // throws
            log.trace('[extractEncodedLnurl] Extracted lnurl from URL', encodedLnurl)
            return encodedLnurl
        }
    }

	for (const prefix of LNURL_URI_PREFIXES) {
		if (maybeLnurl && maybeLnurl.toLowerCase().startsWith(prefix)) {            
            encodedLnurl = maybeLnurl.toLowerCase().slice(prefix.length)
            break // necessary
        }
	}    

    
    if(encodedLnurl) {
        const decoded = decodelnurl(encodedLnurl) // throws
        log.trace('[extractEncodedLnurl] Extracted lnurl from deeplink', encodedLnurl)
        return encodedLnurl
    }

    throw new AppError(Err.NOTFOUND_ERROR, 'Could not extract LNURL from the provided string', maybeLnurl)
}


function extractLnurlAddress(maybeAddress: string) {
    let address: string | null = null
    for (const prefix of LNURL_URI_PREFIXES) {
        if (maybeAddress && maybeAddress.startsWith(prefix)) {
            address = maybeAddress.slice(prefix.length)
          break; // necessary
        }
    }

    if(address && isLnurlAddress(address)) {
        return address.toLowerCase()
    }

    if(isLnurlAddress(maybeAddress)) {
        return maybeAddress.toLowerCase()
    }

    throw new AppError(Err.NOTFOUND_ERROR, '[extractLnurlAddress] Could not extract Lightning address from the provided string', {maybeAddress})
}


const getDomainFromLnurlAddress = function(address: string) {
    const atIndex = address.lastIndexOf('@')

    if (atIndex !== -1) {
        const domain = address.slice(atIndex + 1)
        return domain      
    }
    // Invalid email or no domain found
    return null
}


const getNameFromLnurlAddress = function(address: string) {
    const atIndex = address.indexOf('@')
    
    if (atIndex !== -1) {
        const name = address.slice(0, atIndex);
        return name
    }
    
    // Invalid email or no "@" symbol found
    return null
}


export const LnurlUtils = {
    findEncodedLnurl,
    extractEncodedLnurl,
    findEncodedLnurlAddress,
    isLnurlAddress,
    extractLnurlAddress,
    getDomainFromLnurlAddress,
    getNameFromLnurlAddress,
}
  