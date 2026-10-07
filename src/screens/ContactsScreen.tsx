import {observer} from 'mobx-react-lite'
import React, {useRef, useState} from 'react'
import {Pressable, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import Animated, {useAnimatedStyle} from 'react-native-reanimated'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {Button, Card, ErrorModal, Header, Icon, ListItem, Loading, Screen, Text} from '../components'
import {HEADER_HEIGHT} from '../components/Header'
import {useStores} from '../models'
import {Contact, getContactAddress, getContactName, isNostrContact} from '../models/Contact'
import {log} from '../services/logService'
import {NostrClient} from '../services'
import {getImageSource} from '../utils/utils'
import {ReceiveOption} from './ReceiveScreen'
import {SendOption} from './SendScreen'
import {TransferOption} from './TransferScreen'
import {IncomingDataType, IncomingParser} from '../services/incomingParser'
import {translate} from '../i18n'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import {StaticScreenProps, useNavigation} from '@react-navigation/native'
import {toJS} from 'mobx'
import FastImage from 'react-native-fast-image'
import {tabBarHiddenProgress, useTabBarInset, useTabBarScrollHandler} from '../navigation/tabBarVisibility'
import AppError from '../utils/AppError'
import {useSafeAreaInsetsStyle} from '../utils/useSafeAreaInsetsStyle'
import {ContactListItem} from './Contacts/ContactListItem'
import {ContactAvatar} from './Contacts/ContactAvatar'

export type ContactPickerOption = ReceiveOption | SendOption | TransferOption

type Props = StaticScreenProps<{
    paymentOption?: ContactPickerOption
}>

/** Which contacts can serve the flow that opened the list as a picker. */
const canServe = function (contact: Contact, paymentOption?: ContactPickerOption) {
    switch (paymentOption) {
        case SendOption.SEND_TOKEN:
        case ReceiveOption.SEND_PAYMENT_REQUEST:
            return isNostrContact(contact)
        case TransferOption.LNURL_ADDRESS:
            return !!contact.lud16
        default:
            return true
    }
}

const matchesQuery = function (contact: Contact, query: string) {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [contact.noteToSelf, getContactName(contact), contact.name, contact.nip05, contact.lud16]
        .some(v => v?.toLowerCase().includes(q))
}

export const ContactsScreen = observer(function ({ route }: Props) {
    const navigation = useNavigation()
    const {walletProfileStore, contactsStore, userSettingsStore} = useStores()
    const searchInputRef = useRef<TextInput>(null)

    const paymentOption = route.params?.paymentOption
    const isPicker = !!paymentOption

    const [isSearchVisible, setIsSearchVisible] = useState(false)
    const [query, setQuery] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    const headerBg = useThemeColor('header')
    const $topInset = useSafeAreaInsetsStyle(['top'])
    const inputBg = useThemeColor('background')
    const inputText = useThemeColor('text')
    const placeholderTextColor = useThemeColor('textDim')
    const cardBg = useThemeColor('card')
    const mainButtonIcon = useThemeColor('mainButtonIcon')
    const hintColor = useThemeColor('textDim')
    const scrollHandler = useTabBarScrollHandler()
    const tabBarInset = useTabBarInset()

    // Leaves together with the tab bar on scroll: same progress value, moved below
    // the screen edge so a parked button cannot be tapped.
    // (computed here: verticalScale is plain JS and cannot run in the UI-thread worklet)
    const addButtonTravel = tabBarInset + verticalScale(60)
    const $addButtonAnimated = useAnimatedStyle(() => ({
        opacity: 1 - tabBarHiddenProgress.value,
        transform: [{translateY: tabBarHiddenProgress.value * addButtonTravel}],
    }), [addButtonTravel])

    const gotoProfile = function () {
        //@ts-ignore
        navigation.navigate('Profile', {prevScreen: 'Contacts'})
    }

    const gotoAddContact = function () {
        //@ts-ignore
        navigation.navigate('AddContact')
    }

    const openSearch = function () {
        setIsSearchVisible(true)
        setTimeout(() => searchInputRef.current?.focus(), 100)
    }

    const closeSearch = function () {
        setQuery('')
        setIsSearchVisible(false)
    }

    const clearPicker = function () {
        //@ts-ignore
        navigation.setParams({paymentOption: undefined})
    }

    const onSelect = async function (contact: Contact) {
        if (!isPicker) {
            //@ts-ignore
            navigation.navigate('Conversation', {contactId: contact.id})
            return
        }

        try {
            log.trace('[ContactsScreen.onSelect] picker', {paymentOption})

            if (paymentOption === TransferOption.LNURL_ADDRESS) {
                await IncomingParser.navigateWithIncomingData({
                    type: IncomingDataType.LNURL_ADDRESS,
                    encoded: contact.lud16,
                }, navigation, userSettingsStore.preferredUnit)
                clearPicker()
                return
            }

            setIsLoading(true)

            if (contact.nip05 && contact.pubkey) {
                await NostrClient.verifyNip05(contact.nip05, contact.pubkey) // throws
            }

            //@ts-ignore
            navigation.navigate('WalletNavigator', {
                screen: paymentOption === SendOption.SEND_TOKEN ? 'Send' : 'Topup',
                params: {
                    paymentOption,
                    contact: toJS(contact),
                    unit: userSettingsStore.preferredUnit,
                },
            })
            setIsLoading(false)
        } catch (e: any) {
            // reset so that an invalid contact can still be opened and deleted
            clearPicker()
            setIsLoading(false)
            setError(e)
        }
    }

    const contacts = contactsStore.sorted.filter(c =>
        canServe(c, paymentOption) && matchesQuery(c, query),
    )
    const requests = isPicker || query ? [] : contactsStore.requests
    const pickerHint = paymentOption === SendOption.SEND_TOKEN
        ? 'contactsScreen_privateContacts_selectSendToken'
        : paymentOption === TransferOption.LNURL_ADDRESS
            ? 'contactsScreen_privateContacts_selectSendLnURL'
            : paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST
                ? 'contactsScreen_privateContacts_selectSendPaymentRequest'
                : undefined

    const renderRequests = () => (
        <Card
            style={$requestsCard}
            ContentComponent={
                <>
                    <Text size='xs' preset='bold' tx='contacts_messageRequests' style={{marginBottom: spacing.tiny}} />
                    {requests.map((r, i) => (
                        <ListItem
                            key={r.id}
                            text={getContactName(r)}
                            subText={getContactAddress(r)}
                            LeftComponent={<ContactAvatar contact={r} size={32} style={$requestAvatar} />}
                            topSeparator={i > 0}
                            onPress={() => onSelect(r)}
                        />
                    ))}
                </>
            }
        />
    )

    return (
        <Screen contentContainerStyle={$screen} contentUnderTabBar>
            {isSearchVisible ? (
                <View style={[{backgroundColor: headerBg}, $topInset]}>
                    <View style={$searchHeader}>
                        <TextInput
                            ref={searchInputRef}
                            value={query}
                            onChangeText={setQuery}
                            placeholder={translate('contacts_searchPlaceholder')}
                            placeholderTextColor={placeholderTextColor}
                            autoCapitalize='none'
                            autoCorrect={false}
                            style={[$searchInput, {backgroundColor: inputBg, color: inputText}]}
                        />
                        <Pressable style={$searchClose} onPress={closeSearch} hitSlop={spacing.small}>
                            <Icon icon='faXmark' color='white' />
                        </Pressable>
                    </View>
                </View>
            ) : (
                <Header
                    LeftActionComponent={<LeftProfileHeader gotoProfile={gotoProfile} isAvatarVisible={true} />}
                    title={walletProfileStore.nip05}
                    titleStyle={{fontFamily: typography.primary?.medium, fontSize: 16}}
                    RightActionComponent={
                        <Pressable style={$headerAction} onPress={openSearch}>
                            <Icon icon='faMagnifyingGlass' color='white' />
                        </Pressable>
                    }
                />
            )}
            <View style={$contentContainer}>
                {pickerHint && (
                    <View style={$pickerHint}>
                        <Text size='xs' style={{color: hintColor, flex: 1}} tx={pickerHint} />
                        <Button preset='tertiary' tx='commonCancel' onPress={clearPicker} />
                    </View>
                )}
                {contactsStore.count > 0 ? (
                    <Animated.FlatList<string>
                        // Ids, not the store's contact objects: React's dev-mode render
                        // logging diffs a list's previous props, and a deleted contact
                        // still sitting in the old `data` makes MST warn on every
                        // read of the dead node.
                        data={contacts.map(c => c.id!)}
                        ListHeaderComponent={requests.length > 0 ? renderRequests() : undefined}
                        renderItem={({item: id, index}) => {
                            const contact = contactsStore.findById(id)
                            if (!contact) return null
                            return (
                                // The card is drawn per row so it ends with the last contact;
                                // the clearance for the Add button below stays outside it.
                                <View style={[
                                    $cardRow,
                                    {backgroundColor: cardBg},
                                    index === 0 && $cardRowFirst,
                                    index === contacts.length - 1 && $cardRowLast,
                                ]}>
                                    <ContactListItem
                                        contact={contact}
                                        conversation={contactsStore.conversations[id]}
                                        isFirst={index === 0}
                                        onPress={() => onSelect(contact)}
                                    />
                                </View>
                            )
                        }}
                        ListEmptyComponent={query ? (
                            <Text size='xs' style={{color: hintColor, padding: spacing.medium, textAlign: 'center'}} tx='contacts_noResults' />
                        ) : undefined}
                        keyExtractor={id => id}
                        keyboardShouldPersistTaps='handled'
                        onScroll={scrollHandler}
                        scrollEventThrottle={16}
                        style={$contactsList}
                        contentContainerStyle={{paddingBottom: tabBarInset + verticalScale(60)}}
                    />
                ) : (
                    <Card
                        ContentComponent={
                            <>
                                <ListItem
                                    leftIcon='faComment'
                                    leftIconInverse={true}
                                    leftIconColor={colors.palette.iconGreen200}
                                    tx='contacts_emptyTitle'
                                    subTx='contacts_emptySubText'
                                    onPress={gotoAddContact}
                                />
                                <ListItem
                                    leftIcon='faCircleUser'
                                    leftIconInverse={true}
                                    leftIconColor={colors.palette.iconMagenta200}
                                    tx='contactsScreen_privateContacts_switchName'
                                    subTx='contactsScreen_privateContacts_switchNameSubText'
                                    onPress={gotoProfile}
                                    topSeparator={true}
                                />
                            </>
                        }
                    />
                )}
                {isLoading && <Loading />}
            </View>
            {!isPicker && (
                <Animated.View style={[$bottomContainer, {bottom: tabBarInset}, $addButtonAnimated]} pointerEvents='box-none'>
                    <Button
                        LeftAccessory={() => (
                            <Icon icon='faPlus' size={spacing.medium} color={mainButtonIcon} />
                        )}
                        onPress={gotoAddContact}
                        preset='tertiary'
                        tx='buttonAdd'
                    />
                </Animated.View>
            )}
            {error && <ErrorModal error={error} />}
        </Screen>
    )
})


export const LeftProfileHeader = observer(function (props: {
    gotoProfile: any
    isAvatarVisible?: boolean
}) {
    const {walletProfileStore} = useStores()

    return (
        <Pressable style={{marginHorizontal: spacing.small}} onPress={props.gotoProfile}>
            {walletProfileStore.picture && props.isAvatarVisible ? (
                <FastImage
                    style={
                        {
                            width: 40,
                            height: (walletProfileStore.isOwnProfile) ? 40 : 43,
                            borderRadius: (walletProfileStore.isOwnProfile) ? 20 : 0,
                        }
                    }
                    source={{uri: getImageSource(walletProfileStore.picture)}}
                />
            ) : (
                <View style={{opacity: 0.5}} >
                    <Icon
                        icon='faCircleUser'
                        size={verticalScale(25)}
                        color={'white'}
                    />
                </View>
            )}
        </Pressable>
    )
})


const $screen: ViewStyle = {
    flex: 1,
}

const $headerAction: ViewStyle = {
    marginHorizontal: spacing.small,
    padding: spacing.extraSmall,
}

// Same height as the regular Header it replaces, so opening search does not
// push the list down.
const $searchHeader: ViewStyle = {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.medium,
    paddingRight: spacing.small,
}

const $searchClose: ViewStyle = {
    marginLeft: spacing.tiny,
    padding: spacing.extraSmall,
}

const $searchInput: TextStyle = {
    flex: 1,
    borderRadius: spacing.small,
    fontSize: verticalScale(16),
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.extraSmall,
}

const $contentContainer: ViewStyle = {
    flex: 1,
    padding: spacing.extraSmall,
}

const $pickerHint: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.small,
}

const $contactsList: ViewStyle = {
    flex: 1,
}

// The Card look, rebuilt per row so the contacts scroll as page content.
const $cardRow: ViewStyle = {
    paddingHorizontal: spacing.medium,
}

const $cardRowFirst: ViewStyle = {
    borderTopLeftRadius: spacing.medium,
    borderTopRightRadius: spacing.medium,
    paddingTop: spacing.extraSmall,
}

const $cardRowLast: ViewStyle = {
    borderBottomLeftRadius: spacing.medium,
    borderBottomRightRadius: spacing.medium,
    paddingBottom: spacing.extraSmall,
}

const $requestsCard: ViewStyle = {
    marginBottom: spacing.small,
}

const $requestAvatar: ViewStyle = {
    alignSelf: 'center',
    marginRight: spacing.small,
}

// Floats above the list, just clear of the tab bar, so contacts scroll underneath it.
const $bottomContainer: ViewStyle = {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
}
