import {
    logger,
    mapConsoleTransport,
    transportFunctionType,
} from "react-native-logs"
import {lightFormat} from 'date-fns'
import * as Sentry from '@sentry/react-native'
import {rootStoreInstance} from '../models'
import {LogLevel} from './log/logTypes'

// refresh // refresh // refresh

const {    
    userSettingsStore
} = rootStoreInstance

const customSentryTransport: transportFunctionType = props => {    

    if (!props.options?.SENTRY) {
        throw Error('No sentry instance provided')
    }

    // Log to Sentry only if user setting is switched on
    if (!userSettingsStore.isLoggerOn) {        
        return true
    }    

    if (props.level.text === 'error') {                
        // Capture error log
        if (props.rawMsg && props.rawMsg.stack && props.rawMsg.message) {
            // this is probably a JS error
            props.options.SENTRY.captureException(props.rawMsg)
        } else {
            props.options.SENTRY.captureException(props.msg)
        }
        return true
    }    

    // Capture log based on user setting for log level
    if (userSettingsStore.logLevel === LogLevel.DEBUG && [LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG].includes(props.level.text as LogLevel)) {        
        props.options.SENTRY.captureMessage(props.msg)
    }
    
    if (userSettingsStore.logLevel === LogLevel.INFO && [LogLevel.WARN, LogLevel.INFO].includes(props.level.text as LogLevel)) {        
        props.options.SENTRY.captureMessage(props.msg)
    }

    if (userSettingsStore.logLevel === LogLevel.WARN && props.level.text === LogLevel.WARN) {        
        props.options.SENTRY.captureMessage(props.msg)
    }
        
    return true
}

  
const log = logger.createLogger<LogLevel.TRACE | LogLevel.DEBUG | LogLevel.INFO | LogLevel.WARN | LogLevel.ERROR>({    
    severity: __DEV__ ? LogLevel.TRACE : LogLevel.DEBUG,
    levels: {
        trace: 0,
        debug: 1,
        info: 2,
        warn: 3,
        error: 4,
    },
    stringifyFunc: (msg: any) => {return JSON.stringify(msg, undefined, 4)},
    transport: __DEV__ ? mapConsoleTransport : customSentryTransport,
    transportOptions: {        
        SENTRY: Sentry,
        mapLevels: {
            trace: "log",
            debug: "debug",
            info: "info",
            warn: "warn",
            error: "error",
        }
    },
    dateFormat: (date: Date) => {
        return `${lightFormat(new Date(), 'HH:mm:ss:SSS')} | `
    },
})

export {log}
