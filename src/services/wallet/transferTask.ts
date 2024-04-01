import {CashuUtils} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {type Proof as CashuProof} from '@cashu/cashu-ts'
import {rootStoreInstance} from '../../models'
import { TransactionTaskResult, WalletTask } from '../walletService'
import { MintBalance } from '../../models/Mint'
import { Proof } from '../../models/Proof'
import { Transaction, TransactionData, TransactionRecord, TransactionStatus, TransactionType } from '../../models/Transaction'
import { log } from '../logService'
import { MintClient, MintKeys } from '../cashuMintClient'
import { WalletUtils } from './utils'
import isBefore from 'date-fns/isBefore'
import { sendFromMint } from './sendTask'

const {
    transactionsStore,
    mintsStore,
    proofsStore
} = rootStoreInstance

const TRANSFER = 'transferTask'

export const transferTask = async function (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    estimatedFee: number,
    invoiceExpiry: Date,
    memo: string,
    encodedInvoice: string,
)  : Promise<TransactionTaskResult> {
    const mintUrl = mintBalanceToTransferFrom.mint
    const mintInstance = mintsStore.findByUrl(mintUrl)

    log.debug('[transfer]', 'mintBalanceToTransferFrom', mintBalanceToTransferFrom)
    log.debug('[transfer]', 'amountToTransfer', amountToTransfer)
    log.debug('[transfer]', 'estimatedFee', estimatedFee)

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            mintBalanceToTransferFrom,
            encodedInvoice,
            amountToTransfer,
            estimatedFee,
            createdAt: new Date(),
        }
    ]

    let transactionId: number = 0
    let proofsToPay: CashuProof[] = []

    try {
        if (amountToTransfer + estimatedFee > mintBalanceToTransferFrom.balance) {
            throw new AppError(Err.VALIDATION_ERROR, 'Mint balance is insufficient to cover the amount to transfer with expected Lightning fees.')
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
            fee: estimatedFee,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintBalanceToTransferFrom.mint,
            status: TransactionStatus.DRAFT,
        }

        // store tx in db and in the model
        const storedTransaction: TransactionRecord =
        await transactionsStore.addTransaction(newTransaction)
        
        transactionId = storedTransaction.id as number

        // get proofs ready to be paid to the mint
        proofsToPay = await sendFromMint(
            mintBalanceToTransferFrom,
            amountToTransfer + estimatedFee,
            [],
            transactionId,
        )

        const proofsAmount = CashuUtils.getProofsAmount(proofsToPay as Proof[])
        log.debug('[transfer]', 'Prepared poofsToPay amount', proofsAmount)

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            createdAt: new Date(),
        })

        await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )        

        // we do not know how much we will get so use big enough constant to increase and lock
        const countOfInFlightProofs = 10
        // temp increase the counter + acquire lock and set inFlight values                        
        await WalletUtils.lockAndSetInFlight(mintInstance, countOfInFlightProofs, transactionId)

        // get locked counter values
        const lockedProofsCounter = mintInstance.getOrCreateProofsCounter?.() 
        
        let paymentResult: {feeSavedProofs: CashuProof[], isPaid: boolean, preimage: string | null, newKeys?: MintKeys} = {
            feeSavedProofs: [],
            isPaid: false,
            preimage: null,
            newKeys: undefined
        }

        try {
            paymentResult = await MintClient.payLightningInvoice(
                mintUrl,
                encodedInvoice,
                proofsToPay,
                estimatedFee,
                lockedProofsCounter.inFlightFrom as number
            )    
        } catch (e: any) {
            if (e instanceof AppError && 
                e.params && 
                e.params.message?.includes('outputs have already been signed before')) {

                    log.error('[transfer] Emergency increase of proofsCounter and retrying the send')

                    mintInstance.increaseProofsCounter(20)
                    paymentResult = await MintClient.payLightningInvoice(
                        mintUrl,
                        encodedInvoice,
                        proofsToPay,
                        estimatedFee,
                        lockedProofsCounter.inFlightFrom as number + 20 
                    )
                    
                    log.error('[transfer] Emergency increase of proofsCounter, payLightningInvoice retry result', {paymentResult})
            } else {
                throw e
            }
        }

        mintInstance.decreaseProofsCounter(countOfInFlightProofs) 
        
        const {newKeys, isPaid, feeSavedProofs} = paymentResult
        if (newKeys) {WalletUtils.updateMintKeys(mintUrl, newKeys)}

        // We've sent the proofsToPay to the mint, so we remove those pending proofs from model storage.
        // Hopefully mint gets important shit done synchronously.        
        await WalletTask.handleSpentByMint({mintUrl, isPending: true})

        // I have no idea yet if this can happen, unpaid call throws, return sent Proofs to the store an track tx as Reverted
        if (!isPaid) {
            const { amountPendingByMint } = await _moveProofsFromPending(proofsToPay, mintUrl, transactionId)
            // release lock
            mintInstance.resetInFlight(transactionId)

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
                
                // There is not clear way to get refund for saved fees later so we treat estimated fees as final
                await transactionsStore.updateFee(transactionId, estimatedFee)

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
                    message: 'Payment of lightning invoice failed. Coins were returned to your wallet.',
                } as TransactionTaskResult
            }            
        }

        // If real fees were less then estimated, cash the returned savings.
        let finalFee = estimatedFee

        if (feeSavedProofs.length) {
            
            const {addedAmount: feeSaved} = WalletUtils.addCashuProofs(
                feeSavedProofs, 
                mintUrl, 
                transactionId                
            )
            
            finalFee = estimatedFee - feeSaved            
        }

        // release lock
        mintInstance.resetInFlight(transactionId)

        // Save final fee in db
        await transactionsStore.updateFee(transactionId, finalFee)

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            finalFee,
            createdAt: new Date(),
        })

        // this overwrites transactionData and COMPLETED status already set by _checkSpentByMint
        const completedTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getBalances().totalBalance

        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)       

        return {
            taskFunction: TRANSFER,
            mintUrl,
            transaction: completedTransaction,
            message: `Lightning invoice has been successfully paid and settled with your Minibits ecash. Final network fee has been ${finalFee} SATS.`,
            finalFee,
        } as TransactionTaskResult
    } catch (e: any) {        
        // Update transaction status if we have any
        let errorTransaction: TransactionRecord | undefined = undefined

        if (transactionId > 0) {            
            // release lock  
            if(mintInstance) {
                mintInstance.resetInFlight(transactionId as number)
            }

            // Return tokens intended for payment to the wallet if payment failed with an error
            if (proofsToPay.length > 0) {
                log.warn('[transfer]', 'Returning proofsToPay to the wallet likely after failed lightning payment.', proofsToPay.length)
                
                const { 
                    amountToMove, 
                    amountPendingByMint 
                } = await _moveProofsFromPending(proofsToPay, mintUrl, transactionId)

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
                    
                    // There is not clear way to get refund for saved fees later so we treat estimated fees as final
                    await transactionsStore.updateFee(transactionId, estimatedFee)

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
            message: '',
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
  }
}


const _moveProofsFromPending = async function (
    proofsToMove: CashuProof[],
    mintUrl: string,
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
    }

    const amountToMove = CashuUtils.getProofsAmount(proofsToMove as Proof[])
    
    // Here we move proofs from pending back to spendable wallet in case of lightning payment failure
    
    // Check with the mint if the proofs are not marked as pending. This happens when lightning payment fails
    // due to the timeout but mint's node keeps the payment as in-flight (e.g. receiving node holds the invoice)
    // In this case we need to keep such proofs as pending and not move them back to wallet as in other payment failures.    
    const {pending: pendingByMint} = await MintClient.getSpentOrPendingProofsFromMint(
        mintUrl,
        proofsToMove as Proof[],
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