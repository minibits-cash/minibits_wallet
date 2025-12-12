import { Task, TaskId, TaskQueue, TaskStatus } from "taskon"
import {log} from './logService'
import EventEmitter from '../utils/eventEmitter'
import { TransactionTaskResult, WalletTaskResult } from "./walletService"
import { NotificationService, NWC_LISTENER_NAME } from "./notificationService"

let _queue: any = undefined

const getSyncQueue = function () {
    if(!_queue) {
        _queue = new TaskQueue({
            concurrency: 1, // strictly synchronous processing
            returnError: true,
            stopOnError: false,
            // verbose: true,
            taskPrioritizationMode: "head",
            memorizeTasks: true
          })
        return _queue as TaskQueue
    }

    return _queue as TaskQueue
}

const addTask = function <T>(
    taskId: TaskId, 
    task: Promise<T> | (() => Promise<T>) | any
): Promise<T> {
    const queue = getSyncQueue()

    log.info(`Adding new task ${taskId} to the queue`)

    const promise = queue.addTask(
        task,
        taskId, 
        _handleTaskStatusChange
    ) as Promise<T>

    // Side effect: handle result when it resolves (fire-and-forget)
    promise.then((result: any) => {
        _handleTaskResult(taskId, result as WalletTaskResult | TransactionTaskResult)
    }).catch(() => {})  // Optional: ignore errors here if handled elsewhere

    return promise
}

const addPrioritizedTask = function <T>(
    taskId: TaskId, 
    task: Promise<T> | (() => Promise<T>) | any
): Promise<T> {
    const queue = getSyncQueue()

    log.info(`Adding new high priority task ${taskId} to the queue`)

    const promise = queue.addPrioritizedTask(
        task,
        taskId, 
        _handleTaskStatusChange
    ) as Promise<T>

    promise.then((result: any) => {
        _handleTaskResult(taskId, result as WalletTaskResult | TransactionTaskResult)
    }).catch(() => {})

    return promise
}

// retrieve result of wallet transaction by listening to ev_taskFuncion event
const _handleTaskResult = async (taskId: TaskId, result: WalletTaskResult | TransactionTaskResult) => {
    log.info(
      `[_handleTaskResult] The result of task ${taskId}`, result
    )    

    EventEmitter.emit(`ev_${result.taskFunction}_result`, result)

    const queue: TaskQueue = getSyncQueue()    
    
    log.trace('[_handleTaskResult]', {inQueue: queue.getAllTasksDetails(['idle', 'running']).length})

    if(queue.getAllTasksDetails(['idle', 'running']).length === 0) {
        const notifications = await NotificationService.getDisplayedNotifications()
        // Do not stop the listener for NWC events, this one is handled via timeout
        for (const n of notifications) {            
            if(n.notification.android?.asForegroundService) {
                if(n.notification.title && n.notification.title !== NWC_LISTENER_NAME) {
                    log.trace('[_handleTaskResult] Stopping foreground service')
                    await NotificationService.stopForegroundService()
                }
            }
        }
    }
}
  
// Helper function to handle the task status changes
const _handleTaskStatusChange = (status: TaskStatus, task: Task) => {
    log.trace(
        `[_handleTaskStatusChange] The status of task ${task.taskId} changed to ${status}`,
    )
}


export const SyncQueue = {
    getSyncQueue,    
    addTask,
    addPrioritizedTask,
}
