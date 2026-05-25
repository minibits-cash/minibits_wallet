/**
 * Cashu Payment Request (NUT-18) operation lifecycle — API contract tests.
 *
 * @jest-environment node
 */

jest.mock('../src/services/logService', () => ({
    log: {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        trace: jest.fn(),
        warn: jest.fn(),
    },
    LogLevel: {ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG', TRACE: 'TRACE'},
}))

import type {
    CashuPaymentRequestMethod,
    CashuPaymentRequestMethodInput,
    CashuPaymentRequestMethodOptions,
    CashuPaymentRequestMethodPayload,
} from '../src/services/wallet/operations/cashuPaymentRequestMethods'

describe('CashuPaymentRequestMethod discriminator', () => {
    test('CashuPaymentRequestMethod is a union of the registered keys', () => {
        const knownMethods: CashuPaymentRequestMethod[] = ['nostr']
        expect(knownMethods).toEqual(['nostr'])
    })

    test('CashuPaymentRequestMethodPayload narrows by method', () => {
        const nostr: CashuPaymentRequestMethodPayload<'nostr'> = {}
        expect(Object.keys(nostr)).toHaveLength(0)
    })

    test('CashuPaymentRequestMethodInput is a tagged union', () => {
        const inputNostr: CashuPaymentRequestMethodInput = {method: 'nostr', options: {}}
        expect(inputNostr.method).toBe('nostr')

        if (inputNostr.method === 'nostr') {
            // empty options
            expect(Object.keys(inputNostr.options)).toHaveLength(0)
        }
    })

    test('compile-time: unknown method tag rejected', () => {
        // OK
        const a: CashuPaymentRequestMethodInput = {method: 'nostr', options: {}}

        // @ts-expect-error — nostr cannot have arbitrary fields
        const b: CashuPaymentRequestMethodInput = {method: 'nostr', options: {target: 'x'}}

        // @ts-expect-error — unknown method tag
        const c: CashuPaymentRequestMethodInput = {method: 'http', options: {}}

        expect(a.method).toBe('nostr')
        expect(b.method).toBe('nostr')
        expect(c.method).toBe('http')
    })

    test('CashuPaymentRequestMethodOptions interface keys match union', () => {
        const optionKeys: Array<keyof CashuPaymentRequestMethodOptions> = ['nostr']
        const methodKeys: CashuPaymentRequestMethod[] = ['nostr']
        expect(optionKeys.sort()).toEqual(methodKeys.sort())
    })
})

describe('CashuPaymentRequestApi surface (compile-time)', () => {
    test('imports without runtime errors', () => {
        type Api = typeof import('../src/services/wallet/operations/cashuPaymentRequestApi').CashuPaymentRequestApi
        type Methods = keyof Api

        const expected: Methods[] = [
            'prepare',
            'execute',
            'cancel',
            'reclaim',
            'finalize',
            'refresh',
        ]
        expect(expected).toHaveLength(6)
    })

    test('PreparedCashuPaymentRequestData shape pins the fields execute() depends on', () => {
        type PRD = import('../src/services/wallet/operations/cashuPaymentRequestApi').PreparedCashuPaymentRequestData

        type RequiredKeys = keyof PRD
        const requiredKeys: RequiredKeys[] = [
            'transactionId',
            'tx',
            'mintUrl',
            'unit',
            'amount',
            'memo',
            'method',
        ]
        expect(requiredKeys).toHaveLength(7)
    })

    test('ExecutedCashuPaymentRequestData shape pins the fields the wrapper depends on', () => {
        type ERD = import('../src/services/wallet/operations/cashuPaymentRequestApi').ExecutedCashuPaymentRequestData

        type RequiredKeys = keyof ERD
        const requiredKeys: RequiredKeys[] = [
            'transaction',
            'cashuPaymentRequest',
            'encodedCashuPaymentRequest',
        ]
        expect(requiredKeys).toHaveLength(3)
    })
})
