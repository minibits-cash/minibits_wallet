import { isAlive, isStateTreeNode } from 'mobx-state-tree'
import { observer } from "mobx-react-lite"
import React from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import { ListItem, Text } from "../../components"
import { Contact, getContactAddress, getContactName } from "../../models/Contact"
import { ConversationSummary, MessageDirection } from '../../services/db'
import { colors, spacing, useThemeColor } from "../../theme"
import { translate } from '../../i18n'
import { formatCurrency, getCurrency, MintUnit } from '../../services/wallet/currency'
import { formatDayTime } from '../../utils/dateUtils'
import { ContactAvatar } from './ContactAvatar'
import { MessageContentKind, parseMessageContent } from './messageContent'


export interface ContactListProps {
  contact: Contact
  conversation?: ConversationSummary
  isFirst: boolean
  onPress: () => void
}

/** One line describing a message, for the contact list. */
export const getMessagePreview = function (content: string): string {
    const parsed = parseMessageContent(content)
    const amount = parsed.amount !== undefined && parsed.unit
        ? ` ${formatCurrency(parsed.amount, getCurrency(parsed.unit as MintUnit).code)} ${getCurrency(parsed.unit as MintUnit).code}`
        : ''

    switch (parsed.kind) {
        case MessageContentKind.TOKEN:
        case MessageContentKind.PAYMENT_PAYLOAD:
            return '🥜 ' + translate('contacts_ecash') + amount
        case MessageContentKind.INVOICE:
            return '⚡ ' + translate('contacts_lightningInvoice') + amount
        case MessageContentKind.PAYMENT_REQUEST:
            return '🥜 ' + translate('contacts_paymentRequest') + amount
        default:
            return parsed.text ?? ''
    }
}

export const ContactListItem = observer(function (props: ContactListProps) {
    const { contact, conversation } = props
    const dimText = useThemeColor('textDim')

    if (isStateTreeNode(contact) && !isAlive(contact as any)) {
        return null
    }

    const unread = conversation?.unread ?? 0
    const subText = conversation
        ? (conversation.lastDirection === MessageDirection.OUT ? translate('contacts_you') : '')
            + getMessagePreview(conversation.lastContent).replace(/\s+/g, ' ')
        : getContactAddress(contact)

    return (
      <ListItem
        text={contact.noteToSelf || getContactName(contact)}
        textStyle={[$name, unread > 0 && {fontWeight: 'bold'}]}
        subText={subText}
        subTextStyle={unread > 0 ? undefined : {color: dimText}}
        subTextEllipsizeMode='tail'
        LeftComponent={<ContactAvatar contact={contact} style={$avatar} />}
        RightComponent={conversation ? (
            <View style={$right}>
                <Text size='xxs' style={{color: dimText}} text={formatDayTime(conversation.lastAt * 1000)} />
                {unread > 0 && (
                    <View style={$badge}>
                        <Text size='xxs' style={$badgeText} text={unread > 99 ? '99+' : String(unread)} />
                    </View>
                )}
            </View>
        ) : undefined}
        topSeparator={!props.isFirst}
        style={$item}
        onPress={props.onPress}
      />
    )
})


const $item: ViewStyle = {
    marginHorizontal: spacing.micro,
}

const $name: TextStyle = {
    overflow: 'hidden',
}

const $avatar: ViewStyle = {
    alignSelf: 'center',
    marginRight: spacing.medium,
}

const $right: ViewStyle = {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: spacing.small,
}

const $badge: ViewStyle = {
    marginTop: spacing.tiny,
    minWidth: 20,
    paddingHorizontal: spacing.tiny,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.palette.success200,
    alignItems: 'center',
    justifyContent: 'center',
}

const $badgeText: TextStyle = {
    color: 'white',
    lineHeight: 14,
}
