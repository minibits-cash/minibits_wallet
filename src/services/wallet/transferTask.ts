import {CashuUtils, ProofV3, TokenEntryV3} from '../cashu/cashuUtils'
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

    let transaction: Transaction | undefined = undefined
    let proofsToPay: ProofV3[] = []
    let proofsToPayAmount: number = 0

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
            transaction.id,
        )

        proofsToPay = swapResult.proofs
        const {mintFeePaid, mintFeeReserve, isSwapNeeded} = swapResult
        proofsToPayAmount = CashuUtils.getProofsAmount(proofsToPay)

        // TODO in case of swap from inactive keysets, different meltFees might apply than above calculated meltFeeReserve
        // In such case, we might need to add / substract the fee difference to / from proofsToPay

        log.debug('[transfer]', 'Prepared poofsToPay amount', {proofsToPayAmount, unit})

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            mintFeeReserve,
            mintFeePaid,
            isSwapNeeded,
            createdAt: new Date(),
        })

        transaction.setStatus(            
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )
        
        const inputTokenEntry: TokenEntryV3 = {
            mint: mintUrl,
            proofs: proofsToPay,
        }

        const inputToken = CashuUtils.encodeToken({
            token: [inputTokenEntry],
            unit,            
        })

        transaction.setInputToken(inputToken)

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
            transaction.id
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

        if(!completedTransactionIds.includes(transaction.id)) {
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
                    transactionId: transaction.id,
                    isPending: false
                }                
            )

            const feeSavedTokenEntry: TokenEntryV3 = {
                mint: mintUrl,
                proofs: feeSavedProofs,
            }
    
            const outputToken = CashuUtils.encodeToken({
                token: [feeSavedTokenEntry],
                unit,            
            })

            transaction.setOutputToken(outputToken)

            lightningFeePaid = meltQuote.fee_reserve - feeSaved            
        }

        // release lock
        lockedProofsCounter.resetInFlight(transaction.id)

        // Save preimage
        if(preimage) {
            transaction.setProof(preimage)
        }

        // Save final fee in db
        if(lightningFeePaid + mintFeePaid !== meltQuote.fee_reserve) {
            transaction.setFee(lightningFeePaid + mintFeePaid)
        }        

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            lightningFeeReserve: meltQuote.fee_reserve,
            lightningFeePaid,
            preimage,
            createdAt: new Date(),
        })

        // this overwrites transactionData and COMPLETED status already set by syncStateWithMintSync
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
            message: `Lightning invoice has been successfully paid and settled with your Minibits ecash. Fee has been ${formatCurrency(lightningFeePaid + mintFeePaid, getCurrency(unit).code)} ${getCurrency(unit).code}.`,
            lightningFeePaid,
            mintFeePaid,
            meltQuote,
            preimage,
            nwcEvent
        } as TransactionTaskResult

    } catch (e: any) {
        if (transaction) {            
            // release lock  
            if(lockedProofsCounter) {
                lockedProofsCounter.resetInFlight(transaction.id)
            }

            // If Exception was trigerred most likely by walletStore.payLightningMelt()
            if (proofsToPay.length > 0) {
                // check with the mint if proofs are not pending by mint, if yes, set transaction status pending (timeout-ed/hodled lightning payments)
                const { pendingTransactionIds } = await WalletTask.syncStateWithMintSync({
                    mintUrl,
                    isPending: true
                })
                
                // force refresh just in case above method did not update the model?
                const refreshed = transactionsStore.findById(transaction.id)

                if(refreshed?.status === TransactionStatus.PENDING) {
                    log.warn('[transfer]', 'proofsToPay from transfer with error are pending by mint', {proofsToPayAmount, unit})

                    return {
                        taskFunction: TRANSFER,
                        mintUrl,
                        transaction,
                        message: 'Lightning payment did not complete in time. Your ecash will remain pending until the payment completes or fails.',
                        error: WalletUtils.formatError(e),
                        meltQuote,
                        nwcEvent
                    } as TransactionTaskResult

                } else {
                    log.warn('[transfer]', 'proofsToPay from transfer with error to be returned to spendable wallet', {proofsToPayAmount, unit})

                    // remove it from pending proofs in the wallet
                    proofsStore.removeProofs(proofsToPay as Proof[], true, true)
                    // add proofs back to the spendable wallet with internal references
                    WalletUtils.addCashuProofs(
                        mintUrl, 
                        proofsToPay, 
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
            taskFunction: TRANSFER,
            mintUrl,
            transaction,
            message: e.message,
            error: WalletUtils.formatError(e),
            meltQuote,
            nwcEvent
        } as TransactionTaskResult
  }
}