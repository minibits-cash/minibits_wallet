/**
 * The cashu-ts contract that melt-change recovery depends on (`MeltChangeError`).
 *
 * cashu-ts 4.10 raises `MeltChangeError` from `completeMelt` in one specific
 * situation: the melt request SUCCEEDED — the mint executed the payment and the
 * inputs are spent — but the NUT-08 change could not be reconstructed from the
 * blank outputs. Its own docs are explicit: "The inputs are spent and the payment
 * stands." It carries `outputData` and the merged `quote` precisely so the change
 * can be rebuilt later.
 *
 * Why this file exists: `WalletStore.payLightningMelt` used to delete the melt
 * recovery record for any error whose message did not mention a timeout or a
 * network failure. `MeltChangeError`'s message mentions neither, so that heuristic
 * deleted the record — one step before
 * `TransferOperationApi._handleExecuteError` re-checks the quote, finds it PAID,
 * and calls `recoverMeltQuoteChange`, which reads exactly that record. The user
 * silently forfeited the change on a payment that had actually gone through.
 *
 * The wallet no longer message-sniffs, so what it now relies on is this error
 * TYPE existing and being distinguishable. These tests pin that dependency: if
 * cashu-ts v5 renames the class, drops the payload, or changes the message such
 * that the old heuristic would have "worked", this fails and says why.
 *
 * @jest-environment node
 */
import {CTSError, MeltChangeError} from '@cashu/cashu-ts'
import type {OutputDataLike} from '@cashu/cashu-ts'

/** Stand-ins with the right shape; nothing here needs real crypto. */
const outputData = [
  {blindedMessage: {amount: '2', id: '00aa', B_: '02ff'}},
] as unknown as OutputDataLike[]

const quote = {
  quote: 'quote-id-1',
  amount: '21',
  unit: 'sat',
  state: 'PAID',
} as never

describe('MeltChangeError is a distinguishable type', () => {
  test('cashu-ts still exports it', () => {
    expect(typeof MeltChangeError).toBe('function')
  })

  test('an instance is recognisable by instanceof — no message matching needed', () => {
    const error = new MeltChangeError(outputData, quote)

    expect(error).toBeInstanceOf(MeltChangeError)
    expect(error).toBeInstanceOf(Error)
  })

  test('it is a CTSError, so it travels the same path as other library errors', () => {
    expect(new MeltChangeError(outputData, quote)).toBeInstanceOf(CTSError)
  })
})

describe('it carries what change recovery needs', () => {
  test('outputData — the blank outputs the change proofs are rebuilt from', () => {
    const error = new MeltChangeError(outputData, quote)

    expect(Array.isArray(error.outputData)).toBe(true)
    expect(error.outputData).toHaveLength(1)
  })

  test('quote — merged from the preview and the mint response', () => {
    const error = new MeltChangeError(outputData, quote)

    expect(error.quote).toBeDefined()
    expect(error.quote.quote).toBe('quote-id-1')
  })

  test('an underlying cause is preserved for diagnosis', () => {
    const cause = new Error('undefined key for amount 2')
    const error = new MeltChangeError(outputData, quote, {cause})

    expect((error as unknown as {cause?: Error}).cause).toBe(cause)
  })
})

describe('why the old message heuristic was wrong', () => {
  // The exact predicate WalletStore.payLightningMelt used to decide whether the
  // melt might still have gone through, and therefore whether to KEEP the record.
  const oldHeuristicWouldKeepRecord = (e: Error) =>
    e.message.toLowerCase().includes('timeout') ||
    e.message.toLowerCase().includes('network request failed')

  test('a MeltChangeError does not look like a timeout or a network failure', () => {
    const error = new MeltChangeError(outputData, quote)

    // So the old code fell through to the delete branch — for an error that means
    // the payment SUCCEEDED. This assertion is the bug, pinned.
    expect(oldHeuristicWouldKeepRecord(error)).toBe(false)
  })

  test('yet it is exactly the case where the record must survive', () => {
    const error = new MeltChangeError(outputData, quote)

    // The payload is only useful to a reader that still has the record; the two
    // are the same recovery. Keeping one and dropping the other is incoherent.
    expect(error.outputData.length).toBeGreaterThan(0)
    expect(error.quote).toBeDefined()
  })
})
