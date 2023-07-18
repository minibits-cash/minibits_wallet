import {
  CashuMint,
  CashuWallet,
  deriveKeysetId,
  PayLnInvoiceResponse,
  type Proof as CashuProof,
} from '@cashu/cashu-ts'
import {validateMintKeys} from './cashuHelpers'
import AppError, {Err} from '../utils/AppError'
import {log} from '../utils/logger'
import {getProofsAmount} from '../services/cashuHelpers'
import {Token} from '../models/Token'
import {Proof} from '../models/Proof'

export type MintKeys = {[k: number]: string}
export type MintKeySets = {keysets: Array<string>}

let _mints: {[mintUrl: string]: CashuMint} = {}
let _wallets: {[mintUrl: string]: CashuWallet} = {}

const getMint = function (mintUrl: string) {
  if (_mints[mintUrl]) {
    return _mints[mintUrl]
  }

  const mint = new CashuMint(mintUrl)
  _mints[mintUrl] = mint

  return mint
}

const getWallet = function (mintUrl: string) {
  if (_wallets[mintUrl]) {
    return _wallets[mintUrl]
  }

  const mint = getMint(mintUrl)
  const wallet = new CashuWallet(mint)
  _wallets[mintUrl] = wallet

  return wallet
}

const getMintKeys = async function (mintUrl: string) {
  const mint = getMint(mintUrl)
  let keys: MintKeys
  let keyset: string
  
  try {
    // keysets = await mint.getKeySets()
    keys = await mint.getKeys()
  } catch (e: any) {
    throw new AppError(
      Err.CONNECTION_ERROR,
      `Could not connect to the selected mint.}`,
      [e.message, mintUrl],
    )
  }

  if (!validateMintKeys(keys)) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      'Invalid keys retrieved from the selected mint.',
      [mintUrl, keys],
    )
  }

  keyset = deriveKeysetId(keys)

  const newMintKeys: {keys: MintKeys; keyset: string} = {
    keys,
    keyset,
  }

  return newMintKeys
}


const receiveFromMint = async function (mintUrl: string, encodedToken: string) {
  try {
    const cashuWallet = getWallet(mintUrl)

    // this method returns quite a mess, we normalize naming of returned parameters
    const {token, tokensWithErrors, newKeys} = await cashuWallet.receive(
      encodedToken,
    )

    log.trace('[receiveFromMint] updatedToken', token)
    log.trace('[receiveFromMint] tokensWithErrors', tokensWithErrors)
    log.trace('[receiveFromMint] newKeys', newKeys)

    // if (newKeys) { _setKeys(mintUrl, newKeys) }

    return {
      updatedToken: token as Token,
      errorToken: tokensWithErrors as Token,
      newKeys,
    }
  } catch (e: any) {
    throw new AppError(Err.MINT_ERROR, e.message)
  }
}

const sendFromMint = async function (
  mintUrl: string,
  amountToSend: number,
  proofsToSendFrom: Proof[],
) {
  try {
    const cashuWallet = getWallet(mintUrl)

    const {returnChange, send, newKeys} = await cashuWallet.send(
      amountToSend,
      proofsToSendFrom,
    )

    log.trace('[MintClient.sendFromMint] returnedProofs', returnChange)
    log.trace('[MintClient.sendFromMint] sentProofs', send)
    log.trace('[MintClient.sendFromMint] newKeys', newKeys)

    // do some basic validations that proof amounts from mints match
    const totalAmountToSendFrom = getProofsAmount(proofsToSendFrom)
    const returnedAmount = getProofsAmount(returnChange as Proof[])
    const proofsAmount = getProofsAmount(send as Proof[])

    if (proofsAmount !== amountToSend) {
      throw new AppError(
        Err.VALIDATION_ERROR,
        `Amount to be sent does not equal requested original amount. Original is ${amountToSend}, mint returned ${proofsAmount}`,
      )
    }

    if (totalAmountToSendFrom !== returnedAmount + proofsAmount) {
      throw new AppError(
        Err.VALIDATION_ERROR,
        `Amount returned byt he mint as a change ${returnedAmount} is incorrect, it should be ${
          totalAmountToSendFrom - proofsAmount
        }`,
      )
    }

    // we normalize naming of returned parameters
    return {
      returnedProofs: returnChange as Proof[],
      proofsToSend: send as Proof[],
      newKeys,
    }
  } catch (e: any) {
    throw new AppError(Err.MINT_ERROR, e.message)
  }
}

const getSpentProofsFromMint = async function (
  mintUrl: string,
  proofs: Proof[],
) {
  try {
    const cashuWallet = getWallet(mintUrl)

    const spentPendingProofs = await cashuWallet.checkProofsSpent(proofs)
    return spentPendingProofs
  } catch (e: any) {
    throw new AppError(Err.MINT_ERROR, e.message)
  }
}

const getLightningFee = async function (
  mintUrl: string,
  encodedInvoice: string,
) {
  try {
    const cashuMint = getMint(mintUrl)
    const {fee} = await cashuMint.checkFees({pr: encodedInvoice})
    log.trace('Estimated fee', fee)
    return fee
  } catch (e: any) {
    throw new AppError(Err.MINT_ERROR, e.message)
  }
}

const payLightningInvoice = async function (
  mintUrl: string,
  encodedInvoice: string,
  proofsToPayFrom: CashuProof[],
  estimatedFee: number,
) {
  try {
    log.trace('[payLightningInvoice] start')
    const cashuWallet = getWallet(mintUrl)

    const {isPaid, change, preimage, newKeys}: PayLnInvoiceResponse =
      await cashuWallet.payLnInvoice(
        encodedInvoice,
        proofsToPayFrom,
        estimatedFee,
      )

    // if (newKeys) { _setKeys(mintUrl, newKeys) }
    log.trace('[payLightningInvoice] result', {
      isPaid,
      change,
      preimage,
      newKeys,
    })
    // we normalize naming of returned parameters
    return {
      feeSavedProofs: change,
      isPaid,
      preimage,
      newKeys
    }
  } catch (e: any) {
    throw new AppError(Err.MINT_ERROR, e.message)
  }
}

const requestLightningInvoice = async function (
  mintUrl: string,
  amount: number,
) {
  try {
    const cashuWallet = getWallet(mintUrl)
    const {pr, hash} = await cashuWallet.requestMint(amount)

    log.trace('Invoice', [pr, hash], 'requestLightningInvoice')

    return {
      encodedInvoice: pr,
      paymentHash: hash,
    }
  } catch (e: any) {
    throw new AppError(Err.MINT_ERROR, e.message)
  }
}

const requestProofs = async function (
  mintUrl: string,
  amount: number,
  paymentHash: string,
) {
  try {
    const cashuWallet = getWallet(mintUrl)
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {proofs, newKeys} = await cashuWallet.requestTokens(
      amount,
      paymentHash,
    )
    /* eslint-enable */

    // if (newKeys) { _setKeys(mintUrl, newKeys) }
    if(proofs) {
        log.trace('[requestProofs]', proofs)
    }

    return {
        proofs, 
        newKeys
    }
  } catch (e: any) {
    log.info(e.message,[],'cashuMintClient.requestProofs')
    return {proofs: []}
  }
}

export const MintClient = {
  getMintKeys,
  receiveFromMint,
  sendFromMint,
  getSpentProofsFromMint,
  getLightningFee,
  payLightningInvoice,
  requestLightningInvoice,
  requestProofs,
}
