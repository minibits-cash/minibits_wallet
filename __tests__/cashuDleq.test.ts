import {
  Amount,
  blindMessage,
  constructUnblindedSignature,
  createBlindSignature,
  createDLEQProof,
  getPubKeyFromPrivKey,
  pointFromBytes,
} from '@cashu/cashu-ts'
import type {MintKeys, Proof} from '@cashu/cashu-ts'
import {bytesToHex, hexToBytes} from '@noble/curves/utils.js'

jest.mock('../src/services/logService', () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    trace: jest.fn(),
    warn: jest.fn(),
  },
}))

jest.mock('../src/services/nostrService', () => ({
  NostrClient: {
    getFirstTagValue: jest.fn(),
  },
}))

import {CashuUtils} from '../src/services/cashu/cashuUtils'
import AppError from '../src/utils/AppError'

const invalidDleqMessage = 'Offline ecash verification failed. Do not accept this token.'

const hexToNumber = (hex: string): bigint => BigInt(`0x${hex}`)
const numberToHexPadded64 = (scalar: bigint): string => scalar.toString(16).padStart(64, '0')

const makeProofFixture = function (): {proof: Proof; mintKeys: MintKeys[]} {
  const privkey = hexToBytes('1'.padStart(64, '0'))
  const pubkey = pointFromBytes(getPubKeyFromPrivKey(privkey))
  const secret = new TextEncoder().encode('fakeSecret')
  const r = hexToNumber('123456'.padStart(64, '0'))
  const blindedMessage = blindMessage(secret, r)
  const dleq = createDLEQProof(blindedMessage.B_, privkey)
  const blindSignature = createBlindSignature(blindedMessage.B_, privkey, '00')
  const unblinded = constructUnblindedSignature(blindSignature, r, secret, pubkey)

  const proof: Proof = {
    id: unblinded.id,
    amount: Amount.from(1),
    C: unblinded.C.toHex(true),
    secret: new TextDecoder().decode(unblinded.secret),
    dleq: {
      r: numberToHexPadded64(r),
      e: bytesToHex(dleq.e),
      s: bytesToHex(dleq.s),
    },
  }

  const mintKeys: MintKeys[] = [
    {
      id: unblinded.id,
      unit: 'sat',
      keys: {
        '1': pubkey.toHex(true),
      },
    },
  ]

  return {proof, mintKeys}
}

const expectValidationError = function (
  run: () => void,
  message: string,
) {
  expect(run).toThrow(AppError)

  try {
    run()
  } catch (e: any) {
    expect(e.message).toBe(message)
  }
}

describe('CashuUtils.verifyProofsDleqOrThrow', () => {
  it('accepts a proof with valid DLEQ', () => {
    const {proof, mintKeys} = makeProofFixture()

    expect(() => CashuUtils.verifyProofsDleqOrThrow([proof], mintKeys)).not.toThrow()
  })

  it('rejects a proof without DLEQ', () => {
    const {proof, mintKeys} = makeProofFixture()
    const proofWithoutDleq: Proof = {...proof}
    delete proofWithoutDleq.dleq

    expectValidationError(
      () => CashuUtils.verifyProofsDleqOrThrow([proofWithoutDleq], mintKeys),
      'This token does not include offline verification proof. Receive it online instead.',
    )
  })

  it('rejects a proof without the DLEQ blinding factor', () => {
    const {proof, mintKeys} = makeProofFixture()
    const proofWithoutR: Proof = {
      ...proof,
      dleq: {
        e: proof.dleq!.e,
        s: proof.dleq!.s,
      },
    }

    expectValidationError(
      () => CashuUtils.verifyProofsDleqOrThrow([proofWithoutR], mintKeys),
      'This token is missing the DLEQ blinding factor needed for offline verification.',
    )
  })

  it('rejects a proof when the keyset is not cached', () => {
    const {proof} = makeProofFixture()

    expectValidationError(
      () => CashuUtils.verifyProofsDleqOrThrow([proof], []),
      'This token cannot be verified offline because the mint keys are not saved. Sync the mint online first.',
    )
  })

  it('rejects a proof when the cached keyset does not have the amount key', () => {
    const {proof, mintKeys} = makeProofFixture()
    const keysWithoutAmount: MintKeys[] = [
      {
        ...mintKeys[0],
        keys: {
          '2': mintKeys[0].keys['1'],
        },
      },
    ]

    expectValidationError(
      () => CashuUtils.verifyProofsDleqOrThrow([proof], keysWithoutAmount),
      'This token cannot be verified offline because the mint keys are not saved. Sync the mint online first.',
    )
  })

  it('rejects a proof with tampered DLEQ e', () => {
    const {proof, mintKeys} = makeProofFixture()
    const tamperedProof: Proof = {
      ...proof,
      dleq: {
        ...proof.dleq!,
        e: '00'.repeat(32),
      },
    }

    expectValidationError(
      () => CashuUtils.verifyProofsDleqOrThrow([tamperedProof], mintKeys),
      invalidDleqMessage,
    )
  })

  it('rejects a proof with tampered DLEQ s', () => {
    const {proof, mintKeys} = makeProofFixture()
    const tamperedProof: Proof = {
      ...proof,
      dleq: {
        ...proof.dleq!,
        s: '00'.repeat(32),
      },
    }

    expectValidationError(
      () => CashuUtils.verifyProofsDleqOrThrow([tamperedProof], mintKeys),
      invalidDleqMessage,
    )
  })

  it('rejects a proof with tampered DLEQ r', () => {
    const {proof, mintKeys} = makeProofFixture()
    const tamperedProof: Proof = {
      ...proof,
      dleq: {
        ...proof.dleq!,
        r: '01'.repeat(32),
      },
    }

    expectValidationError(
      () => CashuUtils.verifyProofsDleqOrThrow([tamperedProof], mintKeys),
      invalidDleqMessage,
    )
  })

  it('rejects a proof with tampered signature C', () => {
    const {proof, mintKeys} = makeProofFixture()
    const tamperedC = `${proof.C.startsWith('02') ? '03' : '02'}${proof.C.slice(2)}`
    const tamperedProof: Proof = {
      ...proof,
      C: tamperedC,
    }

    expect(tamperedProof.C).not.toBe(proof.C)
    expectValidationError(
      () => CashuUtils.verifyProofsDleqOrThrow([tamperedProof], mintKeys),
      invalidDleqMessage,
    )
  })

  it('rejects a proof with tampered secret', () => {
    const {proof, mintKeys} = makeProofFixture()
    const tamperedProof: Proof = {
      ...proof,
      secret: `${proof.secret}-tampered`,
    }

    expectValidationError(
      () => CashuUtils.verifyProofsDleqOrThrow([tamperedProof], mintKeys),
      invalidDleqMessage,
    )
  })

  it('rejects a multi-proof token when one proof has invalid DLEQ', () => {
    const {proof, mintKeys} = makeProofFixture()
    const tamperedProof: Proof = {
      ...proof,
      secret: `${proof.secret}-tampered`,
    }

    expectValidationError(
      () => CashuUtils.verifyProofsDleqOrThrow([proof, tamperedProof], mintKeys),
      invalidDleqMessage,
    )
  })
})
