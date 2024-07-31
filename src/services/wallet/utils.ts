import {Proof} from '../../models/Proof'
import {rootStoreInstance} from '../../models'
import AppError, { Err } from "../../utils/AppError"
import { log } from '../logService'
import { isStateTreeNode } from 'mobx-state-tree'
import { CashuUtils, ProofV3 } from '../cashu/cashuUtils'
import { Mint, MintProofsCounter } from '../../models/Mint'
import { delay } from '../../utils/utils'
import { MintUnit } from './currency'

const {
    proofsStore,
    nonPersistedStores
} = rootStoreInstance

const { walletStore } = nonPersistedStores


const lockAndSetInFlight = async function (
    mint: Mint, 
    unit: MintUnit,    
    countOfInFlightProofs: number,
    transactionId: number,
    retryCount: number = 0,    
): Promise<MintProofsCounter> {
    
    // Make sure to select the wallet instance keysetId
    const walletInstance = await walletStore.getWallet(mint.mintUrl, unit, {withSeed: true})
    const currentCounter = mint.getProofsCounterByKeysetId!(walletInstance.keys.id)

    if(!currentCounter) {
        throw new AppError(Err.VALIDATION_ERROR, 'Missing ProofsCounter.')
    }

    // log.trace('[lockAndSetInFlight] proofsCounter before lock', {currentCounter})

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
            currentCounter.resetInFlight(currentCounter.inFlightTid as number)
        }
    } // deprecated end

    // This sets inFlightFrom -> inFlightTo recovery interval in case the mint response won't come
    // It sets as well the counter to inFlightTo until response comes
    currentCounter.setInFlight!(        
        currentCounter?.counter as number, // from
        currentCounter?.counter as number + countOfInFlightProofs, // to + temp counter value
        transactionId        
    )

    // log.trace('[lockAndSetInFlight] proofsCounter locked', {currentCounter})

    return currentCounter
}


const addCashuProofs = function (    
    mintUrl: string,
    proofsToAdd: ProofV3[] | Proof[],
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