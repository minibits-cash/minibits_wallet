import {log} from '../logService'
import {
  Transaction,
  TransactionData,  
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuUtils, ProofV3, TokenEntryV3} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {    
    MintKeyset,
} from '@cashu/cashu-ts'
import { getDefaultAmountPreference } from '@cashu/cashu-ts/src/utils'
import { MAX_SWAP_INPUT_SIZE, TransactionTaskResult, WalletTask } from '../walletService'
import { Mint, MintBalance, MintProofsCounter } from '../../models/Mint'
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

// const {walletStore} = nonPersistedStores

export const sendTask = async function (
    mintBalanceToSendFrom: MintBalance,
    amountToSend: number,
    unit: MintUnit,
    memo: string,
    selectedProofs: Proof[]
) : Promise<TransactionTaskResult> {

    const mintUrl = mintBalanceToSendFrom.mintUrl

    log.trace('[send]', 'mintBalanceToSendFrom', mintBalanceToSendFrom)
    log.trace('[send]', 'amountToSend', {amountToSend, unit})    
    log.trace('[send]', 'memo', memo)

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            mintBalanceToSendFrom,
            createdAt: new Date(),
        }
    ]
    
    let transaction: Transaction | undefined = undefined

    try {
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

        // get proofs to send
        const {
            proofs: proofsToSend, 
            swapFeePaid, 
            swapFeeReserve, 
            isSwapNeeded,
            counter
        } = await sendFromMintSync(
            mintBalanceToSendFrom,
            amountToSend,
            unit,
            selectedProofs,
            transaction.id,
        )

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            swapFeeReserve,
            swapFeePaid,
            isSwapNeeded,
            createdAt: new Date(),
        })

        transaction.setStatus(        
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )

        // Create sendable encoded tokenV3
        const tokenEntryToSend = {
            mint: mintUrl,
            proofs: proofsToSend,
        }

        if (!memo || memo === '') {
            memo = 'Sent from Minibits'
        }

        const outputToken = CashuUtils.encodeToken({
            token: [tokenEntryToSend as TokenEntryV3],
            unit,
            memo,
        })

        transaction.setOutputToken(outputToken)
        
        transactionData.push({
            status: TransactionStatus.PENDING,
            counter,           
            createdAt: new Date(),
        })

        transaction.setStatus(            
            TransactionStatus.PENDING,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        transaction.setBalanceAfter(balanceAfter)
        
        if(swapFeePaid > 0) {
            transaction.setFee(swapFeePaid)
        }

        log.trace('[send] totalBalance after', balanceAfter)

        // Start polling for accepted payment it is not an offline send
        if(selectedProofs.length === 0) {

            const proofsToSync = proofsStore.getByMint(mintUrl, {isPending: true})

            poller(
                `syncStateWithMintPoller-${mintUrl}`,
                WalletTask.syncStateWithMint,
                {
                    interval: 6 * 1000,
                    maxPolls: 3,
                    maxErrors: 2
                },
                {proofsToSync, mintUrl, isPending: true}
            )
            .then(() => log.trace('[syncStateWithMintPoller]', 'polling completed', {mintUrl}))  
        }      
      

        return {
            taskFunction: 'sendTask',
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

            transaction.setStatus(                
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }        

        return {
            taskFunction: 'sendTask',
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
) {
    const mintUrl = mintBalance.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)
    let lockedProofsCounter: MintProofsCounter | undefined = undefined
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
        let proofsToSend: ProofV3[] | Proof[] = []
        let returnedProofs: ProofV3[] = []

        let isSwapNeeded: boolean = proofsToSendFromAmount - amountToSend > 0 ? true : false        

        log.trace('[sendFromMintSync]', {proofsToSendFromAmount, amountToSend})
        /* 
         *  SWAP is needed, could involve a fee
         *  we could not find the denominations to match exact amount        
         */
        if(isSwapNeeded) {
            // Calculate feeReserve from mint fee rate
            swapFeeReserve = mintInstance.getMintFeeReserve(proofsToSendFrom)
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

            // Output denominations we ask for to get back
            const amountPreferences = getDefaultAmountPreference(amountToSend)
            // Output denominations we are about to get as a split remainder
            const returnedAmountPreferences = getDefaultAmountPreference(returnedAmount)

            const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences) + 
                CashuUtils.getAmountPreferencesCount(returnedAmountPreferences)
            
            log.trace('[sendFromMintSync]', 'countOfInFlightProofs', countOfInFlightProofs)    

            // Increase the proofs counter before the mint call so that in case the response
            // is not received our recovery index counts for sigs the mint has already issued (prevents duplicate b_b bug)            
            // Warning/TBD: if proofs from inactive keysets are in proofsToSendFrom, this still locks only the active keyset
            lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
                mintInstance, 
                unit, 
                countOfInFlightProofs, 
                transactionId
            )
            
            const sendResult = await walletStore.send(
                mintUrl,
                amountToSend,
                swapFeeReserve,
                unit,            
                proofsToSendFrom,
                {              
                    preference: amountPreferences,                    
                    counter: lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
                }
            )

            returnedProofs = sendResult.returnedProofs
            proofsToSend = sendResult.proofsToSend
            swapFeePaid = sendResult.swapFeePaid

            // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
            lockedProofsCounter.decreaseProofsCounter(countOfInFlightProofs) 

            // add proofs returned by the mint after the split
            log.trace('[sendFromMintSync] add returned proofs to spendable')

            WalletUtils.addCashuProofs(
                mintUrl,
                returnedProofs,
                {
                    unit,
                    transactionId,
                    isPending: false
                }
            )                
            // release lock
            lockedProofsCounter.resetInFlight(transactionId)
            
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

            proofsToSend = [...proofsToSendFrom] // copy         
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

        // Clean private properties to not to send them out. This returns plain js array, not model objects.
        const cleanedProofsToSend: ProofV3[] = proofsToSend.map(proof => {
            if (isStateTreeNode(proof)) {
                const {mintUrl, unit, tId, ...rest} = getSnapshot(proof)
                return rest
            } else {
                const {mintUrl, unit, tId, ...rest} = proof as Proof
                return rest
            }
        })        
        
        // We return cleaned proofs to be encoded as a sendable token + fees
        return {
            proofs: cleanedProofsToSend,
            swapFeeReserve, 
            swapFeePaid,
            isSwapNeeded,
            counter: lockedProofsCounter?.counter
        }
  } catch (e: any) {
        // release lock
        if(lockedProofsCounter) {
            lockedProofsCounter.resetInFlight(transactionId)
        }
        
        // try to clean spent proofs if that was the swap error cause
        if (e.params && e.params.message && e.params.message.includes('Token already spent')) {
            await WalletTask.syncStateWithMintSync(                
                {
                    proofsToSync: proofsToSendFrom,
                    mintUrl,
                    isPending: false
                }                
            )
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