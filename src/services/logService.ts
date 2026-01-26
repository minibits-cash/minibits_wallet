// logService.ts
import {
    logger,
    consoleTransport,
    transportFunctionType,
} from "react-native-logs"
import {
    APP_ENV,
    SENTRY_DSN,
    JS_BUNDLE_VERSION,    
    ANDROID_VERSION_NAME,    
} from '@env'
import { lightFormat } from 'date-fns'
import * as Sentry from '@sentry/react-native'
import { rootStoreInstance } from '../models'
import { LogLevel } from './log/logTypes'
import { Platform } from "react-native"
import AppError, { Err } from "../utils/AppError"

const { userSettingsStore } = rootStoreInstance
// 

if (!__DEV__) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: APP_ENV,
        release: Platform.OS === 'android' ? `minibits_wallet_android@${JS_BUNDLE_VERSION}` : `minibits_wallet_ios@${JS_BUNDLE_VERSION}`,
        dist: ANDROID_VERSION_NAME,
        beforeSend: function (event, hint) {
            const exception = hint.originalException
            if (exception instanceof AppError && exception.name) {
                event.fingerprint = [exception.name.toString()]
            }
            return event
        },
        enableLogs: true,
    })
}

// === Options interface (used in transportOptions) ===
interface TransportOptions {
    SENTRY?: typeof Sentry
}

// === Type-safe mappings ===
const levelPriority: Record<LogLevel, number> = {
    [LogLevel.TRACE]: 0,
    [LogLevel.DEBUG]: 1,
    [LogLevel.INFO]: 2,
    [LogLevel.WARN]: 3,
    [LogLevel.ERROR]: 4,
}

const levelToSentry: Record<LogLevel, Sentry.SeverityLevel> = {
    [LogLevel.TRACE]: 'debug',
    [LogLevel.DEBUG]: 'debug',
    [LogLevel.INFO]: 'info',
    [LogLevel.WARN]: 'warning',
    [LogLevel.ERROR]: 'error',
}

const safeStringify = (msg: any): string => {
    try {
        if (msg === null || msg === undefined) return 'null'
        if (typeof msg === 'string') return msg
        if (msg instanceof Error) return `${msg.name}: ${msg.message}\n${msg.stack || ''}`
        return JSON.stringify(msg, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
    } catch {
        return '[Unserializable]'
    }
}

const redactSensitive = (text: string): string => {
    if (!text) return text
    return text
        .replace(/lnurl\w{50,}/gi, 'lnurl[redacted]')
        .replace(/nsec1[ac-hj-np-z02-9]{58,}/g, 'nsec1[redacted]')
        .replace(/cashuB[ac-hj-np-z02-9]{58,}/g, 'cashuB[redacted]')
}


const extractFromArray = (arr: any[]): { message: string; params: Record<string, any> } => {
    const strings: string[] = []
    const objects: Record<string, any>[] = []

    for (const item of arr) {
        if (typeof item === 'string') strings.push(redactSensitive(item))
    }



    return {
        message: strings.length > 0 ? strings.join(' ') : '[No message]',
        params: arr[1] && typeof arr[1] === 'object' ? arr[1] : {},
    }
}


const customSentryTransport: transportFunctionType<TransportOptions> = async (props) => {
    if (!userSettingsStore.isLoggerOn) return true

    const level = props.level.text as LogLevel
    const rawMessage = props.rawMsg

    let message = ''
    let params: Record<string, any> = {}

    // === Extract message + params safely ===
    if (typeof rawMessage === 'string') {

        message = redactSensitive(rawMessage)

    } else if (Array.isArray(rawMessage)) {

        const { message: msg, params: p } = extractFromArray(rawMessage)
        message = msg
        params = p

    } else if (rawMessage instanceof Error) {

        message = redactSensitive(rawMessage.message)
        if (rawMessage instanceof AppError) {
            params = rawMessage.params ?? {}
        }
        // For native JS Errors: preserve stack, don't override
        if ('stack' in rawMessage) {
            params.stack = rawMessage.stack?.slice(0, 200)
        }
    } else if (rawMessage && typeof rawMessage === 'object') {
        message = '[Object logged]'
        params = rawMessage
    }

    //console.log(`[${level}] ${message}`, params)

    // === ERROR LEVEL: Send real exception with full context ===
    if (level === LogLevel.ERROR) {
        let errorToSend: Error

        if (rawMessage instanceof Error) {
            // Preserve original error (AppError or native JS Error)
            errorToSend = rawMessage
        } else {
            // Only fallback if no real error was passed
            errorToSend = new Error(message)
        }

        Sentry.captureException(errorToSend, {
            contexts:{ params },
            tags: { source: 'logger' },
            // Optional: improve grouping if needed
            // fingerprint: rawMessage instanceof AppError ? [rawMessage.code] : undefined,
        })

        return true
    }

    // === Non-error levels: structured breadcrumbs via logger (or addBreadcrumb) ===
    const currentPriority = levelPriority[level]
    const minPriority = levelPriority[userSettingsStore.logLevel] ?? levelPriority[LogLevel.WARN]
    if (currentPriority < minPriority) return true

    switch (level) {
        case LogLevel.TRACE:
        case LogLevel.DEBUG:
            Sentry.logger.debug(message, params)
            break
        case LogLevel.INFO:
            Sentry.logger.info(message, params)
            break
        case LogLevel.WARN:
            Sentry.logger.warn(message, params)
            break
    }

    return true
}

// === Create logger ===
const log = logger.createLogger({
    severity: __DEV__ ? LogLevel.TRACE : LogLevel.DEBUG,
    levels: {
        trace: 0,
        debug: 1,
        info: 2,
        warn: 3,
        error: 4,
    },
    transport: __DEV__ ? consoleTransport : customSentryTransport,
    transportOptions: {
        SENTRY: Sentry,
    } as TransportOptions,
    dateFormat: () => `${lightFormat(new Date(), 'HH:mm:ss.SSS')} | `,
    stringifyFunc: safeStringify,
    async: true,
    asyncFunc: (transport: any) => setTimeout(transport, 0),
})

export { log }