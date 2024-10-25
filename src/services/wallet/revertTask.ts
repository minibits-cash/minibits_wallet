import {log} from '../logService'
import {
  Transaction,
  TransactionData,
  TransactionRecord,
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuUtils, ProofV3, TokenEntryV3, TokenV3} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import { getDefaultAmountPreference } from '@cashu/cashu-ts/src/utils'
import { TransactionTaskResult } from '../walletService'
import { WalletUtils } from './utils'
import { MintUnit, formatCurrency, getCurrency } from './currency'
import { Proof } from '../../models/Proof'
import { MintProofsCounter } from '../../models/Mint'

const {
  mintsStore,
  proofsStore,  
  walletStore
} = rootStoreInstance

const REVERT = 'revertTask'

export const revertTask = async function (    
  transaction: Transaction  
): Promise<TransactionTaskResult> {    

let lockedProofsCounter: MintProofsCounter | undefined = undefined
const transactionData = JSON.parse(transaction.data)

try {
      const unit = transaction.unit as MintUnit
      const pendingProofs = proofsStore.getByTransactionId(transaction.id!, true)

      if(pendingProofs.length === 0) {
        throw new AppError(Err.VALIDATION_ERROR, 'Missing proofs to swap')
      }

      const mintInstance = mintsStore.findByUrl(transaction.mint)

      if(!mintInstance) {
          throw new AppError(Err.VALIDATION_ERROR, 'Missing mint')
      }

      const amountToRevert = CashuUtils.getProofsAmount(pendingProofs)
      const amountPreferences = getDefaultAmountPreference(amountToRevert)        
      const countOfInFlightProofs = CashuUtils.getAmountPreferencesCount(amountPreferences)                
      const mintFeeReserve = mintInstance.getMintFeeReserve(pendingProofs)        
      
      log.trace('[_revertTask]', 'amountPreferences', {amountPreferences, transactionId: transaction.id})
      log.trace('[_revertTask]', 'countOfInFlightProofs', {countOfInFlightProofs, transactionId: transaction.id})
      
      // We will swap pending proofs with the mint for fresh ones that we receive to the wallet.
      // This will invalidate originally sent proofs effectively reverting the transaction.
      const encodedToken: TokenV3 = {
        token: [
            {
                mint: mintInstance.mintUrl,
                proofs: pendingProofs
            }
        ],
        unit
      }
      
      // temp increase the counter + acquire lock and set inFlight values        
      lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
          mintInstance, 
          unit, 
          countOfInFlightProofs, 
          transaction.id!
      )

      const receivedResult = await walletStore.receive(
          transaction.mint,
          unit as MintUnit,
          encodedToken,
          mintFeeReserve,
          {            
            preference: amountPreferences,
            counter: lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
          }
      )
      
      const receivedProofs = receivedResult.proofs
      const mintFeePaid = receivedResult.mintFeePaid

      // log.trace('[receiveTask]', {receivedProofs})
     
      // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
      lockedProofsCounter.decreaseProofsCounter(countOfInFlightProofs)

      // store freshed proofs as encoded token in tx data        
      const receivedTokenEntry = {
          mint: mintInstance.mintUrl,
          proofs: receivedProofs,
      }

      const outputToken = CashuUtils.encodeToken({
          token: [receivedTokenEntry],
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

      // release lock
      lockedProofsCounter.resetInFlight(transaction.id!)

      // Update transaction status
      transactionData.push({
          status: TransactionStatus.REVERTED,            
          mintFeeReserve,
          mintFeePaid,
          counter: lockedProofsCounter.counter,
          createdAt: new Date(),
      })

      transaction.setStatus(            
          TransactionStatus.REVERTED,
          JSON.stringify(transactionData),
      )

      transaction.setOutputToken(outputToken)
      const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance!
      transaction.setBalanceAfter(balanceAfter)

      if(mintFeePaid > 0) {
          transaction.setFee(mintFeePaid)
      }

      return {
          taskFunction: REVERT,
          mintUrl: mintInstance.mintUrl,
          transaction,
          message: `Transaction has been reverted and funds were returned to spendable balance.`,
          receivedAmount,
      } as TransactionTaskResult
      
  } catch (e: any) {
      if (transaction) {            
          if(lockedProofsCounter) {                
              lockedProofsCounter.resetInFlight(transaction.id!)
          }

          transactionData.push({
              status: TransactionStatus.ERROR,
              error: WalletUtils.formatError(e),
              errorToken: e.params?.errorToken || undefined
          })

          transaction.setStatus(                
              TransactionStatus.ERROR,
              JSON.stringify(transactionData),
          )
      }

      log.error(e.name, e.message)

      return {
          taskFunction: REVERT,
          mintUrl: transaction.mint,
          transaction,
          message: e.message,
          error: WalletUtils.formatError(e),
      } as TransactionTaskResult
  }
}