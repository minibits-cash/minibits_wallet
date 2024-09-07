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
            createdAt: new Date(),
        }
    ]

    let transactionId: number = 0
    let proofsToPay: ProofV3[] = []

    try {
        if (amountToTransfer + meltQuote.fee_reserve > mintBalanceToTransferFrom.balances[unit]!) {
            throw new AppError(
                Err.VALIDATION_ERROR, 
                'Mint balance is insufficient to cover the amount to transfer with the expected Lightning fees.'
            )
        }
    
        if(isBefore(invoiceExpiry, new Date())) {
            throw new AppError(
                Err.VALIDATION_ERROR, 
                'This invoice has already expired and can not be paid.', 
                {invoiceExpiry}
            )
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
            lightningFeeReserve:  meltQuote.fee_reserve,
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
        const {mintFeePaid, mintFeeReserve, isSwapNeeded} = swapResult
        const proofsAmount = CashuUtils.getProofsAmount(proofsToPay)

        // TODO in case of swap from inactive keysets, different meltFees might apply than above calculated meltFeeReserve
        // In such case, we might need to add / substract the fee difference to / from proofsToPay

        log.debug('[transfer]', 'Prepared poofsToPay amount', proofsAmount)

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            mintFeeReserve,
            mintFeePaid,
            isSwapNeeded,
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

        // update transaction status and proofs state based on sync with the mint
        const { completedTransactionIds, transactionStateUpdates } = await WalletTask.syncStateWithMintSync({
            mintUrl,
            isPending: true
        })        

        if(!completedTransactionIds.includes(transactionId)) {
            // silent
            log.error('[transfer] payLightningMelt call suceeded but proofs were not spent by mint', {transactionStateUpdates})
        }

        // some unknown error because failed payment throws
        if (!isPaid) {
            throw new AppError(Err.MINT_ERROR, 'Lightning payment is not paid', {isPaid})
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

        // this overwrites transactionData and COMPLETED status already set by syncStateWithMintSync
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
            mintFeePaid,
            meltQuote,
            preimage,
            nwcEvent
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
                log.warn('[transfer]', 'Returning proofsToPay to the wallet or keeping them pending if a mint keeps the payment in flight.', proofsToPay.length)
                
                // update transaction status and proofs state based on sync with the mint
                const { pendingTransactionIds } = await WalletTask.syncStateWithMintSync({
                    mintUrl,
                    isPending: true
                })
                         
                const transaction = transactionsStore.findById(transactionId)

                if(transaction?.status === TransactionStatus.PENDING) {                    
                    return {
                        taskFunction: TRANSFER,
                        mintUrl,
                        transaction,
                        message: 'Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.',
                        error: WalletUtils.formatError(e),
                        meltQuote,
                        nwcEvent
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
            meltQuote,
            nwcEvent
        } as TransactionTaskResult
  }
}