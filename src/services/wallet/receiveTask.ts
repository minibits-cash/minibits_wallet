import {log} from '../logService'
import {
  Transaction,
  TransactionData,
  TransactionRecord,
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuUtils, CashuProof} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import { DEFAULT_DENOMINATION_TARGET, TransactionTaskResult } from '../walletService'
import { WalletUtils } from './utils'
import { MintUnit, formatCurrency, getCurrency } from './currency'
import { MintProofsCounter } from '../../models/Mint'
import { Token, getDecodedToken } from '@cashu/cashu-ts'
import { getEncodedToken, getKeepAmounts } from '@cashu/cashu-ts/src/utils'

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
    token: Token,
    amountToReceive: number,    
    memo: string,
    encodedToken: string,
): Promise<TransactionTaskResult> {
  const transactionData: TransactionData[] = []  
  let transaction: Transaction | undefined = undefined
  let mintToReceive: string | undefined = undefined
  const unit = token.unit as MintUnit || 'sat'  

  try {
        mintToReceive = token.mint

        if (!mintToReceive) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Token is missing a mint param.',
            )
        }                

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

        const {            
            receivedAmount, 
            outputToken,            
            swapFeePaid,            
            counter 
        } = await receiveSync(
            mintToReceive,
            token,
            token.memo || '',
            transaction.id
        )
        
 
        // Update tx amount if full amount was not received
        if (receivedAmount !== amountToReceive) {      
            transaction.setReceivedAmount(receivedAmount)
        }

        // Finally, update completed transaction
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            swapFeePaid,         
            receivedAmount,
            unit,
            counter,          
            createdAt: new Date(),
        })

        transaction.setStatus(            
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        transaction.setOutputToken(outputToken)

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        transaction.setBalanceAfter(balanceAfter)

        if(swapFeePaid > 0) {
            transaction.setFee(swapFeePaid)
        }

        return {
            taskFunction: RECEIVE,
            mintUrl: mintToReceive,
            transaction,
            message: `You've received ${formatCurrency(receivedAmount, getCurrency(unit).code)} ${getCurrency(unit).code} to your Minibits wallet.`,
            receivedAmount,
        } as TransactionTaskResult
        
    } catch (e: any) {
        if (transaction) {            

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
            mintUrl: mintToReceive,
            transaction,
            message: e.message,
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
  let transaction: Transaction | undefined = undefined
  let mintToReceive = ''
  const unit = token.unit as MintUnit || 'sat'

  try {
        mintToReceive = token.mint

        if (!mintToReceive) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Token is missing a mint param.',
            )
        }     

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
            const blockedTransaction = transaction.setStatus(                
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

            transaction.setStatus(                
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
    const transaction = transactionsStore.findById(transactionId)

    try {
        if(!transaction) {
            throw new AppError(Err.VALIDATION_ERROR, 'Could not retrieve transaction.', {transactionId})
        }   

        const transactionData = JSON.parse(transaction.data)

        if (!transaction.inputToken) {
            throw new AppError(Err.VALIDATION_ERROR, 'Could not find ecash token to redeem', {caller: 'receiveOfflineComplete'})
        }
        
        const token = getDecodedToken(transaction.inputToken)        
        mintToReceive = token.mint
        const unit = token.unit || 'sat'

        if(unit !== transaction.unit) {
            throw new AppError(Err.VALIDATION_ERROR, 'Transaction unit and token unit are not the same', {unit, transactionUnit: transaction.unit})
        }

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

        const {             
            receivedAmount, 
            outputToken,
            swapFeePaid,            
            counter 
        } = await receiveSync(
            mintToReceive,
            token,
            token.memo || '',
            transaction.id
        )
 
        // Update tx amount if full amount was not received
        if (receivedAmount !== transaction.amount) {      
            transaction.setReceivedAmount(receivedAmount)
        }

        // Finally, update completed transaction
        transactionData.push({
            status: TransactionStatus.COMPLETED,  
            receivedAmount,
            swapFeePaid,
            unit,
            counter,         
            createdAt: new Date(),
        })        

        transaction.setStatus(            
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        transaction.setOutputToken(outputToken)

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        transaction.setBalanceAfter(balanceAfter)

        if(swapFeePaid > 0) {
            transaction.setFee(swapFeePaid)
        }

        return {
            taskFunction: RECEIVE_OFFLINE_COMPLETE,
            mintUrl: mintToReceive,
            transaction,
            message: `You've received ${formatCurrency(receivedAmount, getCurrency(unit).code)} ${getCurrency(unit).code} to your Minibits wallet.`,
            receivedAmount,
        } as TransactionTaskResult

    } catch (e: any) {
        // release lock
        if(transaction) {
                
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

        return {
            taskFunction: RECEIVE_OFFLINE_COMPLETE,
            mintUrl: mintToReceive,
            transaction,
            message: '',
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}


export const receiveSync = async function (
    mintToReceive: string,
    token: Token,    
    memo: string,    
    transactionId: number
) {
  
  const unit = token.unit as MintUnit || 'sat'
  let lockedProofsCounter: MintProofsCounter | undefined = undefined

  try {        
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
        const amountToReceive = CashuUtils.getProofsAmount(token.proofs)

        const proofsByMint = proofsStore.getByMint(mintToReceive, {
            isPending: false,
            unit
        })

        const walletInstance = await walletStore.getWallet(mintToReceive, unit, {withSeed: true})

        const amountPreference = getKeepAmounts(
            proofsByMint,
            amountToReceive,
            (await walletInstance.getKeys()).keys,
            DEFAULT_DENOMINATION_TARGET            
        )    
        
        log.trace('[receiveSync]', {amountPreference, transactionId})          
                
        // temp increase the counter + acquire lock and set inFlight values        
        lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
            mintInstance, 
            unit, 
            amountPreference.length, 
            transactionId
        )

        let receivedResult = undefined

        try {
            receivedResult = await walletStore.receive(
                mintToReceive,
                unit as MintUnit,
                token,                
                {            
                    outputAmounts: {keepAmounts: [], sendAmounts: amountPreference},
                    counter: lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
                }
            )
        } catch (e: any) {
            // ugly but should do the trick if previous nwcTransfer got interrupted
            if(e.message.includes('outputs have already been signed before')) {
                
                log.error('[receiveSync] Increasing proofsCounter outdated values and repeating receiveSync.')
                lockedProofsCounter.resetInFlight(transactionId)
                lockedProofsCounter.increaseProofsCounter(10)
                lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
                    mintInstance, 
                    unit, 
                    amountPreference.length, 
                    transactionId
                )

                receivedResult = await walletStore.receive(
                    mintToReceive,
                    unit as MintUnit,
                    token,                    
                    {            
                        outputAmounts: {keepAmounts: [], sendAmounts: amountPreference},
                        counter: lockedProofsCounter.inFlightFrom as number
                    }
                )
            } else {
                throw e
            }
        }
        
        const receivedProofs = receivedResult!.proofs
        const swapFeePaid = receivedResult!.swapFeePaid       
       
        // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
        lockedProofsCounter.decreaseProofsCounter(amountPreference.length)
       
        const { addedAmount: receivedAmount } = WalletUtils.addCashuProofs(
            mintToReceive,
            receivedProofs,
            {
                unit,
                transactionId: transactionId,
                isPending: false
            }                    
        )

        // release lock
        lockedProofsCounter.resetInFlight(transactionId)

        // store swapped proofs as encoded token in tx data        
        const outputToken = getEncodedToken({
            mint: mintToReceive,
            proofs: receivedProofs,
            unit,
            memo,
        })   

        return {            
            receivedAmount,
            receivedProofs,
            outputToken,
            swapFeePaid,            
            counter: lockedProofsCounter?.counter
        }
        
    } catch (e: any) {
        if (transactionId) {            
            if(lockedProofsCounter) {                
                lockedProofsCounter.resetInFlight(transactionId)
            }
        }

        if (e instanceof AppError) {
            throw e
        } else {
            throw new AppError(Err.WALLET_ERROR, e.message, e.stack.slice(0, 200))
        }
    }
}