import {
    AmountPreference,
    CashuMint,
    CashuWallet,
    MeltQuoteResponse,
    MeltTokensResponse,
    MintAllKeysets,
    deriveKeysetId,    
    setGlobalRequestOptions,
    type Proof as CashuProof,
} from '@cashu/cashu-ts'
import {rootStoreInstance} from '../models'
import { KeyChain } from '../services'
import {CashuUtils} from './cashu/cashuUtils'
import AppError, {Err} from '../utils/AppError'
import {log} from './logService'
import {
    type Token as CashuToken,
} from '@cashu/cashu-ts'
import {Proof} from '../models/Proof'
import { deriveSeedFromMnemonic } from '@cashu/cashu-ts'
import { isObj } from '@cashu/cashu-ts/src/utils'
import { JS_BUNDLE_VERSION } from '@env'
import { MintUnit } from './wallet/currency'


let _mints: CashuMint[] = []
let _wallets: CashuWallet[] = [] // used where seed is not required (perf)
let _seedWallets: CashuWallet[] = [] // wallet instances with seeds from keystore
let _mnemonic: string | undefined = undefined
let _seed: Uint8Array | undefined = undefined

const { mintsStore } = rootStoreInstance

function isOnionMint(mintUrl: string) {
  return new URL(mintUrl).hostname.endsWith('.onion')
}
const TorVPNSetupInstructions = `
Is your Tor VPN running?
Mints on Tor require a Tor VPN like Orbot. You can get it on Google Play or Github (guardianproject/orbot).
Tor can sometimes be slow, so requests might time out. If Orbot is running, try again in a bit.`

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


const getMint = function (mintUrl: string): CashuMint {    
    
    const mint = _mints.find(m => m.mintUrl === mintUrl)

    if (mint) {
      return mint
    }

    setGlobalRequestOptions({
        headers: {'User-Agent': `Minibits/${JS_BUNDLE_VERSION}`}
    })

    const newMint = new CashuMint(mintUrl)
    _mints.push(newMint)

    return newMint
}


// wallet instances are created per mint and unit
const getWallet = async function (
    mintUrl: string,
    unit: MintUnit,
    options?: {
      withSeed: boolean
    }    
): Promise<CashuWallet> {
    const cashuMint = getMint(mintUrl)

    if (options && options.withSeed) {
      const seedWallet = _seedWallets.find(w => w.mint.mintUrl === mintUrl && w.unit === unit)
      
      if (seedWallet) {
        return seedWallet
      }

      let seed: Uint8Array | undefined = undefined
      seed = await getSeed()

      // Handle legacy pre-0.1.5 created wallets
      if(!seed) {
          const mnemonic = await getOrCreateMnemonic()
          seed = await getSeed()
          resetCachedWallets() // force all wallet instances to be recreated with seed
      }
      
      const newSeedWallet = new CashuWallet(cashuMint, {
        unit,        
        mnemonicOrSeed: seed
      })

      try {
        // make sure we have keys for wallet unit cached in wallet instance
        const keys = await newSeedWallet.getKeys(undefined, unit)

        if(!keys || keys.unit !== unit) {
          throw new AppError(Err.VALIDATION_ERROR, `This mint does not currently support unit ${unit}`)
        }

        _seedWallets.push(newSeedWallet)

        log.trace('[getWallet]', 'Returning new cashuWallet instance with seed')
        return newSeedWallet
      } catch (e: any) {
        let message = 'Could not connect to the selected mint.'
        if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
        throw new AppError(Err.NETWORK_ERROR, message, {message: e.message, caller: 'getWallet'})
      }
    }

    const wallet = _wallets.find(w => w.mint.mintUrl === mintUrl && w.unit === unit)

    if (wallet) {
      return wallet
    }
    
    const newWallet = new CashuWallet(cashuMint, {
      unit,      
      mnemonicOrSeed: undefined
    })

    try {

      await newWallet.getKeys(undefined, unit)

      _wallets.push(newWallet)
      
      log.trace('[getWallet]', 'Returning new cashuWallet instance')
      return newWallet
    } catch (e: any) {
      let message = 'Could not connect to the selected mint.'
      if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
      throw new AppError(Err.NETWORK_ERROR, message, {message: e.message, caller: 'getWallet'})
    }
}


const resetCachedWallets = function () {    
    _seedWallets = []
    _wallets = []
    log.trace('[resetCachedWallets] Wallets cashe was cleared.')
}


const getMintKeysets = async function (mintUrl: string) {
  const cashuMint = getMint(mintUrl)
  
  try {
    const {keysets} = await cashuMint.getKeySets() // all
    return keysets    
  } catch (e: any) {
    let message = 'Could not connect to the selected mint.'
    if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
    throw new AppError(Err.CONNECTION_ERROR, message, { message: e.message, mintUrl })
  }  
}


const receiveFromMint = async function (
    mintUrl: string,
    unit: MintUnit,
    decodedToken: CashuToken,
    amountPreferences: AmountPreference[],
    counter: number
) {
  try {
    const cashuWallet = await getWallet(mintUrl, unit, {withSeed: true}) // with seed    
    
    const proofs = await cashuWallet.receive(decodedToken, {
      keysetId: cashuWallet.keys.id,
      preference: amountPreferences,
      counter,
      pubkey: undefined,
      privkey: undefined
    })

    return proofs
  } catch (e: any) {
    throw new AppError(Err.MINT_ERROR, e.message)
  }
}



const sendFromMint = async function (
  mintUrl: string,
  unit: MintUnit,
  amountToSend: number,
  proofsToSendFrom: Proof[],
  amountPreferences: AmountPreference[],
  counter: number
) {
  try {
    const cashuWallet = await getWallet(mintUrl, unit, {withSeed: true}) // with seed

    log.debug('[MintClient.sendFromMint] counter', counter)

    const {returnChange, send} = await cashuWallet.send(
      amountToSend,
      proofsToSendFrom,
      {
        keysetId: cashuWallet.keys.id,
        preference: amountPreferences,
        counter,
        pubkey: undefined,
        privkey: undefined
      }      
    )

    log.debug('[MintClient.sendFromMint] returnedProofs', returnChange)
    log.debug('[MintClient.sendFromMint] sentProofs', send)

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
        `Amount returned by the mint as a change ${returnedAmount} is incorrect, it should be ${
          totalAmountToSendFrom - proofsAmount
        }`,
      )
    }

    // we normalize naming of returned parameters
    return {
      returnedProofs: returnChange as Proof[],
      proofsToSend: send as Proof[],      
    }
  } catch (e: any) {
    let message = 'The mint could not return signatures necessary for this transaction'
    if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
    throw new AppError(
      Err.MINT_ERROR, 
      message,
      {
        message: e.message,            
        mintUrl,
        caller: 'MintClient.sendFromMint', 
        proofsToSendFrom, 
      }
    )
  }
}



const getSpentOrPendingProofsFromMint = async function (
  proofs: Proof[],
  mintUrl: string,
  unit: MintUnit,  
) {
  try {
    
    const cashuWallet = await getWallet(mintUrl, unit, {withSeed: true}) 

    const spentPendingProofs = await cashuWallet.checkProofsSpent(proofs)

    log.trace('[CashuMintClient.getSpentOrPendingProofsFromMint]', {mintUrl, spentPendingProofs})

    return spentPendingProofs as {
        spent: CashuProof[]
        pending: CashuProof[]
    }

  } catch (e: any) {    
    let message = 'Could not get response from the mint.'
    if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
    throw new AppError(
        Err.MINT_ERROR, 
        message, 
        {
          message: e.message,
          caller: 'CashuMintClient.getSpentOrPendingProofsFromMint', 
          mintUrl            
        }
    )
  }
}



const createLightningMeltQuote = async function (
  mintUrl: string,
  unit: MintUnit,
  encodedInvoice: string,
) {
  try {
    const cashuMint = getMint(mintUrl)
    const lightningQuote: MeltQuoteResponse = await cashuMint.createMeltQuote({ 
      unit, 
      request: encodedInvoice 
    })

    log.info('[createLightningMeltQuote]', {mintUrl, unit, encodedInvoice}, {lightningQuote})

    return lightningQuote

  } catch (e: any) {
    let message = 'The mint could not return the lightning quote.'
    if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
    throw new AppError(
        Err.MINT_ERROR, 
        message,
        {
          message: e.message,
          caller: 'createLightningMeltQuote', 
          request: {mintUrl, unit, encodedInvoice},            
        }
    )
  }
}



const payLightningMelt = async function (
  mintUrl: string,
  unit: MintUnit,
  lightningMeltQuote: MeltQuoteResponse,  // invoice is stored by mint by quote
  proofsToPayFrom: CashuProof[],  // proofAmount >= amount + fee_reserve
  counter: number
) {
  try {    
    const cashuWallet = await getWallet(mintUrl, unit, {withSeed: true}) // with seed

    const {isPaid, preimage, change: feeSavedProofs}: MeltTokensResponse =
      await cashuWallet.meltTokens(
        lightningMeltQuote,
        proofsToPayFrom,
        {
          keysetId: cashuWallet.keys.id,
          counter
        }        
      )
    
    log.trace('[payLightningMelt]', {isPaid, preimage, feeSavedProofs})
    // we normalize naming of returned parameters
    return {
      feeSavedProofs,
      isPaid,
      preimage,      
    }
  } catch (e: any) {
    let message = 'Lightning payment failed.'
    if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
    throw new AppError(
        Err.MINT_ERROR, 
        message,
        {
            message: isObj(e.message) ? JSON.stringify(e.message) : e.message,
            caller: 'payLightningMelt', 
            mintUrl            
        }
    )
  }
}



const createLightningMintQuote = async function (
  mintUrl: string,
  unit: MintUnit,
  amount: number,
) {
  try {
    const cashuMint = getMint(mintUrl)
    const {
      request: encodedInvoice, 
      quote: mintQuote,      
    } = await cashuMint.createMintQuote({
      unit, 
      amount
    })

    log.info('[createLightningMintQuote]', {encodedInvoice, mintQuote})

    return {
      encodedInvoice,
      mintQuote,
    }
  } catch (e: any) {
    let message = 'The mint could not return an invoice.'
    if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
    throw new AppError(
      Err.MINT_ERROR, 
      message, 
      {
          message: e.message,
          caller: 'createLightningMintQuote', 
          mintUrl,            
      }
    )
  }
}


const checkLightningMintQuote = async function (
  mintUrl: string,
  quote: string,  
) {
  try {
    const cashuMint = getMint(mintUrl)
    const {
      request: encodedInvoice, 
      quote: mintQuote, 
      state,      
    } = await cashuMint.checkMintQuote(      
      quote
    )

    log.info('[checkLightningMintQuote]', {encodedInvoice, mintQuote, state})

    return {
      encodedInvoice,
      mintQuote,
      state
    }
  } catch (e: any) {
    let message = 'The mint could not return the state of a mint quote.'
    if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
    throw new AppError(
        Err.MINT_ERROR, 
        message, 
        {
            message: e.message,
            caller: 'checkLightningMintQuote', 
            mintUrl,            
        }
    )
  }
}



const mintProofs = async function (
  mintUrl: string,
  unit: MintUnit,
  amount: number,
  mintQuote: string,
  amountPreferences: AmountPreference[],
  counter: number
) {
    try {
        const cashuWallet = await getWallet(mintUrl, unit, {withSeed: true}) // with seed
        /* eslint-disable @typescript-eslint/no-unused-vars */
        const {proofs} = await cashuWallet.mintTokens(
            amount,
            mintQuote,
            {
              keysetId: cashuWallet.keys.id,
              preference: amountPreferences,
              counter,
              pubkey: undefined                          
            }            
        )
        /* eslint-enable */        
        
        log.info('[mintProofs]', {proofs})        

        return proofs

    } catch (e: any) {
        log.info('[mintProofs]', {error: {name: e.name, message: e.message}})
        if(e.message.includes('quote not paid')) {
            return {
                proofs: [],                
            }
        }
        let message = 'The mint returned error on request to mint new ecash.'
        if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
        throw new AppError(
            Err.MINT_ERROR, 
            message, 
            {
                message: e.message,
                caller: 'mintProofs', 
                mintUrl,            
            }
        )
    }
}

const restore = async function (
    mintUrl: string,    
    seed: Uint8Array,
    options: {
      indexFrom: number,
      indexTo: number,    
      keysetId: string
    }
      // support recovery from older but still active keysets
  ) {
    try {
        const {indexFrom, indexTo, keysetId} = options
        // need special wallet instance to pass seed and keysetId directly
        const cashuMint = getMint(mintUrl)
        
        const seedWallet = new CashuWallet(cashuMint, {
          unit: 'sat', // just use default unit as we restore by keyset        
          mnemonicOrSeed: seed
        })

        const count = Math.abs(indexTo - indexFrom)      
        
        /* eslint-disable @typescript-eslint/no-unused-vars */
        const {proofs} = await seedWallet.restore(            
            indexFrom,
            count,
            {keysetId}
        )
        /* eslint-enable */
    
        log.info('[restore]', 'Number of recovered proofs', {proofs: proofs.length})
    
        return {
            proofs: proofs || []            
        }
    } catch (e: any) {        
        throw new AppError(Err.MINT_ERROR, isObj(e.message) ? JSON.stringify(e.message) : e.message, {mintUrl})
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
      let message = 'The mint could not return mint information.';
      if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
      throw new AppError(
          Err.MINT_ERROR, 
          message, 
          {
            message: e.message,
            caller: 'getMintInfo', 
            mintUrl
          }
      )
    }
}


export const MintClient = {
    getWallet,
    getOrCreateMnemonic,
    getMnemonic,
    getSeed,
    resetCachedWallets,  
    getMintKeysets,
    receiveFromMint,
    sendFromMint,
    getSpentOrPendingProofsFromMint,
    createLightningMintQuote,
    checkLightningMintQuote,
    mintProofs,
    createLightningMeltQuote,
    payLightningMelt,
    restore,
    getMintInfo,
}
