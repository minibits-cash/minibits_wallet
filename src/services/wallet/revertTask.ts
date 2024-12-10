import {log} from '../logService'
import {
  Transaction,
  TransactionStatus,  
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import {CashuUtils, CashuProof} from '../cashu/cashuUtils'
import AppError, {Err} from '../../utils/AppError'
import { DEFAULT_DENOMINATION_TARGET, TransactionTaskResult } from '../walletService'
import { WalletUtils } from './utils'
import { MintUnit } from './currency'
import { MintProofsCounter } from '../../models/Mint'
import { Token } from '@cashu/cashu-ts'
import { getEncodedToken, getKeepAmounts } from '@cashu/cashu-ts/src/utils'

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
    const proofsByMint = proofsStore.getByMint(mintInstance.mintUrl, {
        isPending: false,
        unit
    })

    const walletInstance = await walletStore.getWallet(mintInstance.mintUrl, unit, {withSeed: true})

    const amountPreference = getKeepAmounts(
        proofsByMint,
        amountToRevert,
        (await walletInstance.getKeys()).keys,
        DEFAULT_DENOMINATION_TARGET            
    )       
      
      log.trace('[_revertTask]', {amountPreference, transactionId: transaction.id})      
      
      // We will swap pending proofs with the mint for fresh ones that we receive to the wallet.
      // This will invalidate originally sent proofs effectively reverting the transaction.
      const encodedToken: Token = {
        mint: mintInstance.mintUrl,
        proofs: pendingProofs,
        unit
      }
      
      // temp increase the counter + acquire lock and set inFlight values        
      lockedProofsCounter = await WalletUtils.lockAndSetInFlight(
          mintInstance, 
          unit, 
          amountPreference.length, 
          transaction.id!
      )

      const receivedResult = await walletStore.receive(
          transaction.mint,
          unit as MintUnit,
          encodedToken,          
          {            
            outputAmounts: {keepAmounts: [], sendAmounts: amountPreference},
            counter: lockedProofsCounter.inFlightFrom as number // MUST be counter value before increase
          }
      )
      
      const receivedProofs = receivedResult.proofs
      const mintFeePaid = receivedResult.swapFeePaid
  
      // If we've got valid response, decrease proofsCounter and let it be increased back in next step when adding proofs        
      lockedProofsCounter.decreaseProofsCounter(amountPreference.length)

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

      // release lock
      lockedProofsCounter.resetInFlight(transaction.id!)

      // Update transaction status
      transactionData.push({
          status: TransactionStatus.REVERTED,
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