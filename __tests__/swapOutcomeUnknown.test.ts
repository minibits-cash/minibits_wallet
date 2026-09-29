/**
 * When a failed swap must be handed to the resolver instead of rolled back.
 *
 * Rolling back returns the inputs to UNSPENT; if the mint in fact executed the swap
 * they are spent and its outputs exist only at the mint (the 2026-09-24 incident).
 * Only a failure that provably never reached the mint, or that the mint definitively
 * rejected, may roll back.
 *
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))
jest.mock('../src/services/nostrService', () => ({NostrClient: {getFirstTagValue: jest.fn()}}))

import AppError, {Err} from '../src/utils/AppError'
import {WalletUtils, CashuErrorCode} from '../src/services/wallet/utils'

const mintRejection = new AppError(Err.MINT_ERROR, 'Swap to prepare ecash to send has failed.', {
  code: CashuErrorCode.TOKEN_ALREADY_SPENT,
  message: 'Token already spent',
})
const networkFailure = new AppError(Err.MINT_ERROR, 'Swap to prepare ecash to send has failed.', {
  message: 'Request timed out after 60000ms',
})

test('request never sent: safe to roll back, whatever the error', () => {
  expect(WalletUtils.isSwapOutcomeUnknown(networkFailure, false)).toBe(false)
  expect(WalletUtils.isSwapOutcomeUnknown(new Error('Not enough funds available for swap'), false)).toBe(false)
})

test('sent, and the mint rejected it with a protocol code: definitive, roll back', () => {
  expect(WalletUtils.isSwapOutcomeUnknown(mintRejection, true)).toBe(false)
})

test('sent, then a timeout / dropped connection: outcome unknown', () => {
  expect(WalletUtils.isSwapOutcomeUnknown(networkFailure, true)).toBe(true)
})

test('sent, then a local failure while handling the response: outcome unknown', () => {
  // e.g. commitReservation throwing after the mint already executed the swap
  expect(WalletUtils.isSwapOutcomeUnknown(new TypeError('Cannot read properties of undefined'), true)).toBe(true)
})
