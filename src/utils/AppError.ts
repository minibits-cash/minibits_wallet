
import * as Sentry from '@sentry/react-native'
import {SENTRY_ACTIVE} from '@env'
import {log, SentryActive} from '../services/logService'

export enum Err {
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  MINT_ERROR = 'MINT_ERROR',
  WALLET_ERROR = 'WALLET_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  NOTFOUND_ERROR = 'NOTFOUND_ERROR',
  ALREADY_EXISTS_ERROR = 'ALREADY_EXISTS_ERROR',
  UNAUTHORIZED_ERROR = 'UNAUTHORIZED_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  KEYCHAIN_ERROR = 'KEYCHAIN_ERROR',
  POLLING_ERROR = 'POLLING_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
}

export interface IAppError {
  code?: string
  name: Err
  message: string
  params?: any
}

class AppError extends Error {
  public name: Err
  public message: string
  public params?: { caller?: string, message?: string, [key: string]: any }

  constructor(name: Err = Err.UNKNOWN_ERROR, message: string, params?: any) {
    super(name)
    this.name = name
    this.message = message
    this.params = params

    let callerFunctionName = 'unknown'

    if (params && params.caller) {
        callerFunctionName = params.caller
    }

    log.error(`[${callerFunctionName}]`, name, message, JSON.stringify(params))

    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export default AppError
