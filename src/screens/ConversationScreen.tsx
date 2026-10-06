import {observer} from 'mobx-react-lite'
import React, {useCallback, useEffect, useState} from 'react'
import {FlatList, Keyboard, Platform, Pressable, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import {StackActions, StaticScreenProps, useFocusEffect, useIsFocused, useNavigation} from '@react-navigation/native'
import Animated, {useAnimatedKeyboard, useAnimatedStyle, useSharedValue} from 'react-native-reanimated'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import {toJS} from 'mobx'
import {Button, ErrorModal, Icon, InfoModal, Screen, Text} from '../components'
import {useStores} from '../models'
import {getContactAddress, getContactName, isNostrContact} from '../models/Contact'
import {Database, MessageRecord} from '../services/db'
import {MessagingService} from '../services/messagingService'
import {LnurlClient} from '../services/lnurlService'
import {log} from '../services/logService'
import {spacing, typography, useThemeColor} from '../theme'
import {translate} from '../i18n'
import {useSafeAreaInsetsStyle} from '../utils/useSafeAreaInsetsStyle'
import AppError from '../utils/AppError'
import {ReceiveOption} from './ReceiveScreen'
import {SendOption} from './SendScreen'
import {TransferOption} from './TransferScreen'
import {ContactAvatar} from './Contacts/ContactAvatar'
import {ContactProfileModal} from './Contacts/ContactProfileModal'
import {MessageBubble} from './Contacts/MessageBubble'

type Props = StaticScreenProps<{
    contactId: string
}>

export const ConversationScreen = observer(function ({route}: Props) {
    const navigation = useNavigation()
    const {contactId} = route.params
    const {contactsStore, userSettingsStore} = useStores()
    const contact = contactsStore.findById(contactId)
    // Re-read the thread whenever the store's summary of it changes: a message
    // arrived, a send finished, a status moved.
    const conversation = contactsStore.conversations[contactId]

    const [messages, setMessages] = useState<MessageRecord[]>([])
    const [text, setText] = useState('')
    const [isProfileVisible, setIsProfileVisible] = useState(false)
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()

    const headerBg = useThemeColor('header')
    const $topInset = useSafeAreaInsetsStyle(['top'])
    const inputBg = useThemeColor('card')
    const inputText = useThemeColor('text')
    const placeholderColor = useThemeColor('textDim')
    const dimColor = useThemeColor('textDim')

    const isFocused = useIsFocused()

    // Android draws edge-to-edge, so the window does not shrink under the keyboard
    // and the composer has to be lifted by hand; iOS is handled by Screen's
    // KeyboardAvoidingView. Driven by the window insets rather than keyboard events:
    // keyboardDidHide is unreliable when the window never resizes, and a missed one
    // (or one shown while this screen sits in the background tab) used to leave the
    // composer stranded.
    //
    // Only while our own input is focused: a keyboard closed while no conversation
    // was mounted leaves useAnimatedKeyboard reporting its last height to the next
    // subscriber, which used to park the composer mid-screen on entry.
    const keyboard = useAnimatedKeyboard()
    const isInputFocused = useSharedValue(false)
    const $composerLift = useAnimatedStyle(() => ({
        marginBottom: Platform.OS === 'android' && isInputFocused.value ? keyboard.height.value : 0,
    }))

    // Leaving (back, Android back, another tab) must not leave the keyboard over the
    // next screen. Done on blur, while this screen is still mounted.
    useFocusEffect(useCallback(() => () => Keyboard.dismiss(), []))

    useEffect(() => {
        try {
            setMessages(Database.getMessages(contactId))
        } catch (e: any) {
            log.error('[ConversationScreen] Could not load messages', {message: e.message})
        }
    }, [conversation, contactId])

    // Read while looking at it, including messages that arrive meanwhile.
    useFocusEffect(useCallback(() => {
        contactsStore.markConversationRead(contactId)
    }, [conversation?.unread, contactId]))

    // Deleted from the profile modal, or never existed (stale route): back to the
    // list rather than an empty screen.
    useEffect(() => {
        if (!contact && isFocused) navigation.dispatch(StackActions.popToTop())
    }, [contact, isFocused])

    if (!contact) return null

    const isNostr = isNostrContact(contact)

    const onSend = async function () {
        const content = text.trim()
        if (!content || !contact.pubkey) return
        setText('')
        try {
            await MessagingService.sendMessage({recipientPubkey: contact.pubkey, content})
        } catch (e: any) {
            setError(e) // the bubble stays, marked as not sent, tap retries
        }
    }

    const onRetry = async function (message: MessageRecord) {
        try {
            await MessagingService.retryMessage(message)
        } catch (e: any) {
            setError(e)
        }
    }

    const gotoRequest = function () {
        //@ts-ignore
        navigation.navigate('WalletNavigator', {
            screen: 'Topup',
            params: {
                paymentOption: ReceiveOption.SEND_PAYMENT_REQUEST,
                contact: toJS(contact),
                unit: userSettingsStore.preferredUnit,
                prevScreen: 'Conversation',
            },
        })
    }

    const gotoSendEcash = function () {
        //@ts-ignore
        navigation.navigate('WalletNavigator', {
            screen: 'Send',
            params: {
                paymentOption: SendOption.SEND_TOKEN,
                contact: toJS(contact),
                unit: userSettingsStore.preferredUnit,
                prevScreen: 'Conversation',
            },
        })
    }

    const gotoPay = async function () {
        try {
            // as IncomingParser.navigateWithIncomingData, plus the way back here
            const {lnurlParams} = await LnurlClient.getLnurlAddressParams(contact.lud16!)
            //@ts-ignore
            navigation.navigate('WalletNavigator', {
                screen: 'Transfer',
                params: {
                    lnurlParams,
                    paymentOption: TransferOption.LNURL_PAY,
                    unit: userSettingsStore.preferredUnit,
                    prevScreen: 'Conversation',
                },
            })
        } catch (e: any) {
            setError(e)
        }
    }

    const gotoTransaction = function (id: number) {
        //@ts-ignore
        // initial: false keeps the history list beneath it, so the transactions tab is
        // not left holding this detail once we come back
        navigation.navigate('TransactionsNavigator', {screen: 'TranDetail', params: {id, prevScreen: 'Conversation'}, initial: false})
    }

    const onAccept = function () {
        contact.setIsRequest(false)
    }

    const onDelete = function () {
        setIsProfileVisible(false)
        contactsStore.removeContact(contact) // the effect above leaves the screen
    }

    return (
        <Screen preset='fixed' contentContainerStyle={$screen} hideTabBar>
            <View style={[$header, {backgroundColor: headerBg}, $topInset]}>
                <Pressable style={$headerBack} onPress={() => navigation.goBack()}>
                    <Icon icon='faArrowLeft' color='white' />
                </Pressable>
                <Pressable style={$headerContact} onPress={() => setIsProfileVisible(true)}>
                    <ContactAvatar contact={contact} size={36} />
                    <View style={$headerText}>
                        <Text
                            numberOfLines={1}
                            style={{color: 'white', fontFamily: typography.primary?.medium}}
                            text={contact.noteToSelf || getContactName(contact)}
                        />
                        <Text numberOfLines={1} size='xxs' style={{color: 'rgba(255,255,255,0.7)'}} text={getContactAddress(contact)} />
                    </View>
                </Pressable>
            </View>
            {messages.length > 0 ? (
                <FlatList
                    data={messages}
                    inverted
                    keyExtractor={m => m.id}
                    renderItem={({item}) => (
                        <MessageBubble message={item} onOpenTransaction={gotoTransaction} onRetry={onRetry} />
                    )}
                    contentContainerStyle={$list}
                    keyboardShouldPersistTaps='handled'
                />
            ) : (
                // Outside the inverted list: Android inverts with scale(-1) on both axes,
                // iOS only vertically, so no single counter-flip reads right on both.
                <View style={$emptyContainer}>
                    <Text
                        size='xs'
                        style={[$empty, {color: dimColor}]}
                        tx={isNostr ? 'conversation_empty' : 'conversation_emptyLightning'}
                    />
                </View>
            )}
            {contact.isRequest ? (
                <Animated.View style={[$composer, {paddingBottom: spacing.medium}, $composerLift]}>
                    <Text
                        size='xs'
                        style={{color: dimColor, textAlign: 'center', marginBottom: spacing.small}}
                        text={translate('conversation_requestBanner', {name: getContactName(contact)})}
                    />
                    <View style={$actions}>
                        <Button preset='secondary' tx='conversation_delete' onPress={onDelete} style={$action} />
                        <Button tx='conversation_accept' onPress={onAccept} style={$action} />
                    </View>
                </Animated.View>
            ) : (
                <Animated.View style={[$composer, {paddingBottom: spacing.small}, $composerLift]}>
                    <View style={$actions}>
                        <Button
                            preset='secondary'
                            tx='conversation_request'
                            onPress={gotoRequest}
                            style={$action}
                            LeftAccessory={() => <Icon icon='faArrowDown' size={spacing.medium} />}
                        />
                        {isNostr && (
                            <Button
                                preset='secondary'
                                tx='conversation_sendEcash'
                                onPress={gotoSendEcash}
                                style={$action}
                                LeftAccessory={() => <Icon icon='faArrowUp' size={spacing.medium} />}
                            />
                        )}
                        {contact.lud16 && (
                            <Button
                                preset='secondary'
                                tx='conversation_pay'
                                onPress={gotoPay}
                                style={$action}
                                LeftAccessory={() => <Icon icon='faBolt' size={spacing.medium} />}
                            />
                        )}
                    </View>
                    {isNostr && (
                        <View style={$inputRow}>
                            <TextInput
                                value={text}
                                onChangeText={setText}
                                onFocus={() => { isInputFocused.value = true }}
                                onBlur={() => { isInputFocused.value = false }}
                                placeholder={translate('conversation_inputPlaceholder')}
                                placeholderTextColor={placeholderColor}
                                multiline
                                maxLength={4000}
                                style={[$input, {backgroundColor: inputBg, color: inputText}]}
                            />
                            <Button
                                LeftAccessory={() => <Icon icon='faPaperPlane' color='white' size={spacing.medium} />}
                                onPress={onSend}
                                disabled={!text.trim()}
                                style={$sendButton}
                            />
                        </View>
                    )}
                </Animated.View>
            )}
            <ContactProfileModal
                contact={contact}
                isVisible={isProfileVisible}
                onClose={() => setIsProfileVisible(false)}
                onDelete={onDelete}
                onInfo={message => {
                    setIsProfileVisible(false)
                    setInfo(message)
                }}
            />
            {info && <InfoModal message={info} />}
            {error && <ErrorModal error={error} />}
        </Screen>
    )
})

const $screen: ViewStyle = {
    flex: 1,
}

const $header: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.small,
    paddingRight: spacing.medium,
}

const $headerBack: ViewStyle = {
    paddingHorizontal: spacing.medium,
    paddingVertical: spacing.extraSmall,
}

const $headerContact: ViewStyle = {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
}

const $headerText: ViewStyle = {
    flex: 1,
    marginLeft: spacing.small,
}

const $list: ViewStyle = {
    flexGrow: 1,
    paddingVertical: spacing.small,
}

const $emptyContainer: ViewStyle = {
    flex: 1,
    justifyContent: 'center',
}

const $empty: TextStyle = {
    textAlign: 'center',
    padding: spacing.large,
}

const $composer: ViewStyle = {
    paddingHorizontal: spacing.small,
    paddingTop: spacing.extraSmall,
}

const $actions: ViewStyle = {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: spacing.extraSmall,
}

const $action: ViewStyle = {
    marginHorizontal: spacing.tiny,
    minHeight: verticalScale(36),
    paddingVertical: spacing.tiny,
}

// The input sets the row height (and grows with multiline text); the attached
// button stretches to it instead of imposing its own 50px minimum.
const $inputRow: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'stretch',
}

const $input: TextStyle = {
    flex: 1,
    maxHeight: verticalScale(120),
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
    paddingHorizontal: spacing.medium,
    paddingTop: spacing.small,
    paddingBottom: spacing.small,
    fontSize: verticalScale(16),
}

const $sendButton: ViewStyle = {
    minHeight: 0,
    paddingVertical: 0,
    paddingHorizontal: spacing.medium,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
}
