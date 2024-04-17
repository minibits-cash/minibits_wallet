import {
  Instance,
  SnapshotOut,
  types,
  destroy,
  isStateTreeNode,
  detach,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {PaymentRequestModel, PaymentRequest, PaymentRequestStatus, PaymentRequestType} from './PaymentRequest'
import {log} from '../services/logService'
import AppError, { Err } from '../utils/AppError'
import {isBefore} from 'date-fns'
import {isAfter} from 'date-fns'
import {addSeconds} from 'date-fns'

export const PaymentRequestsStoreModel = types
    .model('PaymentRequests', {        
        paymentRequests: types.array(PaymentRequestModel),
    })
    .views(self => ({
        findByPaymentHash(paymentHash: string) {
            const pr = self.paymentRequests.find(p => p.paymentHash === paymentHash)
            return pr || undefined
        },
        findByTransactionId(transactionId: number) {
            const pr = self.paymentRequests.find(p => p.transactionId === transactionId)
            return pr || undefined
        },
    }))
    .actions(withSetPropAction)
    .actions(self => ({
        addPaymentRequest(paymentRequest: PaymentRequest) {

            const {paymentHash, encodedInvoice, expiry} = paymentRequest

            if(!paymentHash) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing invoice payment_hash', {encodedInvoice})
            }

            const alreadyExists = self.findByPaymentHash(paymentHash)

            if(alreadyExists) {
                throw new AppError(Err.ALREADY_EXISTS_ERROR, 'Payment request with this payment_hash exists.', {paymentHash})
            }
            
            const expiresAt = addSeconds(paymentRequest.createdAt, expiry)

            if(isBefore(expiresAt, new Date())) {
                throw new AppError(Err.VALIDATION_ERROR, 'This invoice has already expired and can not be paid.')
            }

            paymentRequest.expiresAt = expiresAt
            const paymentRequestInstance = PaymentRequestModel.create(paymentRequest)

            self.paymentRequests.push(paymentRequestInstance)

            log.info('[addPaymentRequest]', 'New paymentRequest added to PaymentRequestsStore', paymentRequest)

            return paymentRequestInstance       
        },
        removePaymentRequest(paymentRequestToRemove: PaymentRequest) {
            // self.paymentRequests.remove(paymentRequest)

            let paymentRequestInstance: PaymentRequest | undefined

            if (isStateTreeNode(paymentRequestToRemove)) {
                paymentRequestInstance = paymentRequestToRemove
            } else {
                paymentRequestInstance = self.findByPaymentHash(
                (paymentRequestToRemove as PaymentRequest).paymentHash,
                )
            }

            if (paymentRequestInstance) {                
                detach(paymentRequestInstance)
                destroy(paymentRequestInstance)
                log.info('[removePaymentRequest]', 'PaymentRequest removed from the store')                
            }
        },
        removeExpired() {
            return self.paymentRequests.replace(
                self.paymentRequests.filter(pr => isAfter(pr.expiresAt as Date, new Date()))
            )            
        },
    }))
    .views(self => ({
        get count() {
            return self.paymentRequests.length
        },
        get countNotExpired() {
            return self.paymentRequests.filter(pr => isAfter(pr.expiresAt as Date, new Date())).length
        },
        get all() {
            return self.paymentRequests
        },
        get allIncoming() {
            return self.paymentRequests.filter(pr => pr.type === PaymentRequestType.INCOMING)
        },
        get allOutgoing() {
            return self.paymentRequests.filter(pr => pr.type === PaymentRequestType.OUTGOING)
        },
        filterByMint(mintUrl: string) {
            let filtered: PaymentRequest[] = []

            filtered = self.paymentRequests.filter(pr => {
                if (pr.type === PaymentRequestType.OUTGOING && pr.mint === mintUrl) {
                    return true
                }
                return false
            })

            return filtered
        },           
    }))

export interface PaymentRequests extends Instance<typeof PaymentRequestsStoreModel> {}
export interface PaymentRequestsStoreSnapshot
  extends SnapshotOut<typeof PaymentRequestsStoreModel> {}
