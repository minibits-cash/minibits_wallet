import {rootStoreInstance} from '../../models'
import { TransactionTaskResult, WalletTask } from '../walletService'
import { MintBalance } from '../../models/Mint'
import { poller } from '../../utils/poller'
import { Transaction, TransactionData, TransactionStatus, TransactionType } from '../../models/Transaction'
import { log } from '../logService'
import { Contact } from '../../models/Contact'
import { LightningUtils } from '../lightning/lightningUtils'
import { getSnapshot, isStateTreeNode } from 'mobx-state-tree'
import { WalletUtils } from './utils'
import { MintUnit } from './currency'
import { NostrEvent } from '../nostrService'
import AppError, { Err } from '../../utils/AppError'
import { CashuMint, CashuWallet, MintQuoteResponse } from '@cashu/cashu-ts'
import { addSeconds } from 'date-fns/addSeconds'

const {
    transactionsStore,
    walletProfileStore,    
    walletStore
} = rootStoreInstance

// const {walletStore} = nonPersistedStores

export const TOPUP_TASK = 'topupTask'

export const topupTask = async function (
    mintBalanceToTopup: MintBalance,
    amountToTopup: number,
    unit: MintUnit,
    memo: string,
    contactToSendTo?: Contact,
    nwcEvent?: NostrEvent
) : Promise<TransactionTaskResult> {
    log.info('[topupTask]', {mintBalanceToTopup})
    log.info('[topupTask]', {amountToTopup, unit})

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            amountToTopup,
            unit,
            createdAt: new Date(),
        },
    ]

    let transaction: Transaction | undefined = undefined
    const mintUrl = mintBalanceToTopup.mintUrl

    try {
        const newTransaction = {
            type: TransactionType.TOPUP,
            amount: amountToTopup,
            fee: 0,
            unit,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintUrl,
            status: TransactionStatus.DRAFT,
        }
        // store tx in db and in the model
        transaction = await transactionsStore.addTransaction(newTransaction)
        
        if(!transaction) {
            throw new AppError(Err.DATABASE_ERROR, 'Could not store transaction.')
        }

        const {
            encodedInvoice, 
            mintQuote 
        } = await walletStore.createLightningMintQuote(
            mintUrl, 
            unit, 
            amountToTopup,
            memo
        )    

        const decodedInvoice = LightningUtils.decodeInvoice(encodedInvoice)
        const {
            amount, 
            payment_hash: paymentHash, 
            expiry, 
            timestamp
        } = LightningUtils.getInvoiceData(decodedInvoice)

        // Private contacts are stored in model, public ones are plain objects
        // contactToSendTo is to whom to send the request
        const contactTo = isStateTreeNode(contactToSendTo) ? getSnapshot(contactToSendTo) : contactToSendTo

        // Bulk tx update
        let expiresAtDate: Date | undefined = undefined
        if(expiry && expiry > 0) {
            expiresAtDate = addSeconds(new Date(timestamp * 1000), expiry)
        } else {
            expiresAtDate = addSeconds(new Date(timestamp * 1000), 86400)
        }
        
        const sentFromValue = contactTo?.nip05 || contactTo?.name || ''
        const sentToValue = walletProfileStore.nip05 || ''
        
        log.trace('[topupTask] invoice', {amount, paymentHash, expiry, timestamp, expiresAtDate})

        transactionData.push({
            status: TransactionStatus.PENDING,
            quote: mintQuote,                        
            createdAt: new Date()
        })

        const updateData = {
            quote: mintQuote,
            paymentId: paymentHash,
            paymentRequest: encodedInvoice,
            expiresAt: expiresAtDate,
            sentFrom: sentFromValue,
            sentTo: sentToValue,
            status: TransactionStatus.PENDING,
            data: JSON.stringify(transactionData)
        }

        transaction.update(updateData)

        if(!nwcEvent) {
            const wsMint = new CashuMint(mintUrl)
            const wsWallet = new CashuWallet(wsMint)

            try {
                const unsub = await wsWallet.onMintQuotePaid(
                    mintQuote,
                    async (m: MintQuoteResponse) => {
                        log.trace(`Websocket: mint quote PAID: ${m.quote}`)
                        WalletTask.handlePendingQueue()
                        unsub()                        
                    },
                    async (error: any) => {
                        throw error
                    }
                )
            } catch (error: any) {
                log.error(Err.NETWORK_ERROR,
                    "Error in websocket subscription. Starting poller.",
                    error.message
                )

                poller(
                    `handlePendingTopupPoller-${paymentHash}`, 
                    WalletTask.handlePendingQueue,
                    {
                        interval: 10 * 1000,
                        maxPolls: 6,
                        maxErrors: 2
                    },        
                    {transaction})   
                .then(() => log.trace('Polling completed', [], `handlePendingTopupPoller`))
            }
            
        }

        return {
            taskFunction: TOPUP_TASK,
            mintUrl,
            transaction,
            message: '',
            encodedInvoice,            
            nwcEvent
        } as TransactionTaskResult

    } catch (e: any) {        

        if (transaction) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
                createdAt: new Date()
            })

            // Update status and data on error
            transaction.update({
                status: TransactionStatus.ERROR,
                data: JSON.stringify(transactionData)
            })
        }

        log.error(e.name, e.message)

        return {
            taskFunction: TOPUP_TASK,
            transaction,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}