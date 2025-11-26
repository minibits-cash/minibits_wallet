import AppError from "../../utils/AppError"
import { isObj } from '@cashu/cashu-ts/src/utils'

const formatError = function (e: AppError) {
    return {
        name: e.name,
        message: isObj(e.message) ? JSON.stringify(e.message) : e.message.slice(0, 200),
        params: e.params || {},
    } as AppError 
}

const shouldHealOutputsError = function (e: any): boolean {
    if (e instanceof AppError) {
        if (/already.*signed|duplicate key/i.test(e.message)) {
          return true
        }

        if (e.params && e.params.message && /already.*signed|duplicate key/i.test(e.params.message)) {
          return true
        }

        if(e.code && e.code === 10002) {
          return true
        }
    }
    return false
} 

export const WalletUtils = {            
    formatError,
    shouldHealOutputsError
}

