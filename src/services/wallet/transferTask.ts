import {CashuUtils, ProofV3} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {MeltQuoteResponse} from '@cashu/cashu-ts'
import {rootStoreInstance} from '../../models'
import { TransactionTaskResult, WalletTask } from '../walletService'
import { MintBalance, MintProofsCounter } from '../../models/Mint'
import { Proof } from '../../models/Proof'
import { Transaction, TransactionData, TransactionRecord, TransactionStatus, TransactionType } from '../../models/Transaction'
import { log } from '../logService'
import { WalletUtils } from './utils'
import {isBefore} from 'date-fns'
import { sendFromMint } from './sendTask'
import { MintUnit, formatCurrency, getCurrency } from './currency'

const {
    transactionsStore,
    mintsStore,
    proofsStore, 
    walletStore,   
} = rootStoreInstance

// const {walletStore} = nonPersistedStores

const TRANSFER = 'transferTask'

export const transferTask = async function (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    unit: MintUnit,
    meltQuote: MeltQuoteResponse,
    memo: string,
    invoiceExpiry: Date,    
    encodedInvoice: string,
)  : Promise<TransactionTaskResult> {
    const mintUrl = mintBalanceToTransferFrom.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)
    let lockedProofsCounter: MintProofsCounter | undefined = undefined

    log.debug('[transfer]', 'mintBalanceToTransferFrom', mintBalanceToTransferFrom)
    log.debug('[transfer]', 'amountToTransfer', amountToTransfer)
    log.debug('[transfer]', 'meltQuote', meltQuote)

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            mintBalanceToTransferFrom,
            amountToTransfer,
            unit,
            meltQuote,
            encodedInvoice,            
            createdAt: new Date(),
        }
    ]

    let transactionId: number = 0
    let proofsToPay: ProofV3[] = []

    try {
        if (amountToTransfer + meltQuote.fee_reserve > mintBalanceToTransferFrom.balances[unit]!) {
            throw new AppError(Err.VALIDATION_ERROR, 'Mint balance is insufficient to cover the amount to transfer with the expected Lightning fees.')
        }
    
        if(isBefore(invoiceExpiry, new Date())) {
            throw new AppError(Err.VALIDATION_ERROR, 'This invoice has already expired and can not be paid.', {invoiceExpiry})
        }

        if (!mintInstance) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find mint', {mintUrl}
            )
        }

        const newTransaction: Transaction = {
            type: TransactionType.TRANSFER,
            amount: amountToTransfer,
            fee: meltQuote.fee_reserve,
            unit,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintBalanceToTransferFrom.mintUrl,
            status: TransactionStatus.DRAFT,
        }

        // store tx in db and in the model
        const storedTransaction: TransactionRecord =
        await transactionsStore.addTransaction(newTransaction)
        
        transactionId = storedTransaction.id as number

        // calculate fees charged by mint for melt transaction to prepare enough proofs
        const proofsFromMint = proofsStore.getByMint(mintUrl, {isPending: false, unit}) as Proof[]  

        let proofsToSendFrom = CashuUtils.getProofsToSend(
            amountToTransfer + meltQuote.fee_reserve,
            proofsFromMint
        )

        let meltFeeReserve = mintInstance.getMintFeeReserve(proofsToSendFrom) 

        log.trace('[transfer]', {
            meltFeeReserve, 
            amountWithFees: amountToTransfer + meltQuote.fee_reserve + meltFeeReserve,
        })

        // get proofs ready to be paid to the mint
        const swapResult = await sendFromMint(
            mintBalanceToTransferFrom,
            amountToTransfer + meltQuote.fee_reserve + meltFeeReserve,
            unit,
            [],
            transactionId,
        )

        proofsToPay = swapResult.proofs
        const {mintFeePaid, mintFeeReserve} = swapResult
        const proofsAmount = CashuUtils.getProofsAmount(proofsToPay)

        log.debug('[transfer]', 'Prepared poofsToPay amount', proofsAmount)

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

        // number of outputs we can get back with returned lightning fees
        let countOfInFlightProofs = 1
        if(meltQuote.fee_reserve > 1) {
            countOfInFlightProofs = Math.ceil(Math.log2(meltQuote.fee_reserve))
        }

        // temp increase the counter + acquire lock and set inFlight values                        
        lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
            mintInstance, 
            unit, 
            countOfInFlightProofs, 
            transactionId
        )        

        const {isPaid, preimage, feeSavedProofs} = await walletStore.payLightningMelt(
            mintUrl,
            unit,
            meltQuote,
            proofsToPay,
            {
                counter: lockedProofsCounter.inFlightFrom as number
            }
        )    

        lockedProofsCounter.decreaseProofsCounter(countOfInFlightProofs) 
                
        // We've sent the proofsToPay to the mint, so we remove those pending proofs from model storage.
        // Hopefully mint gets important shit done synchronously.        
        await WalletTask.handleSpentByMint({mintUrl, isPending: true})

        // I have no idea yet if this can happen, unpaid call throws, return sent Proofs to the store an track tx as Reverted
        if (!isPaid) {
            const { amountPendingByMint } = await _moveProofsFromPending(proofsToPay, mintUrl, unit, transactionId)
            // release lock
            lockedProofsCounter.resetInFlight(transactionId)

            if(amountPendingByMint > 0) {
                transactionData.push({
                    status: TransactionStatus.PENDING,                    
                    amountPendingByMint,
                })

                const pendingTransaction = await transactionsStore.updateStatus(
                    transactionId,
                    TransactionStatus.PENDING,
                    JSON.stringify(transactionData),
                )

                return {
                    taskFunction: TRANSFER,
                    mintUrl,
                    transaction: pendingTransaction,
                    message: 'Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.',                    
                } as TransactionTaskResult
            } else {
                transactionData.push({
                    status: TransactionStatus.REVERTED,
                    createdAt: new Date(),
                })
    
                const revertedTransaction = await transactionsStore.updateStatus(
                    transactionId,
                    TransactionStatus.REVERTED,
                    JSON.stringify(transactionData),
                )
    
                return {
                    taskFunction: TRANSFER,
                    mintUrl,
                    transaction: revertedTransaction,
                    message: 'Payment of lightning invoice failed. Reserved ecash was returned to your wallet.',
                } as TransactionTaskResult
            }            
        }

        // If real fees were less then estimated, cash the returned savings.
        let lightningFeePaid = meltQuote.fee_reserve

        if (feeSavedProofs.length) {            
            const {addedAmount: feeSaved} = WalletUtils.addCashuProofs(
                mintUrl, 
                feeSavedProofs, 
                {
                    unit,
                    transactionId,
                    isPending: false
                }
                
            )
            
            lightningFeePaid = meltQuote.fee_reserve - feeSaved            
        }

        // release lock
        lockedProofsCounter.resetInFlight(transactionId)

        // Save final fee in db
        if(lightningFeePaid + mintFeePaid !== meltQuote.fee_reserve) {
            await transactionsStore.updateFee(transactionId, lightningFeePaid + mintFeePaid)
        }        

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            lightningFeeReserve: meltQuote.fee_reserve,
            lightningFeePaid,
            preimage, // TODO add to tx details
            createdAt: new Date(),
        })

        // this overwrites transactionData and COMPLETED status already set by _checkSpentByMint
        const completedTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!

        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)       

        return {
            taskFunction: TRANSFER,
            mintUrl,
            transaction: completedTransaction,
            message: `Lightning invoice has been successfully paid and settled with your Minibits ecash. Fee has been ${formatCurrency(lightningFeePaid + mintFeePaid, getCurrency(unit).code)} ${getCurrency(unit).code}.`,
            lightningFeePaid,
            mintFeePaid
        } as TransactionTaskResult

    } catch (e: any) {        
        // Update transaction status if we have any
        let errorTransaction: TransactionRecord | undefined = undefined

        if (transactionId > 0) {            
            // release lock  
            if(lockedProofsCounter) {
                lockedProofsCounter.resetInFlight(transactionId as number)
            }

            // Return tokens intended for payment to the wallet if payment failed with an error
            if (proofsToPay.length > 0) {
                log.warn('[transfer]', 'Returning proofsToPay to the wallet likely after failed lightning payment.', proofsToPay.length)
                
                const { 
                    amountToMove, 
                    amountPendingByMint 
                } = await _moveProofsFromPending(proofsToPay, mintUrl, unit, transactionId)

                // keep tx as pending if proofs were not added because of a mint that keeps them as pending for timed out in-flight payment
                if(amountPendingByMint > 0) {
                    transactionData.push({
                        status: TransactionStatus.PENDING,
                        error: WalletUtils.formatError(e),
                        amountToMove,
                        amountPendingByMint,
                        createdAt: new Date()
                    })
    
                    const pendingTransaction = await transactionsStore.updateStatus(
                        transactionId,
                        TransactionStatus.PENDING,
                        JSON.stringify(transactionData),
                    )

                    return {
                        taskFunction: TRANSFER,
                        transaction: pendingTransaction,
                        message: 'Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.',
                        error: WalletUtils.formatError(e),
                    } as TransactionTaskResult
                }

            }

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

        log.error('[transfer]', e.name, e.message, e.params)

        return {
            taskFunction: TRANSFER,
            mintUrl,
            transaction: errorTransaction || undefined,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
  }
}


const _moveProofsFromPending = async function (
    proofsToMove: ProofV3[],
    mintUrl: string,
    unit: MintUnit,
    transactionId: number,    
): Promise<{
    amountToMove: number,
    amountPendingByMint: number,
    movedAmount: number
}> {
    // Add internal references
    for (const proof of proofsToMove as Proof[]) {
        proof.tId = transactionId
        proof.mintUrl = mintUrl
        proof.unit = unit
    }

    const amountToMove = CashuUtils.getProofsAmount(proofsToMove as Proof[])
    
    // Here we move proofs from pending back to spendable wallet in case of lightning payment failure
    
    // Check with the mint if the proofs are not marked as pending. This happens when lightning payment fails
    // due to the timeout but mint's node keeps the payment as in-flight (e.g. receiving node holds the invoice)
    // In this case we need to keep such proofs as pending and not move them back to wallet as in other payment failures.    
    const {pending: pendingByMint} = await walletStore.getSpentOrPendingProofsFromMint(
        mintUrl,
        unit,
        proofsToMove as Proof[]
    )

    let amountPendingByMint: number = 0
    let movedAmount: number = 0
    const movedProofs: Proof[] = []

    for (const proof of proofsToMove) {
        // if proof to return to the wallet is tracked by mint as pending we do not move it from wallet's pending
        if(pendingByMint.some(p => p.secret === proof.secret)){
            // add it to the list of secrets so we can later handle them based on eventual lightning payment result
            if(proofsStore.addToPendingByMint(proof as Proof)) {
                amountPendingByMint += proof.amount
            }
        } else {
            movedAmount += proof.amount
            movedProofs.push(proof as Proof)
        }
    }

    if(movedProofs.length > 0) {
        // remove it from pending proofs in the wallet
        proofsStore.removeProofs(movedProofs, true, true)
        // add proofs back to the spendable wallet
        proofsStore.addProofs(movedProofs)

        log.trace('[_moveProofsFromPending]', 'Moved proofs back from pending to spendable', {amountToMove, amountPendingByMint, movedAmount})
    }
    
    if(amountPendingByMint > 0 && amountPendingByMint !== amountToMove) {
        // This should not happen, monitor
        log.warn('[_moveProofsFromPending]', 'Not all proofs to be moved were pending by the mint')
    }
    
    return {
        amountToMove,
        amountPendingByMint,
        movedAmount
    }
}