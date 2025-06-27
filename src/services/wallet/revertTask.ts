import {log} from '../logService'
import {
  Transaction,
  TransactionStatus,  
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import AppError, {Err} from '../../utils/AppError'
import { TransactionTaskResult } from '../walletService'
import { WalletUtils } from './utils'
import { MintUnit } from './currency'
import { Token } from '@cashu/cashu-ts'
import { getEncodedToken, getKeepAmounts } from '@cashu/cashu-ts/src/utils'

const {
  mintsStore,
  proofsStore,  
  walletStore
} = rootStoreInstance

export const REVERT_TASK = 'revertTask'

export const revertTask = async function (    
  transaction: Transaction  
): Promise<TransactionTaskResult> {    


let transactionData = []

try {
    transactionData = JSON.parse(transaction.data)
} catch (e) {}

const unit = transaction.unit as MintUnit

try {
    
    const pendingProofs = proofsStore.getByTransactionId(transaction.id!, true)

    if(pendingProofs.length === 0) {
    throw new AppError(Err.VALIDATION_ERROR, 'Missing proofs to swap')
    }

    const mintInstance = mintsStore.findByUrl(transaction.mint)

    if(!mintInstance) {
        throw new AppError(Err.VALIDATION_ERROR, 'Missing mint')
    } 
      
    // We will swap pending proofs with the mint for fresh ones that we receive to the wallet.
    // This will invalidate originally sent proofs effectively reverting the transaction.
    const encodedToken: Token = {
        mint: mintInstance.mintUrl,
        proofs: pendingProofs,
        unit
    }

    const receivedResult = await walletStore.receive(
        transaction.mint,
        unit as MintUnit,
        encodedToken,          
        transaction.id
    )
      
      const receivedProofs = receivedResult.proofs
      const mintFeePaid = receivedResult.swapFeePaid

      // store freshed proofs as encoded token in tx data        
      const outputToken = getEncodedToken({
        mint: mintInstance.mintUrl,
        proofs: receivedProofs,
        unit            
      })
      
      // Remove original pending proofs
      proofsStore.removeProofs(pendingProofs, true, false)
     
      // add fresh proofs to spendable wallet
      const { addedAmount: receivedAmount } = WalletUtils.addCashuProofs(
          mintInstance.mintUrl,
          receivedProofs,
          {
              unit,
              transactionId: transaction.id!,
              isPending: false
          }                    
      )

      // Update transaction status
      transactionData.push({
          status: TransactionStatus.REVERTED,
          mintFeePaid,          
          createdAt: new Date(),
      })

      const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
      
      transaction.update({
          status: TransactionStatus.REVERTED,
          data: JSON.stringify(transactionData),
          outputToken,
          balanceAfter,
          ...(mintFeePaid > 0 && {fee: mintFeePaid})
      })

      return {
          taskFunction: REVERT_TASK,
          mintUrl: mintInstance.mintUrl,
          transaction,
          message: `Transaction has been reverted and funds were returned to spendable balance.`,
          receivedAmount,
      } as TransactionTaskResult
      
  } catch (e: any) {
      if (transaction) {            
          transactionData.push({
              status: TransactionStatus.ERROR,
              error: WalletUtils.formatError(e),
              errorToken: e.params?.errorToken || undefined
          })

          transaction.update({
              status: TransactionStatus.ERROR,
              data: JSON.stringify(transactionData)
          })
      }

      log.error(e.name, e.message)

      return {
          taskFunction: REVERT_TASK,
          mintUrl: transaction.mint,
          transaction,
          message: e.message,
          error: WalletUtils.formatError(e),
      } as TransactionTaskResult
  }
}
