import {deriveKeysetId, getEncodedToken} from '@cashu/cashu-ts'
import {isBefore} from 'date-fns'
import {getSnapshot, isStateTreeNode} from 'mobx-state-tree'
import {log} from '../utils/logger'
import {MintClient, MintKeys, MintKeySets} from './cashuMintClient'
import {Proof} from '../models/Proof'
import {
  Transaction,
  TransactionData,
  TransactionStatus,
  TransactionType,
} from '../models/Transaction'
import {rootStoreInstance} from '../models'
import {
  decodeInvoice,
  getInvoiceData,
  getMintsFromToken,
  getProofsAmount,
  getTokenAmounts,
  validateMintKeys,
} from './cashuHelpers'
import AppError, {Err} from '../utils/AppError'
import {MintBalance} from '../models/Mint'
import {Token} from '../models/Token'
import {
  type TokenEntry as CashuTokenEntry,
  type Proof as CashuProof,
} from '@cashu/cashu-ts'
import {Mint} from '../models/Mint'
import {Invoice} from '../models/Invoice'
import {poller} from '../utils/poller'
import EventEmitter from '../utils/eventEmitter'

type WalletService = {
    checkPendingSpent: () => Promise<void>
    checkSpent: () => Promise<
        {spentCount: number; spentAmount: number} | undefined
    >
    checkPendingTopups: () => Promise<void>
    transfer: (
        mintBalanceToTransferFrom: MintBalance,
        amountToTransfer: number,
        estimatedFee: number,
        memo: string,
        encodedInvoice: string,
    ) => Promise<TransactionResult>
    receive: (
        token: Token,
        amountToReceive: number,
        memo: string,
        encodedToken: string,
    ) => Promise<TransactionResult>
    send: (
        mintBalanceToSendFrom: MintBalance,
        amountToSend: number,
        memo: string,
    ) => Promise<TransactionResult>
    topup: (
        mintBalanceToTopup: MintBalance,
        amountToTopup: number,
        memo: string,
    ) => Promise<TransactionResult>
}

type TransactionResult = {
    transaction: Transaction | undefined
    message: string
    error?: AppError
    [key: string]: any
}

const {
    mintsStore,
    proofsStore,
    transactionsStore,
    invoicesStore,
} = rootStoreInstance

/*
 * Checks with all mints whether their pending proofs have been spent.
 */
async function checkPendingSpent() {
    if (mintsStore.mintCount === 0) {
        return
    }

    // group proofs by mint so that we do max one call per mint
    for (const mint of mintsStore.allMints) {
        await _checkSpentByMint(mint.mintUrl, true) // pending
    }
}

/*
 * Recover stuck wallet if tx error caused spent proof to remain in wallet.
 */
async function checkSpent() {
    if (mintsStore.mintCount === 0) {
        return
    }

    let spentCount = 0
    let spentAmount = 0
    // group proofs by mint so that we do max one call per mint
    for (const mint of mintsStore.allMints) {
        const result = await _checkSpentByMint(mint.mintUrl, false)
        spentCount += result?.spentCount || 0
        spentAmount += result?.spentAmount || 0
    }

    return {spentCount, spentAmount}
}

/*
*  Checks with the mint whether proofs have been spent.
 *  Under normal wallet operations, it is used to check pending proofs that were sent to the payee.
 *
 *  However it is used as well as a recovery process to remove spent proofs from the live wallet itself.
 *  This situation occurs as a result of error during SEND or TRANSFER and causes failure of
 *  subsequent transactions because mint returns "Tokens already spent" if any spent proof is used as an input.
 */
async function _checkSpentByMint(mintUrl: string, isPending: boolean = false) {
    try {
        const proofsFromMint = proofsStore.getByMint(mintUrl, isPending) as Proof[]

        if (proofsFromMint.length < 1) {
            log.info(
                `No ${isPending ? 'pending' : ''} proofs found for mint`,
                mintUrl, '_checkSpentByMint'
            )
            return
        }

        const spentProofs = await MintClient.getSpentProofsFromMint(
            mintUrl,
            proofsFromMint,
        )

        const spentCount = spentProofs.length
        const spentAmount = getProofsAmount(spentProofs)

        log.trace('spentProofs', spentCount, '_checkSpentByMint')

        if (spentProofs.length < 1) {
            log.trace(
                `No spent ${isPending ? 'pending' : ''} proofs returned from the mint`,
                mintUrl,
                '_checkSpentByMint',
            )
            return
        }

        // we need to identify txIds to update their statuses, there might be more then one tx to complete
        let relatedTransactionIds: number[] = []

        for (const spentProof of spentProofs) {
            const tId = proofsFromMint.find(
                (proof: Proof) => proof.secret === spentProof.secret,
            )?.tId

            if (tId && !relatedTransactionIds.includes(tId)) {
                relatedTransactionIds.push(tId)
            }
        }

        // remove spent proofs model instances from pending
        proofsStore.removeProofs(spentProofs as Proof[], isPending)

        // Update related transactions statuses
        log.info(
            'Transaction id(s) to complete',
            relatedTransactionIds.toString(),
            '_checkSpentByMint',
        )

        // Complete related transactions in normal wallet operations
        if (isPending) {
        const transactionDataUpdate = {
            status: TransactionStatus.COMPLETED,
            createdAt: new Date(),
        }

        await transactionsStore.updateStatuses(
            relatedTransactionIds,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionDataUpdate),
        )

        log.trace(
            'sendCompleted event to be fired for',
            relatedTransactionIds,
            '_checkSpentByMint',
        )
        EventEmitter.emit('sendCompleted', relatedTransactionIds)
        }

        // TODO what to do with tx error status after removing spent proofs
        return {spentCount, spentAmount}

    } catch (e: any) {
        // silent
        log.info(e.name, [e.message, mintUrl], '[_checkSpentByMint]')
    }
}

const receive = async function (
    token: Token,
    amountToReceive: number,
    memo: string,
    encodedToken: string,
) {
  const transactionData: TransactionData[] = []
  let transactionId: number = 0

  try {
        const tokenMints: string[] = getMintsFromToken(token as Token)
        log.trace('receiveToken tokenMints', tokenMints, 'receive')

        if (tokenMints.length === 0) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not get any mint information from the coins.',
            )
        }

        // Check if we have all mints from the coins added to wallet
        const missingMints: string[] = mintsStore.getMissingMints(tokenMints)

        // Let's create new draft receive transaction in database
        transactionData.push({
            status: TransactionStatus.DRAFT,
            amountToReceive,
            tokenMints,
            missingMints,
            createdAt: new Date(),
        })

        const newTransaction: Transaction = {
            type: TransactionType.RECEIVE,
            amount: amountToReceive,
            data: JSON.stringify(transactionData),
            memo,
            status: TransactionStatus.DRAFT,
        }

        const draftTransaction: Transaction = await transactionsStore.addTransaction(newTransaction)
        transactionId = draftTransaction.id as number

        const blockedMints = mintsStore.getBlockedFromList(tokenMints)

        if (blockedMints.length > 0) {
            const blockedTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.BLOCKED,
                JSON.stringify(transactionData),
            )

            return {
                transaction: blockedTransaction,
                message: `The mint ${blockedMints.toString()} is blocked. You can unblock it in Settings.`,
            } as TransactionResult
        }

        // if we have missing mints, we add them automatically
        if (missingMints.length > 0) {
            log.trace('Missing mints', missingMints, 'receive')

            for (const mintUrl of missingMints) {
                log.trace('Adding new mint', mintUrl, 'receive')

                const mintKeys: {
                    keys: MintKeys
                    keyset: string
                } = await MintClient.getMintKeys(mintUrl)

                const newMint: Mint = {
                    mintUrl,
                    keys: mintKeys.keys,
                    keysets: [mintKeys.keyset]
                }

                mintsStore.addMint(newMint)
            }
        }

        // Now we ask all mints to get fresh outputs for their tokenEntries, and create from them fresh token proofs
        // 0.8.0-rc3 implements multimints receive however CashuMint constructor still expects single mintUrl
        const {updatedToken, errorToken, newKeys} = await MintClient.receiveFromMint(
            tokenMints[0],
            encodedToken as string,
        )

        // if(newKeys) {_updateMintKeys(mintUrl, newKeys)} // unclear whose keys do we get in case of more then 1 mint

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.PREPARED,
            errorToken,
            createdAt: new Date(),
        })

        await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PREPARED,
            JSON.stringify(transactionData),
        )

        let amountWithErrors = 0

        if (errorToken && errorToken.token.length > 0) {
            amountWithErrors += getTokenAmounts(errorToken as Token).totalAmount
            log.trace('receiveToken amountWithErrors', amountWithErrors, 'receive')
        }

        if (amountWithErrors === amountToReceive) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Received coins are not valid and can not be redeemed',
            )
        }

        // attach transaction id and mintUrl to the proofs before storing them
        const newProofs: Proof[] = []

        for (const entry of updatedToken.token) {
            for (const proof of entry.proofs) {
                proof.tId = transactionId
                proof.mintUrl = entry.mint //multimint support

                newProofs.push(proof)
            }
        }
        // create ProofModel instances and store them into the proofsStore
        proofsStore.addProofs(newProofs)

        // This should be amountToReceive - amountWithErrors but let's set it from updated token
        const receivedAmount = getTokenAmounts(updatedToken as Token).totalAmount
        log.trace('Received amount', receivedAmount, 'receive')

        // Update tx amount if full amount was not received
        if (receivedAmount !== amountToReceive) {      
            await transactionsStore.updateReceivedAmount(
                transactionId,
                receivedAmount,
            )
        }

        // Finally, update completed transaction
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            receivedAmount,
            amountWithErrors,
            createdAt: new Date(),
        })

        const completedTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getBalances().totalBalance

        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)

        if (amountWithErrors > 0) {
        return {
            transaction: completedTransaction,
            message: `You received ${receivedAmount} sats to your minibits wallet. ${amountWithErrors} could not be redeemed from the mint`,
            receivedAmount,
        } as TransactionResult
        }

        return {
            transaction: completedTransaction,
            message: `You received ${receivedAmount} sats to your minibits wallet.`,
            receivedAmount,
        } as TransactionResult
    } catch (e: any) {
        let errorTransaction: Transaction | undefined = undefined

        if (transactionId > 0) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: _formatError(e),
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error(e.name, e.message)

        return {
            transaction: errorTransaction || undefined,
            message: '',
            error: _formatError(e),
        } as TransactionResult
    }
}

const _sendFromMint = async function (
    mintBalance: MintBalance,
    amountToSend: number,
    transactionId: number,
) {
    const mintUrl = mintBalance.mint

    log.trace('mintBalanceToSendFrom', mintBalance, '_sendFromMint')
    log.trace('amountToSend', amountToSend, '_sendFromMint')

    try {
        const proofsFromMint = proofsStore.getByMint(mintUrl) as Proof[]

        log.trace('proofsFromMint', proofsFromMint.length, '_sendFromMint')

        if (proofsFromMint.length < 1) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'Could not find coins for the selected mint',
            )
        }

        const totalAmountFromMint = getProofsAmount(proofsFromMint)

        if (totalAmountFromMint < amountToSend) {
            throw new AppError(
                Err.VALIDATION_ERROR,
                'There is not enough funds to send this payment',
                [{totalAmountFromMint, amountToSend}],
            )
        }

        // filter enough to make a payment
        const proofsToSendFrom = proofsStore.getProofsToSend(
            amountToSend,
            proofsFromMint,
        )
        log.trace('proofsToSendFrom', proofsToSendFrom, '_sendFromMint')

        // if split to required denominations was necessary, this gets it done with the mint and we get the return
        const {returnedProofs, proofsToSend, newKeys} = await MintClient.sendFromMint(
            mintUrl,
            amountToSend,
            proofsToSendFrom,
        )

        log.trace('returnedProofs', returnedProofs, '_sendFromMint')
        log.trace('proofsToSend', proofsToSend, '_sendFromMint')

        if (newKeys) {_updateMintKeys(mintUrl, newKeys)}

        // these might be original proofToSendFrom if they matched the exact amount and split was not necessary
        for (const proof of proofsToSend) {
        if (isStateTreeNode(proof)) {
            proof.setTransactionId(transactionId)
            proof.setMintUrl(mintUrl)
        } else {
            ;(proof as Proof).tId = transactionId
            ;(proof as Proof).mintUrl = mintUrl
        }
        }

        // these are fresh proofs from the mint
        returnedProofs.forEach(proof => {
            proof.tId = transactionId
            proof.mintUrl = mintUrl
        })


        // add proofs returned by the mint after the split
        if (returnedProofs.length > 0) proofsStore.addProofs(returnedProofs)
        // remove used proofs and move sent proofs to pending
        proofsStore.removeProofs(proofsToSendFrom)
        proofsStore.addProofs(proofsToSend, true)

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

        return cleanedProofsToSend
  } catch (e: any) {
        throw new AppError(Err.WALLET_ERROR, e.message, [e.stack.slice(0, 100)])
  }
}



const send = async function (
    mintBalanceToSendFrom: MintBalance,
    amountToSend: number,
    memo: string,
) {
    const mintUrl = mintBalanceToSendFrom.mint

    log.trace('mintBalanceToSendFrom', mintBalanceToSendFrom, 'send')
    log.trace('amountToSend', amountToSend, 'send')
    log.trace('memo', memo, 'send')

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
            status: TransactionStatus.DRAFT,
        }

        // store tx in db and in the model
        const storedTransaction: Transaction =
        await transactionsStore.addTransaction(newTransaction)
        transactionId = storedTransaction.id as number

        // get ready proofs to send and update proofs and pending proofs storage
        const proofsToSend = await _sendFromMint(
            mintBalanceToSendFrom,
            amountToSend,
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
            memo = 'Sent from minibits wallet'
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

        // Start polling for accepted payment, what an ugly piece of code
        poller(
            '_checkSpentByMint',
            () => _checkSpentByMint(mintUrl, true),
            6 * 1000,
            20,
            5,
        )
        .then(() => log.trace('poller completed', [], '_checkSpentByMint'))
        .catch(error =>
            log.error(
                Err.POLLING_ERROR,
                'polling error:',
                error,
                '_checkSpentByMint',
            ),
        )

        return {
            transaction: pendingTransaction,
            message: '',
            encodedTokenToSend,
        } as TransactionResult
    } catch (e: any) {
        // Update transaction status if we have any
        let errorTransaction: Transaction | undefined = undefined

        if (transactionId > 0) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: _formatError(e),
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )
        }

        log.error(e.name, e.message)

        return {
            transaction: errorTransaction || undefined,
            error: _formatError(e),
        } as TransactionResult
    }
}



const transfer = async function (
    mintBalanceToTransferFrom: MintBalance,
    amountToTransfer: number,
    estimatedFee: number,
    memo: string,
    encodedInvoice: string,
) {
    const mintUrl = mintBalanceToTransferFrom.mint

    log.info('mintBalanceToTransferFrom', mintBalanceToTransferFrom, 'transfer')
    log.info('amountToTransfer', amountToTransfer, 'transfer')
    log.info('estimatedFee', estimatedFee, 'transfer')

    if (amountToTransfer + estimatedFee > mintBalanceToTransferFrom.balance) {
        throw new AppError(Err.VALIDATION_ERROR, 'Mint balance is insufficient to cover the amount to transfer with expected Lightning fees.')
    }

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
            const newTransaction: Transaction = {
                type: TransactionType.TRANSFER,
                amount: amountToTransfer,
                fee: estimatedFee,
                data: JSON.stringify(transactionData),
                memo,
                status: TransactionStatus.DRAFT,
            }

        // store tx in db and in the model
        const storedTransaction: Transaction =
        await transactionsStore.addTransaction(newTransaction)
        
        transactionId = storedTransaction.id as number

        // get proofs ready to be paid to the mint
        proofsToPay = await _sendFromMint(
            mintBalanceToTransferFrom,
            amountToTransfer + estimatedFee,
            transactionId,
        )

        const proofsAmount = getProofsAmount(proofsToPay as Proof[])
        log.info('Prepared poofsToPay amount', proofsAmount, 'transfer')

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

        // Use prepared proofs to settle with the mint the payment of the invoice on wallet behalf
        const {feeSavedProofs, isPaid, preimage, newKeys} =
            await MintClient.payLightningInvoice(
                mintUrl,
                encodedInvoice,
                proofsToPay,
                estimatedFee,
            )
        
        if (newKeys) {_updateMintKeys(mintUrl, newKeys)}

        // We've sent the proofsToPay to the mint, so we remove those pending proofs from model storage.
        // Hopefully mint gets important shit done synchronously.
        // We might not need to await for this and set it up as async poller with 1 poll?
        await _checkSpentByMint(mintUrl, true)

        // I have no idea yet if this can happen, return sent Proofs to the store an track tx as Reverted
        if (!isPaid) {
            _addCashuProofs(proofsToPay, mintUrl, transactionId, true)

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
                transaction: revertedTransaction,
                message: 'Payment of lightning invoice failed. Coins were returned to your wallet.',
            } as TransactionResult
        }

        // If real fees were less then estimated, cash the returned savings.
        let finalFee = estimatedFee

        if (feeSavedProofs.length) {
            const feeSaved = _addCashuProofs(feeSavedProofs, mintUrl, transactionId)

            finalFee = estimatedFee - feeSaved
            await transactionsStore.updateFee(transactionId, finalFee)
        }

        // Update transaction status
        transactionData.push({
            status: TransactionStatus.COMPLETED,
            finalFee,
            createdAt: new Date(),
        })

        const completedTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.COMPLETED,
            JSON.stringify(transactionData),
        )

        const balanceAfter = proofsStore.getBalances().totalBalance

        await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)

        log.trace('totalBalance after', balanceAfter, 'transfer')

        return {
            transaction: completedTransaction,
            message: `Lightning invoice has been successfully paid and settled with your minibits coins. Final lightning network fee has been ${finalFee} sats.`,
            finalFee,
        } as TransactionResult
    } catch (e: any) {        
        // Update transaction status if we have any
        let errorTransaction: Transaction | undefined = undefined

        if (transactionId > 0) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: _formatError(e),
            })

            errorTransaction = await transactionsStore.updateStatus(
                transactionId,
                TransactionStatus.ERROR,
                JSON.stringify(transactionData),
            )

            // Return tokens intended for payment to the wallet if payment failed with an error
            if (proofsToPay.length > 0) {
                log.info('Returning proofsToPay to the wallet likely after failed lightning payment', proofsToPay.length, 'transfer')
                _addCashuProofs(proofsToPay, mintUrl, transactionId, true)
            }
        }

        log.error(e.name, e.message)

        return {
            transaction: errorTransaction || undefined,
            message: '',
            error: _formatError(e),
        } as TransactionResult
  }
}



const _addCashuProofs = function (
    proofsToAdd: CashuProof[],
    mintUrl: string,
    transactionId: number,
    isRecoveredFromPending: boolean = false
): number {
    for (const proof of proofsToAdd as Proof[]) {
        proof.tId = transactionId
        proof.mintUrl = mintUrl
    }
    // Creates proper model instances and adds them to storage
    proofsStore.addProofs(proofsToAdd as Proof[])
    const amount = getProofsAmount(proofsToAdd as Proof[])

    log.info('Added proofs with amount', { amount, isRecoveredFromPending })
    
    if(isRecoveredFromPending) {
        // Remove them from pending if they are returned to the wallet due to failed lightning payment
        // Do not mark the as spent as they are recovered back to wallet
        proofsStore.removeProofs(proofsToAdd as Proof[], true, isRecoveredFromPending)
    }    

    return amount
}



const topup = async function (
    mintBalanceToTopup: MintBalance,
    amountToTopup: number,
    memo: string,
) {
    log.info('mintBalanceToTopup', mintBalanceToTopup, 'topup')
    log.info('amountToTopup', amountToTopup, 'topup')

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
        status: TransactionStatus.DRAFT,
        amountToTopup,
        createdAt: new Date(),
        },
    ]

    let transactionId: number = 0

    try {
        // const mint = mintsStore.findByUrl(mintBalanceToTopup.mint) as Mint
        const mintUrl = mintBalanceToTopup.mint

        const newTransaction: Transaction = {
            type: TransactionType.TOPUP,
            amount: amountToTopup,
            data: JSON.stringify(transactionData),
            memo,
            status: TransactionStatus.DRAFT,
        }
        // store tx in db and in the model
        const storedTransaction: Transaction =
        await transactionsStore.addTransaction(newTransaction)
        transactionId = storedTransaction.id as number

        const {encodedInvoice, paymentHash} =
        await MintClient.requestLightningInvoice(mintUrl, amountToTopup)

        const decodedInvoice = decodeInvoice(encodedInvoice)
        const {amount, expiry, description} = getInvoiceData(decodedInvoice)

        if (amount !== amountToTopup) {
        throw new AppError(
            Err.MINT_ERROR,
            'Received lightning invoice amount does not equal requested top-up amount.',
        )
        }

        const newInvoice: Invoice = {
            mint: mintUrl,
            encodedInvoice,
            amount,
            description,
            expiry,
            memo,
            paymentHash,
            transactionId,
        }

        // This calculates and sets expiresAt
        const invoice = invoicesStore.addInvoice(newInvoice)

        transactionData.push({
            status: TransactionStatus.PENDING,
            encodedInvoice,
            invoice,
        })

        const pendingTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.PENDING,
            JSON.stringify(transactionData),
        )

        poller('checkPendingTopupPoller', checkPendingTopups, 6 * 1000, 20, 5)
            .then(() => log.trace('Polling completed', [], 'checkPendingTopups'))
            .catch(error =>
                log.trace(error.message, [], 'checkPendingTopups'),
        )

        return {
            transaction: pendingTransaction,
            message: '',
            encodedInvoice,
        } as TransactionResult

    } catch (e: any) {
        let errorTransaction: Transaction | undefined = undefined

        if (transactionId > 0) {
        transactionData.push({
            status: TransactionStatus.ERROR,
            error: _formatError(e),
        })

        errorTransaction = await transactionsStore.updateStatus(
            transactionId,
            TransactionStatus.ERROR,
            JSON.stringify(transactionData),
        )
        }

        log.error(e.name, e.message)

        return {
            transaction: errorTransaction || undefined,
            message: '',
            error: _formatError(e),
        } as TransactionResult
    }
}

const checkPendingTopups = async function () {

    const invoices: Invoice[] = invoicesStore.allInvoices

    if (invoices.length === 0) {
        log.info('No invoices in store', [], 'checkPendingTopups')
        return
    }

    try {
        for (const invoice of invoices) {
            // claim tokens if invoice is paid
            const {proofs, newKeys} = (await MintClient.requestProofs(
                invoice.mint,
                invoice.amount,
                invoice.paymentHash,
            )) as {proofs: Proof[], newKeys: MintKeys}

            if (!proofs || proofs.length === 0) {
                log.info('No proofs returned from mint', [], 'checkPendingTopups')
                // remove already expired invoices only after check that they have not been paid
                // Fixes #3
                if (isBefore(invoice.expiresAt as Date, new Date())) {
                    log.info('Invoice expired, removing', invoice.paymentHash, 'checkPendingTopups')
                    
                    const transactionId = invoice.transactionId
                    invoicesStore.removeInvoice(invoice)
                    // update related tx
                    const transactionDataUpdate = {
                        status: TransactionStatus.EXPIRED,
                        createdAt: new Date(),
                    }

                    transactionsStore.updateStatuses(
                        [transactionId as number],
                        TransactionStatus.EXPIRED,
                        JSON.stringify(transactionDataUpdate),
                    )                    
                }

                continue
            }            

            if(newKeys) {_updateMintKeys(invoice.mint, newKeys)}

            // accept whatever we've got
            const receivedAmount = _addCashuProofs(
                proofs,
                invoice.mint,
                invoice.transactionId as number,
            )

            if (receivedAmount !== invoice.amount) {
                throw new AppError(
                Err.VALIDATION_ERROR,
                `Received amount ${receivedAmount} sats is not equal to the requested amount ${invoice.amount} sats.`,
                )
            }

            // update related tx
            const transactionDataUpdate = {
                status: TransactionStatus.COMPLETED,
                createdAt: new Date(),
            }

            transactionsStore.updateStatuses(
                [invoice.transactionId as number],
                TransactionStatus.COMPLETED,
                JSON.stringify(transactionDataUpdate),
            )

            // Fire event that the TopupScreen can listen to
            EventEmitter.emit('topupCompleted', invoice)

            // Update tx with current balance
            const balanceAfter = proofsStore.getBalances().totalBalance

            await transactionsStore.updateBalanceAfter(
                invoice.transactionId as number,
                balanceAfter,
            )

            // delete paid invoice if we've got our cash
            invoicesStore.removeInvoice(invoice)
        }

    } catch (e: any) {
        // silent
        log.info(e.name, e.message, 'checkPendingTopups')        
    }
}

const _updateMintKeys = function (mintUrl: string, newKeys: MintKeys) {
    if(!validateMintKeys(newKeys)) {
        // silent
        log.info('Invalid mint keys to update, skipping', newKeys)
        return
    }

    const keyset = deriveKeysetId(newKeys)
    const mint = mintsStore.findByUrl(mintUrl)

    return mint?.updateKeys(keyset, newKeys)
}

const _formatError = function (e: AppError) {
    return {
        name: e.name,
        message: e.message.slice(0, 100),
        params: e.params ? [e.params.toString().slice(0, 200)] : [],
    } as AppError
}

export const Wallet: WalletService = {
    checkPendingSpent,
    checkSpent,
    checkPendingTopups,
    transfer,
    receive,
    send,
    topup,
}
