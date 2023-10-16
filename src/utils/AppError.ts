
import * as Sentry from '@sentry/react-native'
import {SENTRY_ACTIVE} from '@env'
import {log, SentryActive} from './logger'

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
  public params?: any

  constructor(name: Err = Err.UNKNOWN_ERROR, message: string, params?: any) {
    super(name)
    this.name = name
    this.message = message
    this.params = JSON.stringify(params) // prevent showing just [object] in Sentry   

    let callerFunctionName = ''
    const error = new Error()
    const stackTrace = error.stack?.split('\n')

    if (stackTrace) {
      const callerLine = stackTrace[2]
      callerFunctionName = callerLine !== null ? callerLine.match(/at\s+(.*)\s+\(/)[1] : ''

      if( callerFunctionName === '?anon_0_' || callerFunctionName === 'anonymous') {
        callerFunctionName = (params && params.caller) ? params.caller : 'unknown'
      }
    }  

    log.error(name, message, params, callerFunctionName)

    // Sentry trial
    if (!__DEV__ && SENTRY_ACTIVE === SentryActive.TRUE) {
      Sentry.captureException(error)
    }

    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export default AppError
