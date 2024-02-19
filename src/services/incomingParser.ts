import notifee, { AndroidImportance } from '@notifee/react-native'
import { StackNavigationProp } from '@react-navigation/stack'
import { getParams, LNURLResponse } from 'js-lnurl'
import { ReceiveOption, SendOption } from '../screens'
import { colors } from '../theme'
import AppError, { Err } from '../utils/AppError'
import { log } from './logService'
import { CashuUtils } from './cashu/cashuUtils'
import { MintClient, MintKeys } from './cashuMintClient'
import { LightningUtils } from './lightning/lightningUtils'
import { LnurlUtils } from './lnurl/lnurlUtils'
import { LnurlClient } from './lnurlService'

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
        log.trace('Got maybeLnurl', maybeLnurl, 'findAndExtract')

        const encodedLnurl = LnurlUtils.extractEncodedLnurl(maybeLnurl) // throws

        return {
            type: IncomingDataType.LNURL,
            encoded: encodedLnurl
        }
    }


    const maybeLnurlAddress = LnurlUtils.findEncodedLnurlAddress(incomingData)

    if(maybeLnurlAddress) {
        log.trace('Got maybeLnurlAddress', maybeLnurlAddress, 'findAndExtract')

        const lnurlAddress = LnurlUtils.extractLnurlAddress(maybeLnurlAddress) // throws

        return {
            type: IncomingDataType.LNURL_ADDRESS,
            encoded: lnurlAddress
        }
    }

    const maybeMintUrl = new URL(incomingData) // throws

    log.trace('Got maybeMintUrl', incomingData, 'findAndExtract')

    return {
        type: IncomingDataType.MINT_URL,
        encoded: incomingData
    }
}


const navigateWithIncomingData = async function (
    incoming: {
        type: IncomingDataType, 
        encoded: any
    }, 
    navigation: StackNavigationProp<any>
) {

    switch (incoming.type) {
        case IncomingDataType.CASHU:
            return navigation.navigate('Receive', {
                encodedToken: incoming.encoded,
            })

        case IncomingDataType.INVOICE:
            return navigation.navigate('Transfer', {
                encodedInvoice: incoming.encoded,
                paymentOption: SendOption.PASTE_OR_SCAN_INVOICE
            })

        case (IncomingDataType.LNURL):
            try {
                const paramsResult = await LnurlClient.getLnurlParams(incoming.encoded)
                const {lnurlParams} = paramsResult

                if(lnurlParams.tag === 'withdrawRequest') {                
                    return navigation.navigate('Topup', {
                        lnurlParams,
                        paymentOption: ReceiveOption.LNURL_WITHDRAW
                    })
                }

                if(lnurlParams.tag === 'payRequest') {
                    return navigation.navigate('Transfer', {
                        lnurlParams,                    
                        paymentOption: SendOption.LNURL_PAY
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
                    paymentOption: SendOption.LNURL_PAY
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