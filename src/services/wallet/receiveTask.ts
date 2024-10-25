import {log} from '../logService'
import {
  Transaction,
  TransactionData,
  TransactionRecord,
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuUtils, ProofV3, TokenEntryV3, TokenV3} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import { getDefaultAmountPreference } from '@cashu/cashu-ts/src/utils'
import { TransactionTaskResult } from '../walletService'
import { WalletUtils } from './utils'
import { MintUnit, formatCurrency, getCurrency } from './currency'
import { Proof } from '../../models/Proof'
import { MintProofsCounter } from '../../models/Mint'

const {
    mintsStore,
    proofsStore,
    transactionsStore,
    walletStore
} = rootStoreInstance

// function names to pass to task results
const RECEIVE = 'receiveTask'
const RECEIVE_OFFLINE_PREPARE = 'receiveOfflinePrepareTask'
const RECEIVE_OFFLINE_COMPLETE = 'receiveOfflineCompleteTask'

export const receiveTask = async function (
    token: TokenV3,
    amountToReceive: number,    
    memo: string,
    encodedToken: string,
): Promise<TransactionTaskResult> {
  const transactionData: TransactionData[] = []  
  let transaction: Transaction | undefined = undefined
  let mintToReceive: string | undefined = undefined
  const unit = token.unit as MintUnit || 'sat'
  let lockedProofsCounter: MintProofsCounter | undefined = undefined

  try {
        const tokenMints: string[] = CashuUtils.getMintsFromToken(token)
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
            createdAt: new Date(),
        })

        const newTransaction = {
            type: TransactionType.RECEIVE,
            amount: amountToReceive,
            fee: 0,
            unit,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintToReceive,            
            status: TransactionStatus.DRAFT,
        }

        transaction = await transactionsStore.addTransaction(newTransaction)
        transaction.setInputToken(encodedToken)        

        // Handle blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            transactionData.push({
                status: TransactionStatus.BLOCKED,
                message: 'Mint is blocked in your Settings, ecash has not been received.',
            })

            transaction.setStatus(                
                TransactionStatus.BLOCKED,
                JSON.stringify(transactionData),
            )

            return {
                taskFunction: RECEIVE,
                transaction,
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
        // is not received our recovery index counts for sigs the mint has already issued
        const amountPreferences = getDefaultAmountPreference(amountToReceive)        
        const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences)        
        const proofsToReceive = token.token.flatMap(entry => entry.proofs)
        const mintFeeReserve = mintInstance.getMintFeeReserve(proofsToReceive)        
        
        log.trace('[receiveTask]', 'amountPreferences', {amountPreferences, transactionId: transaction.id})
        log.trace('[receiveTask]', 'countOfInFlightProofs', {countOfInFlightProofs, transactionId: transaction.id})  
        // log.trace('[receiveTask]', {tokenEntries})
        
        // temp increase the counter + acquire lock and set inFlight values        
        lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
            mintInstance, 
            unit, 
            countOfInFlightProofs, 
            transaction.id!
        )

        const receivedResult = await walletStore.receive(
            mintToReceive,
            unit as MintUnit,
            token,
            mintFeeReserve,
            {            
              preference: amountPreferences,
              counter: lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
            }
        )
        
        const receivedProofs = receivedResult.proofs
        const mintFeePaid = receivedResult.mintFeePaid

        // log.trace('[receiveTask]', {receivedProofs})
       
        // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
        lockedProofsCounter.decreaseProofsCounter(countOfInFlightProofs)

        // store swapped proofs as encoded token in tx data        
        const receivedTokenEntry = {
            mint: mintToReceive,
            proofs: receivedProofs,
        }

        const outputToken = CashuUtils.encodeToken({
            token: [receivedTokenEntry],
            unit,
            memo,
        })
        
        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,            
            mintFeeReserve,
            mintFeePaid,
            createdAt: new Date(),
        })

        transaction.setStatus(            
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )
       
        const { addedAmount: receivedAmount } = WalletUtils.addCashuProofs(
            mintToReceive,
            receivedProofs,
            {
                unit,
                transactionId: transaction.id!,
                isPending: false
            }                    
        )

        // release lock
        lockedProofsCounter.resetInFlight(transaction.id!)
 
        // Update tx amount if full amount was not received
        if (receivedAmount !== amountToReceive) {      
            transaction.setReceivedAmount(receivedAmount)
        }

        // Finally, update completed transaction
        transactionData.push({
            status: TransactionStatus.COMPLETED,            
            receivedAmount,
            unit,
            counter: lockedProofsCounter.counter,          
            createdAt: new Date(),
        })

        transaction.setStatus(            
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        transaction.setOutputToken(outputToken)

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        transaction.setBalanceAfter(balanceAfter)

        if(mintFeePaid > 0) {
            transaction.setFee(mintFeePaid)
        }

        return {
            taskFunction: RECEIVE,
            mintUrl: mintInstance.mintUrl,
            transaction,
            message: `You've received ${formatCurrency(receivedAmount, getCurrency(unit).code)} ${getCurrency(unit).code} to your Minibits wallet.`,
            receivedAmount,
        } as TransactionTaskResult
        
    } catch (e: any) {
        if (transaction) {            
            if(lockedProofsCounter) {                
                lockedProofsCounter.resetInFlight(transaction.id!)
            }

            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
                errorToken: e.params?.errorToken || undefined
            })

            transaction.setStatus(                
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error(e.name, e.message)

        return {
            taskFunction: RECEIVE,
            mintUrl: mintToReceive || '',
            transaction,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}


export const receiveOfflinePrepareTask = async function (
    token: TokenV3,
    amountToReceive: number,    
    memo: string,
    encodedToken: string,
) {
  const transactionData: TransactionData[] = []
  let transaction: Transaction | undefined = undefined
  let mintToReceive = ''
  const unit = token.unit as MintUnit || 'sat'

  try {
        const tokenMints: string[] = CashuUtils.getMintsFromToken(token)
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

        const newTransaction = {
            type: TransactionType.RECEIVE_OFFLINE,
            amount: amountToReceive,
            fee: 0,
            unit,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintToReceive,            
            status: TransactionStatus.DRAFT,
        }

        transaction = await transactionsStore.addTransaction(newTransaction)
        transaction.setInputToken(encodedToken)        

        // Handle blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            const blockedTransaction = await transaction.setStatus(                
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
            createdAt: new Date(),
        })

        transaction.setStatus(            
            TransactionStatus.PREPARED_OFFLINE,
            JSON.stringify(transactionData),
        )        

        return {
            taskFunction: RECEIVE_OFFLINE_PREPARE,
            mintUrl: mintToReceive,
            transaction,
            message: `You received ${formatCurrency(amountToReceive, getCurrency(unit).code)} ${getCurrency(unit).code} while offline. You need to redeem them to your wallet when you will be online again.`,            
        } as TransactionTaskResult

    } catch (e: any) {
        if (transaction) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
            })

            await transaction.setStatus(                
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error(e.name, e.message)

        return {
            taskFunction: RECEIVE_OFFLINE_PREPARE,
            mintUrl: mintToReceive,
            transaction,
            message: '',
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}


export const receiveOfflineCompleteTask = async function (        
    transactionId: number
) {
    let mintToReceive = ''
    let lockedProofsCounter: MintProofsCounter | undefined = undefined
    const transaction = transactionsStore.findById(transactionId)

    try {
        if(!transaction) {
            throw new AppError(Err.VALIDATION_ERROR, 'Could not retrieve transaction.', {transactionId})
        }   

        const transactionData = JSON.parse(transaction.data)


        if (!transaction.inputToken) {
            throw new AppError(Err.VALIDATION_ERROR, 'Could not find ecash token to redeem', {caller: 'receiveOfflineComplete'})
        }
        
        const token = CashuUtils.decodeToken(transaction.inputToken)        
        const tokenMints: string[] = CashuUtils.getMintsFromToken(token as TokenV3)
        const unit = token.unit || 'sat'

        if(unit !== transaction.unit) {
            throw new AppError(Err.VALIDATION_ERROR, 'Transaction unit and token unit are not the same', {unit, transactionUnit: transaction.unit})
        }

        mintToReceive = tokenMints[0]

        // Re-check blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            transaction.setStatus(                
                TransactionStatus.BLOCKED,
                JSON.stringify(transactionData),
            )

            return {
                taskFunction: RECEIVE_OFFLINE_COMPLETE,
                mintUrl: mintToReceive,
                transaction,
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

        const tokenEntries: TokenEntryV3[] = token.token
        const proofsToReceive = tokenEntries[0].proofs as Proof[]
        const mintFeeReserve = mintInstance.getMintFeeReserve(proofsToReceive)
        // We will receive amount less fees paid for a swap for fresh ecash
        const amountPreferences = getDefaultAmountPreference(transaction.amount - mintFeeReserve)        
        const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences)
        
        log.trace('[receiveOfflineCompleteTask]', 'amountPreferences', amountPreferences)
        log.trace('[receiveOfflineCompleteTask]', 'countOfInFlightProofs', countOfInFlightProofs)  
        
        // temp increase the counter + acquire lock and set inFlight values        
        lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
            mintInstance, 
            unit, 
            countOfInFlightProofs, 
            transaction.id as number
        )

        const receivedResult = await walletStore.receive(
            mintToReceive,
            unit as MintUnit,
            token,
            mintFeeReserve,
            {            
              preference: amountPreferences,
              counter: lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
            }
        )
        
        const receivedProofs = receivedResult.proofs
        const mintFeePaid = receivedResult.mintFeePaid
       
        // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
        lockedProofsCounter.decreaseProofsCounter(countOfInFlightProofs)

        // store swapped proofs as encoded token in tx data        
        const receivedTokenEntry: TokenEntryV3 = {
            mint: mintToReceive,
            proofs: receivedProofs,
        }

        const outputToken = CashuUtils.encodeToken({
            token: [receivedTokenEntry],
            unit,            
        })
        
        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,            
            mintFeeReserve,
            mintFeePaid,
            createdAt: new Date(),
        })

        transaction.setStatus(            
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )
       
        const { addedAmount: receivedAmount } = WalletUtils.addCashuProofs(
            mintToReceive,
            receivedProofs,
            {
                unit,
                transactionId: transaction.id as number,
                isPending: false
            }                    
        )

        // release lock
        lockedProofsCounter.resetInFlight(transaction.id as number)
 
        // Update tx amount if full amount was not received
        if (receivedAmount !== transaction.amount) {      
            transaction.setReceivedAmount(receivedAmount)
        }

        // Finally, update completed transaction
        transactionData.push({
            status: TransactionStatus.COMPLETED,            
            receivedAmount,
            unit,            
            createdAt: new Date(),
        })        

        transaction.setStatus(            
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        transaction.setOutputToken(outputToken)

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        transaction.setBalanceAfter(balanceAfter)

        if(mintFeePaid > 0) {
            transaction.setFee(mintFeePaid)
        }

        return {
            taskFunction: RECEIVE_OFFLINE_COMPLETE,
            mintUrl: mintInstance.mintUrl,
            transaction,
            message: `You've received ${formatCurrency(receivedAmount, getCurrency(unit).code)} ${getCurrency(unit).code} to your Minibits wallet.`,
            receivedAmount,
        } as TransactionTaskResult

    } catch (e: any) {
        // release lock
        if(transaction) {
            if(lockedProofsCounter) {
                lockedProofsCounter.resetInFlight(transaction.id as number)
            }
                
            const transactionData = JSON.parse(transaction.data)
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
            })
    
            transaction.setStatus(                
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error(e.name, e.message)

        return {
            taskFunction: RECEIVE_OFFLINE_COMPLETE,
            mintUrl: mintToReceive,
            transaction,
            message: '',
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}