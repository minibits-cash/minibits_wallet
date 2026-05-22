import EventEmitter from '../../utils/eventEmitter'
import AppError, {Err} from '../../utils/AppError'
import {SyncQueue} from '../syncQueueService'
import {TASK_QUEUE_TIMEOUT, WalletTaskResult} from './types'

/**
 * Shared helper that wraps a task function with the SyncQueue + EventEmitter +
 * timeout pattern that every queue-awaitable wrapper repeats verbatim.
 *
 * The wrapper resolves either:
 *  - when the SyncQueue's promise settles, or
 *  - when an event with name `ev_${taskFunction}_result` is emitted
 *    (whichever happens first — they carry the same result).
 *
 * Both paths share a single-resolution guard (resolveOnce / rejectOnce).
 */
export interface QueueAwaitableOptions<T extends WalletTaskResult> {
    /** Stable task name used in taskId and event name (matches result.taskFunction). */
    taskFunction: string
    /** The task body to run inside the queue. */
    task: () => Promise<T>
    /** Use addPrioritizedTask when true, otherwise addTask. Defaults to true. */
    prioritized?: boolean
    /** Timeout in ms before rejecting with TIMEOUT_ERROR. Defaults to TASK_QUEUE_TIMEOUT. */
    timeoutMs?: number
    /** Message used for the timeout error. */
    timeoutMessage?: string
}

export const createQueueAwaitable = <T extends WalletTaskResult>(
    options: QueueAwaitableOptions<T>,
): Promise<T> => {
    const {
        taskFunction,
        task,
        prioritized = true,
        timeoutMs = TASK_QUEUE_TIMEOUT,
        timeoutMessage = `${taskFunction} timed out`,
    } = options

    const taskId = `${taskFunction}-${Date.now()}`
    const eventName = `ev_${taskFunction}_result`

    return new Promise<T>((resolve, reject) => {
        let resolved = false

        const resolveOnce = (result: T) => {
            if (resolved) return
            resolved = true
            EventEmitter.off(eventName, handler)
            resolve(result)
        }

        const rejectOnce = (error: any) => {
            if (resolved) return
            resolved = true
            EventEmitter.off(eventName, handler)
            reject(error)
        }

        const handler = (result: T) => resolveOnce(result)
        EventEmitter.on(eventName, handler)

        const queued = prioritized
            ? SyncQueue.addPrioritizedTask<T>(taskId, async () => {
                  try {
                      return await task()
                  } catch (error) {
                      rejectOnce(error)
                      throw error
                  }
              })
            : SyncQueue.addTask<T>(taskId, async () => {
                  try {
                      return await task()
                  } catch (error) {
                      rejectOnce(error)
                      throw error
                  }
              })

        queued.then(resolveOnce).catch(rejectOnce)

        setTimeout(() => {
            if (!resolved) {
                rejectOnce(new AppError(Err.TIMEOUT_ERROR, timeoutMessage))
            }
        }, timeoutMs)
    })
}
