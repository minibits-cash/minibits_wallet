import {rootStoreInstance} from '../../models'
import { TransactionTaskResult } from '../walletService'
import { MintBalance } from '../../models/Mint'
import { Transaction, TransactionData, TransactionStatus, TransactionType } from '../../models/Transaction'
import { log } from '../logService'
import { WalletUtils } from './utils'
import { MintUnit } from './currency'
import { NostrClient } from '../nostrService'
import { 
  PaymentRequest as CashuPaymentRequest, 
  PaymentRequestTransport, 
  PaymentRequestTransportType 
} from '@cashu/cashu-ts'
import QuickCrypto from 'react-native-quick-crypto'

const {
    transactionsStore,
    walletProfileStore,    
    relaysStore
} = rootStoreInstance

// const {walletStore} = nonPersistedStores

export const CASHU_PAYMENT_REQUEST_TASK = 'cashuPaymentRequestTask'

export const cashuPaymentRequestTask = async function (
    mintBalanceToReceiveTo: MintBalance,
    amountToReceive: number,
    unit: MintUnit,
    memo: string,
) : Promise<TransactionTaskResult> {
    log.info('[cashuPaymentRequestTask]', {mintBalanceToReceiveTo})
    log.info('[cashuPaymentRequestTask]', {amountToReceive, unit})

    // create draft transaction
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            amountToReceive,
            unit,
            createdAt: new Date(),
        },
    ]

    let transaction: Transaction | undefined = undefined
    const mintUrl = mintBalanceToReceiveTo.mintUrl

    try {
        const newTransaction = {
            type: TransactionType.RECEIVE_BY_PAYMENT_REQUEST,
            amount: amountToReceive,
            fee: 0,
            unit,
            data: JSON.stringify(transactionData),
            memo,
            mint: mintUrl,
            status: TransactionStatus.DRAFT,
        }
        // store tx in db and in the model
        transaction = await transactionsStore.addTransaction(newTransaction)        

        const tags = [["n", "17"]]
        const transport = [
          {
            type: PaymentRequestTransportType.NOSTR,
            target: NostrClient.encodeNprofile(walletProfileStore.pubkey, relaysStore.allUrls),
            tags,
          },
        ] as PaymentRequestTransport[]
    
        const cashuPrId = QuickCrypto.randomBytes(4).toString("hex")
        const cashuPaymentRequest = new CashuPaymentRequest(
          transport,
          cashuPrId,
          amountToReceive,
          unit,
          [mintUrl],
          memo
        )
    
        const encoded = cashuPaymentRequest.toEncodedRequest()

        log.trace("[cashuPaymentRequestTask] Creating cashu payment request", {cashuPaymentRequest, encoded})

        transactionData.push({
            status: TransactionStatus.PENDING,            
            cashuPaymentRequest,
            createdAt: new Date()
        })

        transaction.update({
            status: TransactionStatus.PENDING,
            data: JSON.stringify(transactionData),
            paymentId: cashuPrId
        })
       
        return {
            taskFunction: CASHU_PAYMENT_REQUEST_TASK,
            mintUrl,
            transaction,
            message: '',
            cashuPaymentRequest,
            encodedCashuPaymentRequest: encoded,
        } as TransactionTaskResult

    } catch (e: any) {        

        if (transaction) {
            transactionData.push({
                status: TransactionStatus.ERROR,
                error: WalletUtils.formatError(e),
                createdAt: new Date()
            })

            transaction.update({
                status: TransactionStatus.ERROR,
                data: JSON.stringify(transactionData)
            })
        }

        log.error(e.name, e.message)

        return {
            taskFunction: CASHU_PAYMENT_REQUEST_TASK,
            transaction,
            message: e.message,
            error: WalletUtils.formatError(e),
        } as TransactionTaskResult
    }
}
