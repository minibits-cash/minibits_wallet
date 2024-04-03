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
import { Mint } from '../../models/Mint'
import { delay } from '../../utils/utils'
import { MintClient } from '../cashuMintClient'



const {
    proofsStore,
    mintsStore
} = rootStoreInstance


const lockAndSetInFlight = async function (
    mint: Mint, 
    countOfInFlightProofs: number, 
    transactionId: number,
    retryCount: number = 0
): Promise<void> {
    
    const currentCounter = mint.getOrCreateProofsCounter?.()
    log.trace('[lockAndSetInFlight] proofsCounter', {currentCounter})

    if(!retryCount) {
        retryCount = 50
    }
    
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
    }

    // This sets inFlightFrom -> inFlightTo recovery interval in case the mint response won't come
    // It sets as well the counter to inFlightTo until response comes
    mint.setInFlight?.(
        currentCounter?.counter as number, 
        currentCounter?.counter as number + countOfInFlightProofs,
        transactionId
    )
}


const addCashuProofs = function (
    proofsToAdd: CashuProof[] | Proof[],
    mintUrl: string,
    transactionId: number,
    isPending: boolean = false  
): {  
    amountToAdd: number,  
    addedAmount: number,
    addedProofs: Proof[]
} {
    // Add internal references
    for (const proof of proofsToAdd) {
        if (isStateTreeNode(proof)) {
            proof.setTransactionId(transactionId)
            proof.setMintUrl(mintUrl)
        } else {
            ;(proof as Proof).tId = transactionId
            ;(proof as Proof).mintUrl = mintUrl
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


const updateMintKeys = function (mintUrl: string, newKeys: MintKeys) {
    if(!CashuUtils.validateMintKeys(newKeys)) {
        // silent
        log.warn('[_updateMintKeys]', 'Invalid mint keys to update, skipping', newKeys)
        return
    }

    const keyset = deriveKeysetId(newKeys)
    const mint = mintsStore.findByUrl(mintUrl)
    mint?.updateKeys(keyset, newKeys)
    // needed to get rid of cached old keyset
    MintClient.resetCachedWallets()
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
    updateMintKeys,
    formatError
}