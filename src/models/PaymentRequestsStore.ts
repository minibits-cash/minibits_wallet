import {
  Instance,
  SnapshotOut,
  types,
  destroy,
  isStateTreeNode,
  detach,
} from 'mobx-state-tree'
import {withSetPropAction} from './helpers/withSetPropAction'
import {PaymentRequestModel, PaymentRequest, PaymentRequestStatus} from './PaymentRequest'
import {log} from '../utils/logger'
import AppError, { Err } from '../utils/AppError'
import {LightningUtils} from '../services/lightning/lightningUtils'
import isBefore from 'date-fns/isBefore'
import isAfter from 'date-fns/isAfter'

export const PaymentRequestsStoreModel = types
    .model('PaymentRequests', {        
        paymentRequests: types.array(PaymentRequestModel),
    })
    .views(self => ({
        findByPaymentHash(paymentHash: string) {
            const pr = self.paymentRequests.find(p => p.paymentHash === paymentHash)
            return pr ? pr : undefined
        },
    }))
    .actions(withSetPropAction)
    .actions(self => ({
        addPaymentRequest(encodedInvoice: string, sentFrom: string, sentFromPubkey: string, memo: string) {           
           
            const decoded = LightningUtils.decodeInvoice(encodedInvoice)
            const {
                amount, 
                description, 
                expiry, 
                payment_hash: paymentHash, 
                timestamp
            } = LightningUtils.getInvoiceData(decoded)                

            if(!amount || !paymentHash) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing amount or payment_hash', {encodedInvoice})
            }

            const alreadyExists = self.findByPaymentHash(paymentHash)

            if(alreadyExists) {
                throw new AppError(Err.ALREADY_EXISTS_ERROR, 'Payment request with this payment_hash exists.', {paymentHash})
            }
            
            if(timestamp && expiry) {
                const expiresAt = LightningUtils.getInvoiceExpiresAt(timestamp as number, expiry)
                if(isBefore(expiresAt, new Date())) {
                    throw new AppError(Err.VALIDATION_ERROR, 'This invoice has already expired and can not be paid.')
                }
            }

            const newPaymentRequest: PaymentRequest = {
                encodedInvoice,
                amount,
                description: memo ? memo : description,
                paymentHash,
                expiry,
                sentFrom,
                sentFromPubkey,
                status: PaymentRequestStatus.RECEIVED             
            }

            const paymentRequestInstance = PaymentRequestModel.create(newPaymentRequest)
            // expiry in Date format
            paymentRequestInstance.setExpiresAt()
            self.paymentRequests.push(paymentRequestInstance)

            log.info('New paymentRequest added to PaymentRequestsStore', newPaymentRequest)

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
                log.info('PaymentRequest removed from the store')
                
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
        }        
    }))

export interface PaymentRequests extends Instance<typeof PaymentRequestsStoreModel> {}
export interface PaymentRequestsStoreSnapshot
  extends SnapshotOut<typeof PaymentRequestsStoreModel> {}
