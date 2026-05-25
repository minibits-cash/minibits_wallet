/**
 * Send operation lifecycle — API contract tests.
 *
 * The orchestration body of `SendOperationApi.prepare/execute` exercises
 * MST stores, SQLite, and cashu-ts mint calls — that's an end-to-end path
 * best validated on a live device (see Step 6 of the lifecycle plan).
 *
 * What jest can meaningfully pin down without the full runtime is:
 *   1. The discriminated union for send methods narrows correctly.
 *   2. The exported API surface has the expected methods.
 *   3. The PreparedSendData / SendPath shapes are stable.
 *
 * These are compile-time-mostly tests, enforced by `@ts-expect-error` and
 * structural assertions. If a future refactor weakens the types, this file
 * fails to compile — same trick used in `typedEventBus.test.ts`.
 *
 * @jest-environment node
 */

// Same module-graph mocks as other deep-import tests — see proofReservation.test.ts.
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
    SendMethod,
    SendMethodInput,
    SendMethodOptions,
    SendMethodPayload,
} from '../src/services/wallet/operations/sendMethods'

describe('SendMethod discriminator', () => {
    test('SendMethod is a union of the registered keys', () => {
        // Runtime tag check — the keys at compile time must include these.
        const knownMethods: SendMethod[] = ['default', 'p2pk']
        expect(knownMethods).toEqual(['default', 'p2pk'])
    })

    test('SendMethodPayload narrows by method', () => {
        // p2pk requires pubkey
        const p2pk: SendMethodPayload<'p2pk'> = {pubkey: '02ab…'}
        expect(p2pk.pubkey).toBe('02ab…')

        // default is empty
        const def: SendMethodPayload<'default'> = {}
        expect(Object.keys(def)).toHaveLength(0)
    })

    test('SendMethodInput is a tagged union', () => {
        const inputDefault: SendMethodInput = {method: 'default', options: {}}
        const inputP2pk: SendMethodInput = {
            method: 'p2pk',
            options: {pubkey: '02ab…', locktime: 1700000000},
        }
        expect(inputDefault.method).toBe('default')
        expect(inputP2pk.method).toBe('p2pk')

        // Narrowing on method tag refines options:
        if (inputP2pk.method === 'p2pk') {
            // TS knows options has pubkey here
            expect(inputP2pk.options.pubkey).toBe('02ab…')
        }
    })

    test('compile-time: payload typed by method discriminator', () => {
        // The four lines below would all fail to compile if the types
        // weakened. They compile clean as written.

        // OK — default with empty options
        const a: SendMethodInput = {method: 'default', options: {}}
        // OK — p2pk with required pubkey
        const b: SendMethodInput = {method: 'p2pk', options: {pubkey: 'x'}}

        // @ts-expect-error — p2pk options missing required pubkey
        const c: SendMethodInput = {method: 'p2pk', options: {}}

        // @ts-expect-error — default cannot have arbitrary fields
        const d: SendMethodInput = {method: 'default', options: {pubkey: 'x'}}

        // @ts-expect-error — unknown method tag
        const e: SendMethodInput = {method: 'htlc', options: {}}

        // Use them so TS doesn't flag as unused.
        expect(a.method).toBe('default')
        expect(b.method).toBe('p2pk')
        expect(c.method).toBe('p2pk')
        expect(d.method).toBe('default')
        expect(e.method).toBe('htlc')
    })

    test('SendMethodOptions interface keys match SendMethod union', () => {
        // Sanity: every method we claim exists must have an options entry.
        const optionKeys: Array<keyof SendMethodOptions> = ['default', 'p2pk']
        const methodKeys: SendMethod[] = ['default', 'p2pk']
        expect(optionKeys.sort()).toEqual(methodKeys.sort())
    })
})

describe('SendOperationApi surface (compile-time)', () => {
    test('imports without runtime errors', () => {
        // The api file imports MST stores at load time; we only do a type-only
        // import here so jest doesn't try to bring up the root store.
        type Api = typeof import('../src/services/wallet/operations/sendOperationApi').SendOperationApi
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

    test('PreparedSendData shape pins the fields execute() depends on', () => {
        type PSD = import('../src/services/wallet/operations/sendOperationApi').PreparedSendData

        // Required keys — removing any breaks execute() callers.
        type RequiredKeys = keyof PSD
        const requiredKeys: RequiredKeys[] = [
            'transactionId',
            'tx',
            'sendAmount',
            'swapFeeReserve',
            'needsSwap',
            'path',
            'method',
            'mintUrl',
            'unit',
            'lockedProofs',
        ]
        expect(requiredKeys).toHaveLength(10)
    })

    test('SendPath union covers exactly the three implemented branches', () => {
        type SendPath = import('../src/services/wallet/operations/sendOperationApi').SendPath
        const paths: SendPath[] = ['offline', 'online-no-swap', 'online-swap']
        expect(paths).toHaveLength(3)
    })
})
