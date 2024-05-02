import {log} from '../logService'
import {MintClient} from '../cashuMintClient'
import {
  Transaction,
  TransactionData,
  TransactionRecord,
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuUtils} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {Token} from '../../models/Token'
import {
    type Token as CashuToken
} from '@cashu/cashu-ts'
import { getDefaultAmountPreference } from '@cashu/cashu-ts/src/utils'
import { TransactionTaskResult } from '../walletService'
import { WalletUtils } from './utils'

const {
    mintsStore,
    proofsStore,
    transactionsStore,
} = rootStoreInstance

// function names to pass to task results
const RECEIVE = 'receiveTask'
const RECEIVE_OFFLINE_PREPARE = 'receiveOfflinePrepareTask'
const RECEIVE_OFFLINE_COMPLETE = 'receiveOfflineCompleteTask'

export const receiveTask = async function (
    token: Token,
    amountToReceive: number,    
    memo: string,
    encodedToken: string,
): Promise<TransactionTaskResult> {
  const transactionData: TransactionData[] = []
  let transactionId: number = 0
  let mintToReceive: string | undefined = undefined
  const unit = token.unit || 'sat'

  try {
        const tokenMints: string[] = CashuUtils.getMintsFromToken(token as Token)
        log.trace('[receiveTask]', 'receiveToken tokenMints', tokenMints)

        if (tokenMints.length === 0) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not get any mint information from the ecash token.',
            )
        }

        if (tokenMints.length > 1) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Wallet does not support receiving of tokens with entries from multiple mints.',
            )
        }

        mintToReceive = tokenMints[0]        

        // Let's create new draft receive transaction in database
        transactionData.push({
            status: TransactionStatus.DRAFT,
            amountToReceive,
            unit,
            encodedToken,           
            createdAt: new Date(),
        })

        const newTransaction: Transaction = {
            type: TransactionType.RECEIVE,
            amount: amountToReceive,
            fee: 0,
            unit,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintToReceive,            
            status: TransactionStatus.DRAFT,
        }

        const draftTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
        transactionId = draftTransaction.id as number

        // Handle blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            transactionData.push({
                status: TransactionStatus.BLOCKED,
                message: 'Mint is blocked in your Settings, ecash has not been received.',
            })

            const blockedTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.BLOCKED,
                JSON.stringify(transactionData),
            )

            return {
                taskFunction: RECEIVE,
                transaction: blockedTransaction,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionTaskResult
        }

        // Handle missing mint, we add it automatically
        const alreadyExists = mintsStore.alreadyExists(mintToReceive)

        if (!alreadyExists) {
            await mintsStore.addMint(mintToReceive)
        }

        const mintInstance = mintsStore.findByUrl(mintToReceive)

        if(!mintInstance) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing mint', {mintToReceive})
        }

        // Increase the proofs counter before the mint call so that in case the response
        // is not received our recovery index counts for sigs the mint has already issued (prevents duplicate b_b bug)
        const amountPreferences = getDefaultAmountPreference(amountToReceive)        
        const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences)
        
        log.trace('[receiveTask]', 'proofsCounter initial state', {proofsCounter: await mintInstance.getProofsCounterByUnit?.(unit)})
        log.trace('[receiveTask]', 'amountPreferences', {amountPreferences, transactionId})
        log.trace('[receiveTask]', 'countOfInFlightProofs', {countOfInFlightProofs, transactionId})  
        
        // temp increase the counter + acquire lock and set inFlight values        
        await WalletUtils.lockAndSetInFlight(mintInstance, unit, countOfInFlightProofs, transactionId)
        
        // get locked counter values
        const lockedProofsCounter = await mintInstance.getProofsCounterByUnit?.(unit)
        
        // Now we ask all mints to get fresh outputs for their tokenEntries, and create from them new proofs
        // As this method supports multiple token entries potentially from multiple mints processed in cycle it does not throw but returns collected errors
        let receiveResult: {
            updatedToken: CashuToken | undefined, 
            errorToken: CashuToken | undefined,
            errors: string[] | undefined
        }

        receiveResult = await MintClient.receiveFromMint(
            mintToReceive,
            unit,
            token,
            amountPreferences,
            lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
        )        
       
        // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
        mintInstance.decreaseProofsCounter(lockedProofsCounter.keyset, countOfInFlightProofs)

        const {updatedToken, errorToken, errors} = receiveResult
        
        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            errorToken,
            updatedToken,            
            errors,
            createdAt: new Date(),
        })

        await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )

        let amountWithErrors = 0

        if (errorToken && errorToken.token.length > 0) {
            amountWithErrors += CashuUtils.getTokenAmounts(errorToken as Token).totalAmount
            log.warn('[receiveTask]', 'amountWithErrors', {amountWithErrors, errors})
        }

        if (amountWithErrors === amountToReceive) {            
            throw new AppError(
                Err.MINT_ERROR,
                'Mint returned error on request to swap the received ecash.',
                {caller: 'receiveTask', message: errors && errors.length > 0 ? errors[0] : undefined, errorToken}
            )
        }

        let receivedAmount = 0
        let addedProofsCount = 0

        if(updatedToken && updatedToken.token.length > 0) {
            for (const entry of updatedToken.token) {
                // create ProofModel instances and store them into the proofsStore
                const { addedProofs, addedAmount } = WalletUtils.addCashuProofs(
                    entry.mint,
                    entry.proofs,
                    {
                        unit,
                        transactionId,
                        isPending: false
                    }                    
                )
    
                receivedAmount += addedAmount 
                addedProofsCount += addedProofs.length         
            }
        }

        // release lock
        mintInstance.resetInFlight(transactionId)

        // temporary check of zero value tx until I figure out how it happens
        const receivedAmountCheck = CashuUtils.getTokenAmounts(updatedToken as Token).totalAmount

        if (receivedAmount !== receivedAmountCheck) {
            log.error('[receiveTask]', 
            `Received per proofStore: ${receivedAmount} Received check using tokenAmounts: ${receivedAmountCheck}`, 
            {updatedToken})
        }        

        // Update tx amount if full amount was not received
        if (receivedAmount !== amountToReceive) {      
            await transactionsStore.updateReceivedAmount(
                transactionId,
                receivedAmount,
            )
        }

        // Finally, update completed transaction
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            receivedAmount,
            unit,
            amountWithErrors,
            createdAt: new Date(),
        })

        const completedTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)

        if (amountWithErrors > 0) {
            return {
                taskFunction: RECEIVE,
                mintUrl: mintInstance.mintUrl,
                transaction: completedTransaction,
                message: `You've received ${receivedAmount} ${unit} to your Minibits wallet. ${amountWithErrors} ${unit} could not be redeemed from the mint`,
                receivedAmount,

            } as TransactionTaskResult
        }

        return {
            taskFunction: RECEIVE,
            mintUrl: mintInstance.mintUrl,
            transaction: completedTransaction,
            message: `You've received ${receivedAmount} ${unit} to your Minibits wallet.`,
            receivedAmount,
        } as TransactionTaskResult
        
    } catch (e: any) {

        let errorTransaction: TransactionRecord | undefined = undefined

        if (transactionId > 0) {            
            if(mintToReceive) {
                // release lock
                const mintInstance = mintsStore.findByUrl(mintToReceive)
                mintInstance?.resetInFlight(transactionId)
            }

            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
                errorToken: e.params?.errorToken || undefined
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error(e.name, e.message)

        return {
            taskFunction: RECEIVE,
            mintUrl: mintToReceive || '',
            transaction: errorTransaction || undefined,
            message: '',
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}


export const receiveOfflinePrepareTask = async function (
    token: Token,
    amountToReceive: number,    
    memo: string,
    encodedToken: string,
) {
  const transactionData: TransactionData[] = []
  let transactionId: number = 0
  let mintToReceive = ''
  const unit = token.unit || 'sat'

  try {
        const tokenMints: string[] = CashuUtils.getMintsFromToken(token as Token)
        log.trace('[receiveOfflinePrepareTask]', 'receiveToken tokenMints', tokenMints)

        if (tokenMints.length === 0) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not get any mint information from the ecash token.',
            )
        }


        if (tokenMints.length > 1) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Wallet does not support receiving of tokens with entries from multiple mints.',
            )
        }

        mintToReceive = tokenMints[0]        

        // Let's create new draft receive transaction in database
        transactionData.push({
            status: TransactionStatus.DRAFT,
            amountToReceive,
            unit,
            createdAt: new Date(),
        })

        const newTransaction: Transaction = {
            type: TransactionType.RECEIVE_OFFLINE,
            amount: amountToReceive,
            fee: 0,
            unit,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintToReceive,
            status: TransactionStatus.DRAFT,
        }


        const draftTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
        transactionId = draftTransaction.id as number

        // Handle blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            const blockedTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.BLOCKED,
                JSON.stringify(transactionData),
            )

            return {
                taskFunction: RECEIVE_OFFLINE_PREPARE,
                mintUrl: mintToReceive,
                transaction: blockedTransaction,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionTaskResult
        }

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED_OFFLINE,
            encodedToken, // TODO store in model, MVP initial implementation
            createdAt: new Date(),
        })

        const preparedTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PREPARED_OFFLINE,
            JSON.stringify(transactionData),
        )

        // TODO store as proofs in new model and redeem on internet connection?
        /* const newProofs: Proof[] = []

        for (const entry of token) {
            for (const proof of entry.proofs) {
                proof.tId = transactionId
                proof.mintUrl = entry.mint //multimint support

                newProofs.push(proof)
            }
        } */

        return {
            taskFunction: RECEIVE_OFFLINE_PREPARE,
            mintUrl: mintToReceive,
            transaction: preparedTransaction,
            message: `You received ${amountToReceive} ${unit} while offline. You need to redeem them to your wallet when you will be online again.`,            
        } as TransactionTaskResult

    } catch (e: any) {
        let errorTransaction: TransactionRecord | undefined = undefined

        if (transactionId > 0) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error(e.name, e.message)

        return {
            taskFunction: RECEIVE_OFFLINE_PREPARE,
            mintUrl: mintToReceive,
            transaction: errorTransaction || undefined,
            message: '',
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}


export const receiveOfflineCompleteTask = async function (        
    transaction: Transaction
) {
    let mintToReceive = ''

    try {        
        const transactionData = JSON.parse(transaction.data)
        const {encodedToken} = transactionData.find(
            (record: any) => record.status === TransactionStatus.PREPARED_OFFLINE,
        )

        if (!encodedToken) {
            throw new AppError(Err.VALIDATION_ERROR, 'Could not find ecash token to redeem', {caller: 'receiveOfflineComplete'})
        }
        
        const token = CashuUtils.decodeToken(encodedToken)        
        const tokenMints: string[] = CashuUtils.getMintsFromToken(token as Token)
        const unit = token.unit || 'sat'

        if(unit !== transaction.unit) {
            throw new AppError(Err.VALIDATION_ERROR, 'Transaction unit and token unit are not the same', {unit, transactionUnit: transaction.unit})
        }

        mintToReceive = tokenMints[0]

        // Re-check blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            const blockedTransaction = await transactionsStore.updateStatus(
                transaction.id as number,
                TransactionStatus.BLOCKED,
                JSON.stringify(transactionData),
            )

            return {
                taskFunction: RECEIVE_OFFLINE_COMPLETE,
                mintUrl: mintToReceive,
                transaction: blockedTransaction,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionTaskResult
        }

        // Handle missing mint, we add it automatically
        const alreadyExists = mintsStore.alreadyExists(mintToReceive)

        if (!alreadyExists) {
            await mintsStore.addMint(mintToReceive)
        }

        const mintInstance = mintsStore.findByUrl(mintToReceive)

        if(!mintInstance) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing mint', {mintToReceive})
        }

        // Increase the proofs counter before the mint call so that in case the response
        // is not received our recovery index counts for sigs the mint has already issued (prevents duplicate b_b bug)
        const amountPreferences = getDefaultAmountPreference(transaction.amount)        
        const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences)
        
        log.trace('[receiveOfflineCompleteTask]', 'amountPreferences', amountPreferences)
        log.trace('[receiveOfflineCompleteTask]', 'countOfInFlightProofs', countOfInFlightProofs)  
        
        // temp increase the counter + acquire lock and set inFlight values        
        await WalletUtils.lockAndSetInFlight(mintInstance, unit, countOfInFlightProofs, transaction.id as number)
        
        // get locked counter values
        const lockedProofsCounter = await mintInstance.getProofsCounterByUnit?.(unit)
        
        // Now we ask all mints to get fresh outputs for their tokenEntries, and create from them new proofs
        // As this method supports multiple token entries potentially from multiple mints processed in cycle it does not throw but returns collected errors
        let receiveResult: {
            updatedToken: CashuToken | undefined, 
            errorToken: CashuToken | undefined,
            errors: string[] | undefined
        } 
        
        receiveResult = await MintClient.receiveFromMint(
            tokenMints[0],
            unit,
            token,
            amountPreferences,
            lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
        )

        // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
        mintInstance.decreaseProofsCounter(lockedProofsCounter.keyset, countOfInFlightProofs)

        const {updatedToken, errorToken, errors} = receiveResult
                
        let amountWithErrors = 0

        if (errorToken && errorToken.token.length > 0) {            
            amountWithErrors += CashuUtils.getTokenAmounts(errorToken as Token).totalAmount
            log.warn('[receiveOfflineCompleteTask]', 'receiveToken amountWithErrors', amountWithErrors)
        }

        if (amountWithErrors === transaction.amount) {            
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Ecash could not be redeemed.',
                {caller: 'receiveOfflineCompleteTask', message: errors?.length ? errors[0] : undefined}
            )
        }        
        
        let receivedAmount = 0

        if(updatedToken && updatedToken.token.length > 0) {
            for (const entry of updatedToken.token) {
                // create ProofModel instances and store them into the proofsStore
                const { addedProofs, addedAmount } = WalletUtils.addCashuProofs(
                    entry.mint,
                    entry.proofs,
                    {
                        unit,
                        transactionId: transaction.id as number,
                        isPending: false
                    }                    
                )
                
                receivedAmount += addedAmount            
            }
        }
        
        // release lock
        mintInstance.resetInFlight(transaction.id as number)

        // const receivedAmount = CashuUtils.getTokenAmounts(updatedToken as Token).totalAmount
        log.debug('[receiveOfflineCompleteTask]', 'Received amount', receivedAmount)

        // Update tx amount if full amount was not received
        if (receivedAmount !== transaction.amount) {      
            await transactionsStore.updateReceivedAmount(
                transaction.id as number,
                receivedAmount,
            )
        }

        // Finally, update completed transaction        
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            receivedAmount,
            amountWithErrors,
            createdAt: new Date(),
        })

        const completedTransaction = await transactionsStore.updateStatus(
            transaction.id as number,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        await transactionsStore.updateBalanceAfter(transaction.id as number, balanceAfter)

        if (amountWithErrors > 0) {
            return {
                taskFunction: RECEIVE_OFFLINE_COMPLETE,
                mintUrl: mintToReceive,
                transaction: completedTransaction,
                message: `You received ${receivedAmount} SATS to your minibits wallet. ${amountWithErrors} could not be redeemed from the mint`,
                receivedAmount,
            } as TransactionTaskResult
        }

        return {
            taskFunction: RECEIVE_OFFLINE_COMPLETE,
            mintUrl: mintToReceive,
            transaction: completedTransaction,
            message: `You received ${receivedAmount} SATS to your minibits wallet.`,
            receivedAmount,
        } as TransactionTaskResult
    } catch (e: any) {
        // release lock
        const mintInstance = mintsStore.findByUrl(transaction.mint)
        mintInstance?.resetInFlight(transaction.id as number)

        let errorTransaction: TransactionRecord | undefined = undefined
            
        const transactionData = JSON.parse(transaction.data)
        transactionData.push({
            status: TransactionStatus.ERROR,
            error: WalletUtils.formatError(e),
        })

        errorTransaction = await transactionsStore.updateStatus(
            transaction.id as number,
            TransactionStatus.ERROR,
            JSON.stringify(transactionData),
        )

        log.error(e.name, e.message)

        return {
            taskFunction: RECEIVE_OFFLINE_COMPLETE,
            mintUrl: mintToReceive,
            transaction: errorTransaction || undefined,
            message: '',
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}