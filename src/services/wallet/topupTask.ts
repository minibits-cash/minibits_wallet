import {rootStoreInstance} from '../../models'
import { TransactionTaskResult, WalletTask } from '../walletService'
import { MintBalance } from '../../models/Mint'
import { poller } from '../../utils/poller'
import { Transaction, TransactionData, TransactionRecord, TransactionStatus, TransactionType } from '../../models/Transaction'
import { log } from '../logService'
import { Contact } from '../../models/Contact'
import { LightningUtils } from '../lightning/lightningUtils'
import { getSnapshot, isStateTreeNode } from 'mobx-state-tree'
import { PaymentRequest, PaymentRequestStatus, PaymentRequestType } from '../../models/PaymentRequest'
import { WalletUtils } from './utils'
import { MintUnit } from './currency'
import { NostrEvent } from '../nostrService'

const {
    transactionsStore,
    walletProfileStore,
    paymentRequestsStore,    
    walletStore
} = rootStoreInstance

// const {walletStore} = nonPersistedStores

const TOPUP = 'topupTask'

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
            payment_hash, 
            expiry, 
            timestamp
        } = LightningUtils.getInvoiceData(decodedInvoice)

        log.trace('[topupTask] invoice', {amount, payment_hash, expiry, timestamp})

        // sender is current wallet profile
        const {
            pubkey,
            npub,
            name,
            nip05,
            picture,
        } = walletProfileStore

        const contactFrom: Contact = {
            pubkey,
            npub,
            name,
            nip05,
            picture
        }

        // Private contacts are stored in model, public ones are plain objects
        const contactTo = isStateTreeNode(contactToSendTo) ? getSnapshot(contactToSendTo) : contactToSendTo

        log.trace('[topupTask]', 'contactTo', contactTo)

        const newPaymentRequest: PaymentRequest = {
            type: PaymentRequestType.OUTGOING,
            status: PaymentRequestStatus.ACTIVE,
            mint: mintUrl,
            mintQuote,
            mintUnit: unit,
            amountToTopup,
            encodedInvoice,
            invoicedAmount: amount,
            invoicedUnit: 'sat',
            description: memo ? memo : contactTo ? `Pay to ${walletProfileStore.nip05}` : '',
            paymentHash: payment_hash,
            contactFrom,
            contactTo: contactTo || undefined,
            expiry: expiry || 600,
            transactionId: transaction.id!,
            createdAt: timestamp ? new Date(timestamp * 1000) : new Date()
        }        

        // This calculates and sets expiresAt
        const paymentRequest = paymentRequestsStore.addPaymentRequest(newPaymentRequest)

        transactionData.push({
            status: TransactionStatus.PENDING,            
            paymentRequest,
        })

       transaction.setStatus(            
            TransactionStatus.PENDING,
            JSON.stringify(transactionData),
        )

        if(!nwcEvent) {
            poller(
                `handlePendingTopupTaskPoller-${paymentRequest.paymentHash}`, 
                WalletTask.handlePendingTopup,
                {
                    interval: 6 * 1000,
                    maxPolls: 10,
                    maxErrors: 2
                },        
                {paymentRequest})   
            .then(() => log.trace('Polling completed', [], `handlePendingTopupTaskPoller`))
        }

        return {
            taskFunction: TOPUP,
            mintUrl,
            transaction,
            message: '',
            encodedInvoice,
            paymentRequest,
            nwcEvent
        } as TransactionTaskResult

    } catch (e: any) {        

        if (transaction) {
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

        log.error(e.name, e.message)

        return {
            taskFunction: TOPUP,
            transaction,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}