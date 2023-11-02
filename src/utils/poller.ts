import { log } from '../services/logService'
import { Err } from './AppError'

const pollers = new Map<string, boolean>() // Map to track active pollers

export const poller = async (
  name: string,
  fnToExecute: () => Promise<any>,
  interval: number,
  maxPolls: number,
  maxErrors: number,
): Promise<void> => {
  let pollCount = 0
  let errorCount = 0

  pollers.set(name, true); // Add poller to the Map

  while (pollers.get(name) && pollCount < maxPolls && errorCount < maxErrors) {
    try {
      log.trace(`Poll count for ${name}: ${pollCount}`)
      await fnToExecute()
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
}
