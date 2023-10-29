import {lightFormat} from 'date-fns'
import * as Sentry from '@sentry/react-native'
import {Err} from './AppError'
import {APP_ENV, LOG_LEVEL, SENTRY_ACTIVE} from '@env'

// refresh // refresh // refresh

export enum LogLevel {
  TRACE = 'TRACE',
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  ERROR = 'ERROR',
}

export enum Env {
  DEV = 'DEV',
  TEST = 'TEST',
  PROD = 'PROD',
}

export enum SentryActive {
    TRUE = 'TRUE',
    FALSE = 'FALSE',    
}

const _showTimestamps: boolean = true
const _logLevel = LOG_LEVEL as LogLevel

const trace = function (message: any, params: any = {}, caller: string = '') {
    if (APP_ENV === Env.PROD) return

    let callerFunctionName = ''
    const error = new Error()
    const stackTrace = error.stack?.split('\n')

    if (stackTrace) {
        const callerLine = stackTrace[2]
        callerFunctionName =
            callerLine !== null ? callerLine.match(/at\s+(.*)\s+\(/)[1] : ''

        if(callerFunctionName === '?anon_0_' || callerFunctionName === 'anonymous') {
            callerFunctionName = caller
        }
    }

    if (_logLevel === LogLevel.TRACE) {
        if (_showTimestamps) {
            const t = lightFormat(new Date(), 'HH:mm:ss:SSS')
            console.log(`[TRACE] ${t} [${callerFunctionName}]`, message, params)
        } else {
            console.log(`[TRACE] [${callerFunctionName}]`, message, params)
        }
    }
}

const debug = function (
  message: string,
  params: any = {},
  caller: string = '',
) {
    if (APP_ENV === Env.PROD) return

    let callerFunctionName = ''
    const error = new Error()
    const stackTrace = error.stack?.split('\n')

    if (stackTrace) {
        const callerLine = stackTrace[2]
        callerFunctionName = callerLine !== null ? callerLine.match(/at\s+(.*)\s+\(/)[1] : ''

        if(callerFunctionName === '?anon_0_' ||  callerFunctionName === 'anonymous') {
            callerFunctionName = caller
        }
    }

    if ([LogLevel.TRACE, LogLevel.DEBUG].includes(_logLevel)) {
    if (_showTimestamps) {
        const t = lightFormat(new Date(), 'HH:mm:ss:SSS')
        console.log(`[DEBUG] ${t} [${callerFunctionName}]`, message, params)
    } else {
        console.log(`[DEBUG] [${callerFunctionName}]`, message, params)
    }
    }
}

const info = function (message: string, params: any = {}, caller: string = '') {
    let callerFunctionName = ''
    const error = new Error()
    const stackTrace = error.stack?.split('\n')

    if (stackTrace) {
        const callerLine = stackTrace[2]
        callerFunctionName =
        callerLine !== null ? callerLine.match(/at\s+(.*)\s+\(/)[1] : ''


        if( callerFunctionName === '?anon_0_' || callerFunctionName === 'anonymous') {
        callerFunctionName = caller
        }
    }

    if ([LogLevel.TRACE, LogLevel.DEBUG, LogLevel.INFO].includes(_logLevel)) {
        if (_showTimestamps) {
        const t = lightFormat(new Date(), 'HH:mm:ss:SSS')
        console.log(`[INFO] ${t} [${callerFunctionName}]`, message, params)
        } else {
        console.log(`[INFO] [${callerFunctionName}]`, message, params)
        }
        if (!__DEV__ && SENTRY_ACTIVE === SentryActive.TRUE) {
            Sentry.captureMessage(message, params)
        }
    }
}

const error = function (
  name: Err,
  message: string,
  params: any = {},
  caller: string = '',
) {
    if (_showTimestamps) {
        const t = lightFormat(new Date(), 'HH:mm:ss:SSS')
        console.error(`[${name}] ${t} [${caller}]`, message, params)
    } else {
        console.error(`[${name}] [${caller}]`, message, params)
    }
}


export const log = {
    trace,
    debug,
    info,
    error
}