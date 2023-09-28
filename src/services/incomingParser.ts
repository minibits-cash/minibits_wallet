import notifee, { AndroidImportance } from '@notifee/react-native'
import { StackNavigationProp } from '@react-navigation/stack'
import { colors } from '../theme'
import AppError, { Err } from '../utils/AppError'
import { log } from '../utils/logger'
import { CashuUtils } from './cashu/cashuUtils'
import { MintClient, MintKeys } from './cashuMintClient'
import { LightningUtils } from './lightning/lightningUtils'
import { LnurlUtils } from './lnurl/lnurlUtils'

export enum IncomingDataType {
    CASHU = 'CASHU',
    INVOICE = 'INVOICE',
    LNURLP = 'LNURLP',
    LNURLW = 'LNURLW',
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
            case (IncomingDataType.LNURLP || IncomingDataType.LNURLW):
                encoded = LnurlUtils.extractEncodedLnurl(incomingData)                
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
        log.trace('Got lightning invoice', maybeInvoice, 'findAndExtract')

        const encodedInvoice = LightningUtils.extractEncodedLightningInvoice(maybeInvoice) // throws

        return {
            type: IncomingDataType.INVOICE,
            encoded: encodedInvoice
        }
    }

    const maybeLnurl = LnurlUtils.findEncodedLnurl(incomingData)

    if(maybeLnurl) {
        log.trace('Got lightning invoice', maybeInvoice, 'findAndExtract')

        const encodedLnurl = LnurlUtils.extractEncodedLnurl(maybeLnurl) // throws

        return {
            type: IncomingDataType.INVOICE,
            encoded: encodedLnurl
        }
    }

    const mintUrl = new URL(incomingData) // throws

    return {
        type: IncomingDataType.MINT_URL,
        encoded: incomingData
    }
}


const navigateWithIncomingData = function (
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
            })

        case (IncomingDataType.LNURLP || IncomingDataType.LNURLW):
            throw new AppError(Err.NOTFOUND_ERROR, 'LNURL support is not yet implemented.')


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