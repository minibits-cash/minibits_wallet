import {log} from '../logService'
import {
  Transaction,
  TransactionData,
  TransactionRecord,
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuUtils, ProofV3, TokenEntryV3} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {    
    MintKeyset,
} from '@cashu/cashu-ts'
import { getDefaultAmountPreference, isObj } from '@cashu/cashu-ts/src/utils'
import { TransactionTaskResult, WalletTask } from '../walletService'
import { MintBalance, MintProofsCounter } from '../../models/Mint'
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

    let transactionId: number = 0

    try {
        const newTransaction: Transaction = {
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
        const storedTransaction: TransactionRecord =
        await transactionsStore.addTransaction(newTransaction)
        transactionId = storedTransaction.id as number

        // get ready proofs to send and update proofs and pending proofs storage
        const {proofs: proofsToSend, mintFeePaid, mintFeeReserve} = await sendFromMint(
            mintBalanceToSendFrom,
            amountToSend,
            unit,
            selectedProofs,
            transactionId,
        )

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            mintFeeReserve,
            mintFeePaid,
            createdAt: new Date(),
        })

        await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )

        // Create sendable encoded token v3
        const tokenEntryToSend = {
            mint: mintUrl,
            proofs: proofsToSend,
        }

        if (!memo || memo === '') {
            memo = 'Sent from Minibits'
        }

        const encodedTokenToSend = CashuUtils.encodeToken({
            token: [tokenEntryToSend as TokenEntryV3],
            unit,
            memo,
        })

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PENDING,            
            encodedTokenToSend,
            createdAt: new Date(),
        })

        const pendingTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PENDING,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)
        
        if(mintFeePaid > 0) {
            await transactionsStore.updateFee(transactionId, mintFeePaid)
        }

        log.trace('[send] totalBalance after', balanceAfter)

        // Start polling for accepted payment is it is not offline send
        if(selectedProofs.length === 0) {
            poller(
                `handleSpentByMintPoller-${mintUrl}`,
                WalletTask.handleSpentByMint,
                {
                    interval: 6 * 1000,
                    maxPolls: 10,
                    maxErrors: 2
                },
                {mintUrl, isPending: true}
            )
            .then(() => log.trace('[handleSpentByMintPoller]', 'polling completed', {mintUrl}))  
        }      
      

        return {
            taskFunction: 'sendTask',
            mintUrl,
            transaction: pendingTransaction,
            message: '',
            encodedTokenToSend,
            mintFeePaid
        } as TransactionTaskResult
    } catch (e: any) {
        // Update transaction status if we have any
        let errorTransaction: TransactionRecord | undefined = undefined        

        if (transactionId > 0) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
                createdAt: new Date()
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }        

        return {
            taskFunction: 'sendTask',
            mintUrl,
            transaction: errorTransaction || undefined,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}



export const sendFromMint = async function (
    mintBalance: MintBalance,
    amountToSend: number,
    unit: MintUnit,
    selectedProofs: Proof[],
    transactionId: number,
) {
    const mintUrl = mintBalance.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)
    let lockedProofsCounter: MintProofsCounter | undefined = undefined
    
    try {
        if (!mintInstance) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find mint', {mintUrl}
            )
        }

        
             
        const proofsFromMint = proofsStore.getByMint(mintUrl, {isPending: false, unit}) as Proof[]        
        
        log.debug('[sendFromMint]', 'proofsFromMint count', {mintBalance: mintBalance.balances[unit], amountToSend})

        if (proofsFromMint.length < 1) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find ecash for the selected mint',
            )
        }

        const totalAmountFromMint = CashuUtils.getProofsAmount(proofsFromMint)

        if (totalAmountFromMint < amountToSend) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'There is not enough funds to send this amount',
                {totalAmountFromMint, amountToSend, caller: 'sendFromMint'},
            )
        }

        /* 
         * OFFLINE SEND
         * if we have selected ecash to send in offline mode, we do not interact with the mint        
         */

        const selectedProofsAmount = CashuUtils.getProofsAmount(selectedProofs)

        if(selectedProofsAmount > 0) {            
            if(amountToSend !== selectedProofsAmount) { // failsafe for some unknown ecash selection UX error
                throw new AppError(Err.VALIDATION_ERROR, 'Requested amount to send does not equal sum of ecash denominations provided.')
            }

            for (const proof of selectedProofs) {                
                proof.setTransactionId(transactionId) // update txId                
            }

            // move sent proofs to pending
            proofsStore.removeProofs(selectedProofs)
            proofsStore.addProofs(selectedProofs, true) // pending true

            // Clean private properties to not to send them out. This returns plain js array, not model objects.
            const cleanedProofsToSend = selectedProofs.map(proof => {                
                const {mintUrl, tId, ...rest} = getSnapshot(proof)
                return rest                
            })

            // We return cleaned proofs to be encoded as a sendable token
            return {
                proofs: cleanedProofsToSend, 
                mintFeeReserve: 0, 
                mintFeePaid: 0
            }
        }
        
        /* 
         *  SWAP or DIRECT SEND 
         *  if we did not selected ecash but amount and we might need a swap of ecash by the mint to match exact amount        
         */

        // Prioritize send from inactive keysets
        let proofsToSendFrom: Proof[] = []   
        const inactiveKeysetIds = mintInstance?.keysets.filter((k: MintKeyset) => k.active === false).map((k: MintKeyset) => k.id)   
        const activeKeysetIds = mintInstance?.keysets.filter((k: MintKeyset) => k.active === true).map((k: MintKeyset) => k.id)
        
        log.trace('[sendFromMint]', {inactiveKeysetIds, activeKeysetIds})
        
        if(inactiveKeysetIds.length > 0) {
            
            const proofsFromInactiveKeysets = proofsStore.getByMint(mintUrl, {isPending: false, unit, keysetIds: inactiveKeysetIds})
            const proofsFromActiveKeysets = proofsStore.getByMint(mintUrl, {isPending: false, unit, keysetIds: activeKeysetIds})            

            if(proofsFromInactiveKeysets && proofsFromInactiveKeysets.length > 0) {
                let proofsFromInactiveKeysetsAmount = CashuUtils.getProofsAmount(proofsFromInactiveKeysets)

                log.trace('[sendFromMint]', {proofsFromInactiveKeysetsAmount})

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
        }  else {
            proofsToSendFrom = CashuUtils.getProofsToSend(
                amountToSend,
                proofsFromMint
            )
        }

        let proofsToSendFromAmount = CashuUtils.getProofsAmount(proofsToSendFrom)        
        // swap will happen if we could not select proofs equal to amountToSend        
        let mintFeeReserve: number = 0
        let mintFeePaid: number = 0
        let proofsToSend: Proof[] = []
        let returnedProofs: Proof[] = []
        let isSwapNeeded: boolean = proofsToSendFromAmount - amountToSend > 0 ? true : false
        let returnedAmount = 0

        log.trace('[sendFromMint]', {proofsToSendFromAmount, amountToSend})
        /* 
         *  SWAP is needed, could involve a fee
         *  if we did not selected ecash but amount and we might need a swap of ecash by the mint to match exact amount        
         */
        if(isSwapNeeded) {
            // Calculate feeReserve from mint fee rate
            mintFeeReserve = mintInstance.getMintFeeReserve(proofsToSendFrom)
            // This is expected to get back from mint as a split remainder - we deduct fee that mint will keep
            returnedAmount = proofsToSendFromAmount - amountToSend - mintFeeReserve

            log.debug('[sendFromMint] Swap is needed.', {mintFeeReserve, returnedAmount})
            
            // if we did not selected enough proofs to cover the fees we need some more
            if(returnedAmount < 0) {
                const missingFeesAmount = Math.abs(returnedAmount)
                const remainingProofs = proofsStore.getProofsSubset(proofsFromMint, proofsToSendFrom)
                const remainingProofsAmount = CashuUtils.getProofsAmount(remainingProofs)

                log.warn('[sendFromMint]', 'Not enough proofs to cover feeReserve', {mintFeeReserve, returnedAmount})

                if(missingFeesAmount > remainingProofsAmount) {
                    throw new AppError(
                        Err.VALIDATION_ERROR,
                        'There is not enough funds to send this payment with expected fees',
                        {totalAmountFromMint, amountToSend, mintFeeReserve},
                    )
                }
                // select additional proof(s) to pay fees
                const proofsToPayFees = CashuUtils.getProofsToSend(
                    missingFeesAmount,
                    remainingProofs
                )

                // add more proofs into inputs and recalculate amounts
                proofsToSendFrom.push(...proofsToPayFees)
                proofsToSendFromAmount = CashuUtils.getProofsAmount(proofsToSendFrom)
                returnedAmount =  proofsToSendFromAmount - amountToSend - mintFeeReserve
            }

            // Outputs denominations we asked for to get
            const amountPreferences = getDefaultAmountPreference(amountToSend)
            // Output denominations we are about to get as a split remainder
            const returnedAmountPreferences = getDefaultAmountPreference(returnedAmount)

            const countOfProofsToSend = CashuUtils.getAmountPreferencesCount(amountPreferences)
            const countOfReturnedProofs = CashuUtils.getAmountPreferencesCount(returnedAmountPreferences)
            const countOfInFlightProofs = countOfProofsToSend + countOfReturnedProofs

            log.trace('[sendFromMint]', 'amountPreferences', {amountPreferences, returnedAmountPreferences})
            log.trace('[sendFromMint]', 'countOfInFlightProofs', countOfInFlightProofs)    

            // Increase the proofs counter before the mint call so that in case the response
            // is not received our recovery index counts for sigs the mint has already issued (prevents duplicate b_b bug)
            // + acquire lock and set inFlight values
            // Warning/TBD: if proofs from inactive keysets are in proofsToSendFrom, this still locks only an active keyset
            lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
                mintInstance, 
                unit, 
                countOfInFlightProofs, 
                transactionId
            )

            // if split to required denominations was necessary, this gets it done with the mint and we get the return
            const sendResult = await walletStore.send(
                mintUrl,
                amountToSend,
                mintFeeReserve,
                unit,            
                proofsToSendFrom,
                {              
                    preference: amountPreferences,                    
                    counter: lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
                }
            )

            returnedProofs = sendResult.returnedProofs
            proofsToSend = sendResult.proofsToSend
            mintFeePaid = sendResult.mintFeePaid

            // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
            lockedProofsCounter.decreaseProofsCounter(countOfInFlightProofs) 

            // add proofs returned by the mint after the split
            log.trace('[sendFromMint] add returned proofs to spendable')
            WalletUtils.addCashuProofs(
                mintUrl,
                returnedProofs,
                {
                    unit,
                    transactionId,
                    isPending: false
                })
                
            // release lock
            lockedProofsCounter.resetInFlight(transactionId)
            
        } else if (returnedAmount === 0) {
        /* 
         *  SWAP not needed, all selected proofs will be sent
         */
            log.debug('[sendFromMint] Swap is not necessary, all proofsToSendFrom will be sent.')
            proofsToSend = [...proofsToSendFrom]
            
        } else {
            throw new AppError(Err.VALIDATION_ERROR, 'Amount to keep can not be negative')
        }        

        // remove used proofs and move sent proofs to pending
        log.trace('[sendFromMint] remove proofsToSendFrom from spendable')
        proofsStore.removeProofs(proofsToSendFrom)

        // these might be original proofToSendFrom if they matched the exact amount and split was not necessary
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
        const cleanedProofsToSend = proofsToSend.map(proof => {
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
            proofs: cleanedProofsToSend as ProofV3[], 
            mintFeeReserve, 
            mintFeePaid
        }
  } catch (e: any) {
        // release lock
        if(lockedProofsCounter) {
            lockedProofsCounter.resetInFlight(transactionId)
        }

        if (e instanceof AppError) {
            throw e
        } else {
            throw new AppError(Err.WALLET_ERROR, e.message, e.stack.slice(0, 200))
        }
  }
}

