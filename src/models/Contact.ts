import {Instance, SnapshotIn, SnapshotOut, types} from 'mobx-state-tree'

export type ContactData = {
    [index: string]: any
}

export enum ContactKind {
    /** A nostr profile: messaging, ecash and, if it has a lud16, lightning. */
    NOSTR = 'NOSTR',
    /** A bare lightning address: lightning payments only. */
    LIGHTNING = 'LIGHTNING',
}

/** NOSTR contacts are keyed by pubkey, LIGHTNING ones by their address. */
export const getContactId = function (contact: {kind?: ContactKind, pubkey?: string, lud16?: string}): string | undefined {
    if (contact.kind === ContactKind.LIGHTNING) {
        return contact.lud16?.toLowerCase()
    }
    return contact.pubkey ?? contact.lud16?.toLowerCase()
}

export const ContactModel = types
    .model('Contact', {
        id: types.identifier,
        kind: types.optional(types.frozen<ContactKind>(), ContactKind.NOSTR),
        npub: types.maybe(types.string),
        pubkey: types.maybe(types.string),
        name: types.maybe(types.string),
        about: types.maybe(types.string),
        display_name: types.maybe(types.string),
        picture: types.maybe(types.string),
        nip05: types.maybe(types.string),
        lud16: types.maybe(types.string),
        noteToSelf: types.maybe(types.string),
        data: types.maybe(types.string),
        isExternalDomain: types.optional(types.boolean, false),
        /** Wrote to us without being added; shown as a message request until accepted. */
        isRequest: types.optional(types.boolean, false),
        createdAt: types.optional(types.number, () => Math.floor(Date.now() / 1000)),
    })
    // Contacts before the redesign had no id/kind and carried a PRIVATE/PUBLIC
    // `type`; every stored one was a nostr profile keyed by pubkey. Not version
    // gated, so a backup or snapshot of any age loads.
    .preProcessSnapshot((snapshot: any) => {
        if (!snapshot) return snapshot
        const {type, ...rest} = snapshot
        const kind = rest.kind ?? ContactKind.NOSTR
        return {...rest, kind, id: rest.id ?? getContactId({...rest, kind})}
    })
    .actions(self => ({
        /** Takes what the contact's nostr profile (kind 0) currently says. */
        updateFromProfile(profile: {picture?: unknown, name?: unknown, display_name?: unknown, about?: unknown, lud16?: unknown}) {
            const str = (v: unknown) => typeof v === 'string' && v.length > 0 ? v : undefined
            self.picture = str(profile.picture) ?? self.picture
            self.name = str(profile.name) ?? self.name
            self.display_name = str(profile.display_name) ?? self.display_name
            self.about = str(profile.about) ?? self.about
            self.lud16 = str(profile.lud16) ?? self.lud16
        },
        setNoteToSelf(note: string) {
            self.noteToSelf = note
        },
        setLud16(lud16: string) {
            self.lud16 = lud16
        },
        setIsRequest(isRequest: boolean) {
            self.isRequest = isRequest
        },
    }))
    .views(self => ({
        get nip05handle() {
            return self.nip05 ?? self.lud16 ?? self.name
        },
    }))

export type Contact = {
    id?: string
    kind?: ContactKind
    npub?: string
    pubkey?: string
    name?: string
    picture?: string
    nip05?: string
    lud16?: string
    data?: string
    noteToSelf?: string
} & Partial<Instance<typeof ContactModel>>

// Plain functions rather than views: contacts travel through route params as
// plain objects (toJS), where views do not exist.

/** Messaging, ecash and P2PK need a nostr identity. */
export const isNostrContact = (c?: Contact): boolean =>
    !!c && c.kind !== ContactKind.LIGHTNING && !!c.pubkey

export const getContactName = (c: Contact): string =>
    c.display_name || c.name || c.nip05 || c.lud16 || c.npub?.slice(0, 16) || ''

/** The address shown under the name. */
export const getContactAddress = (c: Contact): string | undefined =>
    c.nip05 || c.lud16 || c.npub

export interface ContactSnapshotOut
  extends SnapshotOut<typeof ContactModel> {}
export interface ContactSnapshotIn
  extends SnapshotIn<typeof ContactModel> {}
