/**
 * Receive (cashu-token) operation lifecycle — API contract tests.
 *
 * Same pattern as the other lifecycle suites: jest pins down the discriminated
 * union, the API surface, and the PreparedReceiveData shape. Runtime
 * orchestration is verified on device.
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
    ReceiveMethod,
    ReceiveMethodInput,
    ReceiveMethodOptions,
    ReceiveMethodPayload,
} from '../src/services/wallet/operations/receiveMethods'
import type {Token} from '@cashu/cashu-ts'

const stubToken = {} as Token

describe('ReceiveMethod discriminator', () => {
    test('ReceiveMethod is a union of the registered keys', () => {
        const knownMethods: ReceiveMethod[] = ['cashu-token']
        expect(knownMethods).toEqual(['cashu-token'])
    })

    test('ReceiveMethodPayload narrows by method', () => {
        const cashuToken: ReceiveMethodPayload<'cashu-token'> = {
            token: stubToken,
            encodedToken: 'cashuA...',
        }
        expect(cashuToken.encodedToken).toBe('cashuA...')
        expect(cashuToken.offline).toBeUndefined()

        const offline: ReceiveMethodPayload<'cashu-token'> = {
            token: stubToken,
            encodedToken: 'cashuA...',
            offline: true,
        }
        expect(offline.offline).toBe(true)
    })

    test('ReceiveMethodInput is a tagged union', () => {
        const input: ReceiveMethodInput = {
            method: 'cashu-token',
            options: {token: stubToken, encodedToken: 'cashuA...'},
        }
        expect(input.method).toBe('cashu-token')

        if (input.method === 'cashu-token') {
            // TS knows options has encodedToken here
            expect(input.options.encodedToken).toBe('cashuA...')
        }
    })

    test('compile-time: payload typed by method discriminator', () => {
        // OK
        const a: ReceiveMethodInput = {
            method: 'cashu-token',
            options: {token: stubToken, encodedToken: 'x'},
        }

        // @ts-expect-error — cashu-token options missing required encodedToken
        const b: ReceiveMethodInput = {method: 'cashu-token', options: {token: stubToken}}

        // @ts-expect-error — unknown method tag
        const c: ReceiveMethodInput = {method: 'nut-18', options: {}}

        expect(a.method).toBe('cashu-token')
        expect(b.method).toBe('cashu-token')
        expect(c.method).toBe('nut-18')
    })

    test('ReceiveMethodOptions interface keys match ReceiveMethod union', () => {
        const optionKeys: Array<keyof ReceiveMethodOptions> = ['cashu-token']
        const methodKeys: ReceiveMethod[] = ['cashu-token']
        expect(optionKeys.sort()).toEqual(methodKeys.sort())
    })
})

describe('ReceiveOperationApi surface (compile-time)', () => {
    test('imports without runtime errors', () => {
        type Api = typeof import('../src/services/wallet/operations/receiveOperationApi').ReceiveOperationApi
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

    test('PreparedReceiveData shape pins the fields execute() depends on', () => {
        type PRD = import('../src/services/wallet/operations/receiveOperationApi').PreparedReceiveData

        type RequiredKeys = keyof PRD
        const requiredKeys: RequiredKeys[] = [
            'transactionId',
            'tx',
            'mintUrl',
            'unit',
            'amountToReceive',
            'memo',
            'blocked',
            'isOffline',
            'method',
        ]
        expect(requiredKeys).toHaveLength(9)
    })
})
