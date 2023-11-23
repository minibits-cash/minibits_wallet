import {KeyChain} from './keyChain'
import {log} from './logService'
import AppError, { Err } from '../utils/AppError'



const getOrCreateSeed = async function (): Promise<string> {
    let seed: string | null = null
    seed = await KeyChain.loadSeed() as string

    if (!seed) {
        seed = KeyChain.generateSeed() as string
        await KeyChain.saveSeed(seed)

        log.trace('[getOrCreateSeed]', 'Created and saved new seed')
    }
     
    return seed
}


const getSeed = async function (): Promise<string | null> {
    let seed: string | null = null
    seed = await KeyChain.loadSeed() as string

    if (!seed) {
        return null        
    }
     
    return seed
}


export const RestoreClient = {        
    getOrCreateSeed,
    getSeed,
}