/**
 * Type guard / state classification tests for TransactionStates.ts.
 *
 * Type guards are runtime functions that also narrow TypeScript's view.
 * These tests verify the runtime side (correct boolean per status) and
 * exhaustiveness of the categorical sets (terminal / in-flight / rollbackable).
 *
 * @jest-environment node
 */

// Transaction.ts -> services -> logService -> @sentry/react-native (ESM, not transformed).
// Mock the deep import chain so the test stays pure type/enum-only.
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
jest.mock('../src/services', () => ({
    log: {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        trace: jest.fn(),
        warn: jest.fn(),
    },
    Database: {},
}))

import {TransactionStatus} from '../src/models/Transaction'
import type {Transaction} from '../src/models/Transaction'
import {
    isBlocked,
    isCompleted,
    isDraft,
    isErrored,
    isExecuting,
    isExpired,
    isInFlight,
    isPending,
    isPrepared,
    isRecovered,
    isReverted,
    isRollbackable,
    isRollingBack,
    isTerminal,
} from '../src/models/TransactionStates'

/** Tiny helper — construct just enough of a Transaction shape for guard tests. */
function txWith(status: TransactionStatus): Transaction {
    return {status} as unknown as Transaction
}

// All known statuses — keep in sync with the enum so we catch additions.
const ALL_STATUSES: TransactionStatus[] = [
    TransactionStatus.DRAFT,
    TransactionStatus.PREPARED,
    TransactionStatus.PREPARED_OFFLINE,
    TransactionStatus.EXECUTING,
    TransactionStatus.PENDING,
    TransactionStatus.ROLLING_BACK,
    TransactionStatus.REVERTED,
    TransactionStatus.RECOVERED,
    TransactionStatus.COMPLETED,
    TransactionStatus.ERROR,
    TransactionStatus.BLOCKED,
    TransactionStatus.EXPIRED,
]

describe('TransactionStatus enum', () => {
    test('contains the two new lifecycle states', () => {
        expect(TransactionStatus.EXECUTING).toBe('EXECUTING')
        expect(TransactionStatus.ROLLING_BACK).toBe('ROLLING_BACK')
    })

    test('test fixture covers every status the enum exposes', () => {
        const enumValues = new Set(Object.values(TransactionStatus))
        for (const s of ALL_STATUSES) expect(enumValues.has(s)).toBe(true)
        expect(ALL_STATUSES.length).toBe(enumValues.size)
    })
})

describe('Per-state type guards', () => {
    test.each([
        ['isDraft', isDraft, TransactionStatus.DRAFT],
        ['isExecuting', isExecuting, TransactionStatus.EXECUTING],
        ['isPending', isPending, TransactionStatus.PENDING],
        ['isRollingBack', isRollingBack, TransactionStatus.ROLLING_BACK],
        ['isReverted', isReverted, TransactionStatus.REVERTED],
        ['isCompleted', isCompleted, TransactionStatus.COMPLETED],
        ['isErrored', isErrored, TransactionStatus.ERROR],
        ['isExpired', isExpired, TransactionStatus.EXPIRED],
        ['isBlocked', isBlocked, TransactionStatus.BLOCKED],
        ['isRecovered', isRecovered, TransactionStatus.RECOVERED],
    ])('%s returns true only for its own status', (_name, guard, ownStatus) => {
        for (const s of ALL_STATUSES) {
            const expected = s === ownStatus
            expect(guard(txWith(s))).toBe(expected)
        }
    })

    test('isPrepared returns true for both PREPARED and PREPARED_OFFLINE', () => {
        for (const s of ALL_STATUSES) {
            const expected =
                s === TransactionStatus.PREPARED || s === TransactionStatus.PREPARED_OFFLINE
            expect(isPrepared(txWith(s))).toBe(expected)
        }
    })
})

describe('Categorical guards', () => {
    test('isTerminal matches exactly the terminal-status set', () => {
        const terminal = new Set([
            TransactionStatus.COMPLETED,
            TransactionStatus.REVERTED,
            TransactionStatus.ERROR,
            TransactionStatus.EXPIRED,
            TransactionStatus.BLOCKED,
            TransactionStatus.RECOVERED,
        ])
        for (const s of ALL_STATUSES) {
            expect(isTerminal(txWith(s))).toBe(terminal.has(s))
        }
    })

    test('isInFlight matches exactly the in-flight-status set', () => {
        const inFlight = new Set([
            TransactionStatus.DRAFT,
            TransactionStatus.PREPARED,
            TransactionStatus.PREPARED_OFFLINE,
            TransactionStatus.EXECUTING,
            TransactionStatus.PENDING,
            TransactionStatus.ROLLING_BACK,
        ])
        for (const s of ALL_STATUSES) {
            expect(isInFlight(txWith(s))).toBe(inFlight.has(s))
        }
    })

    test('isRollbackable matches PREPARED variants and PENDING', () => {
        const rollbackable = new Set([
            TransactionStatus.PREPARED,
            TransactionStatus.PREPARED_OFFLINE,
            TransactionStatus.PENDING,
        ])
        for (const s of ALL_STATUSES) {
            expect(isRollbackable(txWith(s))).toBe(rollbackable.has(s))
        }
    })

    test('terminal and in-flight are mutually exclusive and exhaustive', () => {
        for (const s of ALL_STATUSES) {
            const tx = txWith(s)
            const terminal = isTerminal(tx)
            const inFlight = isInFlight(tx)
            // exactly one of the two must hold for every defined status
            expect(terminal !== inFlight).toBe(true)
        }
    })

    test('every rollbackable transaction is also in-flight', () => {
        for (const s of ALL_STATUSES) {
            const tx = txWith(s)
            if (isRollbackable(tx)) expect(isInFlight(tx)).toBe(true)
        }
    })
})
