import {Instance, SnapshotOut, types, flow, getRoot, getSnapshot, isAlive} from 'mobx-state-tree'
import {
  Mint as CashuMint,
  Wallet as CashuWallet,
  KeyChain as CashuKeyChain,
  MeltQuoteBolt11Response,
  MeltQuoteOnchainResponse,
  setGlobalRequestOptions,
  type MintKeys,
  type MintKeyset,
  Token,
  MeltProofsResponse,
  CheckStateEnum,
  GetKeysetsResponse,
  GetKeysResponse,
  GetInfoResponse,
  MintQuoteBolt11Response,
  MintQuoteOnchainResponse,
  type ProofState,
  type OperationCounters,
  type MeltPreview,
  MeltQuoteState,
} from '@cashu/cashu-ts'
import { JS_BUNDLE_VERSION } from '@env'
import {Database, KeyChain, MinibitsClient, WalletKeys} from '../services'
import {log} from '../services/logService'
import AppError, { Err, MintError, NetworkError } from '../utils/AppError'
import { Currencies, CurrencyCode, MintUnit } from '../services/wallet/currency'
import { CashuProof, CashuUtils } from '../services/cashu/cashuUtils'
import { Proof } from './Proof'

import { InFlightRequest, Mint } from './Mint'
import { MINT_INFO_TTL_SECONDS, isMintInfoStale } from './helpers/mintInfoStale'
import { getRootStore } from './helpers/getRootStore'
import { Transaction } from './Transaction'

// refresh

/* 
   Not persisted, in-memory only model of the cashu-ts wallet instances and wallet keys persisted in the device secure store.
   It is instantiated on first use so that wallet retrieves fresh mint keysets, then cached, 
   so that new cashu-ts instances are re-used over app lifecycle.
*/

/**
 * How long a cached mint NUT-06 info stays fresh, in seconds.
 *
 * mintInfo carries the mint's advertised payment methods and their min/max
 * limits, which drive what the wallet offers the user. An hour keeps a mint that
 * gains (or drops) a method visible reasonably soon, while costing at most one
 * getInfo() per mint per hour.
 */
export {MINT_INFO_TTL_SECONDS, isMintInfoStale}

export type ExchangeRate = {
  currency: CurrencyCode, // 1 EUR, USD, ...
  rate: number // in satoshis
}

export type ReceiveParams = {
  token: string | Token,
  options?: {
    keysetId?: string;
    proofsWeHave?: Array<CashuProof>;
    counter?: number;
    pubkey?: string;
    privkey?: string;
    requireDleq?: boolean;
  }
}


export type SendParams = {
    amount: number,
		proofs: Array<CashuProof>,
		options?: {
			proofsWeHave?: Array<CashuProof>;
			counter?: number;
			pubkey?: string;
			privkey?: string;
			keysetId?: string;
			offline?: boolean;
			includeFees?: boolean;
			includeDleq?: boolean;
      p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> }
		}
}


export type MintParams = {
  amount: number,
  quote: string,
  options?: {
    keysetId?: string;
    proofsWeHave?: Array<CashuProof>;
    counter?: number;
    pubkey?: string;
  }
}


export type MeltParams = {
  meltQuote: MeltQuoteBolt11Response,
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
        // Mirrors cashu-ts v4.7 KeyChain.getCheapestKeyset: among active keysets for
        // this unit with a valid hex id (v00 `00…` or v2 `01…`; excludes deprecated
        // base64 keysets that cannot create outputs), pick the lowest input fee.
        const isHexKeysetId = (id: string) => /^[0-9a-f]+$/i.test(id)

        const optimalKeyset: MintKeyset | undefined = mintInstance.keysets!
        .filter((k: MintKeyset) => k.unit === unit && k.active && isHexKeysetId(k.id))
        .sort((a: MintKeyset, b: MintKeyset) => {
            const feeDelta = (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0)
            if (feeDelta !== 0) return feeDelta
            // Equal fee: prefer the newer keyset version (v2 `01…` over v0 `00…`)
            return b.id.localeCompare(a.id)
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
    .volatile(() => ({
      // In-flight KeyChain read shared by concurrent getCachedWalletKeys callers.
      // Reading secure storage is slow (~2s cold on Android), and several NWC
      // pushes can wake the app at once — without this, each push would trigger
      // its own KeyChain read. Volatile (never persisted), so it resets on a
      // fresh cold start, which is exactly when we want a single fresh read.
      walletKeysInFlight: null as Promise<WalletKeys> | null,
    }))
    .actions(self => ({
      getCachedWalletKeys: flow(function* getWalletKeys() {
        if (self.walletKeys) {
          log.trace('[getCachedWalletKeys]', 'Returning cached walletKeys')
          return self.walletKeys
        }

        // Coalesce concurrent cold reads onto a single KeyChain fetch.
        if (self.walletKeysInFlight) {
          log.trace('[getCachedWalletKeys]', 'Awaiting in-flight KeyChain read')
          return yield self.walletKeysInFlight
        }

        // The shared promise resolves to validated keys so that both this
        // originator and any concurrent awaiters get identical success/error.
        const fetch = (async (): Promise<WalletKeys> => {
          const keys: WalletKeys | undefined = await KeyChain.getWalletKeys()
          if (!keys) {
            throw new AppError(
              Err.NOTFOUND_ERROR,
              'Device secure storage could not return wallet keys, please reinstall and use your seed phrase to recover wallet.'
            )
          }
          return keys
        })()

        self.walletKeysInFlight = fetch

        try {
          const keys: WalletKeys = yield fetch
          self.walletKeys = keys
          return keys
        } finally {
          self.walletKeysInFlight = null
        }
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
      /**
       * Re-fetch a mint's NUT-06 info if the cached copy is older than the TTL.
       *
       * Capabilities (which payment methods a mint supports, and their min/max
       * limits) are read off `mintInfo`, so a copy that never refreshes means the
       * wallet keeps offering — or hiding — the wrong options. Errors are logged
       * and swallowed: a capability refresh must never break the operation that
       * happened to trigger it.
       */
      refreshMintInfoIfStale: flow(function* refreshMintInfoIfStale(
        mintUrl: string,
        cashuMint: CashuMint,
      ) {
        try {
          const mintInstance = self.getMintModelInstance(mintUrl)
          if (!mintInstance) return

          if (!isMintInfoStale(mintInstance.mintInfo)) return

          const info: GetInfoResponse = yield cashuMint.getInfo()

          // the mint may have been removed while the call was in flight
          if (!isAlive(mintInstance)) return

          mintInstance.setMintInfo!(info)
          log.trace('[WalletStore.refreshMintInfoIfStale] refreshed', {mintUrl})
        } catch (e: any) {
          log.warn('[WalletStore.refreshMintInfoIfStale]', {mintUrl, error: e.message})
        }
      }),
    }))
    .actions(self => ({
      getMint: flow(function* getMint(mintUrl: string) {
        const mint = self.mints.find(m => m.mintUrl === mintUrl)

        log.trace('[WalletStore.getMint]', {cachedMint: !!mint})

        if (mint) {
          // Refresh capabilities on a TTL even when the cashu-ts instance is already
          // cached. This check used to live below this early return, so a mint touched
          // once in a session never refreshed again for the rest of it. Fire-and-forget
          // so the caller's operation is not delayed by a getInfo() round trip;
          // observers re-render when fresher info lands.
          void self.refreshMintInfoIfStale(mintUrl, mint as CashuMint)
          return mint as CashuMint
        }

        setGlobalRequestOptions({
            headers: {'User-Agent': `Minibits/${JS_BUNDLE_VERSION}`}
        })
        // create cashu-ts mint instance
        const newMint = new CashuMint(mintUrl)

        // get fresh keysets - returns all keysets, both active and inactive
        const {keysets} = yield newMint.getKeySets()

        // get persisted mint model from wallet state
        const mintInstance = self.getMintModelInstance(mintUrl)

        // skip checks if this is new mint being added
        if(mintInstance) {
          const newKeysets = keysets.filter((freshKeyset: MintKeyset) => {
            return !mintInstance.keysets!.some((keyset: MintKeyset) => keyset.id === freshKeyset.id)
          })

          if(newKeysets.length > 0) {
            // if we have new keysets, get and sync new keys
            // this, for perf reasons, returns ONLY active keys so
            // mintInstance can not be directly used to restore from inactive keysets
            const {keysets: keys} = yield newMint.getKeys() as Promise<GetKeysResponse>
            mintInstance.refreshKeys!(keys)
          }

          // sync wallet state with fresh keysets, active statuses and keys
          mintInstance.refreshKeysets!(keysets)

          // fetch and cache mintInfo if not already cached or gone stale
          if(isMintInfoStale(mintInstance.mintInfo)) {
            const info: GetInfoResponse = yield newMint.getInfo()
            mintInstance.setMintInfo!(info)
          }
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
        const cashuMint: CashuMint = yield self.getMint(mintUrl)
            
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

          //log.warn(mintInstance.keys)

          const requestedKeys = mintInstance.keys!.find((k: MintKeys) => k.id === options.keysetId)

          if(!requestedKeys) {
            throw new AppError(Err.NOTFOUND_ERROR, 'Mint has no active keys with provided keyset id, refresh mint settings.', {
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
            throw new AppError(Err.VALIDATION_ERROR, 'Wallet has no active keys for the selected unit, refresh mint settings.', {
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
            return seedWallet as CashuWallet
          }
          
          const seed = yield self.getCachedSeed()

          const newSeedWallet = new CashuWallet(cashuMint, {
            unit,
            keysetId: walletKeys.id,
            bip39seed: seed
          })

          if (mintInstance.mintInfo && mintInstance.keysets?.length && mintInstance.keys?.length) {
            const keychainCache = CashuKeyChain.mintToCacheDTO(mintUrl, [...mintInstance.keysets], [...mintInstance.keys])
            newSeedWallet.loadMintFromCache(mintInstance.mintInfo, keychainCache)
          } else {
            yield newSeedWallet.loadMint()
          }

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
          keysetId: walletKeys.id,
        })

        if (mintInstance.mintInfo && mintInstance.keysets?.length && mintInstance.keys?.length) {
          const keychainCache = CashuKeyChain.mintToCacheDTO(mintUrl, [...mintInstance.keysets], [...mintInstance.keys])
          newWallet.loadMintFromCache(mintInstance.mintInfo, keychainCache)
        } else {
          yield newWallet.loadMint()
        }

        self.wallets.push(newWallet)
          
        log.trace('[WalletStore.getWallet]', 'Returning NEW cashuWallet instance', {mintUrl})
        return newWallet        
      }),
      getMintKeysets: flow(function* getMintKeysets(mintUrl: string) {
        const cashuMint: CashuMint = yield self.getMint(mintUrl)
  
        try {
          const {keysets} = yield cashuMint.getKeySets() as Promise<GetKeysetsResponse> // all keysets
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
          const {keysets: keys} = yield cashuMint.getKeys() as Promise<GetKeysResponse> // all active keys
          return keys as MintKeys[]   
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

            const cashuWallet: CashuWallet = yield self.getWallet(
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

            // Sync wallet's internal counter with our stored counter (v3.x)
            yield cashuWallet.counters.advanceToAtLeast(cashuWallet.keysetId, currentCounter.counter)

            // P2PK locked tokens can be received only by the wallet they are locked to (if lock has not expired)
            const isLocked = CashuUtils.isTokenP2PKLocked(decodedToken)
            let isLockedToWallet = false
            const walletKeys = yield self.getCachedWalletKeys()

            if(isLocked) {
                const lockedToPK = CashuUtils.getP2PKPubkeySecret(decodedToken.proofs[0].secret)
                const locktime = CashuUtils.getP2PKLocktime(decodedToken.proofs[0].secret)
                const walletP2PK = '02' + walletKeys.NOSTR.publicKey

                isLockedToWallet = lockedToPK === walletP2PK

                if(!isLockedToWallet) {
                    throw new AppError(Err.VALIDATION_ERROR, 'Ecash token is locked to another wallet, can not receive it.', {lockedToPK, walletP2PK, locktime})
                }
            }

            const receiveParams: ReceiveParams = options?.inFlightRequest?.request || {
                token: decodedToken,
                options: {
                    keysetId: cashuWallet.keysetId,
                    // Note: counter is no longer passed in v3.x, wallet manages it internally
                    privkey: isLockedToWallet ? walletKeys.NOSTR.privateKey : undefined,
                }
            }

            // @ts-ignore
            if(cashuWallet.getMintInfo().nuts['19'] && !options?.inFlightRequest) {
                Database.addInFlightRequest(transactionId, receiveParams)
            }

            let reservedCounters: OperationCounters | undefined

            try {
                const proofs = yield cashuWallet.receive(
                  receiveParams.token,
                  {
                    ...receiveParams.options,
                    onCountersReserved: (info: OperationCounters) => {
                      reservedCounters = info
                      log.debug('[WalletStore.receive] Counters reserved', info)
                    }
                  }
                )

                log.trace('[WalletStore.receive]', {proofs})

                Database.removeInFlightRequest(transactionId)

                // Update our counter to match what the wallet used (v3.x)
                if (reservedCounters) {
                    currentCounter.setProofsCounter(reservedCounters.next)
                    log.debug('[WalletStore.receive] Updated counter', {
                        keysetId: reservedCounters.keysetId,
                        start: reservedCounters.start,
                        count: reservedCounters.count,
                        next: reservedCounters.next
                    })
                }

                const receivedAmount: number = CashuUtils.getProofsAmount(proofs as Proof[])
                const amountToReceive: number = CashuUtils.getProofsAmount(decodedToken.proofs)
                const swapFeePaid = amountToReceive - receivedAmount

                return {
                  proofs,
                  swapFeePaid
                } as {
                  proofs: CashuProof[],
                  swapFeePaid: number
                }

            } catch (e: any) {
                if(!e.message.toLowerCase().includes('timeout') &&
                   !e.message.toLowerCase().includes('network request failed')) {
                  // remove in-flight request only if it was not a timeout or network error
                  Database.removeInFlightRequest(transactionId)
                }                
                throw new AppError(
                    Err.MINT_ERROR, 
                    e.message, 
                    {
                      caller: 'WalletStore.receive',
                      code: e.code || undefined,
                      message: e.message,   
                    }
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
              p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> }      
            }
        ) {

            const mintInstance = self.getMintModelInstance(mintUrl)
            
            if(!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mint instance', {mintUrl})
            }

            const cashuWallet: CashuWallet = yield self.getWallet(
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

            // Sync wallet's internal counter with our stored counter (v3.x)
            yield cashuWallet.counters.advanceToAtLeast(cashuWallet.keysetId, currentCounter.counter)

            const p2pk = options?.p2pk

            const sendParams: SendParams = options?.inFlightRequest?.request || {
                amount: amountToSend,
                proofs: CashuUtils.exportProofs(proofsToSendFrom),
                options: {
                    keysetId: cashuWallet.keysetId,
                    // Note: counter is no longer passed in v3.x, wallet manages it internally
                    includeFees: false, // fee reserve needs to be already in proofsToSendFrom
                    p2pk
                }
            }

            // @ts-ignore
            if(cashuWallet.getMintInfo().nuts['19'] && !options?.inFlightRequest) {
                Database.addInFlightRequest(transactionId, sendParams)
            }

            let reservedCounters: OperationCounters | undefined

            try {

                const {keep, send} = yield cashuWallet.send(
                  sendParams.amount,
                  sendParams.proofs,
                  {
                    ...sendParams.options,
                    onCountersReserved: (info: OperationCounters) => {
                      reservedCounters = info
                      log.debug('[WalletStore.send] Counters reserved', info)
                    }
                  }
                )

                Database.removeInFlightRequest(transactionId)

                // Update our counter to match what the wallet used (v3.x)
                if (reservedCounters) {
                    currentCounter.setProofsCounter(reservedCounters.next)
                    log.debug('[WalletStore.send] Updated counter', {
                        keysetId: reservedCounters.keysetId,
                        start: reservedCounters.start,
                        count: reservedCounters.count,
                        next: reservedCounters.next
                    })
                }

                log.trace(`[WalletStore.send] ${keep.length} returnedProofs`, {keep})
                log.trace(`[WalletStore.send] ${send.length} proofsToSend`, {send})

                const proofsToSendFromAmount: number = CashuUtils.getProofsAmount(proofsToSendFrom)
                const returnedAmount: number = CashuUtils.getProofsAmount(keep)
                const swapFeePaid = proofsToSendFromAmount - amountToSend - returnedAmount

                log.debug('[WalletStore.send] Amounts after swap', {proofsToSendFromAmount, amountToSend, returnedAmount, swapFeePaid})

                return {
                    returnedProofs: keep as CashuProof[],
                    proofsToSend: send as CashuProof[],
                    swapFeePaid
                }

            } catch (e: any) {
              if(!e.message.toLowerCase().includes('timeout') &&
                 !e.message.toLowerCase().includes('network request failed')) {
                // remove in-flight request only if it was not a timeout or network error
                Database.removeInFlightRequest(transactionId)
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
                        code: e.code || undefined,                   
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

                // Proofs carry both `secret` and `id`, satisfying the v5-compatible
                // signature; the pre-4.5.1 `secret`-only overload is deprecated.
                const proofStatesArray: ProofState[] = yield cashuWallet.checkProofsStates(proofs)

                // Transform flat ProofState[] into the grouped structure the rest of
                // the code expects. cashu-ts returns states in input order (it batches
                // by 100 and re-indexes each batch by Y), so proofs[i] pairs with
                // proofStatesArray[i].
                const proofsByState: {[key in CheckStateEnum]: CashuProof[]} = {
                    SPENT: [],
                    PENDING: [],
                    UNSPENT: []
                }

                // proofStatesArray is returned in the same order as input proofs
                for (let i = 0; i < proofStatesArray.length; i++) {
                    const proofState = proofStatesArray[i]
                    const originalProof = proofs[i]

                    if (originalProof) {
                        proofsByState[proofState.state].push(originalProof as CashuProof)
                    }
                }

                log.trace('[WalletStore.getProofsStatesFromMint]', {mintUrl, proofsByState})

                return proofsByState

            } catch (e: any) {
                let message = 'Could not get response from the mint.'
                if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;

                // Heuristic: if the inner cashu-ts cause looks like a transport
                // failure, surface a NetworkError so callers (e.g. syncStateWithMintTask)
                // can mark the mint OFFLINE via `instanceof NetworkError`.
                const innerMessage: string = e?.message ?? ''
                const isNetwork = /network|fetch|timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(innerMessage)

                const params = {
                    message: innerMessage,
                    caller: 'WalletStore.getProofsStatesFromMint',
                    mintUrl,
                }

                throw isNetwork
                    ? new NetworkError(message, params)
                    : new MintError(message, params)
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
              const mintQuoteResponse: MintQuoteBolt11Response = yield cashuMint.createMintQuoteBolt11({
                  unit,
                  amount,
                  description
              })
          
              log.info('[WalletStore.createLightningMintQuote]', {mintQuoteResponse})
          
              return {
                  encodedInvoice: mintQuoteResponse.request,
                  mintQuote: mintQuoteResponse.quote,
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
              const quoteResponse: MintQuoteBolt11Response = yield cashuMint.checkMintQuoteBolt11(      
                  quote
              )
          
              log.info('[WalletStore.checkLightningMintQuote]', {quoteResponse})
          
              return {
                  encodedInvoice: quoteResponse.request,
                  mintQuote: quoteResponse.quote,
                  state: quoteResponse.state
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
        /**
         * Ask the mint for an onchain (NUT-30) mint quote.
         *
         * Note there is NO amount: the quote is a Bitcoin address that can receive
         * any number of deposits, so the mint has nothing to price. The `pubkey` is
         * mandatory — NUT-30 requires NUT-20 quote locking and the mint MUST reject
         * a quote request without one (error 20009).
         *
         * The full response is returned (not just the address): the caller has to
         * persist `quote`, and minting later needs the whole object, because
         * cashu-ts decides to sign from `quote.pubkey`.
         */
        createOnchainMintQuote: flow(function* createOnchainMintQuote(
            mintUrl: string,
            unit: MintUnit,
            pubkey: string,
        ) {
            try {
                const cashuMint: CashuMint = yield self.getMint(mintUrl)
                const quoteResponse: MintQuoteOnchainResponse =
                    yield cashuMint.createMintQuoteOnchain({unit, pubkey})

                log.info('[WalletStore.createOnchainMintQuote]', {
                    mintUrl,
                    quote: quoteResponse.quote,
                    address: quoteResponse.request,
                })

                return quoteResponse
            } catch (e: any) {
                let message = 'The mint could not return an onchain mint quote.'
                if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions
                throw new AppError(Err.MINT_ERROR, message, {
                    message: e.message,
                    caller: 'createOnchainMintQuote',
                    mintUrl,
                })
            }
        }),
        /** Current state of an onchain mint quote: amount_paid / amount_issued. */
        checkOnchainMintQuote: flow(function* checkOnchainMintQuote(
            mintUrl: string,
            quote: string,
        ) {
            try {
                const cashuMint: CashuMint = yield self.getMint(mintUrl)
                const quoteResponse: MintQuoteOnchainResponse =
                    yield cashuMint.checkMintQuoteOnchain(quote)

                return quoteResponse
            } catch (e: any) {
                let message = 'The mint could not return the onchain mint quote state.'
                if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions
                throw new AppError(Err.MINT_ERROR, message, {
                    message: e.message,
                    caller: 'checkOnchainMintQuote',
                    mintUrl,
                    quote,
                })
            }
        }),
        /**
         * Mint ecash against a confirmed onchain deposit.
         *
         * Mirrors `mintProofs`: same counter discipline, same NUT-19 in-flight record,
         * same error surface.
         *
         * `quote` is the whole MintQuoteOnchainResponse, not an id — cashu-ts signs the
         * request (NUT-20) when the quote carries a `pubkey`, and it reads that off the
         * quote object. `privkey` is derived on demand from the seed and the quote's
         * stored counterIndex; it is never persisted.
         */
        mintOnchainProofs: flow(function* mintOnchainProofs(
            mintUrl: string,
            amount: number,
            unit: MintUnit,
            quoteResponse: MintQuoteOnchainResponse,
            privkey: string,
            transactionId: number,
            options?: {
                increaseCounterBy?: number
                inFlightRequest?: InFlightRequest<MintParams>
            },
        ) {
            const mintInstance = self.getMintModelInstance(mintUrl)

            if (!mintInstance) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mint instance', {mintUrl})
            }

            const cashuWallet: CashuWallet = yield self.getWallet(mintUrl, unit, {withSeed: true})

            const currentCounter = mintInstance.getProofsCounterByKeysetId!(cashuWallet.keysetId)

            // outputs error healing
            if (options?.increaseCounterBy) {
                currentCounter.increaseProofsCounter(options.increaseCounterBy)
            }

            yield cashuWallet.counters.advanceToAtLeast(
                cashuWallet.keysetId,
                currentCounter.counter,
            )

            const mintParams: MintParams = options?.inFlightRequest?.request || {
                amount,
                quote: quoteResponse.quote,
                options: {keysetId: cashuWallet.keysetId},
            }

            // Record the request BEFORE sending it. If the response is lost (network
            // drop), the mint has already incremented amount_issued — the quote then
            // looks drained and the ecash would be stranded. Replaying the identical
            // request hits the mint's NUT-19 cache and returns the same signatures.
            // Identical outputs depend on the counter NOT having advanced, which holds:
            // onCountersReserved never fired, so we never wrote it back.
            // @ts-ignore
            if (cashuWallet.getMintInfo().nuts['19'] && !options?.inFlightRequest) {
                Database.addInFlightRequest(transactionId, mintParams)
            }

            let reservedCounters: OperationCounters | undefined

            try {
                const proofs = yield cashuWallet.mintProofsOnchain(
                    mintParams.amount,
                    quoteResponse,
                    privkey,
                    {
                        keysetId: mintParams.options?.keysetId,
                        onCountersReserved: (info: OperationCounters) => {
                            reservedCounters = info
                            log.debug('[mintOnchainProofs] Counters reserved', info)
                        },
                    },
                )

                Database.removeInFlightRequest(transactionId)

                if (reservedCounters) {
                    currentCounter.setProofsCounter(reservedCounters.next)
                }

                log.debug('[WalletStore.mintOnchainProofs]', {
                    amount: mintParams.amount,
                    quote: quoteResponse.quote,
                    proofs: proofs.length,
                })

                return proofs
            } catch (e: any) {
                // Keep the in-flight record on timeout / network failure — those are
                // exactly the cases where the mint may have processed the request and
                // we simply did not hear back. Any other error means it did not.
                if (
                    !e.message.toLowerCase().includes('timeout') &&
                    !e.message.toLowerCase().includes('network request failed')
                ) {
                    Database.removeInFlightRequest(transactionId)
                }

                let message = 'Error on request to mint new ecash from an onchain deposit.'
                if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions
                throw new AppError(Err.MINT_ERROR, message, {
                    message: e.message,
                    caller: 'mintOnchainProofs',
                    mintUrl,
                    quote: quoteResponse.quote,
                })
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

            const cashuWallet: CashuWallet = yield self.getWallet(
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

            // Sync wallet's internal counter with our stored counter (v3.x)
            yield cashuWallet.counters.advanceToAtLeast(cashuWallet.keysetId, currentCounter.counter)

            const mintParams: MintParams = options?.inFlightRequest?.request || {
                amount,
                quote: mintQuote,
                options: {
                    keysetId: cashuWallet.keysetId
                    // Note: counter is no longer passed in v3.x, wallet manages it internally
                }
            }

            // @ts-ignore
            if(cashuWallet.getMintInfo().nuts['19'] && !options?.inFlightRequest) {
                Database.addInFlightRequest(transactionId, mintParams)
            }

            let reservedCounters: OperationCounters | undefined

            try {

                const proofs = yield cashuWallet.mintProofsBolt11(
                    mintParams.amount,
                    mintParams.quote,
                    {
                        keysetId: mintParams.options?.keysetId,
                        onCountersReserved: (info: OperationCounters) => {
                            reservedCounters = info
                            log.debug('[cashuWallet.mintProofsBolt11] Counters reserved', info)
                        }
                    }
                )

                Database.removeInFlightRequest(transactionId)

                // Update our counter to match what the wallet used (v3.x)
                if (reservedCounters) {
                    currentCounter.setProofsCounter(reservedCounters.next)
                    log.debug('[WalletStore.mintProofs] Updated counter', {
                        keysetId: reservedCounters.keysetId,
                        start: reservedCounters.start,
                        count: reservedCounters.count,
                        next: reservedCounters.next
                    })
                }

                log.debug('[WalletStore.mintProofs]', {amount: mintParams.amount, quote: mintParams.quote, proofs})

                return proofs
        
            } catch (e: any) {
                if(!e.message.toLowerCase().includes('timeout') &&
                   !e.message.toLowerCase().includes('network request failed')) {
                  // remove in-flight request only if it was not a timeout or network error
                  Database.removeInFlightRequest(transactionId)
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
            const cashuMint: CashuMint = yield self.getMint(mintUrl)
            const lightningQuote: MeltQuoteBolt11Response = yield cashuMint.createMeltQuoteBolt11({ 
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
            meltQuote: MeltQuoteBolt11Response,  // invoice is stored by mint by quote
            proofsToMeltFrom: Proof[],
            transactionId: number,
            options?: {
              increaseCounterBy?: number,
              inFlightRequest?: InFlightRequest<MeltParams>,
              preferAsync?: boolean,
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

            // Sync wallet's internal counter with our stored counter (v3.x)
            yield cashuWallet.counters.advanceToAtLeast(cashuWallet.keysetId, currentCounter.counter)

            log.trace('[WalletStore.payLightningMelt] Preparing melt', {
                localCounter: currentCounter.counter,
                proofsCount: proofsToMeltFrom.length
            })

            let reservedCounters: OperationCounters | undefined

            // Step 1: Prepare the melt (creates change outputs deterministically)
            const meltPreview: MeltPreview = yield cashuWallet.prepareMelt(
                'bolt11',
                meltQuote,
                CashuUtils.exportProofs(proofsToMeltFrom),
                {
                    keysetId: cashuWallet.keysetId,
                    onCountersReserved: (info: OperationCounters) => {
                        reservedCounters = info
                        log.debug('[prepareMelt] Counters reserved', info)
                    }
                }
            )

            // Store the MeltPreview for potential recovery. Synchronous SQLite
            // write BEFORE completeMelt, so the change can always be recovered
            // even if the app dies right after the payment is submitted.
            Database.addMeltRecovery(
                transactionId,
                CashuUtils.serializeMeltPreview(meltPreview),
            )

            // Update our counter to match what the wallet used (v3.x)
            if (reservedCounters) {
                currentCounter.setProofsCounter(reservedCounters.next)
                log.debug('[prepareMelt] Updated counter', {
                    keysetId: reservedCounters.keysetId,
                    start: reservedCounters.start,
                    count: reservedCounters.count,
                    next: reservedCounters.next
                })
            }

            try {
                // Step 2: Complete the melt (sends to mint and constructs change proofs)
                const meltResponse: MeltProofsResponse = yield cashuWallet.completeMelt(meltPreview, undefined, options?.preferAsync)

                // Keep the preview for PENDING async melts — handlePendingMeltTask needs it to unbind change later
                if (meltResponse.quote.state !== MeltQuoteState.PENDING) {
                    Database.removeMeltRecovery(transactionId)
                }

                log.trace('[payLightningMelt]', {meltResponse})
                return meltResponse

            } catch (e: any) {
                if(!e.message.toLowerCase().includes('timeout') &&
                   !e.message.toLowerCase().includes('network request failed')) {
                  // remove only if it was not a timeout or network error
                  Database.removeMeltRecovery(transactionId)
                }   

                let message = 'Lightning payment failed.'
                if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
                throw new AppError(
                    Err.MINT_ERROR,
                    message,
                    {
                        message: e.message,
                        caller: 'payLightningMelt',
                        mintUrl,
                        code: e.code || undefined,
                    }
                )
            }
        }),
        checkLightningMeltQuote: flow(function* checkLightningMeltQuote(  
          mintUrl: string,
          quote: string,  
        ) {
          try {
            const cashuMint: CashuMint = yield self.getMint(mintUrl)
            const quoteResponse: MeltQuoteBolt11Response = yield cashuMint.checkMeltQuoteBolt11(      
                quote
            )
        
            log.info('[checkLightningMeltQuote]', {quoteResponse})
        
            return quoteResponse

          } catch (e: any) {
            let message = 'The mint could not return the state of a melt quote.'
            if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
            throw new AppError(
                Err.MINT_ERROR,
                message,
                {
                    message: e.message,
                    caller: 'checkLightningMeltQuote',
                    mintUrl,
                }
            )
          }
        }),
        /**
         * Ask the mint what it would charge to send `amount` to a Bitcoin address (NUT-30).
         *
         * Unlike bolt11 the amount is not carried by the payment request, so this cannot be
         * called until the user has entered one. The quote comes back with a list of
         * `fee_options` tiers rather than a single `fee_reserve`; they are fixed for the
         * quote's lifetime, and the caller picks one at execute time.
         */
        createOnchainMeltQuote: flow(function* createOnchainMeltQuote(
            mintUrl: string,
            unit: MintUnit,
            address: string,
            amount: number,
        ) {
            try {
                const cashuMint: CashuMint = yield self.getMint(mintUrl)
                const onchainQuote: MeltQuoteOnchainResponse = yield cashuMint.createMeltQuoteOnchain({
                    unit,
                    request: address,
                    amount,
                })

                log.info('[createOnchainMeltQuote]', {mintUrl, unit, amount}, {onchainQuote})

                return onchainQuote

            } catch (e: any) {
                let message = 'The mint could not return the onchain melt quote.'
                if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
                throw new AppError(
                    Err.MINT_ERROR,
                    message,
                    {
                        message: e.message,
                        caller: 'createOnchainMeltQuote',
                        request: {mintUrl, unit, address, amount},
                    }
                )
            }
        }),
        /**
         * Execute an onchain melt (NUT-30).
         *
         * Deliberately the same two-step shape as `payLightningMelt`, because the reason for
         * the split is the same: `prepareMelt` derives the NUT-08 change outputs from the
         * keyset counter, and if the app dies between submitting the melt and receiving the
         * response, the ONLY way to reconstruct that change is the meltPreview we wrote to
         * SQLite before submitting. cashu-ts' one-shot `meltProofsOnchain` hides the split and
         * would leave nothing to recover from.
         *
         * Two things differ from bolt11:
         *  - `fee_index` rides along as `extraPayload` on the melt request. It is not part of
         *    the quote and not part of prepare; the mint locks it into `selected_fee_index`
         *    when it executes, and MUST NOT execute the same quote again with a different one.
         *  - No `preferAsync`. NUT-30 mandates asynchrony ("The mint MUST return a PENDING
         *    state after validating the melt request and then broadcast in the background"),
         *    so there is no faster path to ask for.
         */
        payOnchainMelt: flow(function* payOnchainMelt(
            mintUrl: string,
            unit: MintUnit,
            meltQuote: MeltQuoteOnchainResponse,
            proofsToMeltFrom: Proof[],
            feeIndex: number,
            transactionId: number,
            options?: {
                increaseCounterBy?: number,
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

            yield cashuWallet.counters.advanceToAtLeast(cashuWallet.keysetId, currentCounter.counter)

            log.trace('[WalletStore.payOnchainMelt] Preparing melt', {
                localCounter: currentCounter.counter,
                proofsCount: proofsToMeltFrom.length,
                feeIndex,
            })

            let reservedCounters: OperationCounters | undefined

            // Step 1: prepare (derives the deterministic change outputs)
            const meltPreview: MeltPreview<MeltQuoteOnchainResponse> = yield cashuWallet.prepareMelt(
                'onchain',
                meltQuote,
                CashuUtils.exportProofs(proofsToMeltFrom),
                {
                    keysetId: cashuWallet.keysetId,
                    onCountersReserved: (info: OperationCounters) => {
                        reservedCounters = info
                        log.debug('[payOnchainMelt] Counters reserved', info)
                    }
                }
            )

            // Synchronous SQLite write BEFORE the melt is submitted, so the change is
            // recoverable even if the app dies the moment after.
            Database.addMeltRecovery(
                transactionId,
                CashuUtils.serializeMeltPreview(meltPreview),
            )

            if (reservedCounters) {
                currentCounter.setProofsCounter(reservedCounters.next)
                log.debug('[payOnchainMelt] Updated counter', {
                    keysetId: reservedCounters.keysetId,
                    start: reservedCounters.start,
                    count: reservedCounters.count,
                    next: reservedCounters.next
                })
            }

            try {
                // Step 2: submit. fee_index is the onchain-specific part of the request body.
                const meltResponse: MeltProofsResponse<MeltQuoteOnchainResponse> =
                    yield cashuWallet.completeMelt(meltPreview, undefined, {
                        extraPayload: {fee_index: feeIndex},
                    })

                // The mint answers PENDING (spec-mandated) but MAY already have returned the
                // change, because it knows its actual fee the moment it builds the transaction.
                // Keep the preview only while there is still change left to reconstruct later.
                if (meltResponse.change.length > 0) {
                    Database.removeMeltRecovery(transactionId)
                }

                log.trace('[payOnchainMelt]', {meltResponse})
                return meltResponse

            } catch (e: any) {
                if(!e.message.toLowerCase().includes('timeout') &&
                   !e.message.toLowerCase().includes('network request failed')) {
                    Database.removeMeltRecovery(transactionId)
                }

                let message = 'Onchain payment failed.'
                if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
                throw new AppError(
                    Err.MINT_ERROR,
                    message,
                    {
                        message: e.message,
                        caller: 'payOnchainMelt',
                        mintUrl,
                        code: e.code || undefined,
                    }
                )
            }
        }),
        /**
         * Current state of an onchain melt quote.
         *
         * This — not the state of the input proofs — is what says whether an onchain payment
         * has settled. The mint spending the inputs means it BROADCAST, not that the
         * transaction confirmed. Only `PAID` means confirmed.
         */
        checkOnchainMeltQuote: flow(function* checkOnchainMeltQuote(
            mintUrl: string,
            quote: string,
        ) {
            try {
                const cashuMint: CashuMint = yield self.getMint(mintUrl)
                const quoteResponse: MeltQuoteOnchainResponse = yield cashuMint.checkMeltQuoteOnchain(
                    quote
                )

                log.info('[checkOnchainMeltQuote]', {quoteResponse})

                return quoteResponse

            } catch (e: any) {
                let message = 'The mint could not return the state of an onchain melt quote.'
                if (isOnionMint(mintUrl)) message += TorVPNSetupInstructions;
                throw new AppError(
                    Err.MINT_ERROR,
                    message,
                    {
                        message: e.message,
                        caller: 'checkOnchainMeltQuote',
                        mintUrl,
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
            unit: MintUnit
            }
        ) {
            try {
              // PERF: Start restore timing
              const perfTotal = performance.now()
              log.info('[PERF][WalletStore.restore] ====== START ======')

              log.trace('[restore]', {mintUrl, options})
              const {indexFrom, indexTo, keysetId, unit} = options

              // PERF: Time wallet creation
              const perfWalletCreate = performance.now()

              // Create separate CashuMint and CashuWallet instances for restore operation
              // to avoid polluting the main wallet state with inactive keyset data.
              // cashu-ts 3.4.1+ supports restore from inactive keysets natively.
              const cashuMint = new CashuMint(mintUrl)
              const cashuWallet = new CashuWallet(cashuMint, {
                unit,
                keysetId,
                bip39seed: seed
              })

              yield cashuWallet.loadMint()

              log.info('[PERF][WalletStore.restore] CashuWallet created:', { ms: (performance.now() - perfWalletCreate).toFixed(2) })

              const count = Math.abs(indexTo - indexFrom)
              log.info('[PERF][WalletStore.restore] About to restore', { indexFrom, count, keysetId })

              // PERF: Time the actual restore call (this is the main operation)
              const perfRestore = performance.now()
              const {proofs} = yield cashuWallet.restore(
                  indexFrom,
                  count,
                  {keysetId}
              )
              log.info('[PERF][WalletStore.restore] seedWallet.restore() (cashu-ts):', { ms: (performance.now() - perfRestore).toFixed(2), proofsFound: proofs.length })

              log.info('[PERF][WalletStore.restore] ====== END ======')
              log.info('[PERF][WalletStore.restore] Total:', { ms: (performance.now() - perfTotal).toFixed(2) })

              log.info('[restore]', 'Number of recovered proofs', {proofs: proofs.length})

              return {
                  proofs: proofs || [] as Proof[]
              }
            } catch (e: any) {
                throw new AppError(Err.MINT_ERROR, CashuUtils.isObj(e.message) ? JSON.stringify(e.message) : e.message, {mintUrl})
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