import {log} from './logger'
import {Err} from './AppError'

let shouldStop = false

export const poller = async (
  name: string,
  fnToExecute: () => Promise<any>,
  interval: number,
  maxPolls: number,
  maxErrors: number,
): Promise<void> => {
  let pollCount = 0
  let errorCount = 0

  while (!shouldStop && pollCount < maxPolls && errorCount < maxErrors) {
    try {
        log.trace(`Poll count ${pollCount}`)
        await fnToExecute()
        pollCount++
    } catch (e: any) {
        log.error(Err.POLLING_ERROR, `Polling error for ${name}:`, e.message)
        errorCount++
    }

    await new Promise(resolve => setTimeout(resolve, interval))
  }
}

export const stopPolling = () => {
    shouldStop = true
}
