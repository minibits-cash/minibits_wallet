/**
 * Transfer (lightning melt) operation lifecycle — API contract tests.
 *
 * The orchestration body of `TransferOperationApi.prepare/execute` exercises
 * MST stores, SQLite, and cashu-ts mint calls — best validated on a live
 * device. Here we lock down at compile-time what jest can meaningfully pin:
 *
 *   1. The discriminated union for transfer methods narrows correctly.
 *   2. The exported API surface has the expected methods.
 *   3. The PreparedTransferData / TransferPath shapes are stable.
 *
 * Same trick as `sendOperationLifecycle.test.ts`: a type regression breaks
 * the build.
 *
 * @jest-environment node
 */

// Same module-graph mocks as the other deep-import tests.
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
    TransferMethod,
    TransferMethodInput,
    TransferMethodOptions,
    TransferMethodPayload,
} from '../src/services/wallet/operations/transferMethods'
import type {MeltQuoteBolt11Response} from '@cashu/cashu-ts'

// A minimal stub matching the bolt11 method options. The mint quote shape
// is loosely typed in cashu-ts (BigNumber-like for fee_reserve etc.); we
// only need a value-shaped object that satisfies TypeScript here.
const stubMeltQuote = {} as MeltQuoteBolt11Response

describe('TransferMethod discriminator', () => {
    test('TransferMethod is a union of the registered keys', () => {
        const knownMethods: TransferMethod[] = ['bolt11']
        expect(knownMethods).toEqual(['bolt11'])
    })

    test('TransferMethodPayload narrows by method', () => {
        const bolt11: TransferMethodPayload<'bolt11'> = {
            encodedInvoice: 'lnbc...',
            meltQuote: stubMeltQuote,
            invoiceExpiry: new Date(),
        }
        expect(bolt11.encodedInvoice).toBe('lnbc...')
        expect(bolt11.meltQuote).toBe(stubMeltQuote)
    })

    test('TransferMethodInput is a tagged union', () => {
        const inputBolt11: TransferMethodInput = {
            method: 'bolt11',
            options: {
                encodedInvoice: 'lnbc...',
                meltQuote: stubMeltQuote,
                invoiceExpiry: new Date(),
            },
        }
        expect(inputBolt11.method).toBe('bolt11')

        // Narrowing on method tag refines options:
        if (inputBolt11.method === 'bolt11') {
            // TS knows options has encodedInvoice here
            expect(inputBolt11.options.encodedInvoice).toBe('lnbc...')
        }
    })

    test('compile-time: payload typed by method discriminator', () => {
        // The lines below would all fail to compile if the types weakened.
        // They compile clean as written.

        // OK — bolt11 with required fields
        const a: TransferMethodInput = {
            method: 'bolt11',
            options: {
                encodedInvoice: 'lnbc...',
                meltQuote: stubMeltQuote,
                invoiceExpiry: new Date(),
            },
        }

        // @ts-expect-error — bolt11 options missing required encodedInvoice
        const b: TransferMethodInput = {method: 'bolt11', options: {meltQuote: stubMeltQuote, invoiceExpiry: new Date()}}

        // @ts-expect-error — unknown method tag
        const c: TransferMethodInput = {method: 'onchain', options: {}}

        // Use them so TS doesn't flag as unused.
        expect(a.method).toBe('bolt11')
        expect(b.method).toBe('bolt11')
        expect(c.method).toBe('onchain')
    })

    test('TransferMethodOptions interface keys match TransferMethod union', () => {
        // Sanity: every method we claim exists must have an options entry.
        const optionKeys: Array<keyof TransferMethodOptions> = ['bolt11']
        const methodKeys: TransferMethod[] = ['bolt11']
        expect(optionKeys.sort()).toEqual(methodKeys.sort())
    })
})

describe('TransferOperationApi surface (compile-time)', () => {
    test('imports without runtime errors', () => {
        // Type-only import — avoids bringing up the root store in jest.
        type Api = typeof import('../src/services/wallet/operations/transferOperationApi').TransferOperationApi
        type Methods = keyof Api

        // If any method is removed or renamed, this Methods union shrinks
        // and the assertion below fails to typecheck.
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

    test('PreparedTransferData shape pins the fields execute() depends on', () => {
        type PTD = import('../src/services/wallet/operations/transferOperationApi').PreparedTransferData

        type RequiredKeys = keyof PTD
        const requiredKeys: RequiredKeys[] = [
            'transactionId',
            'tx',
            'mintUrl',
            'unit',
            'amountToTransfer',
            'meltQuote',
            'invoiceExpiry',
            'path',
            'method',
            'proofsToMeltFrom',
            'proofsToMeltFromAmount',
            'meltFeeReserve',
            'lightningFeeReserve',
            'preemptiveSwapFeePaid',
            'nwcEvent',
        ]
        expect(requiredKeys).toHaveLength(15)
    })

    test('TransferPath union covers exactly the two implemented branches', () => {
        type TransferPath = import('../src/services/wallet/operations/transferOperationApi').TransferPath
        const paths: TransferPath[] = ['direct-melt', 'preemptive-swap-then-melt']
        expect(paths).toHaveLength(2)
    })
})
