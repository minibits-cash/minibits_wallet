import {log} from '../logService'
import {
  Transaction,
  TransactionData,  
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuUtils, CashuProof} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {    
    CashuMint,
    CashuWallet,
    CheckStateEnum,
    MintKeyset,
    ProofState,
    getEncodedToken,
} from '@cashu/cashu-ts'
import { MAX_SWAP_INPUT_SIZE, TransactionTaskResult, WalletTask } from '../walletService'
import { Mint, MintBalance } from '../../models/Mint'
import { Proof } from '../../models/Proof'
import { poller } from '../../utils/poller'
import { WalletUtils } from './utils'
import { getSnapshot, isStateTreeNode } from 'mobx-state-tree'
import { MintUnit } from './currency'

const {
    mintsStore,
    proofsStore,
    transactionsStore,    
    walletStore
} = rootStoreInstance

export const SEND_TASK = 'sendTask'

export const sendTask = async function (
    mintBalanceToSendFrom: MintBalance,
    amountToSend: number,
    unit: MintUnit,
    memo: string,
    selectedProofs: Proof[],
    p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> },
    draftTransactionId?: number | null
) : Promise<TransactionTaskResult> {

    const mintUrl = mintBalanceToSendFrom.mintUrl

    log.trace('[sendTask]', 'mintBalanceToSendFrom', mintBalanceToSendFrom)
    log.trace('[sendTask]', 'amountToSend', {amountToSend, unit}) 
    
    if(amountToSend <= 0) {
        throw new AppError(Err.VALIDATION_ERROR, 'Amount to send must be above zero.')
    }

    let transaction: Transaction | undefined = undefined
    let transactionData: TransactionData[] = []

    try {
        if(draftTransactionId && draftTransactionId > 0) {
            transaction = transactionsStore.findById(draftTransactionId)!
        } else {
            // create draft transaction
            transactionData.push({
                status: TransactionStatus.DRAFT,
                mintBalanceToSendFrom,
                createdAt: new Date(),
            })
            
            const newTransaction = {
                type: TransactionType.SEND,
                amount: amountToSend,
                fee: 0,
                unit,
                data: JSON.stringify(transactionData),
                memo,
                mint: mintUrl,
                status: TransactionStatus.DRAFT,
            }

            // store tx in db and in the model
            transaction = await transactionsStore.addTransaction(newTransaction)
        }   


        // get proofs to send
        const {
            proofs: proofsToSend, 
            swapFeePaid, 
            swapFeeReserve, 
            isSwapNeeded,            
        } = await sendFromMintSync(
            mintBalanceToSendFrom,
            amountToSend,
            unit,
            selectedProofs,
            transaction.id,
            p2pk
        )

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            swapFeeReserve,
            swapFeePaid,
            isSwapNeeded,
            createdAt: new Date(),
        })

        // Create sendable encoded token
        if (!memo || memo === '') {
            memo = 'Sent from Minibits'
        }

        const outputToken = getEncodedToken({
            mint: mintUrl,
            proofs: proofsToSend,
            unit,
            memo,
        })

        transaction.update({
            status: TransactionStatus.PREPARED,
            data: JSON.stringify(transactionData),
            outputToken
        })
        
        transactionData.push({
            status: TransactionStatus.PENDING,                      
            createdAt: new Date(),
        })

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        
        transaction.update({
            status: TransactionStatus.PENDING,
            data: JSON.stringify(transactionData),
            balanceAfter,
            ...(swapFeePaid > 0 && {fee: swapFeePaid})
        })

        log.trace('[send] totalBalance after', balanceAfter)

        // Start polling for accepted payment it is not an offline send
        if(selectedProofs.length === 0) {

            const proofsToSync = proofsStore.getByMint(mintUrl, {isPending: true})
            
            const wsMint = new CashuMint(mintUrl)
            const wsWallet = new CashuWallet(wsMint)
            
            try {
                const unsub = await wsWallet.onProofStateUpdates(
                    [proofsToSend[0]],
                    async (proofState: ProofState) => {
                        log.trace(`Websocket: proof state updated: ${proofState.state}`)
                        
                        if (proofState.state == CheckStateEnum.SPENT) {
                            WalletTask.syncStateWithMintQueue({proofsToSync, mintUrl, isPending: true})
                            unsub()
                        }
                    },
                    async (error: any) => {
                        throw error
                    }
                )
            } catch (error: any) {
                log.error(Err.NETWORK_ERROR,
                    "Error in websocket subscription. Starting poller.",
                    error.message
                )

                poller(
                    `syncStateWithMintPoller-${mintUrl}`,
                    WalletTask.syncStateWithMintQueue,
                    {
                        interval: 10 * 1000,
                        maxPolls: 3,
                        maxErrors: 1
                    },
                    {proofsToSync, mintUrl, isPending: true}
                )
                .then(() => log.trace('[syncStateWithMintPoller]', 'polling completed', {mintUrl}))
            }    
        }

        return {
            taskFunction: SEND_TASK,
            mintUrl,
            transaction,
            message: '',
            encodedTokenToSend: outputToken,
            swapFeePaid
        } as TransactionTaskResult

    } catch (e: any) {
        if (transaction) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
                createdAt: new Date()
            })

            transaction.update({
                status: TransactionStatus.ERROR,
                data: JSON.stringify(transactionData)
            })
        }        

        return {
            taskFunction: SEND_TASK,
            mintUrl,
            transaction,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}



export const sendFromMintSync = async function (
    mintBalance: MintBalance,
    amountToSend: number,
    unit: MintUnit,
    selectedProofs: Proof[],
    transactionId: number,
    p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> }
) {
    const mintUrl = mintBalance.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)    
    let proofsToSendFrom: Proof[] = []   
    
    try {
        if (!mintInstance) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find mint', {mintUrl, transactionId}
            )
        }        
             
        const proofsFromMint = proofsStore.getByMint(mintUrl, {isPending: false, unit})       
        
        log.debug('[sendFromMintSync]', {
            proofsFromMintCount: proofsFromMint.length,
            mintBalance: mintBalance.balances[unit], 
            amountToSend, 
            transactionId,
            unit
        })

        const totalAmountFromMint = CashuUtils.getProofsAmount(proofsFromMint)

        if (totalAmountFromMint < amountToSend) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'There is not enough funds to send this amount.',
                {totalAmountFromMint, amountToSend, transactionId, caller: 'sendFromMintSync'},
            )
        }

        /* 
         * OFFLINE SEND
         * if we have selected ecash to send in offline mode, we do not interact with the mint        
         */

        const selectedProofsAmount = CashuUtils.getProofsAmount(selectedProofs)

        if(selectedProofsAmount > 0) {            
            if(amountToSend !== selectedProofsAmount) { // failsafe for some unknown ecash selection UX error
                throw new AppError(
                    Err.VALIDATION_ERROR, 
                    'Requested amount to send does not equal sum of ecash denominations provided.',
                    {transactionId}
                )
            }

            if(selectedProofs.length > MAX_SWAP_INPUT_SIZE) {
                throw new AppError(
                    Err.VALIDATION_ERROR, 
                    `Number of proofs is above max of ${MAX_SWAP_INPUT_SIZE}. Visit Settings > Backup to optimize, then try again.`,
                    {transactionId}
                )
            }

            // move sent proofs to pending and add tx references
            proofsStore.removeProofs(selectedProofs)            
            WalletUtils.addCashuProofs(
                mintUrl, 
                selectedProofs, 
                {
                    unit,
                    transactionId: transactionId,
                    isPending: true
                }                
            )

            // Clean private properties to not to send them out. This returns plain js array, not model objects.
            const cleanedProofsToSend = selectedProofs.map(proof => {                
                const {mintUrl, unit, tId, ...rest} = getSnapshot(proof)
                return rest                
            })

            // We return cleaned proofs to be encoded as a sendable token
            return {
                proofs: cleanedProofsToSend, 
                swapFeeReserve: 0, 
                swapFeePaid: 0
            }
        }
        
        /* 
         *  SWAP or DIRECT SEND 
         *  if we did not selected ecash but amount and we might need a swap of ecash by the mint to match exact amount        
         */

        // Prioritize send from inactive keysets        
        const inactiveKeysetIds = getInactiveKeysetIds(mintInstance)   
        const activeKeysetIds = getActiveKeysetIds(mintInstance)
        
        log.trace('[sendFromMintSync]', {inactiveKeysetIds, activeKeysetIds})
        
        if(inactiveKeysetIds.length > 0) {
            proofsToSendFrom = prioritizeFromInactiveKeysets(
                mintInstance,
                amountToSend,
                unit,
                proofsFromMint
            )
        }  else {
            proofsToSendFrom = CashuUtils.getProofsToSend(
                amountToSend,
                proofsFromMint
            )
        }

        let proofsToSendFromAmount = CashuUtils.getProofsAmount(proofsToSendFrom)
        let swapFeeReserve: number = 0
        let returnedAmount = 0
        let swapFeePaid: number = 0
        let proofsToSend: CashuProof[] | Proof[] = []
        let returnedProofs: CashuProof[] = []
        let isSwapNeeded: boolean = false

        if((p2pk && p2pk.pubkey) || proofsToSendFromAmount - amountToSend > 0) {
            isSwapNeeded = true
        }      

        log.trace('[sendFromMintSync]', {proofsToSendFromAmount, amountToSend})
        /* 
         *  SWAP is needed, could involve a fee
         *  we could not find the denominations to match exact amount        
         */
        if(isSwapNeeded) {
            // Calculate feeReserve from mint fee rate
            const walletInstance = await walletStore.getWallet(mintUrl, unit, {withSeed: true})
            swapFeeReserve = walletInstance.getFeesForProofs(proofsToSendFrom)
            const amountWithFees = amountToSend + swapFeeReserve

            if (totalAmountFromMint < amountWithFees) {
                throw new AppError(
                    Err.VALIDATION_ERROR,
                    'There is not enough funds to send this amount.',
                    {totalAmountFromMint, amountWithFees, transactionId, caller: 'sendFromMintSync'},
                )
            }
            
            if(swapFeeReserve > 0) {
                // re-select proofs for higher amount
                proofsToSendFrom = CashuUtils.getProofsToSend(
                    amountWithFees,
                    proofsFromMint
                )

                proofsToSendFromAmount = CashuUtils.getProofsAmount(proofsToSendFrom)
            }

            // This is expected to get back from mint as a split remainder
            returnedAmount = proofsToSendFromAmount - (amountToSend + swapFeeReserve)

            log.debug('[sendFromMintSync] Swap is needed.', {
                proofsToSendFromAmount, 
                amountWithFees, 
                returnedAmount, 
                transactionId
            })

            let sendResult = {} as {
                returnedProofs: CashuProof[],
                proofsToSend: CashuProof[], 
                swapFeePaid: number
            }

            try {
                sendResult = await walletStore.send(
                    mintUrl,
                    amountToSend,                
                    unit,            
                    proofsToSendFrom,
                    transactionId,
                    {p2pk: p2pk && p2pk.pubkey ? p2pk : undefined}
                )
            } catch (e: any) {                
                if(e.params && (e.params.message.includes('outputs have already been signed before') || e.params.message.includes('duplicate key value violates unique constraint'))) {
                    log.error('[sendFromMintSync] Increasing proofsCounter outdated values and repeating send.')      
                    sendResult = await walletStore.send(
                        mintUrl,
                        amountToSend,                
                        unit,            
                        proofsToSendFrom,
                        transactionId,
                        {p2pk: p2pk && p2pk.pubkey ? p2pk : undefined, increaseCounterBy: 10}
                    )
                } else {
                    throw e
                }
            }

            returnedProofs = sendResult.returnedProofs
            proofsToSend = sendResult.proofsToSend
            swapFeePaid = sendResult.swapFeePaid
            
            // add proofs returned by the mint after the split
            log.trace('[sendFromMintSync] add returned proofs to spendable')
            
            if(returnedProofs.length > 0) {
                WalletUtils.addCashuProofs(
                    mintUrl,
                    returnedProofs,
                    {
                        unit,
                        transactionId,
                        isPending: false
                    }
                ) 
            }          
            
        } else {        
            // SWAP is NOT needed, we've found denominations that match exact amount
            log.debug('[sendFromMintSync] Swap is not necessary.', {transactionId})

            // If we selected whole balance, check if it is not above limit acceptable by wallet and mints.
            if(proofsToSendFrom.length > MAX_SWAP_INPUT_SIZE) {
                throw new AppError(
                    Err.VALIDATION_ERROR, 
                    `Number of proofs is above max limit of ${MAX_SWAP_INPUT_SIZE}. Visit Backup to optimize your wallet, then try again.`,
                    {transactionId}
                )
            }

            proofsToSend = CashuUtils.exportProofs(proofsToSendFrom)       
        }      

        // remove used proofs and move sent proofs to pending
        proofsStore.removeProofs(proofsToSendFrom)
        
        WalletUtils.addCashuProofs(            
            mintUrl,
            proofsToSend,
            {
                unit,
                transactionId,
                isPending: true
            }       
        )        

        
        // We return cleaned proofs to be encoded as a sendable token + fees
        return {
            proofs: proofsToSend,
            swapFeeReserve, 
            swapFeePaid,
            isSwapNeeded            
        }
  } catch (e: any) {
        // try to clean spent proofs if that was the swap error cause
        if (e.params && e.params.message && e.params.message.includes('Token already spent')) {

            log.error('[sendFromMintSync] Going to clean spent proofs from proofsToSendFrom and from pending', {transactionId})
            
            await WalletTask.syncStateWithMintTask({
                proofsToSync: proofsToSendFrom,
                mintUrl,
                isPending: true
            })            

            await WalletTask.syncStateWithMintTask({
                proofsToSync: proofsStore.getByMint(mintUrl, {isPending: true, unit}),
                mintUrl,
                isPending: true
            })
        }

        if (e instanceof AppError) {
            throw e
        } else {
            throw new AppError(Err.WALLET_ERROR, e.message, e.stack.slice(0, 200))
        }
  }
}


const prioritizeFromInactiveKeysets = function (
    mint: Mint,
    amountToSend: number,
    unit: MintUnit,
    proofsFromMint: Proof[]
) {
    let proofsToSendFrom: Proof[] = []
    const activeKeysetIds = getActiveKeysetIds(mint)
    const inactiveKeysetIds = getInactiveKeysetIds(mint)

    const proofsFromInactiveKeysets = proofsStore.getByMint(
        mint.mintUrl, {
            isPending: false, 
            unit, 
            keysetIds: inactiveKeysetIds
        }
    )

    const proofsFromActiveKeysets = proofsStore.getByMint(
        mint.mintUrl, {
            isPending: false, 
            unit, 
            keysetIds: activeKeysetIds
        }
    )            

    if(proofsFromInactiveKeysets && proofsFromInactiveKeysets.length > 0) {
        let proofsFromInactiveKeysetsAmount = CashuUtils.getProofsAmount(proofsFromInactiveKeysets)

        log.trace('[prioritizeFromInactiveKeysets]', {proofsFromInactiveKeysetsAmount})

        if(proofsFromInactiveKeysetsAmount >= amountToSend) {

            proofsToSendFrom = CashuUtils.getProofsToSend(
                amountToSend,
                proofsFromInactiveKeysets
            )

        } else {
            const remainingAmount = amountToSend - proofsFromInactiveKeysetsAmount
            const remainingProofs = CashuUtils.findMinExcess(remainingAmount, proofsFromActiveKeysets!)   

            proofsToSendFrom = CashuUtils.getProofsToSend(
                amountToSend,
                [...proofsFromInactiveKeysets, ...remainingProofs]
            )
        }
    } else {
        proofsToSendFrom = CashuUtils.getProofsToSend(
            amountToSend,
            proofsFromMint
        )
    }

    return proofsToSendFrom
}


const getActiveKeysetIds = function(mint: Mint) {
    
    if(mint.keysets) {
        return mint.keysets
        .filter((k: MintKeyset) => k.active === true)
        .map((k: MintKeyset) => k.id)
    }

    return []
}


const getInactiveKeysetIds = function(mint: Mint) {

    if(mint.keysets) {
        return mint.keysets
        .filter((k: MintKeyset) => k.active === false)
        .map((k: MintKeyset) => k.id)
    }
    
    return []   
}
