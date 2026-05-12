import {CashuUtils} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {Mint as CashuMint, Wallet as CashuWallet, MeltProofsResponse, MeltQuoteBolt11Response, MeltQuoteState, getEncodedToken, normalizeProofAmounts} from '@cashu/cashu-ts'
import {rootStoreInstance} from '../../models'
import { TransactionTaskResult, WalletTask } from '../walletService'
import { MintBalance } from '../../models/Mint'
import { Proof } from '../../models/Proof'
import { Transaction, TransactionData, TransactionStatus, TransactionType } from '../../models/Transaction'
import { log } from '../logService'
import { WalletUtils } from './utils'
import { poller } from '../../utils/poller'
import {isBefore} from 'date-fns'
import { MintUnit, formatCurrency, getCurrency } from './currency'
import { NostrEvent } from '../nostrService'
import { LightningUtils } from '../lightning/lightningUtils'

const {
    transactionsStore,
    mintsStore,
    proofsStore, 
    walletStore,   
} = rootStoreInstance

// const {walletStore} = nonPersistedStores

export const TRANSFER_TASK = 'transferTask'

const _monitorAsyncMeltQuote = async (params: {
    mintUrl: string
    unit: MintUnit
    quoteId: string
    proofsToMeltFrom: Proof[]
    proofsToMeltFromAmount: number
    amountToTransfer: number
    meltFeeReserve: number
    transactionId: number
}) => {
    const { mintUrl, quoteId } = params
    const wsMint = new CashuMint(mintUrl)
    const wsWallet = new CashuWallet(wsMint)

    try {
        log.trace('[transfer] Subscribing to meltQuoteUpdates for async melt', { quoteId })
        const unsub = await wsWallet.on.meltQuoteUpdates(
            [quoteId],
            async (updatedQuote: MeltQuoteBolt11Response) => {
                if (updatedQuote.state === MeltQuoteState.PAID ||
                    updatedQuote.state === MeltQuoteState.UNPAID) {
                    WalletTask.handlePendingMeltTask(params)
                    unsub()
                }
            },
            async (error: any) => {
                throw error
            },
        )
    } catch (error: any) {
        log.error(Err.NETWORK_ERROR,
            '[transfer] WebSocket error for async melt, starting poller.',
            error.message,
        )
        poller(
            `meltQuotePoller-${quoteId}`,
            WalletTask.handlePendingMeltTask,
            { interval: 15 * 1000, maxPolls: 8, maxErrors: 2 },
            params,
        ).then(() => log.trace('[meltQuotePoller] polling completed', { quoteId }))
    }
}

export const transferTask = async function (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    unit: MintUnit,
    meltQuote: MeltQuoteBolt11Response,
    memo: string,
    invoiceExpiry: Date,    
    encodedInvoice: string,
    nwcEvent?: NostrEvent,
    draftTransactionId?: number
)  : Promise<TransactionTaskResult> {
    
    const mintUrl = mintBalanceToTransferFrom.mintUrl
    const mintInstance = mintsStore.findByUrl(mintUrl)    

    // TODO refresh - balance might be outdated if it waits in queue before other txs
    log.debug('[transfer]', 'mintBalanceToTransferFrom', {mintBalanceToTransferFrom}) 
    log.debug('[transfer]', 'amountToTransfer', {amountToTransfer})
    log.debug('[transfer]', 'meltQuote', {meltQuote})


    let transaction: Transaction | undefined = undefined
    let transactionData: TransactionData[] = []    
    let proofsToMeltFrom: Proof[] = []
    let proofsToMeltFromAmount: number = 0
    let meltFeeReserve: number = 0
    let meltResponse: MeltProofsResponse
    let meltQuoteCheck: MeltQuoteBolt11Response    

    try {

        if(draftTransactionId && draftTransactionId > 0) {
            transaction = transactionsStore.findById(draftTransactionId)
        } else {
            // create draft transaction
            transactionData.push({
                status: TransactionStatus.DRAFT,
                mintBalanceToTransferFrom,
                amountToTransfer,
                unit,
                meltQuote,
                //encodedInvoice,
                isNwc: nwcEvent ? true : false,           
                createdAt: new Date(),
            })
            const newTransaction = {
                type: TransactionType.TRANSFER,
                amount: amountToTransfer,
                fee: meltQuote.fee_reserve.toNumber(),
                unit,
                data: JSON.stringify(transactionData),
                memo,
                mint: mintBalanceToTransferFrom.mintUrl,
                status: TransactionStatus.DRAFT,
            }

            // store tx in db and in the model
            transaction = await transactionsStore.addTransaction(newTransaction)
        }

        if(!transaction) {
            throw new AppError(Err.DATABASE_ERROR, 'Could not find or create transaction.')
        }

        const transactionId = transaction.id
        const paymentHash = LightningUtils.getInvoiceData(LightningUtils.decodeInvoice(encodedInvoice)).payment_hash
        // Replace individual setters with a single update
        transaction.update({ paymentId: paymentHash, quote: meltQuote.quote })
        
        if (amountToTransfer + meltQuote.fee_reserve.toNumber() > mintBalanceToTransferFrom.balances[unit]!) {
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
            amountToTransfer + meltQuote.fee_reserve.toNumber(),
            proofsFromMint
        )

        proofsToMeltFromAmount = CashuUtils.getProofsAmount(proofsToMeltFrom)

        const walletInstance = await walletStore.getWallet(mintUrl, unit, {withSeed: true})        
        meltFeeReserve = walletInstance.getFeesForProofs(proofsToMeltFrom).toNumber()
        const amountWithFees = amountToTransfer + meltQuote.fee_reserve.toNumber() + meltFeeReserve        

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

        // Preemptive swap: if selected proofs overshoot needed amount by >20%, swap for
        // well-denominated proofs to avoid paying excessive melt fees.
        let swapFeePaid = 0

        if (proofsToMeltFromAmount > amountWithFees * 1.2) {
            log.info('[transfer] proofsToMeltFromAmount overshoots amountWithFees by >20%, running preemptive swap', {
                proofsToMeltFromAmount,
                amountWithFees,
            })
            try {
                const swapInputProofs = proofsToMeltFrom  // save reference before reassignment

                const swapResult = await walletStore.send(
                    mintUrl,
                    amountWithFees,
                    unit,
                    proofsToMeltFrom,
                    transactionId!,
                )

                // Change proofs from swap go back to spendable wallet
                if (swapResult.returnedProofs.length > 0) {
                    proofsStore.addOrUpdate(swapResult.returnedProofs, {
                        mintUrl,
                        unit,
                        tId: transactionId,
                        isPending: false,
                        isSpent: false,
                    })
                }

                // Mark original input proofs as spent — the swap consumed them.
                // Exclude any returned unchanged by cashu-ts optimisation (they appear in returnedProofs).
                const returnedSecrets = new Set(swapResult.returnedProofs.map(p => p.secret))
                const consumedBySwap = swapInputProofs.filter(p => !returnedSecrets.has(p.secret))
                proofsStore.addOrUpdate(consumedBySwap, {
                    mintUrl,
                    tId: transactionId,
                    unit,
                    isPending: false,
                    isSpent: true,
                })

                // Track the true net debit: swap target + swap fee paid to the mint
                proofsToMeltFromAmount = CashuUtils.getProofsAmount(swapResult.proofsToSend) + swapResult.swapFeePaid
                meltFeeReserve += swapResult.swapFeePaid
                swapFeePaid = swapResult.swapFeePaid

                // Mark swap outputs as pending — addOrUpdate returns them as MST nodes directly.
                const { updatedProofs: pendingSwapProofs } = proofsStore.addOrUpdate(swapResult.proofsToSend, {
                    mintUrl,
                    tId: transactionId,
                    unit,
                    isPending: true,
                    isSpent: false,
                })
                proofsToMeltFrom = pendingSwapProofs

                log.debug('[transfer] Preemptive swap completed', {
                    proofsToMeltFromAmount,
                    swapFeePaid,
                    meltFeeReserve,
                })
            } catch (swapError: any) {
                // Swap is an optimisation — fall back to original proofs, mark them pending
                log.warn('[transfer] Preemptive swap failed, continuing with original proofs', {
                    error: swapError.message,
                })
                proofsStore.addOrUpdate(proofsToMeltFrom, {
                    mintUrl,
                    tId: transaction.id,
                    unit,
                    isPending: true,
                    isSpent: false,
                })
            }
        } else {
            // No swap needed — move original proofs to pending
            proofsStore.addOrUpdate(proofsToMeltFrom, {
                mintUrl,
                tId: transaction.id,
                unit,
                isPending: true,
                isSpent: false,
            })
        }

        log.trace('[transfer]', 'Prepared proofsToMeltFrom proofs', {
            proofsToMeltFromAmount,             
            transactionId,                       
            unit, 
        })

        // Update transaction status and inputToken in one call
        transactionData.push({
            status: TransactionStatus.PREPARED,
            proofsToMeltFromAmount,
            lightningFeeReserve: meltQuote.fee_reserve.toNumber(),
            meltFeeReserve,
            ...(swapFeePaid > 0 && {preemptiveSwapFeePaid: swapFeePaid}),
            createdAt: new Date(),
        })

        const inputToken = getEncodedToken({
            mint: mintUrl,
            proofs: normalizeProofAmounts(proofsToMeltFrom),
            unit
        })

        transaction.update({
            status: TransactionStatus.PREPARED,
            data: JSON.stringify(transactionData),
            keysetId: proofsToMeltFrom[0].id,
            inputToken,
        })
        
        try {
            meltResponse = await walletStore.payLightningMelt(
                mintUrl,
                unit,
                meltQuote,
                proofsToMeltFrom,
                transactionId,
                { preferAsync: true },
            )
        } catch (e: any) {
            if (WalletUtils.shouldHealOutputsError(e)) {
                log.error('[transferTask] Increasing proofsCounter outdated values and repeating payLightningMelt.')
                meltResponse = await walletStore.payLightningMelt(
                    mintUrl,
                    unit,
                    meltQuote,
                    proofsToMeltFrom,
                    transactionId,
                    { increaseCounterBy: 10, preferAsync: true },
                )
            } else {
                throw e
            }
        }
        
        if (meltResponse.quote.state === MeltQuoteState.PAID) {
            
            log.debug('[transfer] Invoice PAID', {                
                transactionId
            })

            // Spend pending proofs that were used to settle the lightning invoice            
            proofsStore.moveToSpent(proofsToMeltFrom)

            // compute fees and change
            let totalFeePaid = proofsToMeltFromAmount - amountToTransfer
            let lightningFeePaid = totalFeePaid - meltFeeReserve
            let meltFeePaid = meltFeeReserve
            let returnedAmount = CashuUtils.getProofsAmount(meltResponse.change)

            let outputToken: string | undefined

            if(meltResponse.change.length > 0) {

                proofsStore.addOrUpdate(meltResponse.change,
                    {
                        mintUrl,
                        tId: transaction.id,
                        unit,
                        isPending: false,
                        isSpent: false
                    }
                )
        
                outputToken = getEncodedToken({
                    mint: mintUrl,
                    proofs: meltResponse.change,
                    unit,            
                })
    
                totalFeePaid = totalFeePaid - returnedAmount
                lightningFeePaid = totalFeePaid - meltFeeReserve
            }
            
            //meltQuoteCheck = await walletStore.checkLightningMeltQuote(mintUrl, meltQuote.quote)

            const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance
    
            // build consolidated update payload
            const completedDataItem: TransactionData = {
                status: TransactionStatus.COMPLETED,                
                lightningFeePaid,
                meltFeePaid,
                returnedAmount,
                //@ts-ignore
                preimage: meltResponse.quote.payment_preimage,                
                createdAt: new Date(),
            }

            transactionData.push(completedDataItem)
    
            const updatePayload: any = {
                status: TransactionStatus.COMPLETED,
                data: JSON.stringify(transactionData),
                fee: totalFeePaid,                
                balanceAfter,
            }
            
            if (outputToken) {
                updatePayload.outputToken = outputToken
            }

            //@ts-ignore
            if (meltResponse.quote.payment_preimage) {
                //@ts-ignore
                updatePayload.proof = meltResponse.quote.payment_preimage
            }
    
            transaction.update(updatePayload)
    
            return {
                taskFunction: TRANSFER_TASK,
                mintUrl,
                transaction,
                message: `Lightning invoice has been successfully paid and settled with your Minibits ecash. Fee has been ${formatCurrency(transaction.fee, getCurrency(unit).code)} ${getCurrency(unit).code}.`,
                lightningFeePaid, 
                meltFeePaid,          
                totalFeePaid,
                meltQuote: meltResponse.quote,
                //@ts-ignore
                preimage: meltResponse.quote.payment_preimage,
                nwcEvent
            } as TransactionTaskResult

        } else if(meltResponse.quote.state === MeltQuoteState.PENDING) {

            log.debug('[transfer] Invoice PENDING, async melt in progress', {
                quoteId: meltResponse.quote.quote,
                transactionId,
            })

            transactionData.push({
                status: TransactionStatus.PENDING,
                createdAt: new Date(),
            })

            transaction.update({
                status: TransactionStatus.PENDING,
                data: JSON.stringify(transactionData),
            })

            // Fire-and-forget: monitors quote via websocket (poller fallback) and
            // updates the transaction + emits ev_asyncMeltResult when resolved.
            _monitorAsyncMeltQuote({
                mintUrl,
                unit,
                quoteId: meltResponse.quote.quote,
                proofsToMeltFrom,
                proofsToMeltFromAmount,
                amountToTransfer,
                meltFeeReserve,
                transactionId,
            })

            return {
                taskFunction: TRANSFER_TASK,
                mintUrl,
                transaction,
                message: 'Lightning payment is in progress...',
                meltQuote: meltResponse.quote,
                nwcEvent,
            } as TransactionTaskResult

        } else {
            // throw so that proper state of proofs is synced inside the catch block
            throw new AppError(Err.MINT_ERROR, 'Lightning payment has not been paid.', {
                meltResponseQuote: meltResponse.quote,
                transactionId
            })
        }

    } catch (e: any) {
        let message = e.message        
        let taskResult: TransactionTaskResult =  {
            taskFunction: TRANSFER_TASK,
            mintUrl,
            transaction,
            message,
            nwcEvent
        } as TransactionTaskResult
        let recovered: number = 0

        if (transaction) { 
            meltQuoteCheck = await walletStore.checkLightningMeltQuote(mintUrl, meltQuote.quote)
            taskResult.meltQuote = meltQuoteCheck     
            
            if (proofsToMeltFrom.length > 0) {               
                                
                // --- PAID ---
                if(meltQuoteCheck.state === MeltQuoteState.PAID) {

                    message = `Lightning invoice has been successfully paid, however some error occured: ${e.message}`
                    
                    taskResult.preimage =  meltQuoteCheck.payment_preimage
                    taskResult.message = message               

                    const {recoveredAmount} = await WalletTask.recoverMeltQuoteChange({
                        mintUrl,
                        meltQuote: meltQuoteCheck,                    
                    })
                    

                    log.error('[transfer]', message, {
                        recoveredAmount,
                        error: e.message,
                        meltQuoteCheck, 
                        unit,
                        transactionId: transaction.id
                    })

                    recovered = recoveredAmount
                
                // --- PENDING BY MINT ---    
                } else if(meltQuoteCheck.state === MeltQuoteState.PENDING) {

                    message = 'Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.'
                    taskResult.message = message

                    log.error('[transfer]', message, {
                        error: `${e.message}: ${e.params.message}`,                       
                        unit,
                        meltQuoteCheck,
                        transactionId: transaction.id
                    })

                // --- UNPAID ---
                } else {
                    if (e.params && e.params.message && e.params.message.toLowerCase().includes('token already spent')) {

                        message = 'Token already spent, going to sync wallet pending proofs with the mint.'
                        taskResult.message = message

                        log.error('[transfer]', message, {
                            transactionId: transaction.id
                        })                        
                    } else if (e.params && e.params.message && e.params.message.toLowerCase().includes('proofs are pending')) {
                        // if melt quote is UNPAID wallet used already pending by mint proofs for this transaction
                        // we do not want to return them to spendable but keep them pending
                        message = 'Pending proofs were used for this transaction, going to sync proofsToMeltFrom with the mint.'
                        taskResult.message = message

                        log.error('[transfer]', message, {
                            transactionId: transaction.id
                        })
                        
                        await WalletTask.syncStateWithMintTask({
                            proofsToSync: proofsToMeltFrom, // includes some pending by mint proofs
                            mintUrl,
                            isPending: true
                        })
                        
                    } else {
                        // if melt quote is UNPAID return proofs from pending to spendable balance                        
                        proofsStore.revertToSpendable(proofsToMeltFrom)

                        message = "Ecash reserved for this payment was returned to spendable balance."

                        log.error('[transfer]', message, {
                            proofsToMeltFromAmount, 
                            transactionId: transaction.id
                        })
                    }
                }

                await WalletTask.syncStateWithMintTask({
                    proofsToSync: proofsStore.getByMint(mintUrl, {isPending: true, unit}),
                    mintUrl,
                    isPending: true
                })
            }

            if(meltQuoteCheck && meltQuoteCheck.state === MeltQuoteState.PAID) {

                transactionData.push({
                    status: TransactionStatus.RECOVERED,
                    recoveredChangeAmount: recovered,
                    error: WalletUtils.formatError(e),
                    createdAt: new Date()
                })

                transaction.update({
                    status: TransactionStatus.RECOVERED,
                    data: JSON.stringify(transactionData),
                })
            } else {
                transactionData.push({
                    status: TransactionStatus.ERROR,
                    error: WalletUtils.formatError(e),
                    createdAt: new Date()
                })

                transaction.update({
                    status: TransactionStatus.ERROR,
                    data: JSON.stringify(transactionData),
                })

                taskResult.error = WalletUtils.formatError(e)
            }
        }

        return taskResult
  }
}