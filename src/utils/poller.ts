import { log } from '../services/logService'
import { Err } from './AppError'

const pollers = new Map<string, boolean>() // Map to track active pollers

export const poller = async (
    name: string,
    fnToExecute: (params: any) => Promise<any>, // Accept additional parameters
    config: {
        interval: number,
        maxPolls: number,
        maxErrors: number,
    },    
    params?: any // Additional parameters to pass to fnToExecute
): Promise<void> => {
    let pollCount = 0
    let errorCount = 0
    const {interval, maxPolls, maxErrors} = config

    pollers.set(name, true); // Add poller to the Map
    log.info('Starting new poller', {name, numOfPollers: pollers.size})

    while (pollers.get(name) && pollCount < maxPolls && errorCount < maxErrors) {
        try {
            log.trace(`Poll count for ${name}: ${pollCount}`)
            await fnToExecute(params) // Pass params to fnToExecute
            pollCount++
        } catch (e: any) {
            log.error(Err.POLLING_ERROR, `Polling error for ${name}:`, e.message)
            errorCount++
        }

        await new Promise(resolve => setTimeout(resolve, interval))
    }

    pollers.delete(name) // Remove poller from the Map after last run
}

export const stopPolling = (name: string) => {
    pollers.delete(name) // Remove poller from the Map
    log.info('Removing poller', {name, numOfPollers: pollers.size})
}

export const pollerExists = (name: string) => {
    return pollers.has(name) ? true : false    
}
