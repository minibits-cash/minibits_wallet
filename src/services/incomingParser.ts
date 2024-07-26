import { StackNavigationProp } from '@react-navigation/stack'
import { ReceiveOption, SendOption } from '../screens'
import AppError, { Err } from '../utils/AppError'
import { log } from './logService'
import { CashuUtils } from './cashu/cashuUtils'
import { LightningUtils } from './lightning/lightningUtils'
import { LnurlUtils } from './lnurl/lnurlUtils'
import { LnurlClient } from './lnurlService'
import { MintUnit } from './wallet/currency'

export enum IncomingDataType {
    CASHU = 'CASHU',
    INVOICE = 'INVOICE',
    LNURL = 'LNURL',
    LNURL_ADDRESS = 'LNURL_ADDRESS',
    MINT_URL = 'MINT_URL',
}

const findAndExtract = function (
    incomingData: string, 
    expectedType?: IncomingDataType
): {type: IncomingDataType, encoded: any} {

    if(expectedType) {

        let encoded: string
        incomingData = incomingData.trim()
        
        switch (expectedType) {
            case IncomingDataType.CASHU:
                encoded = CashuUtils.extractEncodedCashuToken(incomingData)                
                return {
                    type: expectedType,
                    encoded
                }
            case IncomingDataType.INVOICE:
                encoded = LightningUtils.extractEncodedLightningInvoice(incomingData)                
                return {
                    type: expectedType,
                    encoded
                }
            case (IncomingDataType.LNURL):
                encoded = LnurlUtils.extractEncodedLnurl(incomingData)                
                return {
                    type: expectedType,
                    encoded
                }
            case (IncomingDataType.LNURL_ADDRESS):
                encoded = LnurlUtils.extractLnurlAddress(incomingData)                
                return {
                    type: expectedType,
                    encoded
                }                
            case IncomingDataType.MINT_URL:
                const url = new URL(incomingData) // throws

                return {
                    type: expectedType,
                    encoded: incomingData
                }  
            default:
                throw new AppError(Err.NOTFOUND_ERROR, 'Unknown expectedType', {expectedType})
        }
    }
    
    const maybeToken = CashuUtils.findEncodedCashuToken(incomingData)

    if(maybeToken) {
        const encodedToken = CashuUtils.extractEncodedCashuToken(maybeToken) // throws

        return {
            type: IncomingDataType.CASHU,
            encoded: encodedToken
        }
    }

    const maybeInvoice = LightningUtils.findEncodedLightningInvoice(incomingData)

    if(maybeInvoice) {
        log.trace('Got maybeInvoice', maybeInvoice, 'findAndExtract')

        const encodedInvoice = LightningUtils.extractEncodedLightningInvoice(maybeInvoice) // throws

        return {
            type: IncomingDataType.INVOICE,
            encoded: encodedInvoice
        }
    }

    const maybeLnurl = LnurlUtils.findEncodedLnurl(incomingData)

    if(maybeLnurl) {
        log.trace('[findAndExtract] Got maybeLnurl', maybeLnurl)

        const encodedLnurl = LnurlUtils.extractEncodedLnurl(maybeLnurl) // throws

        return {
            type: IncomingDataType.LNURL,
            encoded: encodedLnurl
        }
    }

    const maybeLnurlAddress = LnurlUtils.findEncodedLnurlAddress(incomingData)

    if(maybeLnurlAddress) {
        log.trace('[findAndExtract] Got maybeLnurlAddress', maybeLnurlAddress)

        const lnurlAddress = LnurlUtils.extractLnurlAddress(maybeLnurlAddress) // throws

        return {
            type: IncomingDataType.LNURL_ADDRESS,
            encoded: lnurlAddress
        }
    }

    const maybeMintUrl = new URL(incomingData) // throws

    if(incomingData.startsWith('http')) {
        log.trace('[findAndExtract] Got maybeMintUrl', incomingData)

        return {
            type: IncomingDataType.MINT_URL,
            encoded: incomingData
        }
    }

    if(incomingData.startsWith('ur:bytes')) {
        log.trace('[findAndExtract] Got animated QR', incomingData)

        throw new AppError(Err.VALIDATION_ERROR, 'Minibits does not yet support animated QR codes.', {
            caller: 'findAndExtract'                     
        })
    }

    throw new AppError(Err.VALIDATION_ERROR, 'Unknown incoming data type.', {
        caller: 'findAndExtract'                     
    })

}


const navigateWithIncomingData = async function (
    incoming: {
        type: IncomingDataType, 
        encoded: any
    }, 
    navigation: StackNavigationProp<any>,
    unit: MintUnit,
    mintUrl?: string
) {

    switch (incoming.type) {
        case IncomingDataType.CASHU:
            return navigation.navigate('Receive', {
                encodedToken: incoming.encoded,
                unit,
                mintUrl
            })

        case IncomingDataType.INVOICE:
            return navigation.navigate('Transfer', {
                encodedInvoice: incoming.encoded,
                paymentOption: SendOption.PASTE_OR_SCAN_INVOICE,
                unit,
                mintUrl
            })

        case (IncomingDataType.LNURL):
            try {
                const paramsResult = await LnurlClient.getLnurlParams(incoming.encoded)
                const {lnurlParams} = paramsResult

                if(lnurlParams.tag === 'withdrawRequest') {                
                    return navigation.navigate('Topup', {
                        lnurlParams,
                        paymentOption: ReceiveOption.LNURL_WITHDRAW,
                        unit,
                        mintUrl
                    })
                }

                if(lnurlParams.tag === 'payRequest') {
                    return navigation.navigate('Transfer', {
                        lnurlParams,                    
                        paymentOption: SendOption.LNURL_PAY,
                        unit,
                        mintUrl
                    })
                }

            } catch (e: any) {
                throw new AppError(Err.SERVER_ERROR, 'Could not get Lightning address details from the server.', {
                    caller: 'navigateWithIncomingData', 
                    message: e.message,                    
                })
            }

            
        case (IncomingDataType.LNURL_ADDRESS):
            try {
                const addressParamsResult = await LnurlClient.getLnurlAddressParams(incoming.encoded) // throws

                return navigation.navigate('Transfer', {
                    lnurlParams: addressParamsResult.lnurlParams,                
                    paymentOption: SendOption.LNURL_PAY,
                    unit,
                    mintUrl
                })
            } catch (e: any) {
                throw new AppError(Err.SERVER_ERROR, 'Could not get Lightning address details from the server.', {
                    caller: 'navigateWithIncomingData', 
                    message: e.message,
                    providedAddress: incoming.encoded
                })
            }
            
        case IncomingDataType.MINT_URL:
            return navigation.navigate('Wallet', {
                scannedMintUrl: incoming.encoded,
            })

        default:
            throw new AppError(Err.NOTFOUND_ERROR, 'Scanned data is neither ecash token, lightning invoice, lnurl or mint URL.')
    } 
}

export const IncomingParser = {
    findAndExtract,
    navigateWithIncomingData
}