import {observer} from 'mobx-react-lite'
import React, {useEffect, useRef, useState} from 'react'
import {TextInput, TextStyle, View, ViewStyle} from 'react-native'
import {StackActions, useNavigation} from '@react-navigation/native'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import {Metadata, Contacts} from 'nostr-tools/kinds'
import Clipboard from '@react-native-clipboard/clipboard'
import {MINIBITS_NIP05_DOMAIN} from '@env'
import {BottomModal, Button, Card, ErrorModal, Icon, ListItem, Loading, Screen, Text} from '../components'
import {useStores} from '../models'
import {Contact, ContactKind, getContactAddress, getContactName, getContactId} from '../models/Contact'
import {NostrClient, NostrEvent} from '../services/nostrService'
import {LnurlClient} from '../services/lnurlService'
import {LnurlUtils} from '../services/lnurl/lnurlUtils'
import {log} from '../services/logService'
import {colors, spacing, useThemeColor} from '../theme'
import {translate} from '../i18n'
import {useHeader} from '../utils/useHeader'
import {useTabBarInset, useTabBarScrollHandler} from '../navigation/tabBarVisibility'
import Animated from 'react-native-reanimated'
import AppError, {Err} from '../utils/AppError'
import {ContactAvatar} from './Contacts/ContactAvatar'

const SEARCH_DEBOUNCE_MS = 700
const MAX_FOLLOWS = 50
/** Lets someone without a nostr account try the follows import (from the original Public contacts). */
const DEMO_FOLLOWS_NPUB = 'npub1kvaln6tm0re4d99q9e4ma788wpvnw0jzkz595cljtfgwhldd75xsj9tkzv'

/** A kind 0 event as a nostr contact candidate. The pubkey always comes from the signed event. */
const profileFromEvent = function (event: NostrEvent): Contact | undefined {
    try {
        const p = JSON.parse(event.content)
        return {
            kind: ContactKind.NOSTR,
            pubkey: event.pubkey,
            npub: NostrClient.getNpubkey(event.pubkey),
            name: p.name ? String(p.name) : undefined,
            display_name: p.display_name ? String(p.display_name) : undefined,
            nip05: p.nip05 ? String(p.nip05) : undefined,
            lud16: p.lud16 ? String(p.lud16) : undefined,
            picture: p.picture ? String(p.picture) : undefined,
            about: p.about ? String(p.about) : undefined,
        }
    } catch (e: any) {
        return undefined
    }
}

const uniqueByPubkey = (list: Contact[]) =>
    list.filter((c, i) => list.findIndex(o => o.pubkey === c.pubkey) === i)

/**
 * One input that works out what was typed: an npub, a nostr address (nip05), a bare
 * lightning address, or a name to search nostr for. Followed by the user's nostr
 * follows as one-tap candidates.
 */
export const AddContactScreen = observer(function () {
    const navigation = useNavigation()
    const {contactsStore, relaysStore} = useStores()
    const inputRef = useRef<TextInput>(null)
    const searchId = useRef(0)

    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        titleTx: 'addContact_title',
    })

    const [query, setQuery] = useState('')
    const [results, setResults] = useState<Contact[]>([])
    const [lightningCandidate, setLightningCandidate] = useState<string | undefined>()
    const [lightningName, setLightningName] = useState('')
    const [isSearching, setIsSearching] = useState(false)
    const [hint, setHint] = useState<string | undefined>()

    const [followKey, setFollowKey] = useState('')
    const [follows, setFollows] = useState<Contact[]>([])
    const [isFollowsLoading, setIsFollowsLoading] = useState(false)
    const [isFollowKeyModalVisible, setIsFollowKeyModalVisible] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    const inputBg = useThemeColor('background')
    const inputText = useThemeColor('text')
    const dimColor = useThemeColor('textDim')
    // floats over the content and parks on scroll, as in the transactions list
    const scrollHandler = useTabBarScrollHandler()
    const tabBarInset = useTabBarInset()

    const lookupRelays = () => Array.from(new Set([...relaysStore.allUrls, ...relaysStore.allPublicUrls]))

    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 200)
        if (contactsStore.publicPubkey) loadFollows(contactsStore.publicPubkey)
    }, [])

    useEffect(() => {
        const q = query.trim()
        setLightningCandidate(undefined)
        setHint(undefined)

        if (q.length < 2) {
            setResults([])
            setIsSearching(false)
            return
        }

        setIsSearching(true)
        const timer = setTimeout(() => resolve(q), SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [query])

    const resolve = async function (q: string) {
        const id = ++searchId.current
        // a slower answer to an older query must not overwrite a newer one
        const isCurrent = () => id === searchId.current

        let found: Contact[] = []
        let lightning: string | undefined = undefined
        let failure: string | undefined = undefined

        try {
            if (q.startsWith('npub1') || q.startsWith('nprofile1')) {
                const pubkey = q.startsWith('npub1')
                    ? NostrClient.getHexkey(q)
                    : (NostrClient.decodeNprofile(q).data as {pubkey: string}).pubkey
                const profile = await NostrClient.getProfileFromRelays(pubkey, lookupRelays())
                found = [{
                    kind: ContactKind.NOSTR,
                    pubkey,
                    npub: NostrClient.getNpubkey(pubkey),
                    name: profile?.name ? String(profile.name) : undefined,
                    nip05: profile?.nip05 ? String(profile.nip05) : undefined,
                    lud16: profile?.lud16,
                    picture: profile?.picture ? String(profile.picture) : undefined,
                    about: profile?.about,
                }]
            } else if (q.includes('@')) {
                const address = q.toLowerCase()
                try {
                    const profile = await NostrClient.getNormalizedNostrProfile(address, lookupRelays())
                    found = [{kind: ContactKind.NOSTR, ...profile, name: profile.name ? String(profile.name) : undefined}]
                } catch (e: any) {
                    // not a nostr address — maybe it pays over lightning
                    if (!LnurlUtils.isLnurlAddress(address)) throw e
                    await LnurlClient.getLnurlAddressParams(address) // throws if it does not resolve
                    lightning = address
                }
            } else {
                const [minibits, searched] = await Promise.all([
                    NostrClient.getNormalizedNostrProfile(q.toLowerCase() + MINIBITS_NIP05_DOMAIN, NostrClient.getMinibitsRelays())
                        .catch(() => undefined),
                    NostrClient.getEvents(NostrClient.getSearchRelays(), {kinds: [Metadata], search: q, limit: 10})
                        .catch(() => [] as NostrEvent[]),
                ])

                const fromSearch = searched.map(profileFromEvent).filter(Boolean) as Contact[]
                found = uniqueByPubkey([
                    ...(minibits ? [{kind: ContactKind.NOSTR, ...minibits} as Contact] : []),
                    ...fromSearch,
                ])
            }
        } catch (e: any) {
            log.trace('[AddContactScreen.resolve]', {message: e.message})
            failure = e.message
        }

        if (!isCurrent()) return

        setResults(found)
        setLightningCandidate(lightning)
        setLightningName(lightning ? LnurlUtils.getNameFromLnurlAddress(lightning) ?? '' : '')
        setHint(!lightning && found.length === 0 ? failure ?? translate('addContact_noResults') : undefined)
        setIsSearching(false)
    }

    const loadFollows = async function (pubkey: string) {
        setIsFollowsLoading(true)
        try {
            const lists = await NostrClient.getEvents(relaysStore.allPublicUrls, {authors: [pubkey], kinds: [Contacts]})
            const newest = lists.sort((a, b) => b.created_at - a.created_at)[0]
            const pubkeys = (newest?.tags ?? []).filter(t => t[0] === 'p' && t[1]).map(t => t[1])

            if (pubkeys.length === 0) {
                setFollows([])
                return
            }

            // ponytail: first MAX_FOLLOWS only, page through the list if users ask for more
            const events = await NostrClient.getEvents(relaysStore.allPublicUrls, {
                authors: pubkeys.slice(0, MAX_FOLLOWS),
                kinds: [Metadata],
            })
            const profiles = uniqueByPubkey(
                events.sort((a, b) => b.created_at - a.created_at).map(profileFromEvent).filter(Boolean) as Contact[],
            )
            setFollows(profiles.sort((a, b) => getContactName(a).localeCompare(getContactName(b))))
        } catch (e: any) {
            setError(e)
        } finally {
            setIsFollowsLoading(false)
        }
    }

    const onSaveFollowKey = function () {
        try {
            const key = followKey.trim()
            const pubkey = key.startsWith('npub') ? NostrClient.getHexkey(key) : key
            if (!/^[0-9a-f]{64}$/.test(pubkey)) {
                throw new AppError(Err.VALIDATION_ERROR, translate('addContact_invalidKey'))
            }
            contactsStore.setPublicPubkey(pubkey)
            setIsFollowKeyModalVisible(false)
            loadFollows(pubkey)
        } catch (e: any) {
            setError(e)
        }
    }

    const onPasteFollowKey = async function () {
        setFollowKey((await Clipboard.getString()).trim())
    }

    const openFollowKeyModal = function () {
        setFollowKey(contactsStore.publicPubkey ? NostrClient.getNpubkey(contactsStore.publicPubkey) : '')
        setIsFollowKeyModalVisible(true)
    }

    const openConversation = function (contact?: Contact) {
        if (!contact?.id) return
        // replace, so Back from the conversation returns to the list, not here
        navigation.dispatch(StackActions.replace('Conversation', {contactId: contact.id}))
    }

    // stays on the screen, the row flips to "Added", so several can be added in a row
    const onAddNostr = function (candidate: Contact) {
        contactsStore.addContact(candidate)
    }

    const onAddLightning = function () {
        if (!lightningCandidate || !lightningName.trim()) return
        openConversation(contactsStore.addContact({
            kind: ContactKind.LIGHTNING,
            lud16: lightningCandidate,
            name: lightningName.trim(),
        }))
    }

    const renderCandidate = (candidate: Contact, index: number) => (
        <CandidateRow key={candidate.pubkey} candidate={candidate} isFirst={index === 0} onAdd={onAddNostr} />
    )

    return (
        <Screen preset='fixed' contentContainerStyle={$screen} contentUnderTabBar>
            <Animated.FlatList
                data={[]}
                renderItem={null}
                keyboardShouldPersistTaps='handled'
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                contentContainerStyle={[$content, {paddingBottom: tabBarInset + spacing.medium}]}
                ListHeaderComponent={
                    <>
                        <Card
                            style={$card}
                            ContentComponent={
                                <View>
                                    <View style={$inputRow}>
                                        <TextInput
                                            ref={inputRef}
                                            value={query}
                                            onChangeText={setQuery}
                                            placeholder={translate('addContact_placeholder')}
                                            placeholderTextColor={dimColor}
                                            autoCapitalize='none'
                                            autoCorrect={false}
                                            keyboardType='email-address'
                                            maxLength={200}
                                            style={[$input, {backgroundColor: inputBg, color: inputText}]}
                                        />
                                        {query.length > 0 && (
                                            <Icon icon='faXmark' color={dimColor} onPress={() => setQuery('')} />
                                        )}
                                    </View>
                                    <Text size='xxs' style={{color: dimColor, marginTop: spacing.extraSmall}} tx='addContact_hint' />
                                    <Button
                                        preset='tertiary'
                                        tx='addContact_loadFollows'
                                        onPress={openFollowKeyModal}
                                        style={$linkButton}
                                        textStyle={$linkText}
                                    />
                                </View>
                            }
                        />
                        {isSearching && <Text size='xs' style={[$status, {color: dimColor}]} tx='addContact_searching' />}
                        {!isSearching && hint && <Text size='xs' style={[$status, {color: dimColor}]} text={hint} />}
                        {!isSearching && lightningCandidate && (
                            <Card
                                style={$card}
                                ContentComponent={
                                    <View>
                                        <Text size='xs' text={translate('addContact_lightningNameHint', {address: lightningCandidate})} />
                                        <View style={[$inputRow, $fitToInput, {marginTop: spacing.small, marginBottom: spacing.small}]}>
                                            <TextInput
                                                value={lightningName}
                                                onChangeText={setLightningName}
                                                placeholder={translate('addContact_lightningName')}
                                                placeholderTextColor={dimColor}
                                                maxLength={60}
                                                style={[$input, $inputAttached, {backgroundColor: inputBg, color: inputText}]}
                                            />
                                            <Button tx='commonSave' onPress={onAddLightning} style={[$saveButton, $buttonFitInput]} />
                                        </View>
                                    </View>
                                }
                            />
                        )}
                        {!isSearching && results.length > 0 && (
                            <Card style={$card} ContentComponent={<>{results.map(renderCandidate)}</>} />
                        )}
                        {follows.length > 0 && (
                            <Card style={$card} ContentComponent={<>{follows.map(renderCandidate)}</>} />
                        )}
                        {isFollowsLoading && <Text size='xs' style={[$status, {color: dimColor}]} tx='addContact_searching' />}
                    </>
                }
            />
            <BottomModal
                isVisible={isFollowKeyModalVisible}
                onBackButtonPress={() => setIsFollowKeyModalVisible(false)}
                onBackdropPress={() => setIsFollowKeyModalVisible(false)}
                ContentComponent={
                    <View style={$modalContent}>
                        <Text tx='addContact_loadFollows' preset='subheading' />
                        <Text size='xs' style={{color: dimColor, textAlign: 'center'}} tx='addContact_followsSubText' />
                        <View style={[$inputRow, {marginTop: spacing.small}]}>
                            <TextInput
                                value={followKey}
                                onChangeText={setFollowKey}
                                placeholder='npub...'
                                placeholderTextColor={dimColor}
                                autoCapitalize='none'
                                autoCorrect={false}
                                selectTextOnFocus={true}
                                style={[$keyInput, {backgroundColor: inputBg, color: inputText}]}
                            />
                            <Button preset='secondary' tx='commonPaste' onPress={onPasteFollowKey} style={$pasteButton} />
                            <Button tx='commonSave' onPress={onSaveFollowKey} style={$saveButton} />
                        </View>
                        <View style={$modalButtons}>
                            {!followKey && (
                                <Button
                                    preset='tertiary'
                                    tx='contactsScreen_publicContacts_pasteDemoKey'
                                    onPress={() => setFollowKey(DEMO_FOLLOWS_NPUB)}
                                />
                            )}
                            <Button
                                preset='tertiary'
                                tx='commonCancel'
                                onPress={() => setIsFollowKeyModalVisible(false)}
                                style={{marginLeft: spacing.small}}
                            />
                        </View>
                    </View>
                }
            />
            {isFollowsLoading && follows.length === 0 && <Loading />}
            {error && <ErrorModal error={error} />}
        </Screen>
    )
})

/**
 * A search result or follow. Its own observer, so the plus flips to the check the
 * moment the contact is added — the surrounding list does not re-render its header
 * on store changes. Only the plus acts; the row has no onPress, so ListItem keeps it
 * inert.
 */
const CandidateRow = observer(function (props: {candidate: Contact, isFirst: boolean, onAdd: (c: Contact) => void}) {
    const {candidate} = props
    const {contactsStore} = useStores()
    const dimColor = useThemeColor('textDim')

    const existing = contactsStore.findById(getContactId(candidate) ?? '')
    const isAdded = !!existing && !existing.isRequest

    return (
        <ListItem
            text={getContactName(candidate)}
            subText={getContactAddress(candidate)}
            subTextEllipsizeMode='middle'
            LeftComponent={<ContactAvatar contact={candidate} style={$avatar} />}
            RightComponent={isAdded ? (
                <Icon icon='faCheck' size={spacing.medium} color={colors.palette.success200} containerStyle={$addIcon} />
            ) : (
                <Icon
                    icon='faPlus'
                    size={spacing.medium}
                    color={dimColor}
                    onPress={() => props.onAdd(candidate)}
                    hitSlop={spacing.small}
                    containerStyle={$addIcon}
                />
            )}
            topSeparator={!props.isFirst}
        />
    )
})

const $screen: ViewStyle = {
    flex: 1,
}

const $content: ViewStyle = {
    padding: spacing.extraSmall,
}

const $card: ViewStyle = {
    marginBottom: spacing.small,
}

const $inputRow: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
}

const $input: TextStyle = {
    flex: 1,
    borderRadius: spacing.small,
    fontSize: verticalScale(16),
    padding: spacing.small,
}

const $status: TextStyle = {
    textAlign: 'center',
    padding: spacing.small,
}

const $avatar: ViewStyle = {
    alignSelf: 'center',
    marginRight: spacing.medium,
}

const $linkButton: ViewStyle = {
    alignSelf: 'flex-start',
    minHeight: verticalScale(30),
    // the Button base sets paddingLeft/Right, which win over paddingHorizontal
    paddingLeft: 0,
    paddingRight: 0,
    marginTop: spacing.extraSmall,
    backgroundColor: 'transparent',
}

const $linkText: TextStyle = {
    fontSize: verticalScale(12),
    lineHeight: verticalScale(16),
}

const $modalContent: ViewStyle = {
    padding: spacing.small,
    alignItems: 'center',
}

// Input + attached Paste + attached Save, as in the original npub modal.
const $keyInput: TextStyle = {
    flex: 1,
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
}

const $pasteButton: ViewStyle = {
    borderRadius: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
}

const $saveButton: ViewStyle = {
    borderRadius: 0,
    borderTopRightRadius: spacing.small,
    borderBottomRightRadius: spacing.small,
    alignSelf: 'stretch',
    justifyContent: 'center',
}

const $modalButtons: ViewStyle = {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.medium,
}

const $addIcon: ViewStyle = {
    padding: spacing.small,
}

// The lightning name row: the input keeps the height of the other inputs and the
// attached Save button follows it, rather than the button's 50pt minimum stretching
// the input.
const $fitToInput: ViewStyle = {
    alignItems: 'stretch',
}

const $inputAttached: TextStyle = {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
}

const $buttonFitInput: ViewStyle = {
    minHeight: 0,
    paddingVertical: 0,
}
