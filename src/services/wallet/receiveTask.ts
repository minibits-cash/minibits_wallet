import {log} from '../logService'
import {
  Transaction,
  TransactionData,  
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuProof, CashuUtils} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import { TransactionTaskResult } from '../walletService'
import { WalletUtils } from './utils'
import { MintUnit, formatCurrency, getCurrency } from './currency'
import { PaymentRequestPayload, Token, getDecodedToken } from '@cashu/cashu-ts'
import { getEncodedToken, getKeepAmounts } from '@cashu/cashu-ts/src/utils'
import { Proof } from '../../models/Proof'

const {
    mintsStore,
    proofsStore,
    transactionsStore,
    walletStore
} = rootStoreInstance

// function names to pass to task results
export const RECEIVE_TASK = 'receiveTask'
export const RECEIVE_OFFLINE_PREPARE_TASK = 'receiveOfflinePrepareTask'
export const RECEIVE_OFFLINE_COMPLETE_TASK = 'receiveOfflineCompleteTask'
export const RECEIVE_BY_CASHU_PAYMENT_REQUEST_TASK = 'receiveByCashuPaymentRequestTask'

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
        transaction.update({inputToken: encodedToken})        

        // Handle blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            transactionData.push({
                status: TransactionStatus.BLOCKED,
                mintToReceive,
                createdAt: new Date()
            })

            transaction.update({                
                status: TransactionStatus.BLOCKED,
                data: JSON.stringify(transactionData),
            })

            return {
                taskFunction: RECEIVE_TASK,
                transaction,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionTaskResult
        }

        const {            
            receivedAmount,
            receivedProofs, 
            outputToken,            
            swapFeePaid,             
        } = await receiveSync(
            mintToReceive,
            token,
            token.memo || '',
            transaction.id
        )
        
 
        // Finally, update completed transaction
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            swapFeePaid,         
            receivedAmount,
            unit,                      
            createdAt: new Date(),
        })

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        
        transaction.update({
            status: TransactionStatus.COMPLETED,
            data: JSON.stringify(transactionData),
            outputToken,
            balanceAfter,
            ...(receivedAmount !== amountToReceive && {receivedAmount}),
            ...(swapFeePaid > 0 && {fee: swapFeePaid})
        })

        return {
            taskFunction: RECEIVE_TASK,
            mintUrl: mintToReceive,
            transaction,
            message: `You've received ${formatCurrency(receivedAmount, getCurrency(unit).code)} ${getCurrency(unit).code} to your Minibits wallet.`,
            receivedAmount,
            receivedProofsCount: receivedProofs.length
        } as TransactionTaskResult
        
    } catch (e: any) {
        if (transaction) {            

            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
                errorToken: e.params?.errorToken || undefined
            })

            transaction.update({
                status: TransactionStatus.ERROR,
                data: JSON.stringify(transactionData)
            })
        }

        log.error(e.name, e.message)

        return {
            taskFunction: RECEIVE_TASK,
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
        transaction.update({inputToken: encodedToken})        

        // Handle blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            transactionData.push({
                status: TransactionStatus.BLOCKED,
                mintToReceive,
                createdAt: new Date()
            })

            transaction.update({                
                status: TransactionStatus.BLOCKED,
                data: JSON.stringify(transactionData),
            })

            return {
                taskFunction: RECEIVE_OFFLINE_PREPARE_TASK,
                mintUrl: mintToReceive,
                transaction,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as unknown as TransactionTaskResult
        }

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED_OFFLINE,            
            createdAt: new Date(),
        })

        transaction.update( {           
            status: TransactionStatus.PREPARED_OFFLINE,
            data: JSON.stringify(transactionData),
        })        

        return {
            taskFunction: RECEIVE_OFFLINE_PREPARE_TASK,
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

            transaction.update({                
                status: TransactionStatus.ERROR,
                data: JSON.stringify(transactionData),
            })
        }

        log.error(e.name, e.message)

        return {
            taskFunction: RECEIVE_OFFLINE_PREPARE_TASK,
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

        let transactionData = [] as unknown as TransactionData

        try {
            transactionData = JSON.parse(transaction.data)
        } catch (e) {}

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
            transactionData.push({
                status: TransactionStatus.BLOCKED,
                mintToReceive,
                createdAt: new Date()
            })

            transaction.update({                
                status: TransactionStatus.BLOCKED,
                data: JSON.stringify(transactionData),
            })

            return {
                taskFunction: RECEIVE_OFFLINE_COMPLETE_TASK,
                mintUrl: mintToReceive,
                transaction,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionTaskResult
        }

        const {             
            receivedAmount, 
            outputToken,
            swapFeePaid,             
        } = await receiveSync(
            mintToReceive,
            token,
            token.memo || '',
            transaction.id
        )
 
        // Finally, update completed transaction
        transactionData.push({
            status: TransactionStatus.COMPLETED,  
            receivedAmount,
            swapFeePaid,
            unit,                     
            createdAt: new Date(),
        })        

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        
        transaction.update({
            status: TransactionStatus.COMPLETED,
            data: JSON.stringify(transactionData),
            outputToken,
            balanceAfter,
            ...(receivedAmount !== transaction.amount && {receivedAmount}),
            ...(swapFeePaid > 0 && {fee: swapFeePaid})
        })

        return {
            taskFunction: RECEIVE_OFFLINE_COMPLETE_TASK,
            mintUrl: mintToReceive,
            transaction,
            message: `You've received ${formatCurrency(receivedAmount, getCurrency(unit).code)} ${getCurrency(unit).code} to your Minibits wallet.`,
            receivedAmount,
        } as TransactionTaskResult

    } catch (e: any) {
        // release lock
        if(transaction) {
                
            let transactionData = [] as unknown as TransactionData

            try {
                transactionData = JSON.parse(transaction.data)
            } catch (e) {}

            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
            })
    
            transaction.update({
                status: TransactionStatus.ERROR,
                data: JSON.stringify(transactionData)
            })
        }        

        return {
            taskFunction: RECEIVE_OFFLINE_COMPLETE_TASK,
            mintUrl: mintToReceive,
            transaction,
            message: '',
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}



export const receiveByCashuPaymentRequestTask = async function (
    paymentRequestPayload: PaymentRequestPayload,    
): Promise<TransactionTaskResult> {

  const transactionData = []  as unknown as TransactionData
  let transaction: Transaction | undefined = undefined
  const unit = paymentRequestPayload.unit as MintUnit
  const mintToReceive = paymentRequestPayload.mint
  const proofsToReceive = paymentRequestPayload.proofs
  const paymentRequestId = paymentRequestPayload.id

  try {        
        if (!mintToReceive || !unit || !Array.isArray(proofsToReceive) || proofsToReceive.length === 0) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Payment request payload is invalid.',
                {paymentRequestPayload}
            )
        }                

        // Let's find transaction with related payment request
        const transaction = transactionsStore.findBy({paymentRequest: paymentRequestId})

        if(!transaction) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Related Payment request could not be found in the wallet.',
                {paymentRequestPayload}
            )            
        }

        const amountToReceive = CashuUtils.getProofsAmount(proofsToReceive)        
        const memo = paymentRequestPayload.memo || 'PR ' + paymentRequestId

        if(transaction.unit !== unit || transaction.amount !== amountToReceive) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Related Payment request has different amount or unit than the incoming payment.',
                {
                    expectedUnit: transaction.unit, 
                    expectedAmount: transaction.amount, 
                    amountToReceive, unit, 
                    paymentRequestId, 
                    caller: 'receiveByCashuPaymentRequestTask'
                }
            ) 
        }
        
        // Handle blocked mint
        const isBlocked = mintsStore.isBlocked(mintToReceive)

        if (isBlocked) {
            transactionData.push({
                status: TransactionStatus.BLOCKED,
                message: 'Mint is blocked in your Settings, ecash has not been received.',
            })

            transaction.update({                
                status: TransactionStatus.BLOCKED,
                data: JSON.stringify(transactionData),
            })

            return {
                taskFunction: RECEIVE_BY_CASHU_PAYMENT_REQUEST_TASK,
                transaction,
                message: `The mint ${mintToReceive} is blocked. You can unblock it in Settings.`,
            } as TransactionTaskResult
        }

        // TODO rework to PR payload
        const {            
            receivedAmount,
            receivedProofs, 
            outputToken,            
            swapFeePaid,             
        } = await receiveSync(
            mintToReceive,
            paymentRequestPayload,
            memo,
            transaction.id
        )
        
 
        // Finally, update completed transaction
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            swapFeePaid,         
            receivedAmount,
            unit,                      
            createdAt: new Date(),
        })

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
        
        transaction.update({
            status: TransactionStatus.COMPLETED,
            data: JSON.stringify(transactionData),
            outputToken,
            balanceAfter,
            ...(receivedAmount !== amountToReceive && {receivedAmount}),
            ...(swapFeePaid > 0 && {fee: swapFeePaid})
        })

        return {
            taskFunction: RECEIVE_BY_CASHU_PAYMENT_REQUEST_TASK,
            mintUrl: mintToReceive,
            transaction,
            message: `Payment request ${paymentRequestId} with amount of ${formatCurrency(receivedAmount, getCurrency(unit).code)} ${getCurrency(unit).code} has been paid.`,
            receivedAmount,
            receivedProofsCount: receivedProofs.length
        } as TransactionTaskResult
        
    } catch (e: any) {
        if (transaction) {            

            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
                errorToken: e.params?.errorToken || undefined
            })

            transaction.update({
                status: TransactionStatus.ERROR,
                data: JSON.stringify(transactionData)
            })
        }

        log.error(e.name, e.message)

        return {
            taskFunction: RECEIVE_BY_CASHU_PAYMENT_REQUEST_TASK,
            mintUrl: mintToReceive,
            transaction,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}


export const receiveSync = async function (
    mintToReceive: string,
    token: Token | PaymentRequestPayload,    
    memo: string,    
    transactionId: number
) {
  
  const unit = token.unit as MintUnit || 'sat' 

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
        
        let receivedResult = {} as unknown as {proofs: CashuProof[], swapFeePaid: number}

        try {
            receivedResult = await walletStore.receive(
                mintToReceive,
                unit as MintUnit,
                token,
                transactionId   
            )
        } catch (e: any) {            
            if(e.message.includes('outputs have already been signed before')) {                
                log.error('[receiveSync] Increasing proofsCounter outdated values and repeating receiveSync.')
                receivedResult = await walletStore.receive(
                    mintToReceive,
                    unit as MintUnit,
                    token,
                    transactionId,
                    {increaseCounterBy: 10}
                )
            } else {
                throw e
            }
        }
        
        const receivedProofs = receivedResult!.proofs
        const swapFeePaid = receivedResult!.swapFeePaid       
       
        const { addedAmount: receivedAmount } = WalletUtils.addCashuProofs(
            mintToReceive,
            receivedProofs,
            {
                unit,
                transactionId: transactionId,
                isPending: false
            }                    
        )        

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
            swapFeePaid            
        }
        
    } catch (e: any) {
        if (e instanceof AppError) {
            throw e
        } else {
            throw new AppError(Err.WALLET_ERROR, e.message, e.stack.slice(0, 200))
        }
    }
}
