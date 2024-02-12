import {
    AmountPreference,
    CashuMint,
    CashuWallet,
    deriveKeysetId,
    PayLnInvoiceResponse,
  type Proof as CashuProof,
} from '@cashu/cashu-ts'
import {rootStoreInstance} from '../models'
import { KeyChain, TorDaemon } from '../services'
import {CashuUtils} from './cashu/cashuUtils'
import AppError, {Err} from '../utils/AppError'
import {log} from './logService'
import {
    type Token as CashuToken,
} from '@cashu/cashu-ts'
import {Token} from '../models/Token'
import {Proof} from '../models/Proof'
import { deriveSeedFromMnemonic } from '@cashu/cashu-ts'
import { isObj } from '@cashu/cashu-ts/src/utils'
import { UserCredentials } from 'react-native-keychain'

export type MintKeys = {[k: number]: string}
export type MintKeySets = {keysets: Array<string>}

let _mints: {[mintUrl: string]: CashuMint} = {}
let _wallets: {[mintUrl: string]: CashuWallet} = {} // used where seed is not required (perf)
let _seedWallets: {[mintUrl: string]: CashuWallet} = {} // wallet instances with seeds from keystore
let _mnemonic: string | undefined = undefined
let _seed: Uint8Array | undefined = undefined

const { mintsStore } = rootStoreInstance

const getOrCreateMnemonic = async function (): Promise<string> {    
    let mnemonic: string | undefined = undefined

    mnemonic = await getMnemonic() // returns cached or saved mnemonic   

    if (!mnemonic) {
        mnemonic = KeyChain.generateMnemonic() as string
        const seed = deriveSeedFromMnemonic(mnemonic) // expensive
               
        await KeyChain.saveMnemonic(mnemonic)
        await KeyChain.saveSeed(seed)

        log.trace('[getOrCreateMnemonic]', 'Created and saved new mnemonic and seed')
    }
     
    return mnemonic
}

// caching mnemonic
const getMnemonic = async function (): Promise<string | undefined> {    
    if (_mnemonic) {        
        log.trace('[getMnemonic]', 'returning cached mnemonic')
        return _mnemonic
    }

    const mnemonic = await KeyChain.loadMnemonic() as string

    if (!mnemonic) {
        return undefined        
    }

    _mnemonic = mnemonic
    return mnemonic
}


const getSeed = async function (): Promise<Uint8Array | undefined> {
    if (_seed) {        
        log.trace('[getSeed]', 'returning cached seed')
        return _seed
    }

    const seed = await KeyChain.loadSeed()

    if (!seed) {
        return undefined        
    }

    _seed = seed
    return seed
}


const getMint = function (mintUrl: string) {    
    if (_mints[mintUrl]) {
        return _mints[mintUrl]
    }

    if(mintUrl.includes('.onion')) {
        log.trace('[getMint]', 'Creating mint instance with .onion mintUrl', {mintUrl})
        const mint = new CashuMint(mintUrl, TorDaemon.torRequest)
        _mints[mintUrl] = mint

        return mint
    }

    const mint = new CashuMint(mintUrl)
    _mints[mintUrl] = mint

    return mint
}


const getWallet = async function (
    mintUrl: string,
    withSeed: boolean = false
) {
    log.trace('[getWallet] start')

    if (withSeed && _seedWallets[mintUrl]) {
        log.trace('[getWallet]', 'Returning existing cashuWallet instance with seed')
        return _seedWallets[mintUrl]
    }

    if (!withSeed && _wallets[mintUrl]) {
        log.trace('[getWallet]', 'Returning existing cashuWallet instance')
        return _wallets[mintUrl]
    }

    const cashuMint = getMint(mintUrl)
    const mint = mintsStore.findByUrl(mintUrl)

    if(withSeed) {
        let seed: Uint8Array | undefined = undefined
        seed = await getSeed()

        // Handle legacy pre-0.1.5 created wallets
        if(!seed) {
            const mnemonic = await getOrCreateMnemonic()
            seed = await getSeed()
            resetCachedWallets() // force all wallet instances to be recreated with seed
        }
        
        const seedWallet = new CashuWallet(cashuMint, mint ? mint.keys : undefined, seed)
        log.trace('[getWallet]', 'Returning new cashuWallet instance with seed')

        _seedWallets[mintUrl] = seedWallet        
        return seedWallet
    }
    
    const wallet = new CashuWallet(cashuMint, mint ? mint.keys : undefined)
    _wallets[mintUrl] = wallet

    log.trace('[getWallet]', 'Returning new cashuWallet instance')
    return wallet
}


const resetCachedWallets = function () {
    _seedWallets = {}
    _wallets = {}
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
    amountPreferences: AmountPreference[],
    counter: number
) {
  try {
    const cashuWallet = await getWallet(mintUrl, true) // with seed

    log.trace('[receiveFromMint] calling cashuWallet.receive', {encodedToken, counter})

    // this method returns quite a mess, we normalize naming of returned parameters
    const {token, tokensWithErrors, newKeys, errors} = await cashuWallet.receive(
      encodedToken,
      amountPreferences,
      counter
    )

    log.trace('[receiveFromMint] updatedToken', token)
    log.trace('[receiveFromMint] tokensWithErrors', tokensWithErrors)
    log.trace('[receiveFromMint] newKeys', newKeys)
    log.trace('[receiveFromMint] errors', errors)

    return {
      updatedToken: token as CashuToken | undefined,
      errorToken: tokensWithErrors as CashuToken | undefined,
      newKeys,
      errors
    }
  } catch (e: any) {
    throw new AppError(Err.MINT_ERROR, e.message)
  }
}



const sendFromMint = async function (
  mintUrl: string,
  amountToSend: number,
  proofsToSendFrom: Proof[],
  amountPreferences: AmountPreference[],
  counter: number
) {
  try {
    const cashuWallet = await getWallet(mintUrl, true) // with seed

    log.debug('[MintClient.sendFromMint] counter', counter)

    const {returnChange, send, newKeys} = await cashuWallet.send(
      amountToSend,
      proofsToSendFrom,
      amountPreferences,
      counter
    )

    log.debug('[MintClient.sendFromMint] returnedProofs', returnChange)
    log.debug('[MintClient.sendFromMint] sentProofs', send)
    log.debug('[MintClient.sendFromMint] newKeys', newKeys)
    

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
        `The mint could not return signatures necessary for this transaction`, 
        {
            caller: 'MintClient.sendFromMint', 
            mintUrl,
            proofsToSendFrom, 
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
        'Could not get response from the mint.', 
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
    const cashuWallet = await getWallet(mintUrl, true) // with seed

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
            message: isObj(e.message) ? JSON.stringify(e.message) : e.message
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
    const cashuWallet = await getWallet(mintUrl, true) // with seed
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
    if(e.message.includes('quote not paid') === false) {
        log.warn('[requestProofs]', `${e.message}`)
    }
    
    return {proofs: []}
  }
}

const restore = async function (
    mintUrl: string,
    indexFrom: number,
    indexTo: number,
    seed: Uint8Array   
  ) {
    try {
        // need special wallet instance to pass seed directly
        const cashuMint = getMint(mintUrl)
        const mint = mintsStore.findByUrl(mintUrl)

        if(!mint) {
            throw new AppError(Err.MINT_ERROR, 'Could not find mint in wallet state', {caller: 'restore', mintUrl})
        }
        
        const seedWallet = new CashuWallet(cashuMint, mint.keys, seed)
        const count = Math.abs(indexTo - indexFrom)      
        
        /* eslint-disable @typescript-eslint/no-unused-vars */
        const {proofs, newKeys} = await seedWallet.restore(            
            indexFrom,
            count
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


const getMintInfo = async function (
    mintUrl: string,    
) {
    try {
      const cashuMint = getMint(mintUrl)
      const info = await cashuMint.getInfo()
      log.trace('[getMintInfo]', {info})
      return info
    } catch (e: any) {
      throw new AppError(
          Err.MINT_ERROR, 
          'The mint could not return mint information.', 
          {
              caller: 'getMintInfo', 
              mintUrl, 
              message: e.message
          }
      )
    }
}


export const MintClient = {
    getOrCreateMnemonic,
    getMnemonic,
    getSeed,
    resetCachedWallets,  
    getMintKeys,
    receiveFromMint,
    sendFromMint,
    getSpentOrPendingProofsFromMint,
    getLightningFee,
    payLightningInvoice,
    requestLightningInvoice,
    requestProofs,
    restore,
    getMintInfo,
}
