import {
    Instance,
    SnapshotOut,
    types,
    destroy,
    isStateTreeNode,
    detach,
  } from 'mobx-state-tree'
  import {withSetPropAction} from './helpers/withSetPropAction'
  import {RelayModel, Relay} from './Relay'
  import {log} from '../utils/logger'
import { MINIBITS_RELAY_URL } from '@env'
  
  
  export const RelaysStoreModel = types
      .model('RelaysStore', {
          relays: types.array(RelayModel),          
      })
      .views(self => ({
            findByUrl: (url: string | URL) => {
                const relay = self.relays.find(r => r.url === url)
                return relay ? relay : undefined
            },
            alreadyExists(url: string) {
                return self.relays.some(m => m.url === url) ? true : false
            },
            get allRelays() {
                return self.relays
            },
            get allPublicRelays() {
                return self.relays.filter(r => r.url !== MINIBITS_RELAY_URL && r.url !== MINIBITS_RELAY_URL + '/')
            },
      }))
      .actions(withSetPropAction)
      .actions(self => ({
            addOrUpdateRelay(relay: Relay) {
                if(self.alreadyExists(relay.url)) {

                    const {url, status, error} = relay

                    const relayInstance = self.findByUrl(url)
                    relayInstance?.setStatus(status)

                    if(error) {
                        relayInstance?.setError(error)
                    }

                    log.trace('Relay updated in the RelaysStore', {relay}, 'addOrUpdateRelay')
                } else {
                    const relayInstance = RelayModel.create(relay)
                    relayInstance.setHostname()                 
                    self.relays.push(relayInstance)

                    log.info('New relay added to the RelaysStore', {relay}, 'addOrUpdateRelay')
                }
            },
            removeRelay(relayUrl: string) {
                
                const relayInstance = self.findByUrl(relayUrl)                
    
                if (relayInstance) {
                    detach(relayInstance)
                    destroy(relayInstance)
                    log.info('Relay removed from RelaysStore', {relayUrl}, 'removeRelay')
                }
            },
      }))
      .views(self => ({
            get allUrls() {
                return self.relays.map(r => r.url)
            },
            get allPublicUrls() {
                return self.allPublicRelays.map(r => r.url)
            },
            get connectedCount() {
                return self.relays.filter(r => r.status === WebSocket.OPEN).length
            },
            get disconnectedCount() {
                return self.relays.filter(r => r.status === WebSocket.CLOSED).length
            },          

          
    }))
  
  export interface RelaysStore extends Instance<typeof RelaysStoreModel> {}
  export interface RelaysStoreSnapshot
    extends SnapshotOut<typeof RelaysStoreModel> {}
  