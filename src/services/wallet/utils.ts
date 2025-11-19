import AppError from "../../utils/AppError"
import { isObj } from '@cashu/cashu-ts/src/utils'

const formatError = function (e: AppError) {
    return {
        name: e.name,
        message: isObj(e.message) ? JSON.stringify(e.message) : e.message.slice(0, 200),
        params: e.params || {},
    } as AppError 
}

export const WalletUtils = {            
    formatError
}