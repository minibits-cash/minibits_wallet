
import {decodelnurl} from 'js-lnurl/lib/helpers/decodelnurl'
import AppError, {Err} from '../../utils/AppError'
import { log } from '../../utils/logger'


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


const extractEncodedLnurl = function (maybeLnurl: string) {    

    let encodedLnurl: string | null = null    

    if (maybeLnurl.toLowerCase().startsWith('lnurl1')) {
        const decoded = decodelnurl(maybeLnurl) // throws
        log.trace('Extracted lnurl', maybeLnurl, 'extractEncodedLnurl')
        return maybeLnurl
    }

    if (maybeLnurl.startsWith('http')) { // e.g. lnbits withdraw extension links
        const parsed = new URL(maybeLnurl)
        encodedLnurl = parsed.searchParams.get('lightning')

        if(encodedLnurl) {
            const decoded = decodelnurl(encodedLnurl) // throws
            log.trace('Extracted lnurl from URL', encodedLnurl, 'extractEncodedLnurl')
            return encodedLnurl
        }
    }

    // URI token formats
    const uriPrefixes = [
		'lightning://',
        'lightning:',
		'lnurlw://',
        'lnurlw:',
        'lnurlp://',
        'lnurlp:',
	]

	for (const prefix of uriPrefixes) {
		if (maybeLnurl.startsWith(prefix)) {            
            encodedLnurl = maybeLnurl.slice(prefix.length)
            break // necessary
        }
	}    

    
    if(encodedLnurl) {
        const decoded = decodelnurl(encodedLnurl) // throws
        log.trace('Extracted lnurl from deeplink', encodedLnurl, 'extractEncodedLnurl')
        return encodedLnurl
    }

    throw new AppError(Err.NOTFOUND_ERROR, 'Could not extract LNURL from the provided string', maybeLnurl)
}


function extractLnurlAddress(maybeAddress: string) {   
    if(isLnurlAddress(maybeAddress)) {
        return maybeAddress.toLowerCase()
    }

    throw new AppError(Err.NOTFOUND_ERROR, 'Could not extract Lightning address from the provided string', maybeAddress)
}


function isLnurlAddress(address: string) {
    // Regular expression for a basic email validation
    const regex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/
    
    return regex.test(address)
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
  