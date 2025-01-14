import {Proof} from '../../models/Proof'
import {rootStoreInstance} from '../../models'
import AppError from "../../utils/AppError"
import { log } from '../logService'
import { isStateTreeNode } from 'mobx-state-tree'
import { CashuUtils, CashuProof } from '../cashu/cashuUtils'
import { MintUnit } from './currency'
import { isObj } from '@cashu/cashu-ts/src/utils'

const {
    proofsStore,
} = rootStoreInstance


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
        message: isObj(e.message) ? JSON.stringify(e.message) : e.message.slice(0, 200),
        params: e.params || {},
    } as AppError 
}

export const WalletUtils = {    
    addCashuProofs,    
    formatError
}