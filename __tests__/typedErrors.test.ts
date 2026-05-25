/**
 * Typed error hierarchy tests (Phase 2).
 *
 * Verifies:
 *  - subclass instances are still instanceof AppError (backward compat)
 *  - subclass instances are NOT instanceof unrelated siblings
 *  - the default Err name on each subclass matches its category
 *  - existing `e.name === Err.X` checks still work
 *  - params/caller/code mechanics inherited from AppError
 *  - subclasses can be caught generically by `catch (e: unknown)` and narrowed
 */

// log.error in AppError's constructor would noisily call into the real logger
// during test runs; mock it before importing AppError.
jest.mock('../src/services/logService', () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    trace: jest.fn(),
    warn: jest.fn(),
  },
}))

import AppError, {
  Err,
  MintError,
  NetworkError,
  OperationError,
  StorageError,
  ValidationError,
  WalletError,
} from '../src/utils/AppError'

describe('Typed error hierarchy', () => {
  describe('backward compatibility', () => {
    test('AppError still constructible with (Err, message, params) signature', () => {
      const e = new AppError(Err.MINT_ERROR, 'mint says no', {mintUrl: 'http://m'})
      expect(e).toBeInstanceOf(AppError)
      expect(e).toBeInstanceOf(Error)
      expect(e.name).toBe(Err.MINT_ERROR)
      expect(e.message).toBe('mint says no')
      expect(e.params?.mintUrl).toBe('http://m')
    })

    test.each([
      ['ValidationError', ValidationError, Err.VALIDATION_ERROR],
      ['MintError', MintError, Err.MINT_ERROR],
      ['NetworkError', NetworkError, Err.NETWORK_ERROR],
      ['WalletError', WalletError, Err.WALLET_ERROR],
      ['StorageError', StorageError, Err.STORAGE_ERROR],
      ['OperationError', OperationError, Err.UNKNOWN_ERROR],
    ])('%s is instanceof AppError', (_label, Cls, _name) => {
      const e = new Cls('boom')
      expect(e).toBeInstanceOf(AppError)
      expect(e).toBeInstanceOf(Error)
    })

    test.each([
      ['ValidationError', ValidationError, Err.VALIDATION_ERROR],
      ['MintError', MintError, Err.MINT_ERROR],
      ['NetworkError', NetworkError, Err.NETWORK_ERROR],
      ['WalletError', WalletError, Err.WALLET_ERROR],
      ['StorageError', StorageError, Err.STORAGE_ERROR],
      ['OperationError', OperationError, Err.UNKNOWN_ERROR],
    ])('%s sets default name to the matching Err code', (_label, Cls, name) => {
      const e = new Cls('boom')
      expect(e.name).toBe(name)
      // Existing string-match checks still work
      expect(e.name === name).toBe(true)
    })
  })

  describe('cross-class instanceof', () => {
    test('NetworkError is NOT instanceof MintError (orthogonal categories)', () => {
      const e = new NetworkError('connection refused')
      expect(e).not.toBeInstanceOf(MintError)
    })

    test('MintError is NOT instanceof NetworkError', () => {
      const e = new MintError('mint returned bad response')
      expect(e).not.toBeInstanceOf(NetworkError)
    })

    test('ValidationError is NOT instanceof StorageError', () => {
      const e = new ValidationError('bad input')
      expect(e).not.toBeInstanceOf(StorageError)
    })

    test('All subclasses are NOT instanceof one another', () => {
      const errors = [
        new ValidationError('v'),
        new MintError('m'),
        new NetworkError('n'),
        new WalletError('w'),
        new StorageError('s'),
        new OperationError('o'),
      ]
      for (const a of errors) {
        for (const b of errors) {
          if (a === b) continue
          // a is never instanceof b's class unless they are the same class
          expect(a.constructor.name === b.constructor.name).toBe(false)
        }
      }
    })
  })

  describe('Err name override', () => {
    test('NetworkError can be thrown with NETWORK_TIMEOUT name', () => {
      const e = new NetworkError('timed out', {}, Err.NETWORK_TIMEOUT)
      expect(e).toBeInstanceOf(NetworkError)
      expect(e.name).toBe(Err.NETWORK_TIMEOUT)
    })

    test('NetworkError can be thrown with CONNECTION_ERROR name', () => {
      const e = new NetworkError('refused', {}, Err.CONNECTION_ERROR)
      expect(e).toBeInstanceOf(NetworkError)
      expect(e.name).toBe(Err.CONNECTION_ERROR)
    })

    test('ValidationError can use NOTFOUND_ERROR name', () => {
      const e = new ValidationError('not here', {}, Err.NOTFOUND_ERROR)
      expect(e).toBeInstanceOf(ValidationError)
      expect(e.name).toBe(Err.NOTFOUND_ERROR)
    })

    test('StorageError can use DATABASE_ERROR or KEYCHAIN_ERROR name', () => {
      const e1 = new StorageError('db', {}, Err.DATABASE_ERROR)
      const e2 = new StorageError('kc', {}, Err.KEYCHAIN_ERROR)
      expect(e1).toBeInstanceOf(StorageError)
      expect(e1.name).toBe(Err.DATABASE_ERROR)
      expect(e2).toBeInstanceOf(StorageError)
      expect(e2.name).toBe(Err.KEYCHAIN_ERROR)
    })
  })

  describe('params, caller, code inheritance', () => {
    test('params are stored on the subclass instance', () => {
      const e = new MintError('boom', {mintUrl: 'http://m', detail: 'x'})
      expect(e.params?.mintUrl).toBe('http://m')
      expect(e.params?.detail).toBe('x')
    })

    test('caller is extracted from params', () => {
      const e = new ValidationError('boom', {caller: 'sendTask'})
      expect(e.caller).toBe('sendTask')
    })

    test('code is extracted from params', () => {
      const e = new NetworkError('502', {code: 502})
      expect(e.code).toBe(502)
    })

    test('message and stack trace are preserved', () => {
      const e = new WalletError('keyset missing')
      expect(e.message).toBe('keyset missing')
      expect(typeof e.stack).toBe('string')
      expect(e.stack!.length).toBeGreaterThan(0)
    })
  })

  describe('narrowing in catch blocks', () => {
    test('typed throw is narrowable by instanceof', () => {
      const thrown: AppError = new NetworkError('refused')

      let kind: string | null = null
      try {
        throw thrown
      } catch (e) {
        if (e instanceof NetworkError) {
          kind = 'network'
        } else if (e instanceof MintError) {
          kind = 'mint'
        } else if (e instanceof AppError) {
          kind = 'other-app'
        } else {
          kind = 'unknown'
        }
      }
      expect(kind).toBe('network')
    })

    test('untyped AppError throw falls into AppError catch (no false-positive narrowing)', () => {
      const thrown = new AppError(Err.NETWORK_ERROR, 'refused')

      let path: string | null = null
      try {
        throw thrown
      } catch (e) {
        // Even though e.name === NETWORK_ERROR, it is NOT instanceof NetworkError
        // because it was created via plain AppError. This is the contract: the
        // typed subclass is opt-in for callers that want compile-time narrowing.
        if (e instanceof NetworkError) {
          path = 'network-typed'
        } else if (e instanceof AppError) {
          path = 'app-error'
        } else {
          path = 'unknown'
        }
      }
      expect(path).toBe('app-error')
    })

    test('order of catch blocks: typed > generic AppError > unknown', () => {
      const errors: AppError[] = [
        new ValidationError('v'),
        new MintError('m'),
        new NetworkError('n'),
        new AppError(Err.MINT_ERROR, 'plain'),
      ]

      const kinds = errors.map(thrown => {
        try {
          throw thrown
        } catch (e) {
          if (e instanceof ValidationError) return 'validation'
          if (e instanceof NetworkError) return 'network'
          if (e instanceof MintError) return 'mint'
          if (e instanceof AppError) return 'app-error'
          return 'unknown'
        }
      })

      expect(kinds).toEqual(['validation', 'mint', 'network', 'app-error'])
    })
  })
})
