/**
 * Typed event bus tests (Phase 7).
 *
 * Verifies:
 *  - Runtime: on/emit/off still work for arbitrary string event names (backward compat)
 *  - Runtime: typed events deliver the correct payload to subscribers
 *  - Runtime: off() removes the right handler
 *  - Runtime: duplicate handler subscriptions are deduplicated
 *  - Compile-time (in TS type-check, not runtime): handler payload is narrowed
 */

jest.mock('../src/services', () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    trace: jest.fn(),
    warn: jest.fn(),
  },
}))

// Transaction.ts -> logService -> @sentry/react-native (ESM, not transformed).
// Mock logService directly so transitive imports don't drag Sentry in.
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

// Import for declaration-merging side effects so CoreEvents includes
// the wallet event map below.
import '../src/services/wallet/events'
import EventEmitter from '../src/utils/eventEmitter'
import {TransactionStatus} from '../src/models/Transaction'

describe('Typed event bus', () => {
  describe('backward-compat: arbitrary string events', () => {
    test('emit and listener round-trip with string name', () => {
      const calls: any[] = []
      const handler = (payload: any) => calls.push(payload)

      EventEmitter.on('ev_test_arbitrary_string', handler)
      EventEmitter.emit('ev_test_arbitrary_string', {anything: 'goes'})

      expect(calls).toEqual([{anything: 'goes'}])
      EventEmitter.off('ev_test_arbitrary_string', handler)
    })

    test('off removes handler', () => {
      const calls: any[] = []
      const handler = (payload: any) => calls.push(payload)

      EventEmitter.on('ev_off_test', handler)
      EventEmitter.emit('ev_off_test', 1)
      EventEmitter.off('ev_off_test', handler)
      EventEmitter.emit('ev_off_test', 2)

      expect(calls).toEqual([1])
    })

    test('duplicate subscriptions are deduplicated', () => {
      const calls: any[] = []
      const handler = (payload: any) => calls.push(payload)

      EventEmitter.on('ev_dedup_test', handler)
      EventEmitter.on('ev_dedup_test', handler)
      EventEmitter.on('ev_dedup_test', handler)
      EventEmitter.emit('ev_dedup_test', 'x')

      expect(calls).toEqual(['x'])
      EventEmitter.off('ev_dedup_test', handler)
    })
  })

  describe('typed event names', () => {
    test('typed emit + listener round-trip (ev_asyncMeltResult)', () => {
      type Payload = {transactionId: number; status: TransactionStatus; message: string}
      const received: Payload[] = []

      const handler = (payload: Payload) => {
        received.push(payload)
      }

      // Typed call site: TypeScript narrows the payload type from CoreEvents
      EventEmitter.on('ev_asyncMeltResult', handler)
      EventEmitter.emit('ev_asyncMeltResult', {
        transactionId: 42,
        status: TransactionStatus.COMPLETED,
        message: 'paid',
      })

      expect(received).toEqual([
        {transactionId: 42, status: TransactionStatus.COMPLETED, message: 'paid'},
      ])
      EventEmitter.off('ev_asyncMeltResult', handler)
    })

    test('typed emit for an SyncQueue completion event (ev_sendTask_result)', () => {
      const received: any[] = []
      const handler = (payload: any) => received.push(payload)

      EventEmitter.on('ev_sendTask_result', handler)
      EventEmitter.emit('ev_sendTask_result', {
        taskFunction: 'sendTask',
        mintUrl: 'http://mint',
        message: 'ok',
      })

      expect(received).toHaveLength(1)
      expect(received[0].taskFunction).toBe('sendTask')
      EventEmitter.off('ev_sendTask_result', handler)
    })

    test('emitting an event with no listeners is a no-op', () => {
      expect(() => {
        EventEmitter.emit('ev_handleClaimTask_result', {
          taskFunction: 'handleClaimTask',
          mintUrl: '',
          message: 'no listeners',
        })
      }).not.toThrow()
    })
  })

  describe('compile-time type safety (verified via @ts-expect-error)', () => {
    test('emit rejects payload that does not match the registered event shape', () => {
      // The runtime accepts anything, but tsc must reject these calls.
      // If tsc ever stops catching them, the @ts-expect-error pragmas turn red
      // and this whole file fails to compile.

      // @ts-expect-error — missing required fields on ev_asyncMeltResult payload
      EventEmitter.emit('ev_asyncMeltResult', {foo: 'bar'})

      // @ts-expect-error — transactionId must be number, not string
      EventEmitter.emit('ev_asyncMeltResult', {
        transactionId: 'oops',
        status: 'COMPLETED',
        message: 'x',
      })

      expect(true).toBe(true)
    })

    test('on rejects handler whose param type does not match the event payload', () => {
      // @ts-expect-error — handler expects number, but payload is an object
      EventEmitter.on('ev_asyncMeltResult', (n: number) => void n)

      // @ts-expect-error — handler expects TransactionTaskResult shape; using mismatched shape
      EventEmitter.on('ev_sendTask_result', (x: {totallyWrong: boolean}) => void x)

      expect(true).toBe(true)
    })
  })

  describe('isolation between distinct event names', () => {
    test('handlers registered to one event do not receive others', () => {
      const a: any[] = []
      const b: any[] = []

      const handlerA = (p: any) => a.push(p)
      const handlerB = (p: any) => b.push(p)

      EventEmitter.on('ev_isolated_a', handlerA)
      EventEmitter.on('ev_isolated_b', handlerB)

      EventEmitter.emit('ev_isolated_a', 'A')
      EventEmitter.emit('ev_isolated_b', 'B')

      expect(a).toEqual(['A'])
      expect(b).toEqual(['B'])

      EventEmitter.off('ev_isolated_a', handlerA)
      EventEmitter.off('ev_isolated_b', handlerB)
    })

    test('multiple handlers on same event all receive the payload', () => {
      const a: any[] = []
      const b: any[] = []

      const h1 = (p: any) => a.push(p)
      const h2 = (p: any) => b.push(p)

      EventEmitter.on('ev_multi_handler', h1)
      EventEmitter.on('ev_multi_handler', h2)
      EventEmitter.emit('ev_multi_handler', 'shared')

      expect(a).toEqual(['shared'])
      expect(b).toEqual(['shared'])

      EventEmitter.off('ev_multi_handler', h1)
      EventEmitter.off('ev_multi_handler', h2)
    })
  })
})
