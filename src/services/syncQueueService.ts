import { Task, TaskId, TaskQueue, TaskStatus } from "simple-js-task-queue"
import {rootStoreInstance} from '../models'
import {log} from './logService'
import EventEmitter from '../utils/eventEmitter'
import { TransactionTaskResult, WalletTaskResult } from "./walletService"
import { Err } from "../utils/AppError"
import { MintStatus } from "../models/Mint"

const {
    mintsStore,    
} = rootStoreInstance

let _queue: any = undefined
// const start = new Date().getTime()

const getSyncQueue = function () {
    if(!_queue) {
        _queue = new TaskQueue({
            concurrency: 1, // strictly synchronous processing
            returnError: true,
            stopOnError: false,
            // verbose: true,
            taskPrioritizationMode: "head",
          })
        return _queue
    }

    return _queue
}

const addTask = function (taskId: TaskId, task: Promise<any> | any) {
    const queue = getSyncQueue()

    log.info(`Adding new task ${taskId} to the queue`)

    queue
    .addTask(
        task,
        taskId, _handleTaskStatusChange)
    .then((result: WalletTaskResult | TransactionTaskResult) => _handleTaskResult(taskId, result))
    
}


const addPrioritizedTask = function (taskId: TaskId, task: Promise<any> | any) {
    const queue = getSyncQueue()

    log.info(`Adding new high priority task ${taskId} to the queue`)

    queue
    .addPrioritizedTask(
        task,
        taskId, _handleTaskStatusChange)
    .then((result: WalletTaskResult | TransactionTaskResult) => _handleTaskResult(taskId, result))
    
}

// retrieve result of wallet transaction by listening to ev_taskFuncion event
const _handleTaskResult = (taskId: TaskId, result: WalletTaskResult | TransactionTaskResult) => {
    log.info(
      `The result of task ${taskId}`, result
    )

    EventEmitter.emit(`ev_${result.taskFunction}_result`, result)
}
  
// Helper function to handle the task status changes
const _handleTaskStatusChange = (status: TaskStatus, task: Task) => {
    log.trace(
        `The status of task ${task.taskId} changed to ${status}`,
    )
}

export const SyncQueue = {
    getSyncQueue,
    addTask,
    addPrioritizedTask
}
