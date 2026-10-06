import {observer} from 'mobx-react-lite'
import React from 'react'
import {Pressable, TextStyle, View, ViewStyle} from 'react-native'
import {Icon, Text} from '../../components'
import {useStores} from '../../models'
import {TransactionStatus, TransactionType} from '../../models/Transaction'
import {MessageDirection, MessageRecord, MessageStatus} from '../../services/db'
import {formatCurrency, getCurrency, MintUnit} from '../../services/wallet/currency'
import {colors, spacing, useThemeColor} from '../../theme'
import {translate, TxKeyPath} from '../../i18n'
import {formatDayTime} from '../../utils/dateUtils'
import {MessageContentKind, parseMessageContent} from './messageContent'

const STATUS_KEYS: Partial<Record<TransactionStatus, TxKeyPath>> = {
    [TransactionStatus.COMPLETED]: 'transactionCommon_status_completed',
    [TransactionStatus.PENDING]: 'transactionCommon_status_pending',
    [TransactionStatus.PREPARED]: 'transactionCommon_status_prepared',
    [TransactionStatus.ERROR]: 'transactionCommon_status_error',
    [TransactionStatus.EXPIRED]: 'transactionCommon_status_expired',
    [TransactionStatus.REVERTED]: 'transactionCommon_status_reverted',
    [TransactionStatus.RECOVERED]: 'transactionCommon_status_recovered',
    [TransactionStatus.BLOCKED]: 'transactionCommon_status_blocked',
}

const TITLE_KEYS: Record<MessageContentKind, TxKeyPath> = {
    [MessageContentKind.TOKEN]: 'contacts_ecash',
    [MessageContentKind.PAYMENT_PAYLOAD]: 'contacts_ecash',
    [MessageContentKind.INVOICE]: 'contacts_lightningInvoice',
    [MessageContentKind.PAYMENT_REQUEST]: 'contacts_paymentRequest',
    [MessageContentKind.TEXT]: 'contacts_lightningPayment',
}

/**
 * One message. Payments (ecash, invoices, payment requests) render as a card that
 * opens their transaction; the linked transaction, when there is one, is the
 * authority for amount and status.
 */
export const MessageBubble = observer(function (props: {
    message: MessageRecord
    onOpenTransaction: (id: number) => void
    onRetry: (message: MessageRecord) => void
}) {
    const {message} = props
    const {transactionsStore} = useStores()

    const isOut = message.direction === MessageDirection.OUT
    const outBg = useThemeColor('header')
    const inBg = useThemeColor('card')
    const textColor = useThemeColor('text')
    const dimColor = useThemeColor('textDim')

    const parsed = parseMessageContent(message.content)
    const tx = message.transactionId ? transactionsStore.findById(message.transactionId) : undefined
    const isPayment = parsed.kind !== MessageContentKind.TEXT || !!tx

    const fg = isOut ? 'white' : textColor
    const fgDim = isOut ? 'rgba(255,255,255,0.7)' : dimColor

    const footer = isOut && message.status === MessageStatus.SENDING
        ? translate('conversation_sending')
        : isOut && message.status === MessageStatus.FAILED
            ? translate('conversation_notSent')
            : formatDayTime(message.createdAt * 1000)

    const renderPayment = () => {
        const amount = tx?.amount ?? parsed.amount
        const unit = (tx?.unit ?? parsed.unit) as MintUnit | undefined
        const currency = unit ? getCurrency(unit).code : undefined
        const memo = parsed.memo || tx?.memo
        const isRequest = parsed.kind === MessageContentKind.INVOICE || parsed.kind === MessageContentKind.PAYMENT_REQUEST
        const title = !tx || parsed.kind !== MessageContentKind.TEXT
            ? translate(TITLE_KEYS[parsed.kind])
            : translate(tx.type === TransactionType.TOPUP ? 'contacts_lightningInvoice' : 'contacts_lightningPayment')

        // an incoming request waits for the user, say so instead of "draft"
        const status = tx
            ? !isOut && isRequest && tx.status === TransactionStatus.DRAFT
                ? translate('conversation_tapToPay')
                : STATUS_KEYS[tx.status] ? translate(STATUS_KEYS[tx.status]!) : undefined
            : undefined

        return (
            <View>
                <View style={$paymentTitle}>
                    <Icon
                        icon={parsed.kind === MessageContentKind.INVOICE || !!tx && parsed.kind === MessageContentKind.TEXT ? 'faBolt' : 'faMoneyBill1'}
                        size={spacing.medium}
                        color={isOut ? 'white' : colors.palette.orange200}
                        containerStyle={{padding: 0, marginRight: spacing.extraSmall}}
                    />
                    <Text size='xs' style={{color: fgDim}} text={title} />
                </View>
                {amount !== undefined && currency && (
                    <Text preset='bold' size='md' style={{color: fg}} text={`${formatCurrency(amount, currency)} ${currency}`} />
                )}
                {!!memo && <Text size='xs' style={{color: fg}} text={memo} />}
                {status && <Text size='xxs' style={{color: fgDim, marginTop: spacing.tiny}} text={status} />}
            </View>
        )
    }

    const onPress = () => {
        if (isOut && message.status === MessageStatus.FAILED) {
            props.onRetry(message)
        } else if (tx) {
            props.onOpenTransaction(tx.id!)
        }
    }

    return (
        <View style={[$row, {justifyContent: isOut ? 'flex-end' : 'flex-start'}]}>
            <Pressable
                onPress={onPress}
                disabled={!tx && message.status !== MessageStatus.FAILED}
                style={[
                    $bubble,
                    {backgroundColor: isOut ? outBg : inBg},
                    isOut ? $bubbleOut : $bubbleIn,
                    isPayment && $paymentBubble,
                ]}
            >
                {isPayment ? renderPayment() : (
                    <Text selectable style={{color: fg}} text={message.content} />
                )}
                <Text
                    size='xxs'
                    style={[$footer, {color: message.status === MessageStatus.FAILED ? colors.palette.angry500 : fgDim}]}
                    text={footer}
                />
            </Pressable>
        </View>
    )
})

const $row: ViewStyle = {
    flexDirection: 'row',
    paddingHorizontal: spacing.small,
    marginVertical: spacing.tiny,
}

const $bubble: ViewStyle = {
    maxWidth: '80%',
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.extraSmall,
    borderRadius: spacing.medium,
}

const $bubbleOut: ViewStyle = {
    borderBottomRightRadius: spacing.tiny,
}

const $bubbleIn: ViewStyle = {
    borderBottomLeftRadius: spacing.tiny,
}

const $paymentBubble: ViewStyle = {
    minWidth: '50%',
    paddingVertical: spacing.small,
}

const $paymentTitle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.tiny,
}

const $footer: TextStyle = {
    alignSelf: 'flex-end',
    marginTop: spacing.micro,
}
