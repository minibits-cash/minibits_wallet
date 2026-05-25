import {log} from '../logService'
import {
  Transaction,
  TransactionData,
  TransactionStatus,  
} from '../../models/Transaction'
import {rootStoreInstance} from '../../models'
import AppError, {Err} from '../../utils/AppError'
import { TransactionTaskResult } from '../walletService'
import { ProofReservation } from './proofReservation'
import { WalletUtils } from './utils'
import { MintUnit } from './currency'
import { Token, getEncodedToken, normalizeProofAmounts } from '@cashu/cashu-ts'

const {
  mintsStore,
  proofsStore,  
  walletStore
} = rootStoreInstance

export const REVERT_TASK = 'revertTask'

export const revertTask = async function (    
  transaction: Transaction  
): Promise<TransactionTaskResult> {    


let transactionData = [] as unknown as TransactionData

try {
    transactionData = JSON.parse(transaction.data)
} catch (e) {}

const unit = transaction.unit as MintUnit

const allProofs = proofsStore.getByTransactionId(transaction.id)
const pendingProofs = allProofs.filter(p => p.state === 'PENDING')
const mintInstance = mintsStore.findByUrl(transaction.mint)

// Reservation is declared at the outer scope so the catch block can resolve it
// (commit or rollback) if a failure happens after it's opened. Errors thrown
// during the pre-validation below leave it undefined.
let reservation: ProofReservation | undefined = undefined

try {

    if(pendingProofs.length === 0) {
    throw new AppError(Err.VALIDATION_ERROR, 'Missing proofs to swap')
    }

    if(!mintInstance) {
        throw new AppError(Err.VALIDATION_ERROR, 'Missing mint')
    }

    // We will swap pending proofs with the mint for fresh ones that we receive to the wallet.
    // This will invalidate originally sent proofs effectively reverting the transaction.
    const encodedToken: Token = {
        mint: mintInstance.mintUrl,
        proofs: normalizeProofAmounts(pendingProofs),
        unit
    }

    // Open the reservation BEFORE the mint call. The pending proofs are
    // already PENDING; `rollbackTo: 'PENDING'` ensures they stay PENDING if
    // the recovery swap fails (user can retry). Without the override, rollback
    // would restore them to their pre-reservation state which is also PENDING
    // — but being explicit documents the intent and protects against future
    // callers passing UNSPENT proofs into revertTask by mistake.
    reservation = proofsStore.reserve(pendingProofs, {
        transactionId: transaction.id,
        mintUrl: mintInstance.mintUrl,
        unit,
        operationType: 'revert',
        rollbackTo: 'PENDING',
    })

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
        proofs: normalizeProofAmounts(receivedProofs),
        unit
    })

    // Pre-compute everything that needs to land atomically. balanceAfter is
    // simulated: the original pending proofs were PENDING (contribute 0 to
    // UNSPENT pool); moving them to SPENT changes nothing. The new fresh
    // proofs added as UNSPENT raise the spendable balance.
    const receivedAmount = receivedProofs.reduce((sum, p) => sum + Number(p.amount), 0)
    const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
    const balanceAfter = currentSpendable + receivedAmount

    transactionData.push({
        status: TransactionStatus.REVERTED,
        mintFeePaid,
        createdAt: new Date(),
    })

    // ATOMIC commit: pending proofs → SPENT, new fresh proofs → UNSPENT,
    // tx → REVERTED, reservation row deleted — single SQLite transaction.
    proofsStore.commitReservation(reservation, {
        toSpent: pendingProofs,
        newProofs: [{ proofs: receivedProofs, state: 'UNSPENT', tId: transaction.id }],
        transactionUpdate: {
            id: transaction.id,
            status: TransactionStatus.REVERTED,
            data: JSON.stringify(transactionData),
            outputToken,
            balanceAfter,
            ...(mintFeePaid > 0 && { fee: mintFeePaid }),
        },
    })

    return {
        taskFunction: REVERT_TASK,
        mintUrl: mintInstance.mintUrl,
        transaction,
        message: `Transaction has been reverted and funds were returned to spendable balance.`,
        receivedAmount,
    } as TransactionTaskResult

  } catch (e: any) {
      // Resolve the reservation if we opened one (otherwise it becomes an
      // orphan). Rollback restores the proofs to PENDING (their pre-reservation
      // state) so the user can retry the revert.
      if (reservation) {
          proofsStore.rollbackReservation(reservation)
      }

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
