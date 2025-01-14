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
    MintKeyset,
    getEncodedToken,
} from '@cashu/cashu-ts'
import { DEFAULT_DENOMINATION_TARGET, MAX_SWAP_INPUT_SIZE, TransactionTaskResult, WalletTask } from '../walletService'
import { Mint, MintBalance, MintProofsCounter } from '../../models/Mint'
import { Proof } from '../../models/Proof'
import { poller } from '../../utils/poller'
import { WalletUtils } from './utils'
import { getSnapshot, isStateTreeNode } from 'mobx-state-tree'
import { MintUnit } from './currency'
import { getKeepAmounts } from '@cashu/cashu-ts/src/utils'

const {
    mintsStore,
    proofsStore,
    transactionsStore,    
    walletStore
} = rootStoreInstance

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

        transaction.setOutputToken(outputToken)
        
        transactionData.push({
            status: TransactionStatus.PENDING,                      
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
                    maxPolls: 5,
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

        let isSwapNeeded: boolean = proofsToSendFromAmount - amountToSend > 0 ? true : false        

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
            
            const sendResult = await walletStore.send(
                mintUrl,
                amountToSend,                
                unit,            
                proofsToSendFrom,
                transactionId
            )

            returnedProofs = sendResult.returnedProofs
            proofsToSend = sendResult.proofsToSend
            swapFeePaid = sendResult.swapFeePaid
            
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
        const cleanedProofsToSend: CashuProof[] = proofsToSend.map(proof => {
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
            isSwapNeeded            
        }
  } catch (e: any) {
        // try to clean spent proofs if that was the swap error cause
        if (e.params && e.params.message && e.params.message.includes('Token already spent')) {

            log.error('[sendFromMintSync] Going to clean spent proofs from pending', {transactionId})

            await WalletTask.syncStateWithMintSync({
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