import AppError from "../../utils/AppError"
import { CashuUtils } from '../cashu/cashuUtils'

/**
 * Cashu protocol error codes (NUT-00).
 * See https://github.com/cashubtc/nuts/blob/main/error_codes.md
 *
 * cashu-ts surfaces these on `MintOperationError.code`; our WalletStore copies
 * the code into `AppError.params.code` (and AppError's constructor exposes it
 * on `e.code`).
 */
export const CashuErrorCode = {
    OUTPUTS_ALREADY_SIGNED: 10002,
    TOKEN_ALREADY_SPENT: 11001,
    QUOTE_PENDING: 11005,
    TOKEN_PENDING: 11006,
} as const

const formatError = function (e: AppError) {
    return {
        name: e.name,
        message: CashuUtils.isObj(e.message) ? JSON.stringify(e.message) : e.message.slice(0, 200),
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

        if(e.code && e.code === CashuErrorCode.OUTPUTS_ALREADY_SIGNED) {
          return true
        }
    }
    return false
}

/**
 * True if the cashu mint reported that one of the input proofs is already
 * spent (NUT-00 code 11001). Inputs to this op are stale — sync the wallet
 * to reconcile.
 */
const isTokenAlreadySpentError = function (e: any): boolean {
    if (!(e instanceof AppError)) return false
    return e.code === CashuErrorCode.TOKEN_ALREADY_SPENT
}

/**
 * True if the cashu mint reported that one of the input proofs is pending
 * in another in-flight melt operation (NUT-00 code 11006). Do not release
 * these — sync will resolve once the other operation settles.
 */
const isTokenPendingError = function (e: any): boolean {
    if (!(e instanceof AppError)) return false
    return e.code === CashuErrorCode.TOKEN_PENDING
}

/**
 * True when a swap failed without the mint definitively rejecting it, after the
 * request may already have been sent: the mint may have executed it, and its
 * outputs would then exist only at the mint.
 *
 * `requestSent` is whether onCountersReserved fired — cashu-ts calls it right
 * before the POST, so if it never fired the request never left. A mint REJECTION
 * carries a NUT-00 code (copied onto e.code by WalletStore) and is definitive; a
 * timeout, dropped connection, 5xx, or a local error after the response (e.g. while
 * committing it) is not.
 */
const isSwapOutcomeUnknown = function (e: any, requestSent: boolean): boolean {
    if (!requestSent) return false
    return !(e instanceof AppError && e.code)
}

export const WalletUtils = {
    formatError,
    shouldHealOutputsError,
    isTokenAlreadySpentError,
    isTokenPendingError,
    isSwapOutcomeUnknown,
}

