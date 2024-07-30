import {Instance, SnapshotOut, types, flow, getRoot} from 'mobx-state-tree'
import {
  AmountPreference,
  CashuMint,
  CashuWallet,
  MeltQuoteResponse,
  MeltTokensResponse,
  setGlobalRequestOptions,  
  deriveSeedFromMnemonic,  
  type MintKeys,
  type MintKeyset
} from '@cashu/cashu-ts'
import { JS_BUNDLE_VERSION } from '@env'
import {KeyChain} from '../services'
import {log} from '../services/logService'
import AppError, { Err } from '../utils/AppError'
import { MintUnit } from '../services/wallet/currency'
import { CashuUtils, ProofV3, TokenV3 } from '../services/cashu/cashuUtils'
import { Proof } from './Proof'
import { isObj } from '@cashu/cashu-ts/src/utils'
import { Mint, MintModel } from './Mint'
import { getRootStore } from './helpers/getRootStore'

/* 
   Not persisted, in-memory only model of the cashu-ts wallet instances and seed.
   It is instantiated on first use so that wallet retrieves fresh mint keysets, then cached, 
   so that new cashu-ts instances are re-used over app lifecycle. Seed is as well retrieved as needed and cached because retrieval from keychain might be slow.
*/

export const WalletStoreModel = types
    .model('WalletStore', {        
        mints: types.array(types.frozen<CashuMint>()),
        wallets: types.array(types.frozen<CashuWallet>()),
        seedWallets: types.array(types.frozen<CashuWallet>()),
        mnemonicPhrase: types.maybe(types.string),
        seedBase64: types.maybe(types.string),
    })
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
          log.trace('[getMnemonic]', 'returning cached mnemonic')
          return new Uint8Array(Buffer.from(self.seedBase64, 'base64'))
        }
    
        const seed = yield KeyChain.loadSeed()
    
        if (!seed) {
            return undefined        
        }
    
        self.seedBase64 = Buffer.from(seed).toString('base64')
        return seed
      }),
      getMintModelInstance(mintUrl: string) {
        const mintsStore = getRoot(self).mintsStore
        return mintsStore.findByUrl(mintUrl)        
      }  
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
            return !mintInstance.keysets.some((keyset: MintKeyset) => keyset.id === freshKeyset.id)
          })
      
          if(newKeysets.length > 0) {
            // if we heve new keysets, get and sync new keys
            const {keysets} = yield newMint.getKeys()
            mintInstance.refreshKeys(keysets)
          }
      
          // sync wallet state with fresh keysets, active statuses and keys
          mintInstance.refreshKeysets(keysets) 
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
        log.trace('[WalletStore.getWallet] start')
        // syncs mint model in wallet state and returns cashu-ts mint class instance
        const cashuMint = yield self.getMint(mintUrl)
            
        // get uptodate mint model from wallet state
        // const mintsStore = getRootStore(self).mintsStore
        const mintInstance = self.getMintModelInstance(mintUrl)
        if(!mintInstance) {
          throw new AppError(Err.NOTFOUND_ERROR, 'Mint not found in the wallet state.', {
            mintUrl
          })
        }
        
        // select keys to be used to find or create new cashu-ts wallet instance
        let walletKeys: MintKeys
        if(options && options.keysetId) {

          const requestedKeys = mintInstance.keys.find((k: MintKeys) => k.id === options.keysetId)

          if(!requestedKeys) {
            throw new AppError(Err.NOTFOUND_ERROR, 'Wallet has not keys with provided keyset id.', {
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
          const activeKeyset: MintKeyset = mintInstance.keysets
          .filter((k: MintKeyset) => k.unit === unit && k.active)
          .sort((a: MintKeyset, b: MintKeyset) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0))[0]

          if(!activeKeyset) {
            throw new AppError(Err.VALIDATION_ERROR, 'Wallet has not any active keyset for the selected unit.', {
              mintUrl, 
              unit
            })
          }

          const activeKeys = mintInstance.keys.find((k: MintKeys) => k.id === activeKeyset.id)

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
            w.keys.id === walletKeys.id
          )
          
          if (seedWallet) {
            return seedWallet
          }

          let seed: Uint8Array | undefined = undefined
          seed = yield self.getSeed()
          
          const newSeedWallet = new CashuWallet(cashuMint, {
            keys: walletKeys,        
            mnemonicOrSeed: seed
          })

          self.seedWallets.push(newSeedWallet)

          log.trace('[getWallet]', 'Returning NEW cashuWallet instance with seed')
          
          return newSeedWallet
        }

        const wallet: CashuWallet | undefined = self.wallets.find(
            w => w.mint.mintUrl === mintUrl &&         
            w.keys.id === walletKeys.id
        )

        if (wallet) {
          return wallet
        }
        
        const newWallet = new CashuWallet(cashuMint, {
          keys: walletKeys,      
          mnemonicOrSeed: undefined
        })
        
        self.wallets.push(newWallet)
          
        log.trace('[getWallet]', 'Returning NEW cashuWallet instance')
        return newWallet        
      }),
      getMintKeysets: flow(function* getMintKeysets(mintUrl: string) { 
        log.trace('[getMintKeysets] start')   
        const cashuMint: CashuMint = yield self.getMint(mintUrl)
  
        try {
          const {keysets} = yield cashuMint.getKeySets() // all
          return keysets    
        } catch (e: any) {
          let message = 'Could not connect to the selected mint.'
          if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
          throw new AppError(Err.CONNECTION_ERROR, message, { message: e.message, mintUrl })
        }  
      }),
      getMintKeys: flow(function* getMintKeys(mintUrl: string) {    
        const cashuMint: CashuMint = yield self.getMint(mintUrl)
  
        try {
          const {keysets} = yield cashuMint.getKeys() // all
          return keysets    
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
      receive: flow(function* receive(mintUrl: string,
        unit: MintUnit,
        decodedToken: TokenV3,
        mintFeeReserve: number,
        options: {      
          preference: AmountPreference[],
          counter: number
        }) {
          
          try {
            const cashuWallet = yield self.getWallet(
              mintUrl, 
              unit, 
              {
                withSeed: true,         
              })   
            
            const amountToReceive: number = CashuUtils.getTokenAmounts(decodedToken).totalAmount
        
            const proofs = yield cashuWallet.receive(
              decodedToken,
              mintFeeReserve,
              {
                keysetId: cashuWallet.keys.id,
                preference: options.preference,
                counter: options.counter,
                pubkey: undefined,
                privkey: undefined
              })
        
              const receivedAmount: number = CashuUtils.getProofsAmount(proofs as Proof[])
              const mintFeePaid = amountToReceive - receivedAmount
        
            return {proofs, mintFeePaid}
          } catch (e: any) {
            throw new AppError(Err.MINT_ERROR, e.message)
          }        
      }),
      send: flow(function* send(mintUrl: string,
        amountToSend: number,
        mintFeeReserve: number,
        unit: MintUnit,  
        proofsToSendFrom: Proof[],
        options: {    
          preference: AmountPreference[],
          counter: number
        }  ) {
          try {
            const cashuWallet = yield self.getWallet(
              mintUrl, 
              unit, 
              {
                withSeed: true,         
              }) 
        
            log.debug('[WalletStore.send] counter', options.counter)
        
            const {returnChange, send} = yield cashuWallet.send(
              amountToSend,
              mintFeeReserve,
              proofsToSendFrom,
              {
                keysetId: cashuWallet.keys.id,
                preference: options.preference,
                counter: options.counter,
                pubkey: undefined,
                privkey: undefined
              }      
            )
        
            log.debug('[WalletStore.send] returnedProofs', returnChange)
            log.debug('[WalletStore.send] proofsToSend', send)
        
            // do some basic validations that proof amounts from mints match
            const totalAmountToSendFrom: number = CashuUtils.getProofsAmount(proofsToSendFrom)
            const returnedAmount: number = CashuUtils.getProofsAmount(returnChange as Proof[])
            const sendAmount: number = CashuUtils.getProofsAmount(send as Proof[])
        
            if (sendAmount !== amountToSend) {
              throw new AppError(
                Err.VALIDATION_ERROR,
                `Amount to be sent provided by mint does not equal requested amount. Original is ${amountToSend}, mint returned ${sendAmount}`,
              )
            }
        
            const mintFeePaid = totalAmountToSendFrom - amountToSend - returnedAmount
        
            // we normalize naming of returned parameters
            return {
              returnedProofs: returnChange as Proof[],
              proofsToSend: send as Proof[], 
              mintFeePaid     
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
                caller: 'WalletStore.sendFromMint', 
                proofsToSendFrom, 
              }
            )
          }              
      }),
      getSpentOrPendingProofsFromMint: flow(function* getSpentOrPendingProofsFromMint(  
        mintUrl: string,
        unit: MintUnit,  
        proofs: Proof[]
      ) {
          try {
            log.trace('*** [WalletStore.getSpentOrPendingProofsFromMint] start', {mintUrl, unit})
            const cashuWallet = yield self.getWallet(mintUrl, unit, {withSeed: true})    
            const spentPendingProofs = yield cashuWallet.checkProofsSpent(proofs)
        
            log.trace('*** [WalletStore.getSpentOrPendingProofsFromMint]', {mintUrl, spentPendingProofs})
        
            return spentPendingProofs as {
                spent: ProofV3[]
                pending: ProofV3[]
            }
        
          } catch (e: any) {    
            let message = 'Could not get response from the mint.'
            if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
            throw new AppError(
                Err.MINT_ERROR, 
                message, 
                {
                  message: e.message,
                  caller: 'Wallet.getSpentOrPendingProofsFromMint', 
                  mintUrl            
                }
            )
          }
      }),
      createLightningMintQuote: flow(function* createLightningMintQuote(  
        mintUrl: string,
        unit: MintUnit,
        amount: number,
      ) {
        try {
          const cashuMint = yield self.getMint(mintUrl)
          const {
            request: encodedInvoice, 
            quote: mintQuote,      
          } = yield cashuMint.createMintQuote({
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
          preference: AmountPreference[],
          counter: number
        }
      ) {
        try {
          const cashuWallet: CashuWallet = yield self.getWallet(mintUrl, unit, {withSeed: true}) // with seed
          
          const {proofs} = yield cashuWallet.mintTokens(
              amount,
              mintQuote,
              {
                keysetId: cashuWallet.keys.id,
                preference: options.preference,
                counter: options.counter,
                pubkey: undefined                          
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
        proofsToPayFrom: ProofV3[],  // proofAmount >= amount + fee_reserve
        options: {
          counter: number
        }
      ) {
        try {    
          const cashuWallet = yield self.getWallet(mintUrl, unit, {withSeed: true}) // with seed
      
          const {isPaid, preimage, change: feeSavedProofs}: MeltTokensResponse =
            yield cashuWallet.meltTokens(
              lightningMeltQuote,
              proofsToPayFrom,
              {
                keysetId: cashuWallet.keys.id,
                counter: options.counter
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
            mnemonicOrSeed: seed
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
      },
    }))

    function isOnionMint(mintUrl: string) {
      return new URL(mintUrl).hostname.endsWith('.onion')
    }

    const TorVPNSetupInstructions = `
    Is your Tor VPN running?
    Mints on Tor require a Tor VPN application like Orbot. You can get it on Google Play or Github.`

    
    export interface WalletStore extends Instance<typeof WalletStoreModel> {}
    export interface WalletStoreSnapshot
  extends SnapshotOut<typeof WalletStoreModel> {}
