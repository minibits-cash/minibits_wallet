import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'

/**
 * This represents a Nostr relay
 */
export const RelayModel = types
    .model('Relay', {
        url: types.identifier,
        hostname: types.maybe(types.string),
        status: types.optional(types.number, WebSocket.CLOSED),
        error: types.maybe(types.string),        
    })
    .actions(withSetPropAction)
    .actions(self => ({
        setStatus(status: number) {
            if(status === WebSocket.OPEN) {
                self.error = undefined
            }
            self.status = status
        },
        setHostname() {
            try {
                self.hostname = new URL(self.url).hostname
            } catch (e) {
                return false
            }
        },
        setError(error: string) {
           self.error = error
        },        
  }))

export type Relay = {
    url: string
    status: number
    error?: string
} & Partial<Instance<typeof RelayModel>>
export interface RelaySnapshotOut extends SnapshotOut<typeof RelayModel> {}
export interface RelaySnapshotIn extends SnapshotIn<typeof RelayModel> {}
