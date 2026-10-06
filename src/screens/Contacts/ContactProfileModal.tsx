import {observer} from 'mobx-react-lite'
import React, {useEffect, useState} from 'react'
import {Share, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import {BottomModal, Button, Icon, ListItem, Text} from '../../components'
import {useStores} from '../../models'
import {Contact, getContactAddress, getContactName, isNostrContact} from '../../models/Contact'
import {MINIBITS_NIP05_DOMAIN} from '@env'
import {NostrClient} from '../../services/nostrService'
import {log} from '../../services/logService'
import {colors, spacing, useThemeColor} from '../../theme'
import {translate} from '../../i18n'
import useIsInternetReachable from '../../utils/useIsInternetReachable'
import {ContactAvatar} from './ContactAvatar'

type SyncStatus = 'unknown' | 'synced' | 'not_synced'

/** The contact's profile and housekeeping, over the conversation (was ContactDetailScreen). */
export const ContactProfileModal = observer(function (props: {
    contact: Contact
    isVisible: boolean
    onClose: () => void
    onDelete: () => void
    onInfo: (message: string) => void
}) {
    const {contact, isVisible, onClose} = props
    const {contactsStore, relaysStore} = useStores()
    const isInternetReachable = useIsInternetReachable()

    const [note, setNote] = useState(contact.noteToSelf || '')
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('unknown')

    const textDim = useThemeColor('textDim')
    const inputText = useThemeColor('text')
    const inputBg = useThemeColor('background')

    // The nip05 must still point to the pubkey we pay to; a stale one is flagged.
    // Then the profile itself is re-read, so a changed picture or lightning address
    // shows up — best effort, a relay miss does not make the contact unverified.
    const verify = async function () {
        if (!contact.pubkey) return
        try {
            if (contact.nip05) {
                await NostrClient.verifyNip05(contact.nip05, contact.pubkey)
                setSyncStatus('synced')
            }
        } catch (e: any) {
            log.warn('[ContactProfileModal] Sync check failed', {message: e.message})
            setSyncStatus('not_synced')
            throw e
        }

        try {
            const relays = contact.nip05?.includes(MINIBITS_NIP05_DOMAIN)
                ? [...NostrClient.getMinibitsRelays(), ...relaysStore.allUrls]
                : relaysStore.allUrls
            const profile = await NostrClient.getProfileFromRelays(contact.pubkey, Array.from(new Set(relays)))
            if (profile) contactsStore.findById(contact.id!)?.updateFromProfile(profile)
        } catch (e: any) {
            log.warn('[ContactProfileModal] Could not refresh the profile', {message: e.message})
        }
    }

    useEffect(() => {
        if (isVisible && isInternetReachable && syncStatus === 'unknown') {
            verify().catch(() => {})
        }
    }, [isVisible])

    const copy = function (value?: string) {
        if (!value) return
        try {
            Clipboard.setString(value)
            props.onInfo(translate('commonCopySuccessParam', {param: value}))
        } catch (e: any) {
            props.onInfo(translate('commonCopyFailParam', {param: e.message}))
        }
    }

    const onSaveNote = function () {
        contactsStore.saveNote(contact.id!, note.trim())
    }

    const onSync = async function () {
        try {
            await verify()
            props.onInfo(translate('syncCompleted'))
        } catch (e: any) {
            props.onInfo(e.message)
        }
    }

    const address = getContactAddress(contact)

    return (
        <BottomModal
            isVisible={isVisible}
            style={{alignItems: 'stretch'}}
            onBackButtonPress={onClose}
            onBackdropPress={onClose}
            ContentComponent={
                <View>
                    <View style={$profile}>
                        <View>
                            <ContactAvatar contact={contact} size={80} />
                            {syncStatus !== 'unknown' && (
                                <View style={$syncBadge}>
                                    <Icon
                                        icon={syncStatus === 'synced' ? 'faCheckCircle' : 'faTriangleExclamation'}
                                        size={18}
                                        color={syncStatus === 'synced' ? colors.palette.success200 : colors.palette.angry500}
                                    />
                                </View>
                            )}
                        </View>
                        <Text preset='subheading' text={getContactName(contact)} style={{marginTop: spacing.small}} />
                        {address && <Text size='xs' style={{color: textDim}} text={address} />}
                        {!!contact.about && (
                            <Text size='xs' style={{color: textDim, marginTop: spacing.small, textAlign: 'center'}} text={contact.about.slice(0, 200)} />
                        )}
                    </View>
                    <View style={$noteRow}>
                        <TextInput
                            value={note}
                            onChangeText={setNote}
                            onEndEditing={onSaveNote}
                            maxLength={200}
                            placeholder={translate('privateNotePlaceholder')}
                            placeholderTextColor={textDim}
                            style={[$noteInput, {color: inputText, backgroundColor: inputBg}]}
                        />
                        <Button preset='secondary' tx='commonSave' onPress={onSaveNote} style={$noteButton} />
                    </View>
                    {contact.lud16 && (
                        <ListItem
                            text={contact.lud16}
                            subTx='lightningAddress'
                            leftIcon='faBolt'
                            leftIconColor={colors.palette.orange200}
                            rightIcon='faCopy'
                            rightIconColor={textDim as string}
                            onPress={() => copy(contact.lud16)}
                            bottomSeparator
                        />
                    )}
                    {isNostrContact(contact) && (
                        <ListItem
                            tx='copyContactPublicKey'
                            subText={contact.npub}
                            subTextEllipsizeMode='middle'
                            leftIcon='faCopy'
                            onPress={() => copy(contact.npub)}
                            bottomSeparator
                        />
                    )}
                    {address && (
                        <ListItem
                            tx='share_contactAddress'
                            subText={address}
                            leftIcon='faShareNodes'
                            onPress={() => Share.share({message: address}).catch(() => {})}
                            bottomSeparator
                        />
                    )}
                    {contact.nip05 && (
                        <ListItem
                            tx='checkAndSync'
                            subTx='checkAndSyncDesc'
                            leftIcon='faRotate'
                            onPress={onSync}
                            bottomSeparator
                        />
                    )}
                    <ListItem
                        tx='deleteContact'
                        subTx='deleteContactDesc'
                        leftIcon='faXmark'
                        onPress={props.onDelete}
                    />
                </View>
            }
        />
    )
})

const $profile: ViewStyle = {
    alignItems: 'center',
    marginBottom: spacing.medium,
}

const $syncBadge: ViewStyle = {
    position: 'absolute',
    bottom: -4,
    right: -4,
}

const $noteRow: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.small,
}

// Same compact input + attached button as RelaysScreen / OwnKeysScreen.
const $noteInput: TextStyle = {
    flex: 1,
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'center',
}

const $noteButton: ViewStyle = {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
}
