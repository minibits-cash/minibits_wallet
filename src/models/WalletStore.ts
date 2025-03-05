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
  Token,
  MeltProofsResponse,  
  CheckStateEnum,
  OutputAmounts,
} from '@cashu/cashu-ts'
import { isObj } from '@cashu/cashu-ts/src/utils'
import { JS_BUNDLE_VERSION } from '@env'
import {KeyChain, MinibitsClient, WalletKeys} from '../services'
import {log} from '../services/logService'
import AppError, { Err } from '../utils/AppError'
import { Currencies, CurrencyCode, MintUnit } from '../services/wallet/currency'
import { CashuProof, CashuUtils } from '../services/cashu/cashuUtils'
import { Proof } from './Proof'

import { InFlightRequest, Mint } from './Mint'
import { getRootStore } from './helpers/getRootStore'


/* 
   Not persisted, in-memory only model of the cashu-ts wallet instances and wallet keys persisted in the device secure store.
   It is instantiated on first use so that wallet retrieves fresh mint keysets, then cached, 
   so that new cashu-ts instances are re-used over app lifecycle.
*/

export type ExchangeRate = {
  currency: CurrencyCode, // 1 EUR, USD, ...
  rate: number // in satoshis
}

export type ReceiveParams = {
  token: string | Token,
  options?: {
    keysetId?: string;
    outputAmounts?: OutputAmounts;
    proofsWeHave?: Array<CashuProof>;
    counter?: number;
    pubkey?: string;
    privkey?: string;
    requireDleq?: boolean;
  }
}


export type SendParams = {
    amount: number,
		proofs: Array<Proof>,
		options?: {
			outputAmounts?: OutputAmounts;
			proofsWeHave?: Array<CashuProof>;
			counter?: number;
			pubkey?: string;
			privkey?: string;
			keysetId?: string;
			offline?: boolean;
			includeFees?: boolean;
			includeDleq?: boolean;
		}
}


export type MintParams = {
  amount: number,
  quote: string,
  options?: {
    keysetId?: string;
    outputAmounts?: OutputAmounts;
    proofsWeHave?: Array<CashuProof>;
    counter?: number;
    pubkey?: string;
  }
}


export type MeltParams = {
  meltQuote: MeltQuoteResponse,
  proofsToSend: Array<CashuProof>,
  options?: {
    keysetId?: string;
    counter?: number;
    privkey?: string;
  }
}

export const WalletStoreModel = types
    .model('WalletStore', {        
        mints: types.array(types.frozen<CashuMint>()),
        wallets: types.array(types.frozen<CashuWallet>()),
        seedWallets: types.array(types.frozen<CashuWallet>()),
        walletKeys: types.maybe(types.frozen<WalletKeys>()),
        exchangeRate: types.maybe(types.frozen<ExchangeRate>()),
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
      getCachedWalletKeys: flow(function* getWalletKeys() {    
        if (self.walletKeys) {        
          log.trace('[getCachedWalletKeys]', 'Returning cached walletKeys')
          return self.walletKeys     
        }    
        
        const keys: WalletKeys | undefined = yield KeyChain.getWalletKeys()
    
        if (!keys) {
            throw new AppError(
              Err.NOTFOUND_ERROR, 
              'Device secure storage could not return wallet keys, please reinstall and use your seed phrase to recover wallet.'
            )
        }
    
        self.walletKeys = keys
        return keys
      }),
      cleanCachedWalletKeys() {    
        self.walletKeys = undefined
      },      
    }))
    .actions(self => ({
      getCachedSeed: flow(function* getCachedSeed() {    
        const keys: WalletKeys = yield self.getCachedWalletKeys()
        return new Uint8Array(Buffer.from(keys.SEED.seed, 'base64'))
      }),
      getCachedMnenomic: flow(function* getCachedMnenomic() {    
        const keys: WalletKeys = yield self.getCachedWalletKeys()
        return keys.SEED.mnemonic
      }),
      getCachedSeedHash: flow(function* getCachedSeedHash() {    
        const keys: WalletKeys = yield self.getCachedWalletKeys()
        return keys.SEED.seedHash
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
            const {keysets: keys} = yield newMint.getKeys()
            mintInstance.refreshKeys!(keys)
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
            throw new AppError(Err.NOTFOUND_ERROR, 'Mint has no keys with provided keyset id, refresh mint settings.', {
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
            throw new AppError(Err.VALIDATION_ERROR, 'Wallet has not any keys for the selected unit, refresh mint settings.', {
              mintUrl, 
              unit,
              activeKeysetId: activeKeyset.id
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
          
          const seed = yield self.getCachedSeed()
          
          const newSeedWallet = new CashuWallet(cashuMint, {
            unit,
            keys: mintInstance.keys,
            keysets: mintInstance.keysets,                    
            bip39seed: seed
          })

          // Load uptodate mint info to wallet.mintInfo (NUTS support etc)
          yield newSeedWallet.getMintInfo()

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
            transactionId: number,
            options?: {
              increaseCounterBy?: number,
              inFlightRequest?: InFlightRequest<ReceiveParams>       
            }            
        ) {    
            const mintInstance = self.getMintModelInstance(mintUrl)
            if(!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mint instance', {mintUrl})
            }

            const cashuWallet = yield self.getWallet(
                mintUrl, 
                unit, 
                {
                    withSeed: true,         
                }
            )

            const currentCounter = mintInstance.getProofsCounterByKeysetId!(cashuWallet.keysetId)
            
            // outputs error healing
            if(options && options.increaseCounterBy) {
                currentCounter.increaseProofsCounter(options.increaseCounterBy)
            }

            log.debug('[WalletStore.receive] counter', currentCounter.counter)            

            const receiveParams: ReceiveParams = options?.inFlightRequest?.request || {
                token: decodedToken,
                options: {
                    keysetId: cashuWallet.keysetId,                    
                    counter: currentCounter.counter,                    
                }
            }                
            
            if(cashuWallet.mintInfo.nuts['19'] && !options?.inFlightRequest) {
                currentCounter.addInFlightRequest(transactionId, receiveParams)
            }            

            try {
                const proofs = yield cashuWallet.receive(
                  receiveParams.token,
                  receiveParams.options
                )                
                
                currentCounter.removeInFlightRequest(transactionId)               
                
                const receivedAmount: number = CashuUtils.getProofsAmount(proofs as Proof[])
                const amountToReceive: number = CashuUtils.getProofsAmount(decodedToken.proofs)
                const swapFeePaid = amountToReceive - receivedAmount
            
                return {proofs, swapFeePaid}

            } catch (e: any) {
                if(!e.message.toLowerCase().includes('timeout')) {
                  currentCounter.removeInFlightRequest(transactionId)
                }                
                throw new AppError(
                    Err.MINT_ERROR, 
                    e.message, 
                    {caller: 'WalletStore.receive'}
                )
            }        
        }),
        send: flow(function* send(
            mintUrl: string,
            amountToSend: number,        
            unit: MintUnit,  
            proofsToSendFrom: Proof[],
            transactionId: number,
            options?: {
              increaseCounterBy?: number,             
              inFlightRequest?: InFlightRequest<SendParams>       
            }
        ) {

            const mintInstance = self.getMintModelInstance(mintUrl)
            
            if(!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mint instance', {mintUrl})
            }

            const cashuWallet = yield self.getWallet(
                mintUrl, 
                unit, 
                {
                    withSeed: true,         
                }
            )

            const currentCounter = mintInstance.getProofsCounterByKeysetId!(cashuWallet.keysetId)
            
            // outputs error healing
            if(options && options.increaseCounterBy) {
              currentCounter.increaseProofsCounter(options.increaseCounterBy)
            }
        
            log.debug('[WalletStore.send] counter', currentCounter.counter)
            
            const sendParams: SendParams = options?.inFlightRequest?.request || {
                amount: amountToSend,              
                proofs: proofsToSendFrom,
                options: {
                    keysetId: cashuWallet.keysetId,                   
                    counter: currentCounter.counter,
                    includeFees: false // fee reserve needs to be already in proofsToSendFrom
                }
            }                
            
            if(cashuWallet.mintInfo.nuts['19']) {
                currentCounter.addInFlightRequest(transactionId, sendParams)
            }

            try {
            
                const {keep, send} = yield cashuWallet.swap(
                  sendParams.amount,
                  sendParams.proofs,
                  sendParams.options
                )

                currentCounter.removeInFlightRequest(transactionId)
            
                log.trace(`[WalletStore.send] ${keep.length} returnedProofs`)
                log.trace(`[WalletStore.send] ${send.length} proofsToSend`)            
                
                const totalAmountToSendFrom: number = CashuUtils.getProofsAmount(proofsToSendFrom)
                const returnedAmount: number = CashuUtils.getProofsAmount(keep)            
                const swapFeePaid = totalAmountToSendFrom - amountToSend - returnedAmount        
                
                return {
                    returnedProofs: keep as CashuProof[],
                    proofsToSend: send as CashuProof[], 
                    swapFeePaid
                }

            } catch (e: any) {
                if(!e.message.toLowerCase().includes('timeout')) {
                  currentCounter.removeInFlightRequest(transactionId)
                }      

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
                
                const cashuWallet: CashuWallet = yield self.getWallet(mintUrl, unit, {withSeed: false})    
                const proofsByState: {[key in CheckStateEnum]: Proof[]} = yield cashuWallet.checkProofsStates(proofs)
            
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
              let message = 'The mint could not return a mint quote.'
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
            const cashuMint: CashuMint = yield self.getMint(mintUrl)
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
            transactionId: number ,
            options?: {
              increaseCounterBy?: number,
              inFlightRequest?: InFlightRequest<MintParams>
            }
            
        ) {
            const mintInstance = self.getMintModelInstance(mintUrl)
            
            if(!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mint instance', {mintUrl})
            }

            const cashuWallet = yield self.getWallet(
                mintUrl, 
                unit, 
                {
                    withSeed: true,         
                }
            )

            const currentCounter = mintInstance.getProofsCounterByKeysetId!(cashuWallet.keysetId)

            // outputs error healing
            if(options && options.increaseCounterBy) {
                currentCounter.increaseProofsCounter(options.increaseCounterBy)
            }
        
            log.debug('[WalletStore.mintProofs] counter', currentCounter.counter)
            
            const mintParams: MintParams = options?.inFlightRequest?.request || {
                amount,              
                quote: mintQuote,
                options: {                    
                    keysetId: cashuWallet.keysetId,                    
                    counter: currentCounter.counter                       
                }
            }                
            
            if(cashuWallet.mintInfo.nuts['19']) {
                currentCounter.addInFlightRequest(transactionId, mintParams)
            }
            
            try {            
            
                const proofs = yield cashuWallet.mintProofs(
                    mintParams.amount,
                    mintParams.quote,
                    mintParams.options
                )

                currentCounter.removeInFlightRequest(transactionId)            
                
                log.info('[mintProofs]', {proofs})        
        
                return proofs
        
            } catch (e: any) {
                if(!e.message.toLowerCase().includes('timeout')) {
                  currentCounter.removeInFlightRequest(transactionId)
                }      
                
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
            meltQuote: MeltQuoteResponse,  // invoice is stored by mint by quote
            proofsToMeltFrom: CashuProof[],  // proofAmount >= amount + fee_reserve
            transactionId: number,
            options?: {
              increaseCounterBy?: number,
              inFlightRequest?: InFlightRequest<MeltParams>
            }
        ) {
            const mintInstance = self.getMintModelInstance(mintUrl)
            
            if(!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mint instance', {mintUrl})
            }

            const cashuWallet = yield self.getWallet(
                mintUrl, 
                unit, 
                {
                    withSeed: true,         
                }
            )

            const currentCounter = mintInstance.getProofsCounterByKeysetId!(cashuWallet.keysetId)

            // outputs error healing
            if(options && options.increaseCounterBy) {
              currentCounter.increaseProofsCounter(options.increaseCounterBy)
            }
        
            log.debug('[WalletStore.payLightningMelt] counter', currentCounter.counter)
            
            const meltParams: MeltParams = options?.inFlightRequest?.request || {
                meltQuote,              
                proofsToSend: proofsToMeltFrom,
                options: {                    
                    keysetId: cashuWallet.keysetId,                    
                    counter: currentCounter.counter                       
                }
            }                
            
            if(cashuWallet.mintInfo.nuts['19']) {
                currentCounter.addInFlightRequest(transactionId, meltParams)
            }            
            
            try {                
            
                const meltResponse: MeltProofsResponse = yield cashuWallet.meltProofs(
                    meltParams.meltQuote,
                    meltParams.proofsToSend,
                    meltParams.options
                )

                currentCounter.removeInFlightRequest(transactionId)    
                
                log.trace('[payLightningMelt]', {meltResponse})
                // we normalize naming of returned parameters
                return meltResponse

            } catch (e: any) {
                if(!e.message.toLowerCase().includes('timeout')) {
                  currentCounter.removeInFlightRequest(transactionId)
                }      

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
                keys: cashuMint.keys,
                keysets: cashuMint.keysets,
                bip39seed: seed
            })

            seedWallet.keysetId = keysetId
    
            const count = Math.abs(indexTo - indexFrom)          
            
            const {proofs} = yield seedWallet.restore(            
                indexFrom,
                count,
                {keysetId}
            )
            
        
            log.info('[restore]', 'Number of recovered proofs', {proofs: proofs.length})
        
            return {
                proofs: proofs || [] as Proof[]            
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
    .postProcessSnapshot((snapshot) => {   // NOT persisted to mmkv storage except last exchangeRate!  
      return {
          mints: [],
          wallets: [],
          seedWallets: [],          
          walletKeys: undefined,
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
