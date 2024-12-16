import {CashuUtils} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {MeltProofsResponse, MeltQuoteResponse, MeltQuoteState, getEncodedToken} from '@cashu/cashu-ts'
import {rootStoreInstance} from '../../models'
import { TransactionTaskResult, WalletTask } from '../walletService'
import { MintBalance, MintProofsCounter } from '../../models/Mint'
import { Proof } from '../../models/Proof'
import { Transaction, TransactionData, TransactionRecord, TransactionStatus, TransactionType } from '../../models/Transaction'
import { log } from '../logService'
import { WalletUtils } from './utils'
import {isBefore} from 'date-fns'
import { MintUnit, formatCurrency, getCurrency } from './currency'
import { NostrEvent } from '../nostrService'

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
    nwcEvent?: NostrEvent
)  : Promise<TransactionTaskResult> {
    const mintUrl = mintBalanceToTransferFrom.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)
    let lockedProofsCounter: MintProofsCounter | undefined = undefined

    // TODO refresh - balance might be outdated if it waits in queue before other txs
    log.debug('[transfer]', 'mintBalanceToTransferFrom', {mintBalanceToTransferFrom}) 
    log.debug('[transfer]', 'amountToTransfer', {amountToTransfer})
    log.debug('[transfer]', 'meltQuote', {meltQuote})

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            mintBalanceToTransferFrom,
            amountToTransfer,
            unit,
            meltQuote,
            encodedInvoice,
            isNwc: nwcEvent ? true : false,           
            createdAt: new Date(),
        }
    ]

    let transaction: Transaction | undefined = undefined
    let proofsToMeltFrom: Proof[] = []
    let proofsToMeltFromAmount: number = 0
    let meltFeeReserve: number = 0
    let meltResponse: MeltProofsResponse    

    try {
        const newTransaction = {
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
        transaction = await transactionsStore.addTransaction(newTransaction)
        const transactionId = transaction.id
        
        if (amountToTransfer + meltQuote.fee_reserve > mintBalanceToTransferFrom.balances[unit]!) {
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
            amountToTransfer + meltQuote.fee_reserve,
            proofsFromMint
        )

        proofsToMeltFromAmount = CashuUtils.getProofsAmount(proofsToMeltFrom)

        const walletInstance = await walletStore.getWallet(mintUrl, unit, {withSeed: true})        
        meltFeeReserve = walletInstance.getFeesForProofs(proofsToMeltFrom)
        const amountWithFees = amountToTransfer + meltQuote.fee_reserve + meltFeeReserve

        if (totalAmountFromMint < amountWithFees) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'There is not enough funds to send this amount.',
                {totalAmountFromMint, amountWithFees, transactionId, caller: 'transferTask'},
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

        log.trace('[transfer]', 'Prepared proofsToMeltFrom proofs', {
            proofsToMeltFromAmount,             
            transactionId,                       
            unit, 
        })

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            proofsToMeltFromAmount,
            lightningFeeReserve: meltQuote.fee_reserve,
            meltFeeReserve,
            createdAt: new Date(),
        })

        transaction.setStatus(            
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )

        const inputToken = getEncodedToken({
            mint: mintUrl,
            proofs: proofsToMeltFrom,
            unit         
        })

        transaction.setInputToken(inputToken)

        // number of outputs we can get back as a change
        let countOfInFlightProofs = proofsToMeltFrom.length
        if(proofsToMeltFromAmount - amountToTransfer > 1) {
            countOfInFlightProofs += Math.ceil(Math.log2(proofsToMeltFromAmount - amountToTransfer))
        }

        // temp increase the counter + acquire lock and set inFlight values                        
        lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
            mintInstance, 
            unit, 
            countOfInFlightProofs, 
            transaction.id
        )

        meltResponse = await walletStore.payLightningMelt(
            mintUrl,
            unit,
            meltQuote,
            proofsToMeltFrom,
            {
                counter: lockedProofsCounter.inFlightFrom as number
            }
        )   

        lockedProofsCounter.decreaseProofsCounter(countOfInFlightProofs)
        
        if (meltResponse.quote.state === MeltQuoteState.PAID) {
            
            log.debug('[transfer] Invoice PAID', {                
                transactionId
            })

            // Spend pending proofs that were used to settle the lightning invoice
            proofsStore.removeProofs(proofsToMeltFrom as Proof[], true, false)

            // Save preimage asap
            if(meltResponse.quote.payment_preimage) {
                transaction.setProof(meltResponse.quote.payment_preimage)
            }
            
            let totalFeePaid = proofsToMeltFromAmount - amountToTransfer
            let lightningFeePaid = totalFeePaid - meltFeeReserve
            let meltFeePaid = meltFeeReserve
            let returnedAmount = CashuUtils.getProofsAmount(meltResponse.change)

            if(meltResponse.change.length > 0) {            
                WalletUtils.addCashuProofs(
                    mintUrl, 
                    meltResponse.change, 
                    {
                        unit,
                        transactionId: transaction.id,
                        isPending: false
                    }                
                )
        
                const outputToken = getEncodedToken({
                    mint: mintUrl,
                    proofs: meltResponse.change,
                    unit,            
                })
    
                transaction.setOutputToken(outputToken)    
                
                totalFeePaid = totalFeePaid - returnedAmount
                lightningFeePaid = totalFeePaid - meltFeeReserve
            }

            // release lock
            lockedProofsCounter.resetInFlight(transactionId)
    
            // Save final fee in db
            if(totalFeePaid !== transaction.fee) {
                transaction.setFee(totalFeePaid)
            }        
    
            // Update transaction status
            transactionData.push({
                status: TransactionStatus.COMPLETED,                
                lightningFeePaid,
                meltFeePaid,
                returnedAmount,       
                preimage: meltResponse.quote.payment_preimage,
                counter: lockedProofsCounter.counter,
                createdAt: new Date(),
            })    
            
            transaction.setStatus(            
                TransactionStatus.COMPLETED,
                JSON.stringify(transactionData),
            )
    
            const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
            transaction.setBalanceAfter(balanceAfter)       
    
            return {
                taskFunction: TRANSFER,
                mintUrl,
                transaction,
                message: `Lightning invoice has been successfully paid and settled with your Minibits ecash. Fee has been ${formatCurrency(transaction.fee, getCurrency(unit).code)} ${getCurrency(unit).code}.`,
                lightningFeePaid, 
                meltFeePaid,          
                totalFeePaid,
                meltQuote: meltResponse.quote,
                preimage: meltResponse.quote.payment_preimage,
                nwcEvent
            } as TransactionTaskResult

        } else if(meltResponse.quote.state === MeltQuoteState.PENDING) {            

            log.debug('[transfer] Invoice PENDING', {
                metResponseQuote: meltResponse.quote,
                transactionId
            })

            return {
                taskFunction: TRANSFER,
                mintUrl,
                transaction,
                message: `Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.`,                
                meltQuote,                
                nwcEvent
            } as TransactionTaskResult

        } else {
            // throw so that proper state of proofs is synced inside the catch block
            throw new AppError(Err.MINT_ERROR, 'Lightning payment has not been paid.', {
                metResponseQuote: meltResponse.quote,
                transactionId
            })
        }

    } catch (e: any) {
        let message = e.message
        let returnMessage = ''

        if (transaction) { 
            // release lock  
            if(lockedProofsCounter) {
                lockedProofsCounter.resetInFlight(transaction.id)
            }
            

            
            if (proofsToMeltFrom.length > 0) {
               
                const walletInstance = await walletStore.getWallet(mintUrl, unit, {withSeed: true})
                const refreshedMeltQuote = await walletInstance.checkMeltQuote(meltQuote.quote)
                
                if(refreshedMeltQuote.state = MeltQuoteState.PENDING) {
                    log.warn('[transfer]', 'proofsToMeltFrom from transfer with error are pending by mint', {
                        proofsToMeltFromAmount, 
                        unit,
                        transactionId: transaction.id
                    })

                    message = 'Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.'
                    // needs to be returned as error so we do not return

                } else if(refreshedMeltQuote.state === MeltQuoteState.PAID) {
                    log.error('[transfer]', 'Transfer throwed error but the payment suceeded', {
                        error: e.message,
                        refreshedMeltQuote, 
                        unit,
                        transactionId: transaction.id
                    })

                    await WalletTask.syncStateWithMintSync({
                        proofsToSync: proofsStore.getByMint(mintUrl, {isPending: true}),
                        mintUrl,
                        isPending: true
                    })

                    message = `Lightning invoice has been successfully paid, however some error occured: ${e.message}`
                    
                    return {
                        taskFunction: TRANSFER,
                        mintUrl,
                        transaction,
                        message,
                        meltQuote: refreshedMeltQuote,
                        preimage: refreshedMeltQuote.payment_preimage,
                        nwcEvent
                    } as TransactionTaskResult
                } else {
                    // if melt quote is UNPAID return proofs from pending to spendable balance
                    proofsStore.removeProofs(proofsToMeltFrom, true, true)
                    proofsStore.addProofs(proofsToMeltFrom)
                    returnMessage = "Ecash reserved for this payment was returned to spendable balance."
                    log.error('[transfer]', {returnMessage, proofsToMeltFromAmount})

                    if(e.message.includes('Token already spent')) {
                        // clean whole spendable balance from spent so that user can retry
                        const proofsToClean = proofsStore.getByMint(mintUrl, {isPending: false, unit})
                        await WalletTask.syncStateWithMintSync(                   
                            {
                                proofsToSync: proofsToClean,
                                mintUrl,
                                isPending: true
                            }
                        )    
                    }
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
            taskFunction: TRANSFER,
            mintUrl,
            transaction,
            message,
            error: WalletUtils.formatError(e),
            meltQuote,
            nwcEvent
        } as TransactionTaskResult
  }
}