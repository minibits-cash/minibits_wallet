import {decodePaymentRequest, getTokenMetadata} from '@cashu/cashu-ts'
import {CashuUtils} from '../../services/cashu/cashuUtils'
import {LightningUtils} from '../../services/lightning/lightningUtils'
import {NostrClient} from '../../services/nostrService'

export enum MessageContentKind {
    TEXT = 'TEXT',
    TOKEN = 'TOKEN',
    INVOICE = 'INVOICE',
    PAYMENT_REQUEST = 'PAYMENT_REQUEST',
    /** Ecash sent in answer to a cashu payment request (JSON). */
    PAYMENT_PAYLOAD = 'PAYMENT_PAYLOAD',
}

export type MessageContent = {
    kind: MessageContentKind
    text?: string
    amount?: number
    unit?: string
    memo?: string
}

/**
 * What a message carries, for display only. Same precedence as the receive path
 * (IncomingParser), but never throws: an undecodable payload is shown as text.
 */
export const parseMessageContent = function (content: string): MessageContent {
    try {
        if (CashuUtils.findEncodedCashuPaymentRequestPayload(content)) {
            const payload = JSON.parse(content)
            const amount = payload.proofs.reduce((sum: number, p: any) => sum + Number(p.amount), 0)
            return {kind: MessageContentKind.PAYMENT_PAYLOAD, amount, unit: payload.unit, memo: payload.memo}
        }

        const token = CashuUtils.findEncodedCashuToken(content)
        if (token) {
            const meta = getTokenMetadata(CashuUtils.extractEncodedCashuToken(token))
            return {kind: MessageContentKind.TOKEN, amount: meta.amount.toNumber(), unit: meta.unit, memo: meta.memo}
        }

        const request = CashuUtils.findEncodedCashuPaymentRequest(content)
        if (request) {
            const decoded = decodePaymentRequest(CashuUtils.extractEncodedCashuPaymentRequest(request))
            return {
                kind: MessageContentKind.PAYMENT_REQUEST,
                amount: decoded.amount ? decoded.amount.toNumber() : undefined,
                unit: decoded.unit,
                memo: decoded.description,
            }
        }

        const invoice = LightningUtils.findEncodedLightningInvoice(content)
        if (invoice) {
            const encoded = LightningUtils.extractEncodedLightningInvoice(invoice)
            const {amount, description} = LightningUtils.getInvoiceData(LightningUtils.decodeInvoice(encoded))
            return {
                kind: MessageContentKind.INVOICE,
                amount,
                unit: 'sat',
                memo: NostrClient.findMemo(content) || description,
            }
        }
    } catch (e: any) {}

    return {kind: MessageContentKind.TEXT, text: content}
}
