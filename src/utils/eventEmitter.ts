import { log } from "../services"

class EventEmitter {
  private events: {[eventName: string]: Function[]}

  constructor() {
    this.events = {}
  }

  /**
   * Subscribe to an event.
   * @param eventName The name of the event to subscribe to.
   * @param handler The callback function to be called when the event is emitted.
   */
  on(eventName: string, handler: Function) {
    log.trace(`[EventEmitter.on] Subscribing to ${eventName}`)

    if (!this.events[eventName]) {
      this.events[eventName] = []
    }

    if(!this.events[eventName].includes(handler)) {
      this.events[eventName].push(handler)
    } else {
      log.warn(`[EventEmitter.on] ${eventName} event listener with this handler already exists, skipping...`)
    }    
  }

  /**
   * Emit an event.
   * @param eventName The name of the event to emit.
   * @param args Additional arguments to pass to the event handlers.
   */
  emit(eventName: string, ...args: any[]) {
    const handlers = this.events[eventName]

    if (handlers) {
      handlers.forEach(handler => handler(...args))
    }
  }

  /**
   * Unsubscribe from an event.
   * @param eventName The name of the event to unsubscribe from.
   * @param handler The callback function to remove from the event handlers.
   */
  off(eventName: string, handler: Function) {
    const handlers = this.events[eventName]

    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index !== -1) {
        handlers.splice(index, 1)
      }
    }
  }
}

export default new EventEmitter()
