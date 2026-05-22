import { log } from "../services"

/**
 * Type-side registry of wallet events. Empty by default — service-layer files
 * use `declare module '../../utils/eventEmitter' { interface CoreEvents { ... } }`
 * to register their event names and payload shapes.
 *
 * See [src/services/wallet/events.ts](src/services/wallet/events.ts) for the
 * canonical wallet event map.
 */
export interface CoreEvents {}

type EventKey = keyof CoreEvents & string

/**
 * Resolves to the input string when it is NOT a registered event name, otherwise
 * to `never`. Used in the untyped fallback overload so a literal string that
 * matches a known event name cannot bypass the typed signature.
 *
 *   UnknownEventName<'ev_asyncMeltResult'> = never
 *   UnknownEventName<'something_else'>      = 'something_else'
 *   UnknownEventName<string>                = string  (no widening hazard)
 */
type UnknownEventName<S extends string> = S extends EventKey ? never : S

class EventEmitter {
  private events: {[eventName: string]: Function[]}

  constructor() {
    this.events = {}
  }

  /**
   * Subscribe to an event.
   *
   * Two overloads:
   *  - Known event name (`keyof CoreEvents`): handler payload is type-checked.
   *  - Arbitrary string: falls back to untyped Function — backward compatible.
   */
  on<K extends EventKey>(eventName: K, handler: (payload: CoreEvents[K]) => void): void
  on<S extends string>(eventName: UnknownEventName<S>, handler: Function): void
  on(eventName: string, handler: Function) {
    log.trace(`[EventEmitter.on] Subscribing to ${eventName}`)

    if (!this.events[eventName]) {
      this.events[eventName] = []
    }

    if(!this.events[eventName].includes(handler)) {
      this.events[eventName].push(handler)
    } else {
      log.trace(`[EventEmitter.on] ${eventName} event listener with this handler already exists, skipping...`)
    }
  }

  /**
   * Emit an event.
   *
   * Two overloads:
   *  - Known event name: requires a single payload of the registered type.
   *  - Arbitrary string: accepts any args — backward compatible.
   */
  emit<K extends EventKey>(eventName: K, payload: CoreEvents[K]): void
  emit<S extends string>(eventName: UnknownEventName<S>, ...args: any[]): void
  emit(eventName: string, ...args: any[]) {
    const handlers = this.events[eventName]

    if (handlers) {
      handlers.forEach(handler => handler(...args))
    }
  }

  /**
   * Unsubscribe from an event.
   */
  off<K extends EventKey>(eventName: K, handler: (payload: CoreEvents[K]) => void): void
  off<S extends string>(eventName: UnknownEventName<S>, handler: Function): void
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
