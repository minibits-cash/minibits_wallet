// AppError.ts
import { log } from '../services/logService'

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
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  KEYCHAIN_ERROR = 'KEYCHAIN_ERROR',
  POLLING_ERROR = 'POLLING_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  LOCKED_ERROR = 'LOCKED_ERROR',
  SCAN_ERROR = 'SCAN_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  NFC_ERROR = 'NFC_ERROR',
}

export class AppError extends Error {
  public readonly code: number | undefined
  public readonly params?: Record<string, any>
  public readonly caller?: string

  constructor(
    name: Err = Err.UNKNOWN_ERROR,
    message: string = 'An unknown error occurred',
    params?: Record<string, any>,
  ) {
    // This is the actual error message shown in Sentry
    super(message)

    this.name = name 
    this.code = params?.code       
    this.params = params          // Structured data (sent to Sentry)
    this.caller = params?.caller  // Optional: who threw it

    // Ensure proper prototype chain (important for instanceof)
    Object.setPrototypeOf(this, AppError.prototype)

    // Preserve correct stack trace (V8 only — safe no-op elsewhere)
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor)
    }

    // === SAFE LOGGING: Only log if logger is on and avoid recursion ===
    if (log && typeof log.error === 'function') {
      try {
        let msg = this.caller ? `[${this.caller}] ${this.message}` : this.message
        log.error(`${msg}`, { ...params, name })
      } catch (e) {
        // Never let logging crash the app
        console.error('Failed to log AppError:', e)
      }
    }
  }
}


export default AppError