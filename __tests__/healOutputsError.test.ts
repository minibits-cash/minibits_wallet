jest.mock('../src/services/logService', () => ({log: {error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn()}}))
jest.mock('../src/services/cashu/cashuUtils', () => ({CashuUtils: {isObj: (v: unknown) => typeof v === 'object'}}))

import {WalletUtils} from '../src/services/wallet/utils'
import AppError, {Err} from '../src/utils/AppError'

test('shouldHealOutputsError recognises masked cdk output collision', () => {
    const cdk = new AppError(Err.MINT_ERROR, 'Error on request to mint new ecash.', {message: 'Invoice already paid or pending'})
    expect(WalletUtils.shouldHealOutputsError(cdk)).toBe(true)
    // task results carry a plain formatError() copy
    expect(WalletUtils.shouldHealOutputsError(WalletUtils.formatError(cdk))).toBe(true)
    expect(WalletUtils.shouldHealOutputsError({message: 'x', params: {message: 'Melt quote already paid or pending.'}})).toBe(false)
    expect(WalletUtils.shouldHealOutputsError(undefined)).toBe(false)
})
