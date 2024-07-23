import {
    type Token as CashuToken,
    type TokenEntry as CashuTokenEntry,
    type Proof as CashuProof,
    deriveKeysetId,
    MintKeys,
} from '@cashu/cashu-ts'
import {Proof} from '../../models/Proof'
import {rootStoreInstance} from '../../models'
import AppError from "../../utils/AppError"
import { log } from '../logService'
import { isStateTreeNode } from 'mobx-state-tree'
import { CashuUtils } from '../cashu/cashuUtils'
import { Mint, MintProofsCounter } from '../../models/Mint'
import { delay } from '../../utils/utils'
import { MintUnit } from './currency'



const {
    proofsStore,
    mintsStore
} = rootStoreInstance


const lockAndSetInFlight = async function (
    mint: Mint, 
    unit: MintUnit,    
    countOfInFlightProofs: number,
    transactionId: number,
    retryCount: number = 0,    
): Promise<void> {
    
    const currentCounter = mint.getProofsCounterByUnit?.(unit)
    log.trace('[lockAndSetInFlight] proofsCounter', {currentCounter})

    if(!retryCount) {
        retryCount = 10
    }
    
    // deprecated, should not be necessary anymore with serial task queue processing
    if(currentCounter && currentCounter.inFlightTid && currentCounter.inFlightTid !== transactionId) {
        
        log.warn('[lockAndSetInFlight] Waiting for a lock to release', {
            lockedBy: currentCounter.inFlightTid, 
            waiting: transactionId
        })

        await delay(1000)

        if (retryCount < 50) {
            // retry to acquire lock, increment the count of retries up to 50 seconds
            return lockAndSetInFlight(
                mint,
                unit,
                countOfInFlightProofs,
                transactionId,
                retryCount + 1
            )
        } else {            
            log.error('[lockAndSetInFlight] Hard reset the lock after max retries to release were reached', {
                lockedBy: currentCounter.inFlightTid, 
                waiting: transactionId
            })         
            mint.resetInFlight?.(currentCounter.inFlightTid as number)
        }
    } // deprecated end

    // This sets inFlightFrom -> inFlightTo recovery interval in case the mint response won't come
    // It sets as well the counter to inFlightTo until response comes
    mint.setInFlight?.(
        currentCounter?.keyset as string,        
        {
            inFlightFrom:  currentCounter?.counter as number,
            inFlightTo: currentCounter?.counter as number + countOfInFlightProofs,
            inFlightTid: transactionId
        }
    )
}


const addCashuProofs = function (    
    mintUrl: string,
    proofsToAdd: CashuProof[] | Proof[],
    options: {
        unit: MintUnit,
        transactionId: number,
        isPending: boolean  
    }    
):{  
    amountToAdd: number,  
    addedAmount: number,
    addedProofs: Proof[]
} {
    const {unit, transactionId, isPending} = options
    // Add internal references
    for (const proof of proofsToAdd) {
        if (isStateTreeNode(proof)) {
            proof.setTransactionId(transactionId)
            proof.setMintUrl(mintUrl)
            proof.setUnit(unit)
        } else {
            ;(proof as Proof).tId = transactionId
            ;(proof as Proof).mintUrl = mintUrl
            ;(proof as Proof).unit = unit
        }
    }

    const amountToAdd = CashuUtils.getProofsAmount(proofsToAdd as Proof[])    
    // Creates proper model instances and adds them to the wallet    
    const { addedAmount, addedProofs} = proofsStore.addProofs(proofsToAdd as Proof[], isPending)
   
    log.trace('[_addCashuProofs]', 'Added proofs to the wallet with amount', { amountToAdd, addedAmount, isPending })

    return {        
        amountToAdd,
        addedAmount,
        addedProofs
    }
}


const formatError = function (e: AppError) {
    return {
        name: e.name,
        message: e.message.slice(0, 500),
        params: e.params || {},
    } as AppError 
}

export const WalletUtils = {
    lockAndSetInFlight,
    addCashuProofs,    
    formatError
}