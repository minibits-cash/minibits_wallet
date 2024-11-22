import {CashuUtils, ProofV3, TokenEntryV3} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {MeltQuoteResponse, MeltQuoteState} from '@cashu/cashu-ts'
import {rootStoreInstance} from '../../models'
import { TransactionTaskResult, WalletTask } from '../walletService'
import { MintBalance, MintProofsCounter } from '../../models/Mint'
import { Proof } from '../../models/Proof'
import { Transaction, TransactionData, TransactionStatus, TransactionType } from '../../models/Transaction'
import { log } from '../logService'
import { WalletUtils } from './utils'
import {isBefore} from 'date-fns'
import { MintUnit, formatCurrency, getCurrency } from './currency'
import { NostrEvent } from '../nostrService'
import { MinibitsClient } from '../minibitsService'
import { getSnapshot } from 'mobx-state-tree'
import { MINIBITS_MINT_URL } from '@env'
import { receiveSync } from './receiveTask'

const {
    transactionsStore,
    mintsStore,
    proofsStore,
    walletStore
} = rootStoreInstance

const NWC_TRANSFER = 'nwcTransferTask'

export const nwcTransferTask = async function (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    feeReserve: number,
    unit: MintUnit,    
    memo: string,
    invoiceExpiry: Date,    
    encodedInvoice: string,
    nwcEvent: NostrEvent
)  : Promise<TransactionTaskResult> {

    const mintUrl = mintBalanceToTransferFrom.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)
    
    if(mintUrl !== MINIBITS_MINT_URL) {
        throw new AppError(
            Err.VALIDATION_ERROR, 
            'Payment of NWC invoice on the Minibits server is supported only for ecash issued by Minibits mint.',
            {mintBalanceToTransferFrom}
        )
    }

    // TODO refresh - balance might be outdated if it waits in queue before other txs
    log.debug('[nwcTransfer]', 'mintBalanceToTransferFrom', {mintBalanceToTransferFrom}) 
    log.debug('[nwcTransfer]', 'amountToTransfer', {amountToTransfer, feeReserve})    

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            mintBalanceToTransferFrom,
            amountToTransfer,
            feeReserve,
            unit,
            encodedInvoice,
            isNwc: nwcEvent ? true : false,           
            createdAt: new Date(),
        }
    ]

    let transaction: Transaction | undefined = undefined
    let meltQuote: MeltQuoteResponse | undefined = undefined
    let proofsToMeltFrom: Proof[] = []
    let proofsToMeltFromAmount: number = 0
    let meltFeeReserve: number = 0

    try {
        const newTransaction = {
            type: TransactionType.NWC_TRANSFER,
            amount: amountToTransfer,
            fee: feeReserve,
            unit,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintBalanceToTransferFrom.mintUrl,
            status: TransactionStatus.DRAFT,
        }

        // store tx in db and in the model
        transaction = await transactionsStore.addTransaction(newTransaction)
        const transactionId = transaction.id
        
        if (amountToTransfer + feeReserve > mintBalanceToTransferFrom.balances[unit]!) {
            throw new AppError(
                Err.VALIDATION_ERROR, 
                'Mint balance is insufficient to cover the amount to transfer with the expected Lightning fees.',
                {transactionId}
            )
        }
    
        if(isBefore(invoiceExpiry, new Date())) {
            throw new AppError(
                Err.VALIDATION_ERROR, 
                'This invoice has already expired and can not be paid.', 
                {invoiceExpiry, transactionId}
            )
        }

        if (!mintInstance) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find mint', {mintUrl, transactionId}
            )
        }        

        // calculate fees charged by mint for melt transaction to prepare enough proofs
        const proofsFromMint = proofsStore.getByMint(mintUrl, {isPending: false, unit})
        const totalAmountFromMint = CashuUtils.getProofsAmount(proofsFromMint)

        proofsToMeltFrom = CashuUtils.getProofsToSend(
            amountToTransfer + feeReserve,
            proofsFromMint
        )

        proofsToMeltFromAmount = CashuUtils.getProofsAmount(proofsToMeltFrom)
        meltFeeReserve = mintInstance.getMintFeeReserve(proofsToMeltFrom)
        const amountWithFees = amountToTransfer + feeReserve + meltFeeReserve

        if (totalAmountFromMint < amountWithFees) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'There is not enough funds to send this amount.',
                {totalAmountFromMint, amountWithFees, transactionId, caller: 'nwcTransferTask'},
            )
        }

        // exact match or min number of proofs that matches the amount
        if(meltFeeReserve > 0) {
            proofsToMeltFrom = CashuUtils.getProofsToSend(
                amountWithFees,
                proofsFromMint
            )

            proofsToMeltFromAmount = CashuUtils.getProofsAmount(proofsToMeltFrom)
        }

        proofsStore.removeProofs(proofsToMeltFrom)
        WalletUtils.addCashuProofs(
            mintUrl, 
            proofsToMeltFrom, 
            {
                unit,
                transactionId: transaction.id,
                isPending: true
            }                
        )        

        log.trace('[nwcTransfer]', 'Prepared proofsToMeltFrom proofs', {
            proofsToMeltFromAmount,             
            transactionId,                       
            unit, 
        })

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            proofsToMeltFromAmount,
            lightningFeeReserve: feeReserve,
            meltFeeReserve,
            createdAt: new Date(),
        })

        transaction.setStatus(            
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )

        const cleanedproofsToMeltFrom = proofsToMeltFrom.map(proof => {                
            const {mintUrl, unit, tId, ...rest} = getSnapshot(proof)
            return rest                
        })
        
        const inputTokenEntry: TokenEntryV3 = {
            mint: mintUrl,
            proofs: cleanedproofsToMeltFrom,
        }

        const tokenToPayFrom = {
            token: [inputTokenEntry],
            unit            
        }

        const inputToken = CashuUtils.encodeToken(tokenToPayFrom)

        transaction.setInputToken(inputToken)

        const result = await MinibitsClient.payNwcTransfer(
            encodedInvoice, 
            {
                token: [inputTokenEntry],
                unit            
            }
        )
        
        meltQuote = result.meltQuote
        const tokenToReturn = result.tokenToReturn // this is server wallet ecash, needs swap        
        
        if (meltQuote.state === MeltQuoteState.PAID) {
            
            log.debug('[nwcTransfer] Invoice PAID', {                 
                transactionId
            })            
            
            // Save preimage asap
            if(meltQuote.payment_preimage) {
                transaction.setProof(meltQuote.payment_preimage)
            }
            
            // If nothing was returned, all reserves were spent on fees
            let totalFeePaid = proofsToMeltFromAmount - amountToTransfer
            let lightningFeePaid = totalFeePaid - meltFeeReserve
            let meltFeePaid = meltFeeReserve                  
            let swapFeePaid = 0
            let returnedAmount

            if (tokenToReturn) {    
                // Save returned token in case receive fails                
                const outputTokenBeforeSwap = CashuUtils.encodeToken(tokenToReturn)    
                transaction.setOutputToken(outputTokenBeforeSwap)  

                // Swap returned proofs as they were issued to the server wallet thus are not linked to the wallet seed                
                const receiveResult = await receiveSync(
                    mintUrl,
                    tokenToReturn,    
                    memo,    
                    transactionId
                )

                swapFeePaid = receiveResult.swapFeePaid
                totalFeePaid = totalFeePaid - receiveResult.receivedAmount                
                lightningFeePaid = totalFeePaid - meltFeeReserve - swapFeePaid
                returnedAmount = receiveResult.receivedAmount

                // re-save with swapped token                            
                transaction.setOutputToken(receiveResult.outputToken)                
            }

            // spend pending proofsToMeltFrom reserved for transaction
            // only after receive passed, in case of exception they remain pending
            proofsStore.removeProofs(proofsToMeltFrom as Proof[], true, false)
    
            // Save final fee in db
            if(totalFeePaid !== transaction.fee) {                
                transaction.setFee(totalFeePaid)
            }        
    
            // Update transaction status
            transactionData.push({
                status: TransactionStatus.COMPLETED,
                lightningFeeReserve: meltQuote.fee_reserve,
                lightningFeePaid,
                meltFeePaid,
                swapFeePaid,
                returnedAmount,              
                preimage: meltQuote.payment_preimage,                
                createdAt: new Date(),
            })    
            
            transaction.setStatus(            
                TransactionStatus.COMPLETED,
                JSON.stringify(transactionData),
            )
    
            const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
            transaction.setBalanceAfter(balanceAfter)       
    
            return {
                taskFunction: NWC_TRANSFER,
                mintUrl,
                transaction,
                message: `Lightning invoice has been successfully paid and settled with your Minibits ecash. Fee has been ${formatCurrency(transaction.fee, getCurrency(unit).code)} ${getCurrency(unit).code}.`,
                lightningFeePaid,
                meltFeePaid,
                swapFeePaid,
                totalFeePaid,             
                meltQuote,
                preimage: meltQuote.payment_preimage,
                nwcEvent
            } as TransactionTaskResult

        } else if(meltQuote.state === MeltQuoteState.PENDING) {            

            log.debug('[transfer] Invoice PENDING', {                 
                meltQuote,                 
                transactionId
            })

            return {
                taskFunction: NWC_TRANSFER,
                mintUrl,
                transaction,
                message: `Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.`,                                
                meltQuote,                
                nwcEvent
            } as TransactionTaskResult

        } else {
            // throw so that proper state of proofs is synced inside the catch block
            throw new AppError(Err.MINT_ERROR, 'Lightning payment has not been paid.', {
                state: meltQuote.state, 
                transactionId
            })
        }

    } catch (e: any) {
        if (transaction) { 
            
            let message = e.message
            
            if (proofsToMeltFrom.length > 0) {                
                // check with the mint the real status of the proofs involved in transaction
                await WalletTask.syncStateWithMintSync(                   
                    {
                        proofsToSync: proofsToMeltFrom,
                        mintUrl,
                        isPending: true
                    }
                )
                
                // force refresh just in case above method did not update the model?
                const refreshed = transactionsStore.findById(transaction.id)

                if(refreshed?.status === TransactionStatus.PENDING) {
                    log.warn('[transfer]', 'proofsToPay from transfer with error are pending by mint', {
                        proofsToMeltFromAmount, 
                        unit,
                        transactionId: transaction.id
                    })

                    message = 'Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.'
                    // needs to be returned as error

                } else if(refreshed?.status === TransactionStatus.COMPLETED) { 
                    // Likely receiving of change failed due to wallet error. We keep completed as status.
                    log.error('[nwcTransfer]', 'NWC Transfer throwed error but the payment suceeded', {
                        error: e.message,
                        proofsToMeltFromAmount, 
                        unit,
                        transactionId: transaction.id
                    })

                    if(meltQuote?.payment_preimage) {
                        refreshed.setProof(meltQuote?.payment_preimage)
                    }

                    const message = `Lightning invoice has been successfully paid, however some error occured: ${e.message}`                        

                    return {
                        taskFunction: NWC_TRANSFER,
                        mintUrl,
                        transaction,
                        message,
                        meltQuote,
                        preimage: meltQuote?.payment_preimage,
                        nwcEvent
                    } as TransactionTaskResult
                    
                } else {
                    // syncStateWithMintSync returns to spendable only proofs that were pending by mint before 
                    // so we need to take care of our transfer here.

                    log.warn('[transfer]', 'proofsToPay from transfer with error to be returned to spendable wallet', {
                        proofsToMeltFromAmount, 
                        unit,
                        transactionId: transaction.id
                    })

                    // remove it from pending proofs in the wallet
                    proofsStore.removeProofs(proofsToMeltFrom as Proof[], true, true)
                    // add proofs back to the spendable wallet with internal references
                    WalletUtils.addCashuProofs(
                        mintUrl, 
                        proofsToMeltFrom, 
                        {
                            unit,
                            transactionId: transaction.id,
                            isPending: false
                        }
                    )                    
                }
            }

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

        log.error('[transfer]', e.name, e.message, e.params)

        return {
            taskFunction: NWC_TRANSFER,
            mintUrl,
            transaction,
            message: e.message,
            error: WalletUtils.formatError(e),
            meltQuote,
            nwcEvent
        } as TransactionTaskResult
  }
}