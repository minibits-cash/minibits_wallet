import {log} from './logger'
import * as Sentry from '@sentry/react-native'

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
  public params: any

  constructor(name: Err = Err.UNKNOWN_ERROR, message: string, ...params: any) {
    super(...params)
    this.name = name
    this.message = message
    this.params = params

    let caller = ''
    const error = new Error()
    const stackTrace = error.stack?.split('\n')

    if (stackTrace) {
      const callerLine = stackTrace[2]
      caller = callerLine !== null ? callerLine.match(/at\s+(.*)\s+\(/)[1] : ''
    }

    log.error(name, message, params, caller)

    // Sentry trial
    if (!__DEV__) {
      Sentry.captureException(error)
    }

    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export default AppError
