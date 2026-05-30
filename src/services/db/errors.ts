import AppError, {Err} from '../../utils/AppError'

/**
 * Normalize an arbitrary caught error into an AppError for the DB layer.
 *
 * Existing AppErrors (e.g. a NOTFOUND_ERROR raised deliberately inside a query)
 * pass through unchanged so their specific `name`/code isn't flattened into a
 * generic DATABASE_ERROR. Everything else is wrapped with the supplied message.
 */
export const dbError = (message: string, e: any): AppError =>
  e instanceof AppError ? e : new AppError(Err.DATABASE_ERROR, message, e?.message)
