import {
  CashuMint,
  CashuWallet,
  deriveKeysetId,
  PayLnInvoiceResponse,
  type Proof as CashuProof,
} from '@cashu/cashu-ts'
import { RestoreClient, TorDaemon } from '../services'
import {CashuUtils} from './cashu/cashuUtils'
import AppError, {Err} from '../utils/AppError'
import {log} from './logService'
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

    if(mintUrl.includes('.onion')) {
        log.trace('Creating mint instance with .onion mintUrl', {mintUrl}, 'getMint')
        const mint = new CashuMint(mintUrl, TorDaemon.torRequest)
        _mints[mintUrl] = mint

        return mint
    }

    const mint = new CashuMint(mintUrl)
    _mints[mintUrl] = mint

    return mint
}

const getWallet = async function (
    mintUrl: string
) {

  if (_wallets[mintUrl]) {
    return _wallets[mintUrl]
  }

  const mint = getMint(mintUrl)
  const seed = await RestoreClient.getOrCreateSeed()

  const wallet = new CashuWallet(mint, undefined, seed)
  _wallets[mintUrl] = wallet

  return wallet
}


const getMintKeys = async function (mintUrl: string) {
  const mint = getMint(mintUrl)
  let keys: MintKeys
  let keyset: string
  
  try {
    // keysets = await mint.getKeySets()
    log.trace('Sending getKeys request', {mintUrl}, 'getMintKeys')
    keys = await mint.getKeys()
  } catch (e: any) {
    throw new AppError(
      Err.CONNECTION_ERROR,
      `Could not connect to the selected mint.`,
      {message: e.message, mintUrl},
    )
  }

  if (!CashuUtils.validateMintKeys(keys)) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      'Invalid keys retrieved from the selected mint.',
      {mintUrl, keys},
    )
  }

  keyset = deriveKeysetId(keys)

  const newMintKeys: {keys: MintKeys; keyset: string} = {
    keys,
    keyset,
  }

  return newMintKeys
}



const receiveFromMint = async function (
    mintUrl: string, 
    encodedToken: string,
    counter: number
) {
  try {
    const cashuWallet = await getWallet(mintUrl)

    // this method returns quite a mess, we normalize naming of returned parameters
    const {token, tokensWithErrors, newKeys} = await cashuWallet.receive(
      encodedToken,
      undefined,
      counter
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
  counter: number
) {
  try {
    const cashuWallet = await getWallet(mintUrl)

    const {returnChange, send, newKeys} = await cashuWallet.send(
      amountToSend,
      proofsToSendFrom,
      undefined,
      counter
    )

    log.trace('[MintClient.sendFromMint] returnedProofs', returnChange)
    log.trace('[MintClient.sendFromMint] sentProofs', send)
    log.trace('[MintClient.sendFromMint] newKeys', newKeys)

    // do some basic validations that proof amounts from mints match
    const totalAmountToSendFrom = CashuUtils.getProofsAmount(proofsToSendFrom)
    const returnedAmount = CashuUtils.getProofsAmount(returnChange as Proof[])
    const proofsAmount = CashuUtils.getProofsAmount(send as Proof[])

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
    throw new AppError(
        Err.MINT_ERROR, 
        `The mint could not return proofs necessary for this transaction. ${e.message}`, 
        {
            caller: 'sendFromMint', 
            mintUrl, 
            message: e.message
        }
    )
  }
}



const getSpentOrPendingProofsFromMint = async function (
  mintUrl: string,
  proofs: Proof[],
) {
  try {
    const cashuWallet = await getWallet(mintUrl)

    const spentPendingProofs = await cashuWallet.checkProofsSpent(proofs)

    log.trace('[getSpentOrPendingProofsFromMint]', spentPendingProofs)

    return spentPendingProofs as {
        spent: CashuProof[]
        pending: CashuProof[]
    }

  } catch (e: any) {    
    throw new AppError(
        Err.MINT_ERROR, 
        'The mint could not reply if the proofs are spent or pending.', 
        {
            caller: 'getSpentOrPendingProofsFromMint', 
            mintUrl, 
            message: e.message
        }
    )
  }
}



const getLightningFee = async function (
  mintUrl: string,
  encodedInvoice: string,
) {
  try {
    const cashuMint = getMint(mintUrl)
    const {fee} = await cashuMint.checkFees({pr: encodedInvoice})
    log.info('Estimated fee', fee, 'getLightningFee')
    return fee
  } catch (e: any) {
    throw new AppError(
        Err.MINT_ERROR, 
        'The mint could not return the lightning fee.', 
        {
            caller: 'getLightningFee', 
            mintUrl, 
            message: e.message
        }
    )
  }
}



const payLightningInvoice = async function (
  mintUrl: string,
  encodedInvoice: string,
  proofsToPayFrom: CashuProof[],
  estimatedFee: number,
  counter: number
) {
  try {    
    const cashuWallet = await getWallet(mintUrl)

    const {isPaid, change, preimage, newKeys}: PayLnInvoiceResponse =
      await cashuWallet.payLnInvoice(
        encodedInvoice,
        proofsToPayFrom,
        estimatedFee,
        counter
      )

    // if (newKeys) { _setKeys(mintUrl, newKeys) }
    log.trace('payLnInvoice result', {
      isPaid,
      change,
      preimage,
      newKeys,
    }, 'payLightningInvoice')
    // we normalize naming of returned parameters
    return {
      feeSavedProofs: change,
      isPaid,
      preimage,
      newKeys
    }
  } catch (e: any) {
    throw new AppError(
        Err.MINT_ERROR, 
        'Lightning payment failed.', 
        {
            caller: 'payLightningInvoice', 
            mintUrl, 
            message: e.message
        }
    )
  }
}



const requestLightningInvoice = async function (
  mintUrl: string,
  amount: number,
) {
  try {
    const cashuWallet = await getWallet(mintUrl)
    const {pr, hash} = await cashuWallet.requestMint(amount)

    log.info('[requestLightningInvoice]', {pr, hash})

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
  counter: number
) {
  try {
    const cashuWallet = await getWallet(mintUrl)
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {proofs, newKeys} = await cashuWallet.requestTokens(
      amount,
      paymentHash,
      undefined,
      counter
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
    if(e.message.includes('Invoice not paid') === false) {
        log.warn('[requestProofs]', `${e.message}`)
    }
    
    return {proofs: []}
  }
}

const restore = async function (
    mintUrl: string,
    indexFrom: number,
    indexTo: number,    
  ) {
    try {
      const cashuWallet = await getWallet(mintUrl)

      const limit = Math.abs(indexTo - indexFrom)
      /* eslint-disable @typescript-eslint/no-unused-vars */
      const {proofs, newKeys} = await cashuWallet.restore(
        indexFrom,
        limit,
      )
      /* eslint-enable */
  
      log.info('[restore]', 'Number of recovered proofs', {proofs: proofs.length, newKeys})
  
      return {
          proofs: proofs || [], 
          newKeys
      }
    } catch (e: any) {
        log.error(e)
        throw new AppError(Err.MINT_ERROR, e.message, {mintUrl})
    }
}

export const MintClient = {
  getMintKeys,
  receiveFromMint,
  sendFromMint,
  getSpentOrPendingProofsFromMint,
  getLightningFee,
  payLightningInvoice,
  requestLightningInvoice,
  requestProofs,
  restore,
}
