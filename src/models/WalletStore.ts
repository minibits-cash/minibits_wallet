import {Instance, SnapshotOut, types, flow, getRoot, getSnapshot} from 'mobx-state-tree'
import {  
  CashuMint,
  CashuWallet,
  MeltQuoteResponse,  
  setGlobalRequestOptions,    
  type MintKeys,
  type MintKeyset,
  MintAllKeysets,
  MintActiveKeys,
  OutputAmounts,
  Token,
  MeltProofsResponse,
  ProofState,
  CheckStateEnum
} from '@cashu/cashu-ts'
import { isObj } from '@cashu/cashu-ts/src/utils'
import { JS_BUNDLE_VERSION } from '@env'
import {KeyChain, MinibitsClient} from '../services'
import {log} from '../services/logService'
import AppError, { Err } from '../utils/AppError'
import { Currencies, CurrencyCode, MintUnit } from '../services/wallet/currency'
import { CashuProof, CashuUtils } from '../services/cashu/cashuUtils'
import { Proof } from './Proof'

import { Mint } from './Mint'
import { getRootStore } from './helpers/getRootStore'
import {deriveSeedFromMnemonic} from '@cashu/crypto/modules/client/NUT09'

/* 
   Not persisted, in-memory only model of the cashu-ts wallet instances and seed.
   It is instantiated on first use so that wallet retrieves fresh mint keysets, then cached, 
   so that new cashu-ts instances are re-used over app lifecycle. Seed is as well retrieved as needed and cached because retrieval from keychain might be slow.
*/

export type ExchangeRate = {
  currency: CurrencyCode, // 1 EUR, USD, ...
  rate: number // in satoshis
}

export const WalletStoreModel = types
    .model('WalletStore', {        
        mints: types.array(types.frozen<CashuMint>()),
        wallets: types.array(types.frozen<CashuWallet>()),
        seedWallets: types.array(types.frozen<CashuWallet>()),
        mnemonicPhrase: types.maybe(types.string),
        seedBase64: types.maybe(types.string),
        exchangeRate: types.maybe(types.frozen<ExchangeRate>()),
        // lastClaimCheck: types.maybe(types.number),
        // lastRateCheck: types.maybe(types.number),
    })
    .views(self => ({
      getMintModelInstance(mintUrl: string) : Mint | undefined {
        const mintsStore = getRootStore(self).mintsStore        
        return mintsStore.findByUrl(mintUrl) as Mint        
      },
      getOptimalKeyset(mintInstance: Mint, unit: MintUnit) {
        const optimalKeyset: MintKeyset =mintInstance.keysets!
        .filter((k: MintKeyset) => k.unit === unit && k.active)
        .sort((a: MintKeyset, b: MintKeyset) => {
            // Prioritize keysets that start with '00'
            const aStartsWith00 = a.id.startsWith('00') ? 1 : 0;
            const bStartsWith00 = b.id.startsWith('00') ? 1 : 0;
    
            if (aStartsWith00 !== bStartsWith00) {
                return bStartsWith00 - aStartsWith00;
            }
    
            // If both start with '00' or neither do, sort by input_fee_ppk
            return (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0);
        })[0]

        if(!optimalKeyset) {
          throw new AppError(Err.VALIDATION_ERROR, 'Wallet has not any active keyset for the selected unit.', {
            mintUrl: mintInstance.mintUrl, 
            unit
          })
        }
        
        return optimalKeyset
      }, 
    }))
    .actions(self => ({
      getExchangeRate: flow(function* getExchangeRate(currencyCode: CurrencyCode) {
        if (self.exchangeRate && self.exchangeRate.currency === currencyCode) {
          return self.exchangeRate          
        }
        
        const {rate, currency} = yield MinibitsClient.getExchangeRate(currencyCode)
        const precision = Currencies[currencyCode]?.precision
        
        if(!precision) {
          throw new AppError(Err.VALIDATION_ERROR, `Currency code ${currency} is not yet supported by Minibits. Submit request to add it on our Github.`)
        }

        return {
          currency: currency,
          rate: rate / precision
        }
      }),
      refreshExchangeRate: flow(function* refreshExchangeRate(currencyCode: CurrencyCode) {                    
        const {rate, currency} = yield MinibitsClient.getExchangeRate(currencyCode)
        const precision = Currencies[currencyCode]?.precision
        
        if(!precision) {
          throw new AppError(Err.VALIDATION_ERROR, `Currency code ${currency} is not yet supported by Minibits. Submit request to add it on our Github.`)
        }

        self.exchangeRate = {
          currency: currency,
          rate: rate / precision
        }
      }),
      resetExchangeRate () {
        self.exchangeRate = undefined
      }
    })) 
    .actions(self => ({
      getMnemonic: flow(function* getMnemonic() {    
        if (self.mnemonicPhrase) {        
          log.trace('[getMnemonic]', 'returning cached mnemonic')
          return self.mnemonicPhrase     
        }    
        
        const mnemonic: string | undefined = yield KeyChain.loadMnemonic()
    
        if (!mnemonic) {
            return undefined        
        }
    
        self.mnemonicPhrase = mnemonic
        return mnemonic
      }),
      getSeed: flow(function* getSeed() {    
        if (self.seedBase64) {        
          log.trace('[getSeed]', 'returning cached seed')
          return new Uint8Array(Buffer.from(self.seedBase64, 'base64'))
        }    
        
        const seed: Uint8Array = yield KeyChain.loadSeed()
    
        if (!seed) {
            return undefined        
        }
    
        self.seedBase64 = Buffer.from(seed).toString('base64')
        return seed
      })
    }))

    .actions(self => ({  
      getOrCreateMnemonic: flow(function* getOrCreateMnemonic() {    
        let mnemonic: string | undefined = undefined
    
        mnemonic = yield self.getMnemonic() // returns cached or saved mnemonic   
    
        if (!mnemonic) {
            mnemonic = KeyChain.generateMnemonic() as string            
            const seed = deriveSeedFromMnemonic(mnemonic) // expensive            
                   
            yield KeyChain.saveMnemonic(mnemonic)
            yield KeyChain.saveSeed(seed)
    
            log.trace('[getOrCreateMnemonic]', 'Created and saved new mnemonic and seed')
        }
         
        return mnemonic
      }),
      getMint: flow(function* getMint(mintUrl: string) {    
        const mint = self.mints.find(m => m.mintUrl === mintUrl)

        if (mint) {
          return mint
        }

        setGlobalRequestOptions({
            headers: {'User-Agent': `Minibits/${JS_BUNDLE_VERSION}`}
        })
        // create cashu-ts mint instance
        const newMint = new CashuMint(mintUrl)

        // get fresh keysets
        const {keysets} = yield newMint.getKeySets()

        // get persisted mint model from wallet state        
        const mintInstance = self.getMintModelInstance(mintUrl)

        // skip checks if this is new mint being added
        if(mintInstance) {
          const newKeysets = keysets.filter((freshKeyset: MintKeyset) => {
            return !mintInstance.keysets!.some((keyset: MintKeyset) => keyset.id === freshKeyset.id)
          })
      
          if(newKeysets.length > 0) {
            // if we heve new keysets, get and sync new keys
            const {keysets} = yield newMint.getKeys()
            mintInstance.refreshKeys!(keysets)
          }
      
          // sync wallet state with fresh keysets, active statuses and keys
          mintInstance.refreshKeysets!(keysets) 
        }
      
        // store cashu-ts mint instance in memory
        self.mints.push(newMint)

        return newMint
      })       
    }))
    .actions(self => ({
      getWallet: flow(function* getWallet(    
        mintUrl: string,
        unit: MintUnit,
        options?: {
          keysetId?: string
          withSeed: boolean
        } 
      ) {        
        // syncs mint model in wallet state and returns cashu-ts mint class instance
        const cashuMint = yield self.getMint(mintUrl)
            
        // get uptodate mint model from wallet state        
        const mintInstance = self.getMintModelInstance(mintUrl)
        if(!mintInstance) {
          throw new AppError(Err.NOTFOUND_ERROR, 'Mint not found in the wallet state.', {
            mintUrl
          })
        }
        
        // select keys to be used to find or create new cashu-ts wallet instance
        let walletKeys: MintKeys
        if(options && options.keysetId) {

          const requestedKeys = mintInstance.keys!.find((k: MintKeys) => k.id === options.keysetId)

          if(!requestedKeys) {
            throw new AppError(Err.NOTFOUND_ERROR, 'Mint has no keys with provided keyset id.', {
              mintUrl, 
              keysetId: options.keysetId
            })
          }

          if(requestedKeys.unit !== unit) {
            throw new AppError(Err.VALIDATION_ERROR, 'Wallet unit and keys mismatch.', {
              mintUrl, 
              keysetId: options.keysetId, 
              unit
            })
          }

          walletKeys = requestedKeys
        } else {
          // if not we find active keyset with lowest fees and related keys
          const activeKeyset: MintKeyset = self.getOptimalKeyset(mintInstance, unit) // throws

          log.trace('[WalletStore.getWallet] Optimal keyset for this unit', {activeKeyset, unit, mintUrl})

          const activeKeys = mintInstance.keys!.find((k: MintKeys) => k.id === activeKeyset.id)

          if(!activeKeys) {
            throw new AppError(Err.VALIDATION_ERROR, 'Wallet has not any keys for the selected unit.', {
              mintUrl, 
              unit
            })
          }
            
          walletKeys = activeKeys      
        }    

        if (options && options.withSeed) {

          const seedWallet: CashuWallet | undefined = self.seedWallets.find(
            w => w.mint.mintUrl === mintUrl &&         
            w.keysetId === walletKeys.id
          )
          
          if (seedWallet) {
            log.trace('[WalletStore.getWallet]', 'Returning CACHED cashuWallet instance with seed', {mintUrl})
            return seedWallet
          }

          let seed: Uint8Array | undefined = undefined
          seed = yield self.getSeed()
          
          const newSeedWallet = new CashuWallet(cashuMint, {
            unit,
            keys: mintInstance.keys,
            keysets: mintInstance.keysets,                    
            bip39seed: seed
          })

          newSeedWallet.keysetId = walletKeys.id
          self.seedWallets.push(newSeedWallet)

          log.trace('[WalletStore.getWallet]', 'Returning NEW cashuWallet instance with seed', {mintUrl})
          
          return newSeedWallet
        }

        const wallet: CashuWallet | undefined = self.wallets.find(
            w => w.mint.mintUrl === mintUrl &&         
            w.keysetId === walletKeys.id
        )

        if (wallet) {
          log.trace('[WalletStore.getWallet]', 'Returning CACHED cashuWallet instance', {mintUrl})
          return wallet
        }
        
        const newWallet = new CashuWallet(cashuMint, {
          unit,
          keys: mintInstance.keys,
          keysets: mintInstance.keysets,   
          bip39seed: undefined
        })
        
        newWallet.keysetId = walletKeys.id
        self.wallets.push(newWallet)
          
        log.trace('[WalletStore.getWallet]', 'Returning NEW cashuWallet instance', {mintUrl})
        return newWallet        
      }),
      getMintKeysets: flow(function* getMintKeysets(mintUrl: string) {
        const cashuMint: CashuMint = yield self.getMint(mintUrl)
  
        try {
          const {keysets} = yield cashuMint.getKeySets() as Promise<MintAllKeysets> // all keysets
          return keysets as MintKeyset[]      
        } catch (e: any) {
          let message = 'Could not connect to the selected mint.'
          if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
          throw new AppError(Err.CONNECTION_ERROR, message, { message: e.message, mintUrl })
        }  
      }),
      getMintKeys: flow(function* getMintKeys(mintUrl: string) {    
        const cashuMint: CashuMint = yield self.getMint(mintUrl)
  
        try {
          const {keysets} = yield cashuMint.getKeys() as Promise<MintActiveKeys> // all active keys
          return keysets as MintKeys[]   
        } catch (e: any) {
          let message = 'Could not connect to the selected mint.'
          if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
          throw new AppError(Err.CONNECTION_ERROR, message, { message: e.message, mintUrl })
        }   
      }),
      resetWallets() {
        self.seedWallets.clear()
        self.wallets.clear()
      }
    }))
    .actions(self => ({
      receive: flow(function* receive(
        mintUrl: string,
        unit: MintUnit,
        decodedToken: Token,        
        options: {      
          outputAmounts: OutputAmounts,
          counter: number
        }) {
          
          try {
            const cashuWallet = yield self.getWallet(
              mintUrl, 
              unit, 
              {
                withSeed: true,         
              })   
            
            const amountToReceive: number = CashuUtils.getProofsAmount(decodedToken.proofs)

            // log.trace('[WalletStore.receive]', {decodedToken, keysetId: cashuWallet.keysetId, outputAmounts: options.outputAmounts, counter: options.counter})
        
            const proofs = yield cashuWallet.receive(
              decodedToken,              
              {
                keysetId: cashuWallet.keysetId,
                outputAmounts: options.outputAmounts,
                counter: options.counter,
              })
        
              const receivedAmount: number = CashuUtils.getProofsAmount(proofs as Proof[])
              const swapFeePaid = amountToReceive - receivedAmount
        
            return {proofs, swapFeePaid}
          } catch (e: any) {
            throw new AppError(
              Err.MINT_ERROR, 
              e.message, 
              {caller: 'WalletStore.receive'}
            )
          }        
      }),
      send: flow(function* send(mintUrl: string,
        amountToSend: number,        
        unit: MintUnit,  
        proofsToSendFrom: Proof[],
        options: {    
          outputAmounts: OutputAmounts,
          counter: number,          
        }  ) {
          try {
            const cashuWallet = yield self.getWallet(
              mintUrl, 
              unit, 
              {
                withSeed: true,         
              }) 
        
            log.debug('[WalletStore.send] counter', options.counter)
        
            const {keep, send} = yield cashuWallet.swap(
              amountToSend,              
              proofsToSendFrom,
              {
                keysetId: cashuWallet.keysetId,
                outputAmounts: options.outputAmounts,
                counter: options.counter,
                includeFees: false // fee reserve needs to be already in proofsToSendFrom
              }      
            )
        
            log.trace(`[WalletStore.send] ${keep.length} returnedProofs`)
            log.trace(`[WalletStore.send] ${send.length} proofsToSend`)
        
            // do some basic validations that proof amounts from mints match
            const totalAmountToSendFrom: number = CashuUtils.getProofsAmount(proofsToSendFrom)
            const returnedAmount: number = CashuUtils.getProofsAmount(keep)
            const sendAmount: number = CashuUtils.getProofsAmount(send)
        
            if (sendAmount !== amountToSend) {
              throw new AppError(
                Err.VALIDATION_ERROR,
                `Amount provided by mint does not equal requested amount. Original is ${amountToSend}, mint returned ${sendAmount}`,
              )
            }
        
            const swapFeePaid = totalAmountToSendFrom - amountToSend - returnedAmount        
            
            return {
              returnedProofs: keep as CashuProof[],
              proofsToSend: send as CashuProof[], 
              swapFeePaid
            }
          } catch (e: any) {
            let message = 'Swap to prepare ecash to send has failed.'
            if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
            throw new AppError(
              Err.MINT_ERROR, 
              message,
              {
                message: e.message,            
                mintUrl,
                caller: 'WalletStore.send',                 
              }
            )
          }              
      }),
      getProofsStatesFromMint: flow(function* getProofsStatesFromMint(  
        mintUrl: string,
        unit: MintUnit,  
        proofs: Proof[]
      ) {
          try {
            log.trace('[WalletStore.getProofsStatesFromMint] start', {mintUrl, unit})
            
            const cashuWallet = yield self.getWallet(mintUrl, unit, {withSeed: false})    
            const proofsByState: {[CheckStateEnum: string]: Proof[]} = yield cashuWallet.checkProofsStates(proofs)
        
            log.trace('[WalletStore.getProofsStatesFromMint]', {mintUrl, proofsByState})
        
            return proofsByState
        
          } catch (e: any) {    
            let message = 'Could not get response from the mint.'
            if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
            throw new AppError(
                Err.MINT_ERROR, 
                message, 
                {
                  message: e.message,
                  caller: 'WalletStore.getProofsStatesFromMint', 
                  mintUrl            
                }
            )
          }
      }),
      createLightningMintQuote: flow(function* createLightningMintQuote(  
        mintUrl: string,
        unit: MintUnit,
        amount: number,
        description?: string,
      ) {
        try {
          const cashuMint = yield self.getMint(mintUrl)
          const {
            request: encodedInvoice, 
            quote: mintQuote,      
          } = yield cashuMint.createMintQuote({
            unit, 
            amount,
            description
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
      }),
      checkLightningMintQuote: flow(function* checkLightningMintQuote(  
        mintUrl: string,
        quote: string,  
      ) {
        try {
          const cashuMint = yield self.getMint(mintUrl)
          const {
            request: encodedInvoice, 
            quote: mintQuote, 
            state,      
          } = yield cashuMint.checkMintQuote(      
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
      }),
      mintProofs: flow(function* mintProofs(  
        mintUrl: string,
        amount: number,
        unit: MintUnit,
        mintQuote: string,
        options: {
          outputAmounts: OutputAmounts,
          counter: number
        }
      ) {
        try {
          const cashuWallet: CashuWallet = yield self.getWallet(mintUrl, unit, {withSeed: true}) // with seed
          
          const proofs = yield cashuWallet.mintProofs(
              amount,
              mintQuote,
              {
                keysetId: cashuWallet.keysetId,
                outputAmounts: options.outputAmounts,
                counter: options.counter,                                        
              }            
          )
            
          
          log.info('[mintProofs]', {proofs})        
  
          return proofs
  
      } catch (e: any) {
          log.info('[mintProofs]', {error: {name: e.name, message: e.message}})
          let message = 'Error on request to mint new ecash.'
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
      }),
      createLightningMeltQuote: flow(function* createLightningMeltQuote(  
        mintUrl: string,
        unit: MintUnit,
        encodedInvoice: string,
      ) {
        try {
          const cashuMint = yield self.getMint(mintUrl)
          const lightningQuote: MeltQuoteResponse = yield cashuMint.createMeltQuote({ 
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
      }),
      payLightningMelt: flow(function* payLightningMelt(  
        mintUrl: string,
        unit: MintUnit,
        lightningMeltQuote: MeltQuoteResponse,  // invoice is stored by mint by quote
        proofsToPayFrom: CashuProof[],  // proofAmount >= amount + fee_reserve
        options: {
          counter: number
        }
      ) {
        try {    
          const cashuWallet: CashuWallet = yield self.getWallet(mintUrl, unit, {withSeed: true}) // with seed
      
          const meltResponse: MeltProofsResponse = yield cashuWallet.meltProofs(
              lightningMeltQuote,
              proofsToPayFrom,
              {
                keysetId: cashuWallet.keysetId,
                counter: options.counter
              }        
            )
          
          log.trace('[payLightningMelt]', {meltResponse})
          // we normalize naming of returned parameters
          return meltResponse

        } catch (e: any) {
          let message = 'Lightning payment failed.'
          if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
          throw new AppError(
              Err.MINT_ERROR, 
              message,
              {
                  message: e.message,
                  caller: 'payLightningMelt', 
                  mintUrl            
              }
          )
        }
      }),
      restore: flow(function* restore(  
        mintUrl: string,    
        seed: Uint8Array,
        options: {
          indexFrom: number,
          indexTo: number,    
          keysetId: string
        }
      ) {
        try {
          const {indexFrom, indexTo, keysetId} = options
          // need special wallet instance to pass seed and keysetId directly
          const cashuMint = yield self.getMint(mintUrl)
          
          const seedWallet = new CashuWallet(cashuMint, {
            unit: 'sat', // just use default unit as we restore by keyset        
            bip39seed: seed
          })
  
          const count = Math.abs(indexTo - indexFrom)      
          
          
          const {proofs} = yield seedWallet.restore(            
              indexFrom,
              count,
              {keysetId}
          )
          
      
          log.info('[restore]', 'Number of recovered proofs', {proofs: proofs.length})
      
          return {
              proofs: proofs || []            
          }
        } catch (e: any) {        
            throw new AppError(Err.MINT_ERROR, isObj(e.message) ? JSON.stringify(e.message) : e.message, {mintUrl})
        }
      }),
      getMintInfo: flow(function* getMintInfo(mintUrl: string) {
        try {
          const cashuMint = yield self.getMint(mintUrl)
          const info = yield cashuMint.getInfo()
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
      })
    }))
    .views(self => ({        
        get mnemonic() {
            return self.mnemonicPhrase
        },
        get seed() {
          return self.seedBase64
        }
    })).postProcessSnapshot((snapshot) => {   // NOT persisted to storage except last exchangeRate!  
      return {
          mints: [],
          seedWallets: [],
          wallets: [],
          mnemonicPhrase: undefined,
          seedBase64: undefined,
          exchangeRate: snapshot.exchangeRate
      }          
    })


    function isOnionMint(mintUrl: string) {
      return new URL(mintUrl).hostname.endsWith('.onion')
    }

    const TorVPNSetupInstructions = `
    Is your Tor VPN running?
    Mints on Tor require a Tor VPN application like Orbot.`

    
    export interface WalletStore extends Instance<typeof WalletStoreModel> {}
    export interface WalletStoreSnapshot
  extends SnapshotOut<typeof WalletStoreModel> {}
