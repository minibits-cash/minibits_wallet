import {CashuMint, deriveKeysetId, getEncodedToken} from '@cashu/cashu-ts'
import {log} from '../logService'
import {MintClient, MintKeys} from '../cashuMintClient'
import {
  Transaction,
  TransactionData,
  TransactionRecord,
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuUtils} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import {Token} from '../../models/Token'
import {
    type Token as CashuToken,
    type TokenEntry as CashuTokenEntry,
    type Proof as CashuProof,
} from '@cashu/cashu-ts'
import { getDefaultAmountPreference, isObj } from '@cashu/cashu-ts/src/utils'
import { TransactionTaskResult, WalletTask } from '../walletService'
import { MintBalance } from '../../models/Mint'
import { Proof } from '../../models/Proof'
import { poller } from '../../utils/poller'
import { WalletUtils } from './utils'
import { getSnapshot, isStateTreeNode } from 'mobx-state-tree'

const {
    mintsStore,
    proofsStore,
    transactionsStore,
} = rootStoreInstance


export const sendTask = async function (
    mintBalanceToSendFrom: MintBalance,
    amountToSend: number,
    memo: string,
    selectedProofs: Proof[]
) : Promise<TransactionTaskResult> {
    const mintUrl = mintBalanceToSendFrom.mint


    log.trace('[send]', 'mintBalanceToSendFrom', mintBalanceToSendFrom)
    log.trace('[send]', 'amountToSend', amountToSend)    
    log.trace('[send]', 'memo', memo)

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            mintBalanceToSendFrom,
            createdAt: new Date(),
        }
    ]

    let transactionId: number = 0

    try {
        const newTransaction: Transaction = {
            type: TransactionType.SEND,
            amount: amountToSend,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintUrl,
            status: TransactionStatus.DRAFT,
        }

        // store tx in db and in the model
        const storedTransaction: TransactionRecord =
        await transactionsStore.addTransaction(newTransaction)
        transactionId = storedTransaction.id as number

        // get ready proofs to send and update proofs and pending proofs storage
        const proofsToSend = await sendFromMint(
            mintBalanceToSendFrom,
            amountToSend,
            selectedProofs,
            transactionId,
        )

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            proofsToSend,
            createdAt: new Date(),
        })

        await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )

        // Create sendable encoded token v3
        const tokenEntryToSend = {
            mint: mintUrl,
            proofs: proofsToSend,
        }

        if (!memo || memo === '') {
            memo = 'Sent from Minibits'
        }

        const encodedTokenToSend = getEncodedToken({
            token: [tokenEntryToSend as CashuTokenEntry],
            memo,
        })

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PENDING,
            encodedTokenToSend,
            createdAt: new Date(),
        })

        const pendingTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PENDING,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getBalances().totalBalance

        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)

        log.trace('[send] totalBalance after', balanceAfter)

        // Start polling for accepted payment
        poller(
            `handleSpentByMintPoller-${mintUrl}`,
            WalletTask.handleSpentByMint,
            {
                interval: 6 * 1000,
                maxPolls: 20,
                maxErrors: 2
            },
            {mintUrl, isPending: true}
        )
        .then(() => log.trace('[handleSpentByMintPoller]', 'polling completed', {mintUrl}))        

        return {
            taskFunction: 'sendTask',
            mintUrl,
            transaction: pendingTransaction,
            message: '',
            encodedTokenToSend,
        } as TransactionTaskResult
    } catch (e: any) {
        // Update transaction status if we have any
        let errorTransaction: TransactionRecord | undefined = undefined        

        if (transactionId > 0) {
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

        return {
            taskFunction: 'sendTask',
            mintUrl,
            transaction: errorTransaction || undefined,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}



export const sendFromMint = async function (
    mintBalance: MintBalance,
    amountToSend: number,
    selectedProofs: Proof[],
    transactionId: number,
) {
    const mintUrl = mintBalance.mint
    const mintInstance = mintsStore.findByUrl(mintUrl)

    try {
        if (!mintInstance) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find mint', {mintUrl}
            )
        }

        const proofsFromMint = proofsStore.getByMint(mintUrl) as Proof[]

        log.debug('[sendFromMint]', 'proofsFromMint count', proofsFromMint.length)

        if (proofsFromMint.length < 1) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find ecash for the selected mint',
            )
        }

        const totalAmountFromMint = CashuUtils.getProofsAmount(proofsFromMint)

        if (totalAmountFromMint < amountToSend) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'There is not enough funds to send this payment',
                {totalAmountFromMint, amountToSend},
            )
        }

        /* 
         * OFFLINE SEND
         * if we have selected ecash to send in offline mode, we do not interact with the mint        
         */

        const selectedProofsAmount = CashuUtils.getProofsAmount(selectedProofs)

        if(selectedProofsAmount > 0 && (amountToSend !== selectedProofsAmount)) { // failsafe for some unknown ecash selection UX error
            throw new AppError(Err.VALIDATION_ERROR, 'Requested amount to send does not equal sum of ecash denominations provided.')
        }

        if(selectedProofsAmount > 0) {
            for (const proof of selectedProofs) {                
                proof.setTransactionId(transactionId) // update txId                
            }

            // move sent proofs to pending
            proofsStore.removeProofs(selectedProofs)
            proofsStore.addProofs(selectedProofs, true) // pending true

            // Clean private properties to not to send them out. This returns plain js array, not model objects.
            const cleanedProofsToSend = selectedProofs.map(proof => {                
                const {mintUrl, tId, ...rest} = getSnapshot(proof)
                return rest                
            })

            // We return cleaned proofs to be encoded as a sendable token
            return cleanedProofsToSend
        }

        
        /* 
         * if we did not selected ecash but amount and we might need a split of ecash by the mint to match exact amount        
         */        
        
        const proofsToSendFrom = proofsStore.getProofsToSend(
            amountToSend,
            proofsFromMint,
        )

        const proofsToSendFromAmount = CashuUtils.getProofsAmount(proofsToSendFrom)

        // Increase the proofs counter before the mint call so that in case the response
        // is not received our recovery index counts for sigs the mint has already issued (prevents duplicate b_b bug)
        const amountPreferences = getDefaultAmountPreference(amountToSend)    
        const returnedAmountPreferences = getDefaultAmountPreference(proofsToSendFromAmount - amountToSend)   

        const countOfProofsToSend = CashuUtils.getAmountPreferencesCount(amountPreferences)
        const countOfReturnedProofs = CashuUtils.getAmountPreferencesCount(returnedAmountPreferences)
        const countOfInFlightProofs = countOfProofsToSend + countOfReturnedProofs        
        
        log.trace('[sendFromMint]', 'amountPreferences', {amountPreferences, returnedAmountPreferences})
        log.trace('[sendFromMint]', 'countOfInFlightProofs', countOfInFlightProofs)    
        
        // temp increase the counter + acquire lock and set inFlight values                
        await WalletUtils.lockAndSetInFlight(mintInstance, countOfInFlightProofs, transactionId)
        
        // get locked counter values
        const lockedProofsCounter = mintInstance.getOrCreateProofsCounter?.()        
        
        // if split to required denominations was necessary, this gets it done with the mint and we get the return
        let sendResult: {returnedProofs: Proof[], proofsToSend: Proof[], newKeys: MintKeys | undefined} = {
            returnedProofs: [],
            proofsToSend: [],
            newKeys: undefined
        }

        try {
            sendResult = await MintClient.sendFromMint(
                mintUrl,
                amountToSend,
                proofsToSendFrom,
                amountPreferences,
                lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
            )    
        } catch (e: any) {
            if (e instanceof AppError && 
                e.params && 
                e.params.message?.includes('outputs have already been signed before')) {

                    log.error('[sendFromMint] Emergency increase of proofsCounter and retrying the send')

                    mintInstance.increaseProofsCounter(20)
                    sendResult = await MintClient.sendFromMint(
                        mintUrl,
                        amountToSend,
                        proofsToSendFrom,
                        amountPreferences,
                        lockedProofsCounter.inFlightFrom as number + 20
                    )
                    
                    log.error('[sendFromMint] Emergency increase of proofsCounter, send retry result', {sendResult})
            } else {
                throw e
            }
        }

        // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
        mintInstance.decreaseProofsCounter(countOfInFlightProofs) 

        const {returnedProofs, proofsToSend, newKeys} = sendResult        
        if (newKeys) {WalletUtils.updateMintKeys(mintUrl, newKeys)}

        // add proofs returned by the mint after the split
        if (returnedProofs.length > 0) {
            const { addedProofs, addedAmount } = WalletUtils.addCashuProofs(
                returnedProofs,
                mintUrl,
                transactionId          
            )            
        }

        // remove used proofs and move sent proofs to pending
        proofsStore.removeProofs(proofsToSendFrom)

        // these might be original proofToSendFrom if they matched the exact amount and split was not necessary        
        const { addedProofs, addedAmount } = WalletUtils.addCashuProofs(
            proofsToSend,
            mintUrl,
            transactionId,
            true       
        )

        // release lock
        mintInstance.resetInFlight(transactionId)

        // Clean private properties to not to send them out. This returns plain js array, not model objects.
        const cleanedProofsToSend = proofsToSend.map(proof => {
            if (isStateTreeNode(proof)) {
                const {mintUrl, tId, ...rest} = getSnapshot(proof)
                return rest
            } else {
                const {mintUrl, tId, ...rest} = proof as Proof
                return rest
            }
        })        
        
        // We return cleaned proofs to be encoded as a sendable token
        return cleanedProofsToSend
  } catch (e: any) {
        // release lock        
        mintInstance?.resetInFlight(transactionId)       

        if (e instanceof AppError) {
            throw e
        } else {
            throw new AppError(Err.WALLET_ERROR, e.message, e.stack.slice(0, 200))
        }
  }
}