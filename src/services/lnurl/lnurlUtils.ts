
import {decodelnurl} from 'js-lnurl/lib/helpers/decodelnurl'
import AppError, {Err} from '../../utils/AppError'
import { log } from '../../utils/logger'


const findEncodedLnurl = function (content: string) {
    const words = content.split(/\s+|\n+/)
    const maybeLnurl = words.find(word => word.toLowerCase().includes("lnurl1"))
    return maybeLnurl || null
}


const extractEncodedLnurl = function (maybeLnurl: string) {    

    let encodedLnurl: string | undefined = undefined    

    if (maybeLnurl.startsWith('lnurl1')) {
        const decoded = decodelnurl(maybeLnurl) // throws
        return maybeLnurl
    }

    // URI token formats
    const uriPrefixes = [
		'lightning://',
        'lightning:',
		'lnurlw://',
        'lnurlp://',
	]

	for (const prefix of uriPrefixes) {
		if (maybeLnurl.startsWith(prefix)) {            
            encodedLnurl = maybeLnurl.slice(prefix.length)
            break // necessary
        }
	}

    log.trace('Got lnurl without prefix', encodedLnurl, 'extractEncodedCashuToken')

    // try to decode
    if(encodedLnurl) {
        const decoded = decodelnurl(encodedLnurl) // throws
        log.trace('decoded lnurl', decoded, 'extractEncodedLnurl')
        
        return encodedLnurl
    }

    throw new AppError(Err.NOTFOUND_ERROR, 'Could not extract LNURL from the provided string', maybeLnurl)
}

export const LnurlUtils = {
    findEncodedLnurl,
    extractEncodedLnurl
}
  