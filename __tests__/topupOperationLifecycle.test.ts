/**
 * Topup (lightning mint) operation lifecycle — API contract tests.
 *
 * Same trick as the SEND and TRANSFER lifecycle tests: jest pins down what it
 * can verify without bringing up MST stores / cashu-ts / SQLite:
 *
 *   1. The discriminated union for topup methods narrows correctly.
 *   2. The exported API surface has the expected methods.
 *   3. The PreparedTopupData shape is stable.
 *
 * Compile-time regressions break the build; runtime orchestration is verified
 * on device.
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
    TopupMethod,
    TopupMethodInput,
    TopupMethodOptions,
    TopupMethodPayload,
} from '../src/services/wallet/operations/topupMethods'

describe('TopupMethod discriminator', () => {
    test('TopupMethod is a union of the registered keys', () => {
        const knownMethods: TopupMethod[] = ['bolt11']
        expect(knownMethods).toEqual(['bolt11'])
    })

    test('TopupMethodPayload narrows by method', () => {
        // bolt11 options are all optional (contactToSendTo only)
        const bolt11Empty: TopupMethodPayload<'bolt11'> = {}
        expect(Object.keys(bolt11Empty)).toHaveLength(0)

        const bolt11WithContact: TopupMethodPayload<'bolt11'> = {
            contactToSendTo: undefined,
        }
        expect(bolt11WithContact.contactToSendTo).toBeUndefined()
    })

    test('TopupMethodInput is a tagged union', () => {
        const inputBolt11: TopupMethodInput = {method: 'bolt11', options: {}}
        expect(inputBolt11.method).toBe('bolt11')

        // Narrowing on method tag refines options:
        if (inputBolt11.method === 'bolt11') {
            // TS knows options has contactToSendTo (optional) here
            expect(inputBolt11.options.contactToSendTo).toBeUndefined()
        }
    })

    test('compile-time: unknown method tag rejected', () => {
        // OK — bolt11 with empty options
        const a: TopupMethodInput = {method: 'bolt11', options: {}}

        // @ts-expect-error — unknown method tag
        const b: TopupMethodInput = {method: 'onchain', options: {}}

        // Use them so TS doesn't flag as unused.
        expect(a.method).toBe('bolt11')
        expect(b.method).toBe('onchain')
    })

    test('TopupMethodOptions interface keys match TopupMethod union', () => {
        const optionKeys: Array<keyof TopupMethodOptions> = ['bolt11']
        const methodKeys: TopupMethod[] = ['bolt11']
        expect(optionKeys.sort()).toEqual(methodKeys.sort())
    })
})

describe('TopupOperationApi surface (compile-time)', () => {
    test('imports without runtime errors', () => {
        // Type-only import — avoids bringing up the root store in jest.
        type Api = typeof import('../src/services/wallet/operations/topupOperationApi').TopupOperationApi
        type Methods = keyof Api

        // If any method is removed or renamed, this Methods union shrinks and
        // the assertion below fails to typecheck.
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

    test('PreparedTopupData shape pins the fields execute() depends on', () => {
        type PTD = import('../src/services/wallet/operations/topupOperationApi').PreparedTopupData

        type RequiredKeys = keyof PTD
        const requiredKeys: RequiredKeys[] = [
            'transactionId',
            'tx',
            'mintUrl',
            'unit',
            'amountToTopup',
            'quote',
            'encodedInvoice',
            'expiresAt',
            'method',
            'nwcEvent',
        ]
        expect(requiredKeys).toHaveLength(10)
    })
})
